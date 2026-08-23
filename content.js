(() => {
  'use strict';

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'CSG_PING') {
      sendResponse({ ok: true, product: 'stability-guard-for-chatgpt' });
    }
  });

  // Remove consent metadata left by versions that required a first-run gate.
  // It is migration-only and is never consulted to decide whether the guard runs.
  chrome.storage.local.remove?.(['privacyConsent', 'privacyConsentVersion', 'privacyConsentAt']);

  chrome.storage.local.get({ uiLanguage: 'auto' }, ({ uiLanguage }) => {
    runGuard(uiLanguage);
  });

  function runGuard(uiLanguage) {

    const DEFAULTS = {
      enabled: true,
      hideThinking: false,
      hideTools: false,
      hideToolSummary: true,
      hideToolEmbeds: true,
      prehideToolPlaceholders: true,
      hideOldAppLoadErrors: true,
      dimTraces: true,
      compactTraces: true,
      reduceMotion: true,
      lazyHeavyBlocks: true,
      freezeOldTurns: false,
      keepTurns: 12,
      showRecentOnly: false,
      recentExchanges: 3,
      autoContinueIncomplete: false,
      autoContinuePatternMode: 'glob',
      autoContinuePattern: '*未完成*',
      showStatus: true
    };

    const state = {
      settings: { ...DEFAULTS },
      uiLanguage: ['ja', 'en'].includes(uiLanguage) ? uiLanguage : (String(navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en'),
      pendingRoots: new Set(),
      liveBoundaryRoots: new Set(),
      textToolShells: new Set(),
      toolShellMarkers: new Map(),
      toolSummaryMarkers: new Set(),
      toolSummaryStealthMarkers: new Set(),
      toolSummaryLiveMarkers: new Set(),
      toolSummaryInitialSweepQueued: new WeakSet(),
      toolSummaryFallbackSweepPending: new WeakSet(),
      toolSummaryFallbackSweepCursor: new WeakMap(),
      toolSummaryPendingRoots: new Set(),
      summaryMutationRoots: new Set(),
      summaryMutationScheduled: false,
      summaryLiveObserver: null,
      summaryLiveObservedTurns: new Set(),
      summaryBoundaryObserver: null,
      summaryBoundaryRoots: new Set(),
      summaryGenerationObserver: null,
      summaryGenerationRoot: null,
      summaryGenerationActive: false,
      previewSurfaces: new Map(),
      previewMounts: new Map(),
      oldAppLoadErrors: new Set(),
      oldAppErrorObservers: new Map(),
      oldAppErrorRefreshTimer: 0,
      oldAppErrorRouteKey: location.pathname + location.search,
      oldAppRoutePending: false,
      oldAppRouteSettleTimer: 0,
      oldAppRouteFallbackTimer: 0,
      oldAppRouteCheckTimer: 0,
      oldAppRoutePreviousTurns: new Map(),
      oldAppStableTurns: new Map(),
      latestTurnIndex: -1,
      liveProtectedTurns: new Set(),
      scheduled: false,
      freezeTimer: 0,
      toolCleanupTimer: 0,
      detachedCleanupTimer: 0,
      autoContinueTimer: 0,
      autoContinueSending: false,
      autoContinueHandledKeys: new Set(),
      autoContinueMatcherKey: '',
      autoContinueMatcher: null,
      autoContinueMatcherInvalid: false,
      stats: { thinking: 0, tools: 0, frozen: 0, scans: 0, autoContinues: 0 }
    };

    const root = document.documentElement;
    function normalizeSettings(raw = {}) {
      const legacy = raw.hideToolChrome;
      return {
        ...DEFAULTS,
        ...raw,
        hideToolSummary: raw.hideToolSummary ?? legacy ?? DEFAULTS.hideToolSummary,
        hideToolEmbeds: raw.hideToolEmbeds ?? legacy ?? DEFAULTS.hideToolEmbeds,
        prehideToolPlaceholders: raw.prehideToolPlaceholders ?? legacy ?? DEFAULTS.prehideToolPlaceholders,
        autoContinuePatternMode: raw.autoContinuePatternMode === 'regex' ? 'regex' : 'glob',
        autoContinuePattern: typeof raw.autoContinuePattern === 'string'
          ? raw.autoContinuePattern.slice(0, 512) : DEFAULTS.autoContinuePattern
      };
    }

    const THINK_KEYS = ['think', 'thinking', 'thought', 'reason', 'reasoning'];
    // "connector" is also used by ChatGPT's first-party connector/plugin UI.
    // Treating it as a generic tool-trace token can mutate real Connect/Add controls.
    const TOOL_KEYS = ['tool', 'mcp'];

    const idle = (fn) => {
      if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 450 });
      else setTimeout(fn, 120);
    };

    function hasKey(value, keys) {
      const text = String(value || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase();
      const tokens = text.split(/[^a-z0-9]+/).filter(Boolean);
      return keys.some((key) => tokens.includes(key));
    }

    function normalizeLabel(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function isToolSummaryLabel(text) {
      const value = normalizeLabel(text);
      const compact = value.replace(/\s+/g, '');
      const lower = compact.toLowerCase();
      return compact.includes('ツールが呼び出されました') ||
        lower.includes('toolswerecalled') || lower.includes('toolscalled') ||
        lower.includes('calledtool') || lower.includes('calledtools');
    }

    function isExactToolSummaryLabel(text) {
      const value = normalizeLabel(text);
      const compact = value.replace(/\s+/g, '');
      const lower = compact.toLowerCase();
      return compact === 'ツールが呼び出されました' ||
        lower === 'toolswerecalled' || lower === 'toolscalled' ||
        lower === 'calledtool' || lower === 'calledtools';
    }

    function isConfigLabel(text) {
      return text.startsWith('View config ·') || text.startsWith('設定を表示 ·');
    }

    const TURN_SELECTOR = '[data-testid^="conversation-turn-"]';
    const SEMANTIC_ACTION_SELECTOR = [
      'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
      '[contenteditable]:not([contenteditable="false"])', '[role="button"]', '[role="link"]',
      '[role="checkbox"]', '[role="switch"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
      '[role="menuitemradio"]', '[role="combobox"]', '[role="slider"]', '[role="spinbutton"]',
      '[role="radio"]', '[role="tab"]', '[role="treeitem"]', '[role="option"]', '[role="dialog"]',
      '[aria-modal="true"]'
    ].join(',');
    const ACTIONABLE_UI_SELECTOR = `${SEMANTIC_ACTION_SELECTOR},[tabindex]:not([tabindex="-1"])`;

    function isConversationTurnScoped(el) {
      return el instanceof Element && Boolean(el.closest(TURN_SELECTOR));
    }

    function boundedElementText(element, maxChars = 220, maxNodes = 24) {
      if (!(element instanceof Element)) return '';
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let text = '';
      let seen = 0;
      for (let node = walker.nextNode(); node && seen < maxNodes && text.length < maxChars; node = walker.nextNode()) {
        const raw = String(node.nodeValue || '');
        if (!raw.trim()) continue;
        seen += 1;
        text += ` ${raw.slice(0, maxChars - text.length)}`;
      }
      return normalizeLabel(text).slice(0, maxChars);
    }

    function boundedControlLabel(control, maxChars = 220) {
      if (!(control instanceof Element)) return '';
      const explicit = control.getAttribute('aria-label') || control.getAttribute('title');
      if (explicit) return normalizeLabel(explicit).slice(0, maxChars);
      if (control.matches('pre,table') && control.hasAttribute('tabindex')) return '';
      return boundedElementText(control, maxChars, 24);
    }

    function hasToolSummaryTextHint(value) {
      const text = String(value || '');
      const compact = text.replace(/\s+/g, '');
      const lower = compact.toLowerCase();
      return compact.includes('ツールが') || compact.includes('呼び出') ||
        lower.includes('tools') || lower.includes('called') || lower.includes('were');
    }

    const ACTION_LINK_LABEL_RE = /(?:\b(?:connect|authori[sz]e|authenticate|sign\s*in|log\s*in|continue|allow|grant|enable|retry|add(?:\s+(?:account|app|connector|plugin|source|library))?)\b|接続|認証|ログイン|追加|許可|連携|再試行)/i;
    const TOOL_LIST_BUTTON_EXACT_SELECTOR = [
      'button[aria-label="Open tool call list" i]',
      'button[aria-label="ツール呼び出しリストを開く"]'
    ].join(',');
    const TOOL_LIST_BUTTON_SELECTOR = [
      TOOL_LIST_BUTTON_EXACT_SELECTOR,
      'button[type="button"][aria-label][data-state="closed"]',
      'button[type="button"][aria-label][data-state="open"]'
    ].join(',');

    function isPassiveToolDisclosure(control) {
      if (!(control instanceof Element)) return false;
      const ownLabel = boundedControlLabel(control, 181);
      // Never turn a real Connect/Auth/Retry-like control into passive chrome.
      if (ACTION_LINK_LABEL_RE.test(ownLabel)) return false;
      // A <summary> is passive only when it is itself the redundant summary.
      // Arbitrary details actions such as "Authorize" must remain actionable.
      if (control.matches('summary')) {
        return ownLabel.length <= 180 &&
          (isExactToolSummaryLabel(ownLabel) || isConfigLabel(ownLabel));
      }
      // Current ChatGPT MCP rows contain an icon-only nested button whose only
      // job is opening the tool-call list. English is the fast path; for a
      // localized aria-label, identify it from the enclosing disclosure's
      // visible summary text instead of depending on the translated label.
      if (control.matches(TOOL_LIST_BUTTON_EXACT_SELECTOR)) return true;
      const ownsToolListControl = Boolean(control.querySelector(TOOL_LIST_BUTTON_SELECTOR));
      if (ownsToolListControl && ownLabel.length <= 180 && isExactToolSummaryLabel(ownLabel)) return true;
      const parentDisclosure = control.parentElement?.closest('button,summary,[role="button"],[aria-expanded]');
      if (parentDisclosure && parentDisclosure !== control) {
        const parentText = boundedElementText(parentDisclosure, 181, 24);
        if (parentText.length <= 180 && isExactToolSummaryLabel(parentText)) return true;
      }
      // An exact label alone is not enough to turn an arbitrary semantic action
      // into passive chrome. Require an actual disclosure state for button-like
      // controls; otherwise a legitimate App button named "Called tool" would be
      // made inert. <summary> was handled above and the dedicated list control /
      // enclosing native disclosure were handled by the structural checks above.
      if (!control.hasAttribute('aria-expanded')) return false;
      return ownLabel.length <= 180 && (isExactToolSummaryLabel(ownLabel) || isConfigLabel(ownLabel));
    }

    function hasActionableUi(element, allowPassiveTraceControls = false) {
      if (!(element instanceof Element)) return false;
      const controls = [];
      if (element.matches(ACTIONABLE_UI_SELECTOR)) controls.push(element);
      controls.push(...element.querySelectorAll(ACTIONABLE_UI_SELECTOR));
      return controls.some((control) => {
        if (!allowPassiveTraceControls) return true;
        // Normal assistant output can legitimately contain links, focus-only
        // scroll containers and copy controls. Ignore those narrow cases, but
        // action-looking auth/connect links must fail open even in markdown/code.
        const label = boundedControlLabel(control);
        if (control.closest('pre, code')) {
          if (/^(copy|copy code|コピー|コードをコピー)$/i.test(label)) return false;
          return ACTION_LINK_LABEL_RE.test(label);
        }
        if (control.matches('a[href]') && control.closest('.markdown')) {
          const buttonLike = control.getAttribute('role') === 'button' || ACTION_LINK_LABEL_RE.test(label);
          if (!buttonLike) return false;
        }
        if (control.closest('.markdown') && control.hasAttribute('tabindex') &&
            !control.matches(SEMANTIC_ACTION_SELECTOR)) {
          return false;
        }
        if (control.closest('.markdown') && /^(copy|copy code|コピー|コードをコピー)$/i.test(label)) return false;
        return !isPassiveToolDisclosure(control);
      });
    }

    const APP_BOOTSTRAP_BUSY_SELECTOR = '[role="progressbar"],[aria-busy="true"]';
    const APP_BOOTSTRAP_BUSY_TEXT_RE = /(?:loading|fetching|initializing|analyzing)\s+(?:app|template|image)|(?:app|template)\s+(?:loading|initializing)|アプリ[^。]{0,24}(?:読み込|ロード)|テンプレート[^。]{0,24}(?:取得|読み込)|画像[^。]{0,24}(?:解析|分析)/i;
    const APP_BOOTSTRAP_BUSY_COMPACT_RE = /(?:loading|fetching|initializing|analyzing)(?:app|template|image)|(?:app|template)(?:loading|initializing)|アプリ.{0,24}(?:読み込|ロード)|テンプレート.{0,24}(?:取得|読み込)|画像.{0,24}(?:解析|分析)/i;

    function hasBootstrapBusyText(element) {
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.classList.contains('markdown')) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_SKIP;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );
      let spaced = '';
      let joined = '';
      let seen = 0;
      for (let node = walker.nextNode(); node && seen < 64; node = walker.nextNode()) {
        const raw = String(node.nodeValue || '');
        if (!raw.trim()) continue;
        seen += 1;
        const fragment = raw.slice(0, 120);
        spaced = `${spaced} ${fragment}`.slice(-360);
        joined = `${joined}${fragment}`.slice(-360);
        const normalizedSpaced = normalizeLabel(spaced);
        const normalizedJoined = normalizeLabel(joined);
        const compactJoined = normalizedJoined.replace(/\s+/g, '');
        if (APP_BOOTSTRAP_BUSY_TEXT_RE.test(normalizedSpaced) ||
            APP_BOOTSTRAP_BUSY_TEXT_RE.test(normalizedJoined) ||
            APP_BOOTSTRAP_BUSY_COMPACT_RE.test(compactJoined)) return true;
      }
      return false;
    }

    function hasActiveAppBootstrapUi(element) {
      if (!(element instanceof Element)) return false;
      if (element.matches(APP_BOOTSTRAP_BUSY_SELECTOR) || element.querySelector(APP_BOOTSTRAP_BUSY_SELECTOR)) return true;
      if (element.closest('.markdown')) return false;
      const uiShaped = element.matches('.no-scrollbar,.mt-2,[class~="group/tool-message"],[data-testid*="tool"],[data-testid*="app"]') ||
        Boolean(element.querySelector('.no-scrollbar,[class~="group/tool-message"],[data-testid*="tool"],[data-testid*="app"]')) ||
        element.nextElementSibling?.matches?.('.no-scrollbar') || element.previousElementSibling?.matches?.('.no-scrollbar');
      if (!uiShaped) return false;
      return hasBootstrapBusyText(element);
    }

    function turnId(turn) {
      return turn instanceof Element ? (turn.getAttribute('data-testid') || '') : '';
    }

    function turnMessageId(turn) {
      if (!(turn instanceof Element)) return '';
      return turn.getAttribute('data-message-id') ||
        turn.querySelector('[data-message-id]')?.getAttribute('data-message-id') || '';
    }

    function routeTurnIdentity(turn) {
      return `${turnId(turn)}|${turnMessageId(turn)}`;
    }

    function turnIndexFromId(id) {
      const match = /^conversation-turn-(\d+)$/.exec(String(id || ''));
      return match ? Number(match[1]) : -1;
    }

    const LIVE_TOOL_GUARD_TURNS = 2;
    const STOP_GENERATING_SELECTOR = [
      'button[data-testid="stop-button"]',
      'button[data-testid="stop-generating-button"]',
      'button[aria-label="Stop generating" i]',
      'button[aria-label="Stop answering" i]',
      'button[aria-label="Stop response" i]',
      'button[aria-label*="生成を停止"]',
      'button[aria-label*="応答を停止"]'
    ].join(',');

    function isGenerationActive() {
      return Boolean(document.querySelector(STOP_GENERATING_SELECTOR));
    }

    function wasStopGeneratingAttribute(attributeName, oldValue) {
      const value = String(oldValue || '').trim();
      if (!value) return false;
      if (attributeName === 'data-testid') {
        return value === 'stop-button' || value === 'stop-generating-button';
      }
      if (attributeName !== 'aria-label') return false;
      return /^(?:Stop generating|Stop answering|Stop response)$/i.test(value) ||
        value.includes('生成を停止') || value.includes('応答を停止');
    }

    function mountedLatestTurnIndex() {
      let latest = -1;
      for (const turn of document.querySelectorAll(TURN_SELECTOR)) {
        latest = Math.max(latest, turnIndexFromId(turnId(turn)));
      }
      return latest;
    }

    function computeLatestBoundaryTurns(latestIndex, turns = [...document.querySelectorAll(TURN_SELECTOR)]) {
      const protectedTurns = new Set(turns.slice(-LIVE_TOOL_GUARD_TURNS));
      for (const turn of turns) {
        const index = turnIndexFromId(turnId(turn));
        if (index < 0 || latestIndex < 0 || index >= latestIndex - (LIVE_TOOL_GUARD_TURNS - 1)) {
          protectedTurns.add(turn);
        }
      }
      return protectedTurns;
    }

    function computeLiveProtectedTurns(latestIndex, turns = [...document.querySelectorAll(TURN_SELECTOR)]) {
      return isGenerationActive() ? computeLatestBoundaryTurns(latestIndex, turns) : new Set();
    }

    function isProtectedLiveToolTurn(element, latestIndex = mountedLatestTurnIndex(), protectedTurns = state.liveProtectedTurns) {
      if (!(element instanceof Element)) return true;
      const turn = element.closest(TURN_SELECTOR);
      if (!(turn instanceof Element)) return true;
      if (!isGenerationActive()) return false;
      if (protectedTurns?.has(turn)) return true;
      const index = turnIndexFromId(turnId(turn));
      if (index < 0 || latestIndex < 0) return true;
      return index >= latestIndex - (LIVE_TOOL_GUARD_TURNS - 1);
    }

    function queueLiveProtectionBoundaryChanges(latestTurnIndex) {
      const turns = [...document.querySelectorAll(TURN_SELECTOR)];
      const nextProtectedTurns = computeLiveProtectedTurns(latestTurnIndex, turns);
      const changedTurns = turns.filter((turn) =>
        state.liveProtectedTurns.has(turn) !== nextProtectedTurns.has(turn)
      );
      state.liveProtectedTurns = nextProtectedTurns;
      for (const turn of changedTurns) {
        state.liveBoundaryRoots.add(turn);
        if (state.settings.hideToolEmbeds) scanPreviewSurfaces(turn);
      }
      return changedTurns;
    }

    const APP_ERROR_CANDIDATE_SELECTOR = 'aside[class*="surface-error"],[class*="surface-error"],.text-token-text-error';
    const APP_ERROR_RETRY_RE = /^(?:retry|再試行)$/i;

    function hasAppTemplateFetchErrorText(value) {
      const text = normalizeLabel(value);
      return text.includes('Failed to fetch template') ||
        /アプリ[^。]{0,32}(?:読み込み|読込|ロード)[^。]{0,24}エラー/.test(text) ||
        /テンプレート[^。]{0,32}(?:取得|読み込み|読込)[^。]{0,24}(?:失敗|エラー)/.test(text);
    }

    function appErrorShellFor(element) {
      if (!(element instanceof Element) || element.closest('.markdown')) return null;
      const turn = element.closest(TURN_SELECTOR);
      if (!(turn instanceof Element)) return null;
      for (let cursor = element, depth = 0;
           cursor instanceof Element && cursor !== turn && depth < 8;
           cursor = cursor.parentElement, depth += 1) {
        const className = String(cursor.className || '');
        if (className.includes('surface-error')) return cursor;
      }
      return null;
    }

    function isAppErrorShell(element) {
      return appErrorShellFor(element) === element;
    }

    const TEXT_BREAK_TAGS = new Set([
      'ADDRESS','ARTICLE','ASIDE','BLOCKQUOTE','BR','DIV','DL','DT','DD','FIELDSET','FIGCAPTION','FIGURE',
      'FOOTER','FORM','H1','H2','H3','H4','H5','H6','HEADER','HR','LI','MAIN','NAV','OL','P','PRE','SECTION','TABLE',
      'TBODY','TD','TFOOT','TH','THEAD','TR','UL'
    ]);

    function stableElementText(element) {
      if (!(element instanceof Element)) return '';
      let text = '';
      const append = (value) => { text += value; };
      const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          append(node.nodeValue || '');
          return;
        }
        if (!(node instanceof Element)) return;
        const breaks = TEXT_BREAK_TAGS.has(node.tagName);
        if (breaks) append(' ');
        for (const child of node.childNodes) walk(child);
        if (breaks) append(' ');
      };
      for (const child of element.childNodes) walk(child);
      return normalizeLabel(text);
    }

    function isAppTemplateFetchErrorCard(shell) {
      if (!isAppErrorShell(shell)) return false;
      const text = stableElementText(shell);
      if (!hasAppTemplateFetchErrorText(text)) return false;
      const heading = shell.querySelector(
        'h1.text-token-text-error,h2.text-token-text-error,h3.text-token-text-error,' +
        'h4.text-token-text-error,h5.text-token-text-error,h6.text-token-text-error,' +
        '[role="heading"].text-token-text-error,.font-bold.text-token-text-error'
      );
      const hasRetry = [...shell.querySelectorAll('button,[role="button"]')].some((control) =>
        APP_ERROR_RETRY_RE.test(boundedControlLabel(control, 40))
      );
      // Legacy cards expose a semantic heading; current ChatGPT cards are divs
      // whose outer error surface carries text-token-text-error plus Retry.
      return heading instanceof Element || hasRetry || shell.classList.contains('text-token-text-error');
    }

    function appErrorCandidatesFor(root) {
      if (!(root instanceof Element)) return [];
      const shells = new Set();
      const add = (candidate) => {
        const shell = appErrorShellFor(candidate);
        if (shell) shells.add(shell);
      };
      add(root);
      root.querySelectorAll?.(APP_ERROR_CANDIDATE_SELECTOR).forEach(add);
      return [...shells];
    }

    function stopOldAppErrorObserver(aside) {
      const observer = state.oldAppErrorObservers.get(aside);
      observer?.disconnect();
      state.oldAppErrorObservers.delete(aside);
    }

    function observeOldAppErrorShell(aside) {
      if (!(aside instanceof Element) || state.oldAppErrorObservers.has(aside)) return;
      const observer = new MutationObserver(() => scheduleScan(aside));
      observer.observe(aside, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class']
      });
      state.oldAppErrorObservers.set(aside, observer);
    }

    function clearOldAppErrorTracking() {
      clearTimeout(state.oldAppErrorRefreshTimer);
      state.oldAppErrorRefreshTimer = 0;
      for (const aside of state.oldAppLoadErrors) aside.classList.remove('csg-old-app-load-error');
      state.oldAppLoadErrors.clear();
      for (const observer of state.oldAppErrorObservers.values()) observer.disconnect();
      state.oldAppErrorObservers.clear();
    }

    function cleanupOldAppErrorTracking() {
      for (const aside of [...state.oldAppErrorObservers.keys()]) {
        if (aside.isConnected) continue;
        stopOldAppErrorObserver(aside);
        state.oldAppLoadErrors.delete(aside);
      }
    }

    function routeTurnSnapshot() {
      return new Map([...document.querySelectorAll(TURN_SELECTOR)].map((turn) => [turn, routeTurnIdentity(turn)]));
    }

    function routeTurnSnapshotChanged() {
      const current = [...document.querySelectorAll(TURN_SELECTOR)];
      if (current.length !== state.oldAppRoutePreviousTurns.size) return true;
      const currentSet = new Set(current);
      for (const [turn, identity] of state.oldAppRoutePreviousTurns) {
        if (!turn.isConnected || !currentSet.has(turn) || routeTurnIdentity(turn) !== identity) return true;
      }
      return false;
    }

    function finalizeOldAppRouteTransition() {
      state.oldAppRouteSettleTimer = 0;
      clearTimeout(state.oldAppRouteFallbackTimer);
      state.oldAppRouteFallbackTimer = 0;
      clearTimeout(state.oldAppRouteCheckTimer);
      state.oldAppRouteCheckTimer = 0;
      if (location.pathname + location.search !== state.oldAppErrorRouteKey) {
        beginOldAppRouteTransition();
        return;
      }
      state.oldAppRoutePending = false;
      state.oldAppRoutePreviousTurns.clear();
      state.latestTurnIndex = -1;
      for (const aside of appErrorCandidatesFor(document.body)) {
        observeOldAppErrorShell(aside);
        if (isAppTemplateFetchErrorCard(aside)) state.oldAppLoadErrors.add(aside);
      }
      scheduleOldAppErrorRefresh();
    }

    function scheduleOldAppRouteSettle(delay = 350) {
      // Once a structural change proves that the new route DOM has started to
      // replace the old one, do not debounce forever on continued streaming
      // mutations. Finalizing from a partial new-route DOM is safe because the
      // latest-turn classifier only hides when current mounted numeric turn
      // order proves an error old; later scans recompute that evidence.
      if (state.oldAppRouteSettleTimer) return;
      state.oldAppRouteSettleTimer = setTimeout(finalizeOldAppRouteTransition, delay);
    }

    function beginOldAppRouteTransition() {
      const routeKey = location.pathname + location.search;
      clearOldAppErrorTracking();
      clearTimeout(state.oldAppRouteSettleTimer);
      clearTimeout(state.oldAppRouteFallbackTimer);
      clearTimeout(state.oldAppRouteCheckTimer);
      state.oldAppRouteSettleTimer = 0;
      state.oldAppRouteFallbackTimer = 0;
      state.oldAppRouteCheckTimer = 0;
      state.oldAppErrorRouteKey = routeKey;
      state.latestTurnIndex = -1;
      state.oldAppRoutePending = true;
      state.oldAppRoutePreviousTurns = state.oldAppStableTurns.size
        ? new Map(state.oldAppStableTurns) : routeTurnSnapshot();
      // If URL and DOM changed in the same React commit, the stable snapshot
      // already proves that the new route DOM is present. Otherwise stay
      // fail-open while waiting for a structural change. A bounded fallback
      // prevents permanent pending state when React reuses the same turn shells;
      // classification itself still fails open for any ambiguous latest turn.
      if (routeTurnSnapshotChanged()) scheduleOldAppRouteSettle(350);
      state.oldAppRouteFallbackTimer = setTimeout(() => {
        state.oldAppRouteFallbackTimer = 0;
        if (state.oldAppRoutePending && location.pathname + location.search === state.oldAppErrorRouteKey) {
          finalizeOldAppRouteTransition();
        }
      }, 2000);
    }

    function ensureOldAppErrorRoute() {
      const routeKey = location.pathname + location.search;
      if (routeKey === state.oldAppErrorRouteKey) return !state.oldAppRoutePending;
      beginOldAppRouteTransition();
      return false;
    }

    function noteOldAppRouteStructureChange() {
      if (!state.oldAppRoutePending || state.oldAppRouteCheckTimer) return;
      state.oldAppRouteCheckTimer = setTimeout(() => {
        state.oldAppRouteCheckTimer = 0;
        if (state.oldAppRoutePending && routeTurnSnapshotChanged()) scheduleOldAppRouteSettle(350);
      }, 0);
    }

    function updateLatestTurnKnowledge() {
      // Current ChatGPT turn IDs are numeric. If the site moves to opaque IDs,
      // this feature intentionally fails open instead of guessing the latest turn.
      let mountedMax = -1;
      for (const turn of document.querySelectorAll(TURN_SELECTOR)) {
        mountedMax = Math.max(mountedMax, turnIndexFromId(turnId(turn)));
      }
      // Use only the currently provable maximum. Keeping a historical maximum
      // would survive upward virtualization, but it can also survive an in-place
      // edit/branch switch to a shorter branch and then hide that branch's true
      // latest error. A smaller mounted window is therefore treated as ambiguous:
      // false negatives are acceptable here; hiding the latest error is not.
      state.latestTurnIndex = mountedMax;
    }

    function refreshOldAppErrors() {
      state.oldAppErrorRefreshTimer = 0;
      if (!ensureOldAppErrorRoute()) return;
      if (!state.settings.enabled || !state.settings.hideOldAppLoadErrors) {
        clearOldAppErrorTracking();
        return;
      }
      updateLatestTurnKnowledge();
      // App load errors keep the latest two-turn safety boundary even after
      // generation ends; unlike passive tool chrome, a Retry on the newest
      // response must never be hidden just because the Stop button vanished.
      const currentLiveTurns = computeLatestBoundaryTurns(state.latestTurnIndex);
      for (const aside of [...state.oldAppLoadErrors]) {
        if (!aside.isConnected || !isAppTemplateFetchErrorCard(aside)) {
          aside.classList.remove('csg-old-app-load-error');
          state.oldAppLoadErrors.delete(aside);
          if (!aside.isConnected || !isAppErrorShell(aside)) stopOldAppErrorObserver(aside);
          continue;
        }
        const turn = aside.closest(TURN_SELECTOR);
        const index = turnIndexFromId(turnId(turn));
        const canProveOld = index >= 0 && state.latestTurnIndex >= 0 &&
          turn instanceof Element && !currentLiveTurns.has(turn);
        aside.classList.toggle('csg-old-app-load-error', canProveOld);
      }
      state.oldAppStableTurns = routeTurnSnapshot();
    }

    function scheduleOldAppErrorRefresh() {
      if (state.oldAppErrorRefreshTimer || state.oldAppRoutePending ||
          !state.settings.enabled || !state.settings.hideOldAppLoadErrors) return;
      state.oldAppErrorRefreshTimer = setTimeout(refreshOldAppErrors, 120);
    }

    function scanOldAppErrors(candidates, turnStructureChanged) {
      if (!state.settings.enabled || !state.settings.hideOldAppLoadErrors) return;
      if (!ensureOldAppErrorRoute()) {
        if (turnStructureChanged) noteOldAppRouteStructureChange();
        return;
      }
      let changed = false;
      for (const aside of candidates) {
        if (isAppErrorShell(aside)) {
          observeOldAppErrorShell(aside);
          if (isAppTemplateFetchErrorCard(aside)) {
            if (!state.oldAppLoadErrors.has(aside)) changed = true;
            state.oldAppLoadErrors.add(aside);
          } else if (state.oldAppLoadErrors.delete(aside) || aside.classList.contains('csg-old-app-load-error')) {
            aside.classList.remove('csg-old-app-load-error');
            changed = true;
          }
          continue;
        }
        if (state.oldAppLoadErrors.delete(aside) || aside.classList.contains('csg-old-app-load-error')) {
          aside.classList.remove('csg-old-app-load-error');
          changed = true;
        }
        stopOldAppErrorObserver(aside);
      }
      if (changed || turnStructureChanged) scheduleOldAppErrorRefresh();
    }

    function analyzeElement(el, latestTurnIndex) {
      if (!(el instanceof Element)) return null;
      const inTurn = isConversationTurnScoped(el);
      const testId = el.getAttribute('data-testid') || '';
      const hasAppAction = inTurn && hasActionableUi(el, true);
      const activeAppBootstrap = inTurn && hasActiveAppBootstrapUi(el);
      const hasAppSurface = inTurn && hasAppSurfaceUi(el);
      const liveToolProtected = inTurn && isProtectedLiveToolTurn(el, latestTurnIndex);
      // Interactive rich UI must fail open. Thinking/tool traces are optimization
      // targets; Connect/Add/auth controls are application UI and stay untouched.
      // Tool wrappers in the newest exchange are also kept live because ChatGPT
      // apps can defer template/bootstrap work until their DOM is visible/laid out.
      const isThinking = inTurn && hasKey(testId, THINK_KEYS) && !hasAppAction && !activeAppBootstrap && !hasAppSurface && !liveToolProtected;
      const isTool = inTurn && hasKey(testId, TOOL_KEYS) && !hasAppAction && !activeAppBootstrap && !hasAppSurface && !liveToolProtected;
      const isTrace = isThinking || isTool;
      const traceChildren = [...el.children].filter((child) => child.classList.contains('csg-trace-body'));
      let traceBody = null;
      if (isTrace && el.children.length > 1) {
        const body = el.lastElementChild;
        if (body && !hasActionableUi(body, true)) traceBody = body;
      }
      const isHeavy = inTurn && !hasAppAction && !activeAppBootstrap && !hasAppSurface && !liveToolProtected && state.settings.lazyHeavyBlocks &&
        (el.matches('pre') || hasKey(testId, ['code']));
      return { el, isThinking, isTool, isHeavy, traceChildren, traceBody };
    }

    function applyElementAnalysis(plan, traceBlockSizes = null) {
      if (!plan) return;
      const { el, isThinking, isTool, isHeavy, traceChildren, traceBody } = plan;
      el.classList.toggle('csg-thinking', isThinking);
      el.classList.toggle('csg-tool', isTool);
      el.classList.toggle('csg-heavy', isHeavy);
      for (const child of traceChildren) {
        child.style.removeProperty('--csg-collapse-block');
      }
      if (traceBody) {
        const measured = traceBlockSizes?.get(traceBody);
        traceBody.style.setProperty('--csg-collapse-block', `${Number.isFinite(measured) ? measured : 0}px`);
        traceBody.classList.add('csg-trace-body');
      }
    }

    function markToolChrome(shell, marker = shell) {
      if (!(shell instanceof Element) || !(marker instanceof Element)) return;
      shell.classList.add('csg-tool-ui');
      state.textToolShells.add(shell);
      state.toolShellMarkers.set(shell, marker);
      if (!shell.matches('[class~="group/tool-message"]')) observeToolMarker(marker);
    }

    function unmarkToolChrome(shell) {
      if (!(shell instanceof Element)) return;
      shell.classList.remove('csg-tool-ui');
      state.textToolShells.delete(shell);
      state.toolShellMarkers.delete(shell);
    }

    function markToolSummary(marker, measuredBlock = null) {
      if (!(marker instanceof Element)) return;
      // Geometry is measured by measureToolSummaryPlans(), which batches every
      // live-handoff write before every layout read. Keep this function write-only
      // so repeated historical classification cannot force synchronous layout.
      if (!marker.classList.contains('csg-tool-summary')) {
        if (Number.isFinite(measuredBlock)) {
          marker.style.setProperty('--csg-collapse-block', `${measuredBlock}px`);
        }
        marker.classList.add('csg-tool-summary');
      }
      state.toolSummaryMarkers.add(marker);
    }

    function unmarkToolSummary(marker) {
      if (!(marker instanceof Element)) return;
      marker.classList.remove('csg-tool-summary');
      marker.style.removeProperty('--csg-collapse-block');
      state.toolSummaryMarkers.delete(marker);
    }

    function markToolSummaryStealth(marker) {
      if (!(marker instanceof Element)) return;
      // Never mutate disclosure state or synthesize clicks here. React owns the
      // component state. Stealth only changes presentation of the redundant label.
      marker.classList.add('csg-tool-summary-stealth');
      state.toolSummaryStealthMarkers.add(marker);
    }

    function unmarkToolSummaryStealth(marker) {
      if (!(marker instanceof Element)) return;
      marker.classList.remove('csg-tool-summary-stealth');
      state.toolSummaryStealthMarkers.delete(marker);
    }

    function markToolSummaryLive(marker) {
      if (!(marker instanceof Element)) return;
      marker.classList.add('csg-tool-summary-live');
      state.toolSummaryLiveMarkers.add(marker);
    }

    function unmarkToolSummaryLive(marker) {
      if (!(marker instanceof Element)) return;
      marker.classList.remove('csg-tool-summary-live');
      state.toolSummaryLiveMarkers.delete(marker);
    }

    const APP_SURFACE_SELECTOR = [
      'iframe', 'canvas', 'video', 'audio', 'table', 'picture', 'object', 'embed',
      '[data-testid*="app"]', '[data-testid*="widget"]', '[data-testid*="artifact"]',
      '[role="application"]', '[role="region"]', 'aside[class*="surface-error"]'
    ].join(',');
    const APP_SURFACE_SELF_SELECTOR = APP_SURFACE_SELECTOR;

    function isToolSummaryDecoration(media, shell) {
      if (!(media instanceof Element) || !(shell instanceof Element)) return false;
      const control = media.closest('button,summary,[role="button"]');
      if (control instanceof Element && shell.contains(control)) {
        // The icon-only native list button exposes an action-style aria-label
        // ("Open tool call list"), not the visible summary text. Recognize it
        // structurally before any CSG class exists so its 18px SVG can never be
        // mistaken for App output during the first historical scan.
        if (control.matches(TOOL_LIST_BUTTON_EXACT_SELECTOR)) return true;
        if (control.matches(TOOL_LIST_BUTTON_SELECTOR)) {
          let row = control;
          while (row.parentElement instanceof Element && row.parentElement !== shell) row = row.parentElement;
          const rowLabel = boundedElementText(row, 181, 24);
          if (rowLabel.length <= 180 && isExactToolSummaryLabel(rowLabel)) return true;
        }
        const label = boundedControlLabel(control, 181);
        if (label && label.length <= 180 && isExactToolSummaryLabel(label)) return true;
      }
      const owned = media.closest('.csg-tool-summary,.csg-tool-summary-stealth,.csg-tool-summary-live');
      if (owned instanceof Element && shell.contains(owned)) return true;
      // Before a classless summary row is marked, permit only a small unlabelled
      // SVG icon to count as redundant chrome. Images and large/accessible SVGs
      // are always treated as real App output and therefore fail open.
      if (media.localName.toLowerCase() !== 'svg' || media.hasAttribute('aria-label') ||
          media.getAttribute('role') === 'img' || media.querySelector('title')) return false;
      const rect = media.getBoundingClientRect();
      const width = Number.parseFloat(media.getAttribute('width') || '') || rect.width;
      const height = Number.parseFloat(media.getAttribute('height') || '') || rect.height;
      if (!(width > 0 && height > 0 && width <= 24 && height <= 24)) return false;
      if (!shell.matches('[class~="group/tool-message"],details')) {
        const shellLabel = boundedElementText(shell, 181, 24);
        return Boolean(shellLabel && shellLabel.length <= 180 && isExactToolSummaryLabel(shellLabel));
      }
      return false;
    }

    function hasAppSurfaceUi(shell) {
      if (!(shell instanceof Element)) return false;
      if (shell.matches(APP_SURFACE_SELF_SELECTOR)) return true;
      // A no-scrollbar mount point inside a disclosure/tool shell is an App
      // lifecycle surface even before/after its iframe/widget is swapped in.
      // Keep it rendered; standalone passive no-scrollbar blocks are still
      // handled by getEmbeddedToolParts() and can be optimized independently.
      if (shell.matches('[class~="group/tool-message"],details') && shell.querySelector('.no-scrollbar')) return true;
      for (const surface of shell.querySelectorAll(APP_SURFACE_SELECTOR)) {
        // Normal assistant/tool Markdown tables are content, not App lifecycle
        // surfaces. Rich mounted surfaces outside Markdown must fail open.
        if (surface.tagName === 'TABLE' && surface.closest('.markdown')) continue;
        return true;
      }
      // Generated images/SVG charts are App output too. Exclude only media that
      // belongs to the redundant tool-summary chrome (including custom div shells).
      // SVGs inside markdown are ignored to prevent "Copy code" icons from failing open,
      // but img tags (markdown images) must always fail open as media.
      return [...shell.querySelectorAll('img,svg')].some((media) =>
        !(media.localName === 'svg' && media.closest('.markdown')) && !isToolSummaryDecoration(media, shell)
      );
    }

    function isSummaryOnlyStructuralToolShell(shell) {
      if (!(shell instanceof Element) || !shell.matches('[class~="group/tool-message"]')) return false;
      if (hasActionableUi(shell, true) || hasActiveAppBootstrapUi(shell) || hasAppSurfaceUi(shell)) return false;
      const label = boundedElementText(shell, 181, 24);
      return Boolean(label && label.length <= 180 && isExactToolSummaryLabel(label));
    }

    function isPassiveStructuralToolShell(shell, latestTurnIndex) {
      if (!isConversationTurnScoped(shell) || !shell.matches('[class~="group/tool-message"]')) return false;
      // A live summary-only shell is safe to take out of flex flow. Keep every
      // other live shell in flow because React may already be rendering real
      // output there. If App/action/bootstrap UI appears later, mutation
      // classification fails open immediately and removes csg-tool-ui.
      if (isProtectedLiveToolTurn(shell, latestTurnIndex) && !isSummaryOnlyStructuralToolShell(shell)) return false;
      return !hasActionableUi(shell, true) &&
        !hasActiveAppBootstrapUi(shell) &&
        !hasAppSurfaceUi(shell);
    }

    function findToolSummaryShell(marker) {
      return marker.closest('[class~="group/tool-message"]') ||
        marker.closest('details') || marker;
    }

    const PREVIEW_IFRAME_SELECTOR = 'iframe[title^="ui://"]';
    // ChatGPT tool rich UI uses ui://<tool>/<route> titles. Do not key hiding to
    // route names such as file-preview: config-editor and future tool routes use
    // the same mount/header/divider structure and are also covered by
    // hideToolEmbeds. Ordinary iframes without a ui:// title still fail open.
    const PREVIEW_TITLE_RE = /^ui:\/\/[^/?#]+(?:\/[^?#]*)?(?:[?#].*)?$/i;
    const PREVIEW_RETRY_RE = /(?:\bretry\b|再試行)/i;

    function isPreviewSurfaceIframe(iframe) {
      if (!(iframe instanceof HTMLIFrameElement)) return false;
      return PREVIEW_TITLE_RE.test(normalizeLabel(iframe.getAttribute('title')));
    }

    function previewSurfaceParts(iframe) {
      if (!isPreviewSurfaceIframe(iframe)) return null;
      const mount = iframe.closest('.no-scrollbar');
      if (!(mount instanceof Element) || !isConversationTurnScoped(mount) || mount.closest('.markdown')) return null;
      const header = mount.previousElementSibling;
      const next = mount.nextElementSibling;
      const divider = next instanceof Element && next.matches('.h-px') ? next : null;
      return {
        mount,
        header: header instanceof Element ? header : null,
        divider
      };
    }

    function previewSiblingHasAppError(scope) {
      if (!(scope instanceof Element)) return false;
      const surfaceError = scope.matches('aside[class*="surface-error"],[class*="surface-error"]') ||
        Boolean(scope.querySelector('aside[class*="surface-error"],[class*="surface-error"]'));
      if (surfaceError) return true;
      const textError = scope.matches('.text-token-text-error') || Boolean(scope.querySelector('.text-token-text-error'));
      return textError && hasAppTemplateFetchErrorText(stableElementText(scope));
    }

    function previewHasFailOpenUi(parts) {
      if (!parts) return true;
      const { mount, header } = parts;
      if (hasActiveAppBootstrapUi(mount) || (header && hasActiveAppBootstrapUi(header))) return true;
      const local = [header, mount].filter((node) => node instanceof Element);
      // Skip only empty structural siblings. Include the first semantic sibling
      // only when it is explicitly an error card (or a small standalone Retry
      // card); never scan an unrelated next tool/App block for Connect/Retry.
      for (let sibling = mount.nextElementSibling, hops = 0;
           sibling instanceof Element && hops < 3;
           sibling = sibling.nextElementSibling, hops += 1) {
        const isAppBoundary = sibling.matches('[class~="group/tool-message"],.no-scrollbar,[data-testid*="tool"],[data-testid*="app"]');
        const explicitError = !isAppBoundary && previewSiblingHasAppError(sibling);
        const controls = [];
        if (sibling.matches(ACTIONABLE_UI_SELECTOR)) controls.push(sibling);
        controls.push(...sibling.querySelectorAll(ACTIONABLE_UI_SELECTOR));
        const retryCard = !isAppBoundary &&
          controls.some((control) => PREVIEW_RETRY_RE.test(boundedControlLabel(control, 181))) &&
          APP_ERROR_RETRY_RE.test(stableElementText(sibling));
        if (explicitError || retryCard) local.push(sibling);
        if (isAppBoundary || explicitError || retryCard || boundedElementText(sibling, 81, 12) || controls.length) break;
      }
      for (const scope of local) {
        if (previewSiblingHasAppError(scope)) return true;
        const controls = [];
        if (scope.matches(ACTIONABLE_UI_SELECTOR)) controls.push(scope);
        controls.push(...scope.querySelectorAll(ACTIONABLE_UI_SELECTOR));
        for (const control of controls) {
          const label = boundedControlLabel(control, 181);
          if (ACTION_LINK_LABEL_RE.test(label) || PREVIEW_RETRY_RE.test(label)) return true;
        }
      }
      return false;
    }

    function previewHasRelativeWrapperHeight(iframe) {
      const value = String(iframe.parentElement?.style?.height || '').trim();
      return Boolean(value && !value.toLowerCase().endsWith('px'));
    }

    function previewReportedHeight(iframe, mount) {
      const wrapperHeightCss = String(iframe.parentElement?.style?.height || '').trim();
      if (wrapperHeightCss.toLowerCase().endsWith('px')) {
        const wrapperHeight = Number.parseFloat(wrapperHeightCss);
        if (Number.isFinite(wrapperHeight) && wrapperHeight >= 0) return wrapperHeight;
      }
      const mountHeight = mount.getBoundingClientRect().height;
      const iframeHeight = iframe.getBoundingClientRect().height;
      return Math.max(mountHeight, iframeHeight);
    }

    function flowBlockSize(element) {
      if (!(element instanceof Element)) return 0;
      // The presentation CSS separately zeroes margin-block-start and applies
      // this value as a negative margin-block-end. Use only the rendered box
      // height here; including the element's original margins would subtract
      // those margins twice and pull following UI upward into an overlap.
      return Math.max(0, element.getBoundingClientRect().height);
    }

    function setPreviewState(element, state = '') {
      if (!(element instanceof Element)) return;
      if (state) element.setAttribute('data-csg-preview-state', state);
      else element.removeAttribute('data-csg-preview-state');
    }

    function isBrokenPreviewMount(element) {
      return element instanceof Element &&
        (element.classList.contains('csg-broken-preview') ||
         element.getAttribute('data-csg-preview-state') === 'broken');
    }

    function hidePreviewPresentation(entry, parts, stateName = 'hidden', measuredInlineSize = null) {
      if (!parts) return;
      const mountInlineSize = Number.isFinite(measuredInlineSize)
        ? measuredInlineSize : parts.mount.getBoundingClientRect().width;
      if (mountInlineSize > 0) parts.mount.style.setProperty('--csg-preview-inline-size', `${mountInlineSize}px`);
      parts.mount.classList.remove('csg-preview-settling', 'csg-broken-preview');
      parts.header?.classList.remove('csg-preview-settling', 'csg-broken-preview-header');
      const preserveLiveLayout = isProtectedLiveToolTurn(parts.mount);
      parts.mount.classList.toggle('csg-preview-live-layout', preserveLiveLayout);
      parts.header?.classList.toggle('csg-preview-live-layout', preserveLiveLayout);
      parts.mount.classList.add('csg-hidden-preview');
      parts.header?.classList.add('csg-hidden-preview-header');
      setPreviewState(parts.mount, stateName);
      setPreviewState(parts.header, stateName);
      parts.divider?.setAttribute('data-csg-preview-divider', stateName);
      if (entry) {
        entry.stableTiny = 0;
        entry.brokenChecks = 0;
      }
    }

    function releasePreviewPresentation(entry, parts, preserveNodes = null) {
      // React may replace mount/header/divider nodes while an iframe entry is
      // still alive. Clear presentation from both the previously tracked nodes
      // and the newly discovered nodes so a detached node cannot be recycled
      // later with stale CSG hiding state. When a newer iframe already owns the
      // same mount, however, its settling/broken presentation must survive the
      // detached cleanup of the old iframe.
      const preserved = preserveNodes instanceof Set ? preserveNodes : new Set();
      const mounts = new Set([entry?.mount, parts?.mount].filter((node) => node instanceof Element));
      const headers = new Set([entry?.header, parts?.header].filter((node) => node instanceof Element));
      const dividers = new Set([entry?.divider, parts?.divider].filter((node) => node instanceof Element));
      for (const mount of mounts) {
        if (preserved.has(mount)) continue;
        mount.classList.remove('csg-preview-settling', 'csg-broken-preview', 'csg-hidden-preview', 'csg-preview-live-layout');
        setPreviewState(mount);
        mount.style.removeProperty('--csg-collapse-block');
        mount.style.removeProperty('--csg-preview-inline-size');
      }
      for (const header of headers) {
        if (preserved.has(header)) continue;
        header.classList.remove('csg-preview-settling', 'csg-broken-preview-header', 'csg-hidden-preview-header', 'csg-preview-live-layout');
        setPreviewState(header);
        header.style.removeProperty('--csg-collapse-block');
      }
      for (const divider of dividers) {
        if (!preserved.has(divider)) divider.removeAttribute('data-csg-preview-divider');
      }
      if (entry) {
        entry.stableTiny = 0;
        entry.brokenChecks = 0;
      }
    }

    const previewResizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
      const toClear = new Set();
      const toHide = new Map();
      for (const resizeEntry of entries) {
        const target = resizeEntry.target;
        const iframe = target instanceof HTMLIFrameElement ? target : state.previewMounts.get(target);
        if (!(iframe instanceof HTMLIFrameElement)) continue;
        const entry = state.previewSurfaces.get(iframe);
        if (!entry) continue;
        if (!iframe.isConnected || !isPreviewSurfaceIframe(iframe)) {
          toClear.add(iframe);
          continue;
        }
        const parts = previewSurfaceParts(iframe);
        if (!parts || previewHasFailOpenUi(parts)) {
          toClear.add(iframe);
          continue;
        }
        toHide.set(iframe, { entry, parts });
      }
      // Batch every geometry read before any class/style write. ResizeObserver can
      // deliver iframe+mount entries together; interleaving getBoundingClientRect
      // with presentation writes would otherwise force repeated layouts.
      const measured = new Map();
      for (const [iframe, item] of toHide) {
        measured.set(iframe, item.parts.mount.getBoundingClientRect().width);
      }
      for (const iframe of toClear) clearPreviewSurface(iframe);
      for (const [iframe, { entry, parts }] of toHide) {
        if (toClear.has(iframe)) continue;
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = 0;
        hidePreviewPresentation(entry, parts, 'hidden', measured.get(iframe));
      }
    }) : null;

    function clearPreviewSurface(iframe) {
      const entry = state.previewSurfaces.get(iframe);
      const live = previewSurfaceParts(iframe);
      if (entry?.timer) clearTimeout(entry.timer);
      previewResizeObserver?.unobserve(iframe);

      // React can reuse any subset of mount/header/divider nodes while replacing
      // the iframe and/or mount. Never let cleanup of an old entry strip state
      // from a DOM node that is already owned by any other tracked preview.
      const preserveNodes = new Set();
      for (const [otherIframe, otherEntry] of state.previewSurfaces) {
        if (otherIframe === iframe || !otherEntry) continue;
        for (const node of [otherEntry.mount, otherEntry.header, otherEntry.divider]) {
          if (node instanceof Element) preserveNodes.add(node);
        }
      }

      if (entry?.mount && !preserveNodes.has(entry.mount)) {
        previewResizeObserver?.unobserve(entry.mount);
        if (state.previewMounts.get(entry.mount) === iframe) state.previewMounts.delete(entry.mount);
      }
      releasePreviewPresentation(entry, live, preserveNodes);
      state.previewSurfaces.delete(iframe);
    }

    function schedulePreviewProbe(iframe, delay = 850) {
      const entry = state.previewSurfaces.get(iframe);
      if (!entry) return;
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        entry.timer = 0;
        probePreviewSurface(iframe);
      }, delay);
    }

    function probePreviewSurface(iframe) {
      const entry = state.previewSurfaces.get(iframe);
      if (!entry) return;
      if (!state.settings.enabled || !state.settings.hideToolEmbeds || !iframe.isConnected || !isPreviewSurfaceIframe(iframe)) {
        clearPreviewSurface(iframe);
        return;
      }
      const parts = previewSurfaceParts(iframe);
      if (!parts) {
        clearPreviewSurface(iframe);
        return;
      }
      if (entry.mount !== parts.mount || entry.header !== parts.header || entry.divider !== parts.divider) {
        // React can reparent the iframe into a fresh mount while leaving the old
        // now-empty mount between it and the original divider. Reuse that divider
        // when it still belongs to the same conversation turn instead of leaving
        // a thin separator/gap behind after the preview itself is hidden.
        const reusableDivider = !parts.divider && entry.divider instanceof Element && entry.divider.isConnected &&
          entry.divider.closest(TURN_SELECTOR) === parts.mount.closest(TURN_SELECTOR)
          ? entry.divider : null;
        if (entry.mount) {
          previewResizeObserver?.unobserve(entry.mount);
          if (state.previewMounts.get(entry.mount) === iframe) state.previewMounts.delete(entry.mount);
        }
        entry.mount?.classList.remove('csg-preview-settling', 'csg-broken-preview', 'csg-hidden-preview', 'csg-preview-live-layout');
        entry.header?.classList.remove('csg-preview-settling', 'csg-broken-preview-header', 'csg-hidden-preview-header', 'csg-preview-live-layout');
        entry.divider?.removeAttribute('data-csg-preview-divider');
        if (reusableDivider) parts.divider = reusableDivider;
        setPreviewState(entry.mount);
        setPreviewState(entry.header);
        entry.mount?.style.removeProperty('--csg-preview-inline-size');
        entry.mount = parts.mount;
        entry.header = parts.header;
        entry.divider = parts.divider;
        state.previewMounts.set(parts.mount, iframe);
        previewResizeObserver?.observe(parts.mount);
        parts.mount.classList.add('csg-preview-settling');
        parts.header?.classList.add('csg-preview-settling');
        setPreviewState(parts.mount, 'settling');
        setPreviewState(parts.header, 'settling');
      }
      if (previewHasFailOpenUi(parts)) {
        clearPreviewSurface(iframe);
        return;
      }
      entry.probes += 1;
      // hideToolEmbeds is an explicit user choice: every passive Tool/App preview
      // stays mounted for ChatGPT/React, but is removed from the conversation's
      // visual flow regardless of whether the iframe is healthy or a tiny fallback.
      // Retry/Auth/Connect bootstrap UI is handled above and always fails open.
      hidePreviewPresentation(entry, parts);
    }

    function trackPreviewIframe(iframe) {
      if (!state.settings.enabled || !state.settings.hideToolEmbeds || !isPreviewSurfaceIframe(iframe)) return;
      const parts = previewSurfaceParts(iframe);
      if (!parts) return;
      let entry = state.previewSurfaces.get(iframe);
      if (!entry) {
        entry = { mount: parts.mount, header: parts.header, divider: parts.divider, timer: 0, stableTiny: 0, probes: 0, brokenChecks: 0 };
        state.previewSurfaces.set(iframe, entry);
        state.previewMounts.set(parts.mount, iframe);
        previewResizeObserver?.observe(iframe);
        previewResizeObserver?.observe(parts.mount);
      }
      probePreviewSurface(iframe);
    }

    function scanPreviewSurfaces(scanRoot) {
      if (!state.settings.enabled || !state.settings.hideToolEmbeds) return;
      const rootElement = scanRoot instanceof Element ? scanRoot : scanRoot?.parentElement;
      if (!(rootElement instanceof Element)) return;
      if (rootElement.matches(PREVIEW_IFRAME_SELECTOR)) trackPreviewIframe(rootElement);
      rootElement.querySelectorAll?.(PREVIEW_IFRAME_SELECTOR).forEach(trackPreviewIframe);
      const mount = rootElement.closest?.('.no-scrollbar');
      mount?.querySelectorAll?.(PREVIEW_IFRAME_SELECTOR).forEach(trackPreviewIframe);
      // Auth/Retry/bootstrap UI often lives in the header immediately beside
      // the mount. When that fail-open UI disappears, re-check the adjacent
      // preview without scanning the whole turn.
      for (let cursor = rootElement, depth = 0;
           cursor instanceof Element && depth < 3 && !cursor.matches(TURN_SELECTOR);
           cursor = cursor.parentElement, depth += 1) {
        for (const sibling of [cursor.previousElementSibling, cursor.nextElementSibling]) {
          if (sibling?.matches?.('.no-scrollbar')) {
            sibling.querySelectorAll?.(PREVIEW_IFRAME_SELECTOR).forEach(trackPreviewIframe);
          }
        }
      }
    }

    function clearAllPreviewSurfaces() {
      for (const iframe of [...state.previewSurfaces.keys()]) clearPreviewSurface(iframe);
    }

    const TOOL_CHROME_CANDIDATES = 'button,[role="button"],summary,[aria-expanded]';

    function boundedToolSummaryLabel(element, maxChars = 181) {
      if (!(element instanceof Element)) return '';
      return element.matches(TOOL_CHROME_CANDIDATES)
        ? boundedControlLabel(element, maxChars)
        : boundedElementText(element, maxChars, 24);
    }

    function directToolSummaryRow(element) {
      if (!(element instanceof Element)) return null;
      const shell = element.closest('[class~="group/tool-message"]');
      if (!(shell instanceof Element)) return null;
      if (element === shell) return null;
      let row = element;
      while (row.parentElement instanceof Element && row.parentElement !== shell) row = row.parentElement;
      if (row.closest('.markdown')) return null;
      const label = boundedElementText(row, 181, 24);
      if (!label || label.length > 180 || !isExactToolSummaryLabel(label)) return null;
      if (hasActionableUi(row, true) || hasActiveAppBootstrapUi(row) || hasAppSurfaceUi(row)) return null;
      return row;
    }

    function historicalToolSummaryCandidatesFor(scanRoot) {
      if (!(scanRoot instanceof Element)) return [];
      const candidates = new Set();
      const addDisclosure = (control) => {
        if (control.closest('.markdown')) return;
        const label = boundedControlLabel(control, 181);
        if (label && label.length <= 180 && isExactToolSummaryLabel(label) && !hasActionableUi(control, true)) {
          candidates.add(directToolSummaryRow(control) || control);
        }
      };
      if (scanRoot.matches('summary,[aria-expanded]')) addDisclosure(scanRoot);
      scanRoot.querySelectorAll?.('summary,[aria-expanded]').forEach(addDisclosure);

      // Reclassify only summaries CSG already owns when they cross the live/old
      // boundary or their label changes. This is tiny compared with all tool rows.
      const existingSelector = '.csg-tool-summary, .csg-tool-summary-stealth, .csg-tool-summary-live';
      if (scanRoot.matches(existingSelector)) candidates.add(scanRoot);
      scanRoot.querySelectorAll?.(existingSelector).forEach((marker) => candidates.add(marker));
      return [...candidates];
    }

    function knownToolSummaryCandidatesFor(scanRoot) {
      if (!(scanRoot instanceof Element)) return [];
      const candidates = new Set(historicalToolSummaryCandidatesFor(scanRoot));
      const addKnownButton = (button) => {
        const row = directToolSummaryRow(button);
        if (row) candidates.add(row);
      };
      if (scanRoot.matches(TOOL_LIST_BUTTON_SELECTOR)) addKnownButton(scanRoot);
      scanRoot.querySelectorAll?.(TOOL_LIST_BUTTON_SELECTOR).forEach(addKnownButton);
      return [...candidates];
    }

    function canGrowToolSummaryWrapper(parent, candidate) {
      if (!(parent instanceof Element) || !(candidate instanceof Element) || !parent.contains(candidate)) return false;
      for (const child of parent.childNodes) {
        if (child === candidate || (child instanceof Element && child.contains(candidate))) continue;
        if (child.nodeType === Node.TEXT_NODE) {
          if (String(child.nodeValue || '').trim()) return false;
          continue;
        }
        if (!(child instanceof Element)) continue;
        if (child.matches('svg,[aria-hidden="true"]') && !boundedElementText(child, 40, 4)) continue;
        if (hasActionableUi(child, true) || hasActiveAppBootstrapUi(child) || hasAppSurfaceUi(child)) return false;
        if (boundedElementText(child, 80, 4)) return false;
      }
      return true;
    }

    function queueToolSummaryRoot(root) {
      if (!(root instanceof Element)) return;
      state.toolSummaryPendingRoots.add(root);
      state.pendingRoots.add(root);
    }

    function fallbackToolSummaryCandidatesFor(scanRoot, maxTextNodes = 128, resumable = false) {
      if (!(scanRoot instanceof Element)) return [];
      const areas = [];
      const containingTurn = scanRoot.closest(TURN_SELECTOR);
      if (scanRoot.matches(TURN_SELECTOR)) {
        areas.push(scanRoot);
        state.toolSummaryInitialSweepQueued.add(scanRoot);
      } else if (containingTurn) {
        areas.push(scanRoot);
      } else {
        const turns = [...scanRoot.querySelectorAll(TURN_SELECTOR)];
        const immediate = turns.slice(-4);
        for (const turn of immediate) {
          areas.push(turn);
          state.toolSummaryInitialSweepQueued.add(turn);
        }
        // Do not add an O(N) TreeWalker over an entire long conversation to a
        // single idle callback. Queue older mounted turns into the existing
        // bounded root scheduler and sweep them incrementally.
        for (const turn of turns.slice(0, -4)) {
          if (state.toolSummaryInitialSweepQueued.has(turn)) continue;
          state.toolSummaryInitialSweepQueued.add(turn);
          state.toolSummaryFallbackSweepPending.add(turn);
          queueToolSummaryRoot(turn);
        }
      }

      const candidates = new Set();
      for (const area of areas) {
        if (!(area instanceof Element) || area.closest('.markdown')) continue;
        const walker = document.createTreeWalker(area, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.classList.contains('markdown')) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_SKIP;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        const resumableArea = resumable && area === scanRoot && area.matches(TURN_SELECTOR);
        const resumeState = resumableArea ? state.toolSummaryFallbackSweepCursor.get(area) : null;
        if (resumeState?.node instanceof Node && resumeState.node.isConnected && area.contains(resumeState.node)) {
          walker.currentNode = resumeState.node;
        }
        let visitedTextNodes = 0;
        let rollingText = resumeState?.rollingText || '';
        let lastProcessed = resumeState?.node instanceof Node ? resumeState.node : null;
        let textNode = walker.nextNode();
        while (textNode && visitedTextNodes < maxTextNodes) {
          visitedTextNodes += 1;
          lastProcessed = textNode;
          const fragment = String(textNode.nodeValue || '');
          if (fragment.trim()) {
            rollingText = `${rollingText}${fragment}`.slice(-160);
            if (hasToolSummaryTextHint(rollingText) && isToolSummaryLabel(rollingText)) {
              const turn = textNode.parentElement?.closest(TURN_SELECTOR);
              if (turn instanceof Element) {
                let candidate = null;
                let candidateText = '';
                let depth = 0;
                for (let el = textNode.parentElement;
                     el instanceof Element && el !== turn && depth < 8;
                     el = el.parentElement, depth += 1) {
                  // Markdown subtrees are rejected by the TreeWalker filter.
                  if (el.matches('[class~="group/tool-message"],details')) break;
                  const label = boundedElementText(el, 181, 24);
                  if (!label || label.length > 180 || !isToolSummaryLabel(label)) {
                    if (candidate) break;
                    continue;
                  }
                  if (hasActiveAppBootstrapUi(el) || hasActionableUi(el, true) || hasAppSurfaceUi(el)) {
                    if (candidate) break;
                    continue;
                  }
                  if (!candidate) {
                    candidate = el;
                    candidateText = label;
                    continue;
                  }
                  if (label !== candidateText || !canGrowToolSummaryWrapper(el, candidate)) break;
                  candidate = el;
                }
                if (candidate) {
                  const trigger = candidate.closest(TOOL_CHROME_CANDIDATES);
                  if (trigger && turn.contains(trigger) && !trigger.closest('.markdown')) {
                    const triggerLabel = boundedControlLabel(trigger, 181);
                    if (triggerLabel.length <= 180 && triggerLabel === candidateText && isToolSummaryLabel(triggerLabel)) {
                      candidate = trigger;
                    }
                  }
                  candidates.add(candidate);
                  rollingText = '';
                }
              }
            }
          }
          textNode = walker.nextNode();
        }
        if (resumableArea) {
          if (textNode && lastProcessed instanceof Node) {
            state.toolSummaryFallbackSweepCursor.set(area, { node: lastProcessed, rollingText });
            queueToolSummaryRoot(area);
          } else {
            state.toolSummaryFallbackSweepCursor.delete(area);
            state.toolSummaryFallbackSweepPending.delete(area);
          }
        }
      }
      return [...candidates];
    }

    function analyzeToolSummaryPresentation(marker, latestTurnIndex) {
      if (!(marker instanceof Element)) return null;
      let target = marker;
      const structuralShell = marker.closest('[class~="group/tool-message"]');
      if (structuralShell) {
        let row = marker;
        while (row.parentElement && row.parentElement !== structuralShell) row = row.parentElement;
        if (row.parentElement === structuralShell) {
          const rowLabel = boundedElementText(row, 181, 24);
          if (rowLabel && rowLabel.length <= 180 && isExactToolSummaryLabel(rowLabel) &&
              !hasActionableUi(row, true) && !hasActiveAppBootstrapUi(row) && !hasAppSurfaceUi(row)) {
            target = row;
          }
        }
      }

      const targetLabel = boundedToolSummaryLabel(target, 181);
      if (!targetLabel || targetLabel.length > 180 || !isExactToolSummaryLabel(targetLabel)) {
        return { marker, target, mode: 'clear', needsMeasure: false, measuredBlock: null };
      }
      if (hasActionableUi(target, true) || hasActiveAppBootstrapUi(target) || hasAppSurfaceUi(target)) {
        return { marker, target, mode: 'clear', needsMeasure: false, measuredBlock: null };
      }

      const shell = findToolSummaryShell(target);
      const preserveLayout = isProtectedLiveToolTurn(target, latestTurnIndex) ||
        hasActiveAppBootstrapUi(shell) || hasAppSurfaceUi(shell);
      let mode = 'historical';
      if (preserveLayout) mode = 'live';
      else if (target.matches(TOOL_CHROME_CANDIDATES) &&
               !target.querySelector(TOOL_LIST_BUTTON_SELECTOR)) mode = 'stealth';
      const needsMeasure = mode === 'historical' &&
        (!target.classList.contains('csg-tool-summary') ||
         !target.style.getPropertyValue('--csg-collapse-block'));
      return { marker, target, mode, needsMeasure, measuredBlock: null, tempLive: false };
    }

    function measureToolSummaryPlans(plans) {
      const targets = new Map();
      for (const plan of plans) {
        if (!plan?.needsMeasure || targets.has(plan.target)) continue;
        targets.set(plan.target, plan);
        if (!plan.target.classList.contains('csg-tool-summary-live')) {
          plan.target.classList.add('csg-tool-summary-live');
          plan.tempLive = true;
        }
      }
      // All geometry-restoring writes above happen before the first read. The
      // browser can satisfy the remaining reads from one layout calculation.
      for (const [target, plan] of targets) plan.measuredBlock = flowBlockSize(target);
    }

    function applyToolSummaryPlan(plan) {
      if (!plan) return;
      const { marker, target, mode } = plan;
      const structuralShell = target.closest?.('[class~="group/tool-message"]');
      if (target !== marker) {
        unmarkToolSummary(marker);
        unmarkToolSummaryStealth(marker);
        unmarkToolSummaryLive(marker);
      }
      if (mode === 'clear') {
        unmarkToolSummary(target);
        unmarkToolSummaryStealth(target);
        unmarkToolSummaryLive(target);
        if (structuralShell instanceof Element) unmarkToolChrome(structuralShell);
        return;
      }
      if (mode === 'live') {
        unmarkToolSummary(target);
        unmarkToolSummaryStealth(target);
        markToolSummaryLive(target);
        if (structuralShell instanceof Element) {
          if (isSummaryOnlyStructuralToolShell(structuralShell)) markToolChrome(structuralShell, target);
          else unmarkToolChrome(structuralShell);
        }
        return;
      }
      if (mode === 'stealth') {
        unmarkToolSummary(target);
        unmarkToolSummaryLive(target);
        markToolSummaryStealth(target);
        return;
      }

      unmarkToolSummaryStealth(target);
      if (Number.isFinite(plan.measuredBlock)) {
        target.style.setProperty('--csg-collapse-block', `${plan.measuredBlock}px`);
      }
      markToolSummary(target, plan.measuredBlock);
      unmarkToolSummaryLive(target);
    }

    function applyToolSummaryPresentations(markers, latestTurnIndex) {
      const plans = [...new Set(markers)]
        .map((marker) => analyzeToolSummaryPresentation(marker, latestTurnIndex))
        .filter(Boolean);
      measureToolSummaryPlans(plans);
      for (const plan of plans) applyToolSummaryPlan(plan);
      return plans;
    }

    function applyToolSummaryPresentation(marker, latestTurnIndex) {
      applyToolSummaryPresentations([marker], latestTurnIndex);
    }

    function classifyToolChromeCandidate(el, latestTurnIndex, summaryAlreadyApplied = false) {
      if (!(el instanceof Element) || el.closest('.markdown') || !isConversationTurnScoped(el)) return;
      // Legacy disclosures can expose the summary only through aria-label/title
      // with no visible text node. Use the control-aware label path for actual
      // disclosure candidates; generic wrappers still use bounded visible text.
      const label = boundedToolSummaryLabel(el, 181);
      const isSummary = Boolean(label && label.length <= 180 && isExactToolSummaryLabel(label) &&
        !hasActionableUi(el, true));
      const summaryShell = isSummary ? findToolSummaryShell(el) : null;
      if (!summaryAlreadyApplied) {
        if (isSummary) {
          applyToolSummaryPresentation(el, latestTurnIndex);
        } else {
          unmarkToolSummary(el);
          unmarkToolSummaryStealth(el);
          unmarkToolSummaryLive(el);
        }
      }

      const structuralShell = el.closest('[class~="group/tool-message"]');
      if (structuralShell) {
        if (isPassiveStructuralToolShell(structuralShell, latestTurnIndex)) markToolChrome(structuralShell, el);
        else unmarkToolChrome(structuralShell);
        return;
      }
      if (!label || label.length > 180) return;
      if (isSummary) {
        const shell = findToolSummaryShell(el);
        if (isProtectedLiveToolTurn(shell, latestTurnIndex) || hasActionableUi(shell, true) ||
            hasActiveAppBootstrapUi(shell) || hasAppSurfaceUi(shell)) {
          unmarkToolChrome(shell);
        } else {
          markToolChrome(shell, el);
        }
      } else if (isConfigLabel(label)) {
        if (isProtectedLiveToolTurn(el, latestTurnIndex)) unmarkToolChrome(el);
        else markToolChrome(el, el);
      }
    }

    function fastClassifyToolSummaryMutation(node, applyNow = true) {
      if (!state.settings.enabled || !state.settings.hideToolSummary) return [];
      const element = node instanceof Element ? node : node?.parentElement;
      if (!(element instanceof Element) || !isConversationTurnScoped(element) || element.closest('.markdown')) return [];
      const roots = [element];
      let cursor = element;
      for (let i = 0; i < 2; i += 1) {
        const parent = cursor.parentElement;
        if (!(parent instanceof Element) || parent.matches(TURN_SELECTOR) || parent.closest('.markdown')) break;
        roots.push(parent);
        cursor = parent;
      }
      const candidates = new Set();
      for (const root of roots) {
        const known = knownToolSummaryCandidatesFor(root);
        if (known.length) {
          known.forEach((candidate) => candidates.add(candidate));
          continue;
        }
        for (const candidate of fallbackToolSummaryCandidatesFor(root, 24)) candidates.add(candidate);
      }
      const list = [...candidates];
      if (applyNow && list.length) {
        applyToolSummaryPresentations(list, mountedLatestTurnIndex());
      }
      return list;
    }

    function processSummaryMutationRoots() {
      state.summaryMutationScheduled = false;
      if (!state.settings.enabled || !state.settings.hideToolSummary) {
        state.summaryMutationRoots.clear();
        return;
      }
      const batch = [...state.summaryMutationRoots].slice(0, 12);
      batch.forEach((root) => state.summaryMutationRoots.delete(root));
      const candidates = new Set();
      for (const root of batch) {
        if (!root.isConnected) continue;
        for (const candidate of fastClassifyToolSummaryMutation(root, false)) candidates.add(candidate);
      }
      if (candidates.size) {
        applyToolSummaryPresentations([...candidates], mountedLatestTurnIndex());
      }
      if (state.summaryMutationRoots.size) scheduleSummaryMutationRoot();
    }

    function scheduleSummaryMutationRoot(node) {
      if (!state.settings.enabled || !state.settings.hideToolSummary) return;
      if (node instanceof Node) {
        const element = node instanceof Element ? node : node.parentElement;
        if (!(element instanceof Element) || element.closest('.markdown')) return;
        const turn = element.closest(TURN_SELECTOR);
        const existingMarker = element.closest('.csg-tool-summary, .csg-tool-summary-stealth, .csg-tool-summary-live');
        // Historical rows are CSS-only. Restrict JS mutation work to the live
        // boundary (or an already-owned marker that must be released safely).
        if (turn instanceof Element && state.liveProtectedTurns.size &&
            !state.liveProtectedTurns.has(turn) && !existingMarker) return;
        if (turn instanceof Element && !state.liveProtectedTurns.size && !existingMarker) return;

        // Real MCP DOM: the tool-list button is a cheap stable anchor. Handle it
        // immediately without a TreeWalker or a whole-shell fallback scan.
        const listButton = element.matches?.(TOOL_LIST_BUTTON_SELECTOR)
          ? element : element.closest?.(TOOL_LIST_BUTTON_SELECTOR);
        if (listButton instanceof Element) {
          const row = directToolSummaryRow(listButton);
          if (row) applyToolSummaryPresentation(row, mountedLatestTurnIndex());
          return;
        }

        const shell = element.closest('[class~="group/tool-message"],details');
        // Fail open synchronously when a previously summary-only shell starts
        // growing real App/action UI. Waiting for the idle classifier can leave
        // a fresh loader/Connect/Retry surface clipped inside the 0x0 shell for
        // hundreds of milliseconds, which is long enough to break App bootstrap.
        if (shell instanceof Element && shell.classList.contains('csg-tool-ui') &&
            (hasActionableUi(shell, true) || hasActiveAppBootstrapUi(shell) || hasAppSurfaceUi(shell))) {
          unmarkToolChrome(shell);
        }
        // A complete generic/classless label in a small local wrapper is safe to
        // classify immediately. Also inspect direct children when React inserts
        // a complete wrapper containing {summary, body} in one mutation.
        const localCandidates = [];
        for (let cursor = element, depth = 0;
             cursor instanceof Element && depth < 4 && cursor !== shell;
             cursor = cursor.parentElement, depth += 1) {
          if (cursor.matches(TURN_SELECTOR) || cursor.childElementCount > 16) break;
          localCandidates.push(cursor);
          if (depth === 0) localCandidates.push(...cursor.children);
        }
        for (const candidate of localCandidates) {
          if (!(candidate instanceof Element) || candidate.closest('.markdown') || candidate.childElementCount > 16) continue;
          const label = boundedElementText(candidate, 181, 20);
          if (label && label.length <= 180 && isExactToolSummaryLabel(label) &&
              !hasActionableUi(candidate, true) && !hasActiveAppBootstrapUi(candidate) && !hasAppSurfaceUi(candidate)) {
            applyToolSummaryPresentation(candidate, mountedLatestTurnIndex());
            return;
          }
        }

        let root = shell;
        if (root) {
          // Unknown structural shells are queued only when the changed local
          // subtree carries a summary-like text hint; body/App mutations do not
          // repeatedly enqueue the same shell.
          const localHint = boundedElementText(element, 181, 24);
          if (!hasToolSummaryTextHint(localHint) &&
              !root.querySelector('.csg-tool-summary, .csg-tool-summary-stealth, .csg-tool-summary-live')) return;
        } else {
          if (!isConversationTurnScoped(element)) return;
          if (element.matches(TURN_SELECTOR) || element.childElementCount > 16) return;
          const hint = boundedElementText(element, 181, 24);
          if (!hasToolSummaryTextHint(hint)) return;
          root = element;
        }
        state.summaryMutationRoots.delete(root);
        state.summaryMutationRoots.add(root);
        while (state.summaryMutationRoots.size > 128) {
          const oldest = state.summaryMutationRoots.values().next().value;
          state.summaryMutationRoots.delete(oldest);
        }
      }
      if (state.summaryMutationScheduled || !state.summaryMutationRoots.size) return;
      state.summaryMutationScheduled = true;
      idle(processSummaryMutationRoots);
    }

    function shellHasToolLabel(shell, latestTurnIndex) {
      const marker = state.toolShellMarkers.get(shell);
      if (!(marker instanceof Element) || !marker.isConnected || !shell.contains(marker)) return false;
      if (isProtectedLiveToolTurn(shell, latestTurnIndex)) return false;
      if (shell.matches('[class~="group/tool-message"]')) return isPassiveStructuralToolShell(shell, latestTurnIndex);
      if (!isConversationTurnScoped(shell)) return false;
      const label = boundedToolSummaryLabel(marker, 181);
      if (label.length > 180) return false;
      if (isExactToolSummaryLabel(label)) return !hasActionableUi(shell, true);
      return isConfigLabel(label);
    }

    // The document-level observer already sees text/child changes for connected
    // tool markers. Avoid a second per-marker observer: disconnect/reobserve cycles
    // can drop mutations and retain detached marker subtrees unnecessarily.
    const toolShellObserver = { disconnect() {} };
    function observeToolMarker(_marker) {}
    function refreshToolShellObserver() {}

    function cleanupToolChrome(latestTurnIndex = mountedLatestTurnIndex()) {
      let changed = false;
      for (const shell of state.textToolShells) {
        if (!shell.isConnected || !shellHasToolLabel(shell, latestTurnIndex)) {
          shell.classList.remove('csg-tool-ui');
          state.textToolShells.delete(shell);
          state.toolShellMarkers.delete(shell);
          changed = true;
        }
      }
      for (const marker of [...state.toolSummaryMarkers]) {
        const label = marker.isConnected ? boundedToolSummaryLabel(marker, 181) : '';
        // Actionable descendants are handled immediately by the document observer,
        // which rescans the marked summary on child/attribute changes. Avoid doing
        // a querySelectorAll() across every historic marker on every streaming scan.
        if (!marker.isConnected || !isConversationTurnScoped(marker) ||
            !label || label.length > 180 || !isExactToolSummaryLabel(label)) {
          unmarkToolSummary(marker);
          changed = true;
        }
      }
      for (const marker of [...state.toolSummaryStealthMarkers]) {
        const label = marker.isConnected ? boundedToolSummaryLabel(marker, 181) : '';
        if (!marker.isConnected || !isConversationTurnScoped(marker) ||
            !label || label.length > 180 || !isExactToolSummaryLabel(label)) {
          unmarkToolSummaryStealth(marker);
          changed = true;
        }
      }
      for (const marker of [...state.toolSummaryLiveMarkers]) {
        const label = marker.isConnected ? boundedToolSummaryLabel(marker, 181) : '';
        if (!marker.isConnected || !isConversationTurnScoped(marker) ||
            !label || label.length > 180 || !isExactToolSummaryLabel(label)) {
          unmarkToolSummaryLive(marker);
          changed = true;
          continue;
        }
        const shell = findToolSummaryShell(marker);
        if (!isProtectedLiveToolTurn(marker, latestTurnIndex) &&
            !hasActiveAppBootstrapUi(shell) && !hasAppSurfaceUi(shell)) {
          applyToolSummaryPresentation(marker, latestTurnIndex);
          changed = true;
        }
      }
      return changed;
    }

    function scheduleToolChromeCleanup(delay = 1200) {
      if (state.toolCleanupTimer || (!state.textToolShells.size && !state.toolSummaryMarkers.size &&
          !state.toolSummaryStealthMarkers.size && !state.toolSummaryLiveMarkers.size)) return;
      state.toolCleanupTimer = setTimeout(() => {
        state.toolCleanupTimer = 0;
        if (!state.settings.enabled || !state.settings.hideToolSummary) return;
        cleanupToolChrome();
      }, delay);
    }

    function scanRoot(scanRoot, latestTurnIndex = mountedLatestTurnIndex()) {
      if (!(scanRoot instanceof Element)) return;
      state.stats.scans += 1;

      // Summary-only mode does not need the general tool/thinking/pre scan. On
      // long chats that query can touch tens of thousands of nodes per batch.
      const generalAnalysis = needsGeneralMutationScan();
      const candidates = generalAnalysis ? [
        scanRoot,
        ...scanRoot.querySelectorAll('[data-testid], .csg-thinking, .csg-tool, .csg-heavy, pre, aside[class*="surface-error"]')
      ] : [];
      const uniqueCandidates = [...new Set(candidates)];
      const plans = uniqueCandidates.map((el) => analyzeElement(el, latestTurnIndex));
      const oldAppErrorCandidates = state.settings.enabled && state.settings.hideOldAppLoadErrors
        ? appErrorCandidatesFor(scanRoot)
        : [];
      const turnStructureChanged = uniqueCandidates.some((el) => el.matches(TURN_SELECTOR));
      const scanHasTurn = isConversationTurnScoped(scanRoot) || Boolean(scanRoot.querySelector(TURN_SELECTOR));
      // Mounted App/tool surfaces remain rendered to avoid lifecycle/template
      // failures. Only confirmed broken preview surfaces are visually suppressed.
      const toolCandidates = [];
      if (state.settings.enabled && state.settings.hideToolSummary && scanHasTurn) {
        const turnNotSwept = scanRoot.matches(TURN_SELECTOR) &&
          !state.toolSummaryInitialSweepQueued.has(scanRoot);
        if (turnNotSwept) state.toolSummaryFallbackSweepPending.add(scanRoot);
        const needsInitialFallbackSweep = state.toolSummaryFallbackSweepPending.has(scanRoot);
        const isConversationSweepRoot = !scanRoot.matches(TURN_SELECTOR) &&
          !scanRoot.closest(TURN_SELECTOR) && Boolean(scanRoot.querySelector(TURN_SELECTOR));
        if (isConversationSweepRoot || isProtectedLiveToolTurn(scanRoot, latestTurnIndex) || needsInitialFallbackSweep) {
          // A conversation-level root seeds older mounted turns. Any historical
          // turn mounted later by virtualization gets its own bounded/resumable
          // first sweep before switching to the cheap marker-only fast path.
          knownToolSummaryCandidatesFor(scanRoot).forEach((candidate) => toolCandidates.push(candidate));
          fallbackToolSummaryCandidatesFor(scanRoot, needsInitialFallbackSweep ? 256 : 128, needsInitialFallbackSweep)
            .forEach((candidate) => toolCandidates.push(candidate));
        } else {
          // Routine historical rescans stay cheap: legacy disclosure controls plus
          // markers CSG already owns. Real MCP rows remain CSS-only.
          historicalToolSummaryCandidatesFor(scanRoot).forEach((candidate) => toolCandidates.push(candidate));
        }
      }
      const existingTraceBodies = generalAnalysis ? [...scanRoot.querySelectorAll('.csg-trace-body')] : [];

      // Trace geometry uses a three-phase batch: remove the old presentation
      // classes for every body (write), measure every natural height (read), then
      // apply all final classes/styles (write). This avoids one forced layout per
      // trace when a long-chat scan contains many updated tool blocks.
      if (scanRoot.classList.contains('csg-trace-body') &&
          !scanRoot.parentElement?.matches('.csg-thinking, .csg-tool')) {
        scanRoot.classList.remove('csg-trace-body');
      }
      for (const plan of plans) {
        for (const child of plan?.traceChildren || []) child.classList.remove('csg-trace-body');
      }
      for (const el of existingTraceBodies) {
        if (!el.parentElement?.matches('.csg-thinking, .csg-tool')) el.classList.remove('csg-trace-body');
      }
      const traceBlockSizes = new Map();
      for (const plan of plans) {
        if (plan?.traceBody && !traceBlockSizes.has(plan.traceBody)) {
          traceBlockSizes.set(plan.traceBody, flowBlockSize(plan.traceBody));
        }
      }
      for (const plan of plans) applyElementAnalysis(plan, traceBlockSizes);
      const uniqueToolCandidates = [...new Set(toolCandidates)];
      if (uniqueToolCandidates.length) {
        applyToolSummaryPresentations(uniqueToolCandidates, latestTurnIndex);
        for (const candidate of uniqueToolCandidates) {
          classifyToolChromeCandidate(candidate, latestTurnIndex, true);
        }
      }
      scanOldAppErrors(oldAppErrorCandidates, turnStructureChanged);
    }

    function compactPendingRoots() {
      const compact = new Set();
      for (const node of state.pendingRoots) {
        if (!(node instanceof Element) || !node.isConnected) continue;
        const turn = node.closest('[data-testid^="conversation-turn-"]');
        const parent = node.parentElement;
        const anchor = turn || (parent && parent !== document.body ? parent : node);
        compact.add(anchor);
      }
      if (compact.size > 160) {
        const mountedTurns = [...document.querySelectorAll('[data-testid^="conversation-turn-"]')];
        const extras = [...compact]
          .filter((node) => !node.matches?.('[data-testid^="conversation-turn-"]'));
        const errorExtras = extras.filter((node) =>
          node.matches?.('aside[class*="surface-error"], .csg-old-app-load-error') ||
          Boolean(node.querySelector?.('aside[class*="surface-error"], .csg-old-app-load-error'))
        );
        const errorSet = new Set(errorExtras);
        const ordinaryExtras = extras.filter((node) => !errorSet.has(node)).slice(-40);
        state.pendingRoots = new Set([...mountedTurns, ...errorExtras, ...ordinaryExtras]);
      } else {
        state.pendingRoots = compact;
      }
      for (const root of [...state.toolSummaryPendingRoots]) {
        if (!(root instanceof Element) || !root.isConnected) {
          state.toolSummaryPendingRoots.delete(root);
          continue;
        }
        // Resumable summary sweeps are priority work. Compaction may replace a
        // descendant mutation root with a turn/body anchor, but it must never
        // orphan the dedicated turn root that owns the sweep cursor.
        state.pendingRoots.add(root);
      }
    }

    function scheduleScan(el) {
      if (el instanceof Element) {
        state.pendingRoots.add(el);
        if (state.pendingRoots.size > 600) compactPendingRoots();
      }
      if (state.scheduled) return;
      state.scheduled = true;
      idle(() => {
        state.scheduled = false;
        const latestTurnIndex = mountedLatestTurnIndex();
        // Advancing, rewinding, or reusing a turn node can change which DOM
        // elements are protected as live UI. Keep those roots in a dedicated
        // priority queue so a large boundary transition cannot be starved by
        // ordinary streaming mutations.
        queueLiveProtectionBoundaryChanges(latestTurnIndex);
        for (const node of [...state.liveBoundaryRoots]) {
          if (!node.isConnected) state.liveBoundaryRoots.delete(node);
        }
        const batchBudget = needsGeneralMutationScan() ? 80 : 8;
        const urgentBoundaryRoots = [...state.liveBoundaryRoots].slice(0, batchBudget);
        const urgentSet = new Set(urgentBoundaryRoots);
        const remainingBudget = Math.max(0, batchBudget - urgentBoundaryRoots.length);
        const normalRoots = [...state.pendingRoots]
          .filter((node) => !urgentSet.has(node))
          .slice(0, remainingBudget);
        const batch = [...urgentBoundaryRoots, ...normalRoots];
        const batchSet = new Set(batch);
        // Ordinary nested mutation roots can be covered by an ancestor scan, but
        // live-boundary work and resumable historical summary sweeps cannot: an
        // ancestor deliberately skips an already-queued historical turn. Keep
        // those priority roots even when an ancestor is in the same batch.
        const prioritySet = new Set([
          ...urgentBoundaryRoots,
          ...batch.filter((node) => state.toolSummaryPendingRoots.has(node))
        ]);
        const roots = batch.filter((node) => {
          if (prioritySet.has(node)) return true;
          for (let parent = node.parentElement; parent; parent = parent.parentElement) {
            if (batchSet.has(parent)) return false;
          }
          return true;
        });
        const rootsSet = new Set(roots);
        for (const node of urgentBoundaryRoots) {
          if (!rootsSet.has(node)) continue;
          state.liveBoundaryRoots.delete(node);
          state.pendingRoots.delete(node);
          state.toolSummaryPendingRoots.delete(node);
        }
        for (const node of normalRoots) {
          if (rootsSet.has(node)) {
            state.pendingRoots.delete(node);
            state.toolSummaryPendingRoots.delete(node);
          } else if (!state.toolSummaryPendingRoots.has(node)) {
            // A processed ancestor fully covers ordinary nested mutation roots.
            state.pendingRoots.delete(node);
          }
        }
        roots.forEach((node) => scanRoot(node, latestTurnIndex));
        scheduleToolChromeCleanup();
        updateStatus();
        scheduleFreeze();
        if (state.liveBoundaryRoots.size || state.pendingRoots.size) scheduleScan();
      });
    }

    const AUTO_CONTINUE_TEXT = 'Continue';
    const AUTO_CONTINUE_PATTERN_LIMIT = 512;
    const AUTO_CONTINUE_MATCH_TEXT_LIMIT = 2048;
    const AUTO_CONTINUE_REGEX_MAX_BOUND = 16;
    const AUTO_CONTINUE_REGEX_MAX_QUANTIFIERS = 3;
    const AUTO_CONTINUE_REGEX_MAX_ALTERNATIONS = 8;
    const AUTO_CONTINUE_REGEX_MAX_GROUPS = 8;
    const AUTO_CONTINUE_SETTLE_MS = 900;
    const AUTO_CONTINUE_MAX_HANDLED = 64;
    const COMPOSER_SELECTOR = [
      '#prompt-textarea',
      '[data-testid="composer-text-input"]',
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="メッセージ"]'
    ].join(',');
    const SEND_BUTTON_SELECTOR = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt" i]',
      'button[aria-label="Send message" i]',
      'button[aria-label*="送信"]'
    ].join(',');

    function getTurns() {
      return [...document.querySelectorAll('[data-testid^="conversation-turn-"]')];
    }

    function getTurnRole(turn) {
      if (!(turn instanceof Element)) return '';
      const direct = turn.getAttribute('data-message-author-role');
      if (direct) return direct.toLowerCase();
      const roleNode = turn.querySelector('[data-message-author-role]');
      const nested = roleNode?.getAttribute('data-message-author-role');
      if (nested) return nested.toLowerCase();
      if (turn.classList.contains('user-turn') || turn.querySelector('.user-turn')) return 'user';
      if (turn.classList.contains('agent-turn') || turn.querySelector('.agent-turn')) return 'assistant';
      return '';
    }

    function assistantResponseText(turn) {
      if (!(turn instanceof Element)) return '';
      const markdown = [...turn.querySelectorAll('.markdown')]
        .filter((node) => !node.closest('[class~="group/tool-message"]'));
      if (!markdown.length) return stableElementText(turn);
      return normalizeLabel(markdown.map((node) => stableElementText(node)).join(' '));
    }

    function globToRegExp(pattern) {
      let source = '^';
      for (const char of pattern) {
        if (char === '*') source += '.*';
        else if (char === '?') source += '.';
        else source += '\\^$.*+?()[]{}|'.includes(char) ? `\\${char}` : char;
      }
      return new RegExp(`${source}$`, 'u');
    }

    function autoContinuePatternMatches(text) {
      const pattern = String(state.settings.autoContinuePattern || '').slice(0, AUTO_CONTINUE_PATTERN_LIMIT);
      if (!pattern) return false;
      const mode = state.settings.autoContinuePatternMode === 'regex' ? 'regex' : 'glob';
      const matcherKey = `${mode}\u0000${pattern}`;
      if (state.autoContinueMatcherKey !== matcherKey) {
        state.autoContinueMatcherKey = matcherKey;
        state.autoContinueMatcher = null;
        state.autoContinueMatcherInvalid = false;
        try {
          state.autoContinueMatcher = mode === 'regex' ? new RegExp(pattern) : globToRegExp(pattern);
        } catch {
          state.autoContinueMatcherInvalid = true;
        }
      }
      if (state.autoContinueMatcherInvalid || !(state.autoContinueMatcher instanceof RegExp)) return false;
      return state.autoContinueMatcher.test(String(text || ''));
    }

    function autoContinueTurnKey(turn) {
      const identity = routeTurnIdentity(turn) || turnId(turn);
      return `${location.pathname}${location.search}|${identity}`;
    }

    function rememberAutoContinueKey(key) {
      state.autoContinueHandledKeys.add(key);
      while (state.autoContinueHandledKeys.size > AUTO_CONTINUE_MAX_HANDLED) {
        state.autoContinueHandledKeys.delete(state.autoContinueHandledKeys.values().next().value);
      }
    }

    function findComposer() {
      return [...document.querySelectorAll(COMPOSER_SELECTOR)].find((element) => {
        if (!(element instanceof HTMLElement) || !element.isConnected) return false;
        if (element.matches('textarea,input')) return !element.disabled;
        return element.isContentEditable || element.getAttribute('contenteditable') === 'true';
      }) || null;
    }

    function composerText(composer) {
      if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
        return String(composer.value || '').trim();
      }
      return normalizeLabel(composer?.innerText || composer?.textContent || '');
    }

    function findSendButton(composer) {
      const form = composer?.closest?.('form');
      return form?.querySelector(SEND_BUTTON_SELECTOR) || document.querySelector(SEND_BUTTON_SELECTOR);
    }

    function isEnabledButton(button) {
      return button instanceof HTMLButtonElement && !button.disabled &&
        button.getAttribute('aria-disabled') !== 'true';
    }

    function setComposerText(composer, text) {
      if (!(composer instanceof HTMLElement)) return false;
      composer.focus();
      if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
        const proto = composer instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (!setter) return false;
        setter.call(composer, text);
        composer.dispatchEvent(new Event('input', { bubbles: true }));
        return composerText(composer) === text;
      }
      if (!(composer.isContentEditable || composer.getAttribute('contenteditable') === 'true')) return false;
      const selection = window.getSelection();
      if (!selection) return false;
      const anchor = composer.lastElementChild || composer;
      const range = document.createRange();
      const trailingBreak = anchor.lastChild;
      if (trailingBreak instanceof HTMLBRElement) {
        range.setStartBefore(trailingBreak);
        range.collapse(true);
      } else {
        range.selectNodeContents(anchor);
        range.collapse(false);
      }
      selection.removeAllRanges();
      selection.addRange(range);
      // The caller only invokes us for an empty composer. Never fall back to
      // textContent/innerHTML: ProseMirror owns the block structure and direct
      // DOM writes can desynchronize it from React/editor state.
      const inserted = document.execCommand?.('insertText', false, text);
      if (!inserted) return false;
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      return composerText(composer) === text;
    }

    function clearAutoContinueDraft(composer) {
      if (!(composer instanceof HTMLElement) || composerText(composer) !== AUTO_CONTINUE_TEXT) return false;
      if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
        const proto = composer instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (!setter) return false;
        setter.call(composer, '');
        composer.dispatchEvent(new Event('input', { bubbles: true }));
        return !composerText(composer);
      }
      if (!(composer.isContentEditable || composer.getAttribute('contenteditable') === 'true')) return false;
      const selection = window.getSelection();
      if (!selection) return false;
      // Auto Continue inserted into the final editor block. Delete through the
      // browser editing pipeline so ProseMirror keeps its <p>/<br> structure.
      const anchor = composer.lastElementChild || composer;
      const range = document.createRange();
      range.selectNodeContents(anchor);
      selection.removeAllRanges();
      selection.addRange(range);
      const deleted = document.execCommand?.('delete', false);
      if (!deleted) return false;
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      return !composerText(composer);
    }

    async function submitAutoContinue(composer) {
      const initialButton = findSendButton(composer);
      if (!(initialButton instanceof HTMLButtonElement)) return false;
      if (!setComposerText(composer, AUTO_CONTINUE_TEXT)) return false;
      const deadline = Date.now() + 1200;
      while (Date.now() < deadline) {
        if (!composer.isConnected || composerText(composer) !== AUTO_CONTINUE_TEXT) return false;
        const button = findSendButton(composer);
        if (isEnabledButton(button)) {
          button.click();
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      clearAutoContinueDraft(composer);
      return false;
    }

    async function runAutoContinueCheck() {
      state.autoContinueTimer = 0;
      if (!state.settings.enabled || !state.settings.autoContinueIncomplete || state.autoContinueSending) return;
      if (document.querySelector(STOP_GENERATING_SELECTOR)) return;
      const turns = getTurns();
      const latestTurn = turns.at(-1);
      if (!(latestTurn instanceof Element) || getTurnRole(latestTurn) !== 'assistant') return;
      const key = autoContinueTurnKey(latestTurn);
      if (!key || state.autoContinueHandledKeys.has(key)) return;
      if (!autoContinuePatternMatches(assistantResponseText(latestTurn))) return;
      const composer = findComposer();
      if (!(composer instanceof HTMLElement) || composerText(composer)) return;

      state.autoContinueSending = true;
      try {
        const sent = await submitAutoContinue(composer);
        // An automatic attempt is single-shot per assistant turn. If ChatGPT's
        // send control stays disabled, the draft cleanup mutates the composer;
        // without recording the key those mutations can immediately schedule
        // the same attempt again and create a focus/typing loop.
        rememberAutoContinueKey(key);
        if (sent) state.stats.autoContinues += 1;
      } finally {
        state.autoContinueSending = false;
      }
    }

    function scheduleAutoContinueCheck(delay = AUTO_CONTINUE_SETTLE_MS) {
      if (!state.settings.enabled || !state.settings.autoContinueIncomplete) return;
      clearTimeout(state.autoContinueTimer);
      state.autoContinueTimer = setTimeout(runAutoContinueCheck, delay);
    }

    function applyFreeze() {
      const visibleTurns = getTurns();
      const active = state.settings.enabled && state.settings.freezeOldTurns && !state.settings.showRecentOnly;
      const keep = Math.max(2, Number(state.settings.keepTurns) || 12);
      const cutoff = active ? Math.max(0, visibleTurns.length - keep) : 0;
      for (let i = 0; i < visibleTurns.length; i += 1) {
        visibleTurns[i].classList.toggle('csg-frozen', i < cutoff);
      }
      state.stats.frozen = cutoff;
    }

    function scheduleFreeze() {
      if (!state.settings.freezeOldTurns && state.stats.frozen === 0) return;
      if (state.freezeTimer) return;
      state.freezeTimer = setTimeout(() => {
        state.freezeTimer = 0;
        applyFreeze();
      }, 500);
    }

    function toggleClass(name, on) {
      root.classList.toggle(name, Boolean(state.settings.enabled && on));
    }

    function applySettings() {
      toggleClass('csg-hide-thinking', state.settings.hideThinking);
      toggleClass('csg-hide-tools', state.settings.hideTools);
      toggleClass('csg-hide-tool-summary', state.settings.hideToolSummary);
      toggleClass('csg-hide-tool-embeds', state.settings.hideToolEmbeds);
      toggleClass('csg-hide-old-app-errors', state.settings.hideOldAppLoadErrors);
      toggleClass('csg-dim-traces', state.settings.dimTraces);
      toggleClass('csg-compact-traces', state.settings.compactTraces);
      toggleClass('csg-reduce-motion', state.settings.reduceMotion);
      toggleClass('csg-lazy-heavy', state.settings.lazyHeavyBlocks);
        toggleClass('csg-freeze-old', state.settings.freezeOldTurns);
        if (!state.settings.enabled || !state.settings.hideToolSummary) {
        clearTimeout(state.toolCleanupTimer);
        state.toolCleanupTimer = 0;
        stopSummaryLiveObservation();
        toolShellObserver.disconnect();
        for (const shell of state.textToolShells) shell.classList.remove('csg-tool-ui');
        for (const marker of state.toolSummaryMarkers) {
          marker.classList.remove('csg-tool-summary');
          marker.style.removeProperty('--csg-collapse-block');
        }
        for (const marker of [...state.toolSummaryStealthMarkers]) unmarkToolSummaryStealth(marker);
        for (const marker of [...state.toolSummaryLiveMarkers]) unmarkToolSummaryLive(marker);
        state.textToolShells.clear();
        state.toolShellMarkers.clear();
        state.toolSummaryMarkers.clear();
        state.toolSummaryStealthMarkers.clear();
        state.toolSummaryLiveMarkers.clear();
        for (const root of state.toolSummaryPendingRoots) state.pendingRoots.delete(root);
        state.toolSummaryPendingRoots.clear();
        // A later re-enable on the same React DOM must be allowed to perform a
        // fresh historical fallback sweep instead of inheriting "already seen"
        // turn nodes from the previous enabled session.
        state.toolSummaryInitialSweepQueued = new WeakSet();
        state.toolSummaryFallbackSweepPending = new WeakSet();
        state.toolSummaryFallbackSweepCursor = new WeakMap();
      }
      if (!state.settings.enabled || !state.settings.hideToolEmbeds) {
        clearAllPreviewSurfaces();
      }
      if (!state.settings.enabled || !state.settings.hideOldAppLoadErrors) {
        clearOldAppErrorTracking();
        clearTimeout(state.oldAppRouteSettleTimer);
        clearTimeout(state.oldAppRouteFallbackTimer);
        clearTimeout(state.oldAppRouteCheckTimer);
        state.oldAppRouteSettleTimer = 0;
        state.oldAppRouteFallbackTimer = 0;
        state.oldAppRouteCheckTimer = 0;
        state.oldAppRoutePending = false;
        state.oldAppStableTurns.clear();
        state.oldAppRoutePreviousTurns.clear();
      }
      if (!state.settings.enabled || !state.settings.autoContinueIncomplete) {
        clearTimeout(state.autoContinueTimer);
        state.autoContinueTimer = 0;
      }
      updateStatus();
      if (!state.settings.enabled) return;
      if (state.settings.hideToolEmbeds) scanPreviewSurfaces(document.body);
      if (needsGeneralMutationScan()) {
        // Seed the live boundary synchronously before the document observer is
        // attached. This removes the short startup window where a classless
        // streaming summary could mutate before the first idle scan establishes
        // which turns are protected.
        if (state.settings.hideToolSummary) {
          const turns = [...document.querySelectorAll(TURN_SELECTOR)];
          state.liveProtectedTurns = computeLiveProtectedTurns(mountedLatestTurnIndex(), turns);
        }
        scheduleScan(document.body);
      } else if (state.settings.hideToolSummary) {
        // Real historical MCP rows are CSS-only. JS scans only the protected
        // live edge; legacy disclosures are revisited when they cross that edge.
        const turns = [...document.querySelectorAll(TURN_SELECTOR)];
        const latestTurnIndex = mountedLatestTurnIndex();
        state.liveProtectedTurns = computeLiveProtectedTurns(latestTurnIndex, turns);
        for (const turn of state.liveProtectedTurns) queueToolSummaryRoot(turn);
        scheduleScan();
      }
      scheduleFreeze();
      scheduleAutoContinueCheck();
    }

    function ensureStatus() {
      let el = document.getElementById('csg-status');
      if (el) return el;
      el = document.createElement('div');
      el.id = 'csg-status';
      el.setAttribute('aria-hidden', 'true');
      (document.body || document.documentElement).appendChild(el);
      return el;
    }

    function collectStats() {
      const enabled = Boolean(state.settings.enabled);
      const outsideHiddenOldTurn = (el) => !(el instanceof Element) || !el.closest('.csg-hidden-old-turn');
      const countOutsideOld = (selector) => [...document.querySelectorAll(selector)].filter(outsideHiddenOldTurn).length;
      const hiddenThinking = enabled && state.settings.hideThinking ? countOutsideOld('.csg-thinking') : 0;
      const hiddenTools = enabled && state.settings.hideTools ? countOutsideOld('.csg-tool') : 0;
      const outsideHiddenTrace = (el) => outsideHiddenOldTurn(el) &&
        !(state.settings.hideThinking && el.closest('.csg-thinking')) &&
        !(state.settings.hideTools && el.closest('.csg-tool'));
      const hiddenToolSummary = enabled && state.settings.hideToolSummary
        ? [
            ...state.textToolShells,
            ...[...state.toolSummaryMarkers].filter((marker) => !marker.closest('.csg-tool-ui')),
            ...[...state.toolSummaryStealthMarkers].filter((marker) => !marker.closest('.csg-tool-ui')),
            ...[...state.toolSummaryLiveMarkers].filter((marker) => !marker.closest('.csg-tool-ui'))
          ].filter((el) => el.isConnected && outsideHiddenTrace(el)).length : 0;
      const hiddenToolEmbeds = enabled && state.settings.hideToolEmbeds
        ? [...state.previewSurfaces.values()].filter((entry) =>
            entry?.mount?.isConnected && entry.mount.getAttribute('data-csg-preview-state') === 'broken'
          ).length : 0;
      const hiddenPrehide = 0;
      const independentlyHiddenOldAppError = (el) => outsideHiddenOldTurn(el) &&
        !(state.settings.hideThinking && el.closest('.csg-thinking')) &&
        !(state.settings.hideTools && el.closest('.csg-tool')) &&
        !(state.settings.hideToolSummary && el.closest('.csg-tool-ui'));
      const hiddenOldAppErrors = enabled && state.settings.hideOldAppLoadErrors
        ? [...document.querySelectorAll('.csg-old-app-load-error')].filter(independentlyHiddenOldAppError).length : 0;
      const heavy = enabled && state.settings.lazyHeavyBlocks ? document.querySelectorAll('.csg-heavy').length : 0;
      const hiddenOldTurns = enabled && state.settings.showRecentOnly ? Number(root.dataset.csgRecentHiddenTurns || 0) : 0;
      const hiddenOldExchanges = enabled && state.settings.showRecentOnly ? Number(root.dataset.csgRecentHiddenExchanges || 0) : 0;
      const recentReady = root.dataset.csgRecentState || 'off';
      const hiddenTotal = hiddenThinking + hiddenTools + hiddenToolSummary + hiddenToolEmbeds + hiddenPrehide + hiddenOldAppErrors + hiddenOldTurns;
      return { ...state.stats, hiddenThinking, hiddenTools, hiddenToolSummary, hiddenToolEmbeds, hiddenPrehide, hiddenOldAppErrors, hiddenTotal, heavy, hiddenOldTurns, hiddenOldExchanges, recentReady };
    }

    function updateStatus() {
      const el = ensureStatus();
      if (!el) return;
      const s = state.settings;
      el.dataset.active = String(Boolean(s.enabled && s.showStatus));
      el.textContent = state.uiLanguage === 'ja'
        ? `Guard · 安定描画 · 遅延 ${state.stats.frozen}`
        : `Guard · stable rendering · deferred ${state.stats.frozen}`;
    }


    function scheduleDetachedCleanup() {
      if (state.detachedCleanupTimer) return;
      state.detachedCleanupTimer = setTimeout(() => {
        state.detachedCleanupTimer = 0;
        scheduleToolChromeCleanup(250);
        if (state.previewSurfaces.size) {
          for (const [iframe, entry] of state.previewSurfaces) {
            if (!iframe.isConnected || !entry.mount?.isConnected || !entry.mount.contains(iframe)) {
              clearPreviewSurface(iframe);
            }
          }
        }
        if (state.oldAppErrorObservers.size) cleanupOldAppErrorTracking();
        if (state.oldAppLoadErrors.size) scheduleOldAppErrorRefresh();
      }, 0);
    }

    function needsGeneralMutationScan() {
      const s = state.settings;
      return Boolean(
        s.hideThinking || s.hideTools || s.hideToolEmbeds || s.hideOldAppLoadErrors ||
        s.dimTraces || s.compactTraces || s.reduceMotion || s.lazyHeavyBlocks ||
        s.freezeOldTurns || s.autoContinueIncomplete
      );
    }

    function consumeSummaryLiveMutations(mutations) {
      for (const mutation of mutations || []) {
        scheduleSummaryMutationRoot(mutation.target);
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => scheduleSummaryMutationRoot(node));
        }
      }
    }

    function stopSummaryLiveObservation() {
      state.summaryLiveObserver?.disconnect();
      state.summaryLiveObservedTurns.clear();
      state.summaryBoundaryObserver?.disconnect();
      state.summaryBoundaryRoots.clear();
      state.summaryGenerationObserver?.disconnect();
      state.summaryGenerationRoot = null;
      state.summaryGenerationActive = false;
    }

    function refreshSummaryLiveObservation() {
      if (!state.settings.enabled || !state.settings.hideToolSummary || needsGeneralMutationScan()) {
        stopSummaryLiveObservation();
        return;
      }
      const turns = [...document.querySelectorAll(TURN_SELECTOR)];
      const latestTurnIndex = mountedLatestTurnIndex();
      const nextProtected = computeLiveProtectedTurns(latestTurnIndex, turns);
      const changed = new Set();
      for (const turn of state.liveProtectedTurns) if (!nextProtected.has(turn)) changed.add(turn);
      for (const turn of nextProtected) if (!state.liveProtectedTurns.has(turn)) changed.add(turn);
      const sameObserved = state.summaryLiveObservedTurns.size === nextProtected.size &&
        [...nextProtected].every((turn) => state.summaryLiveObservedTurns.has(turn) && turn.isConnected);
      if (!sameObserved) {
        if (!state.summaryLiveObserver) {
          state.summaryLiveObserver = new MutationObserver(consumeSummaryLiveMutations);
        } else {
          // disconnect() discards queued records. Drain them while the previous
          // live-protection set is still active so a boundary shift cannot lose
          // the final streamed characters of a classless tool summary.
          consumeSummaryLiveMutations(state.summaryLiveObserver.takeRecords());
        }
        state.summaryLiveObserver.disconnect();
        state.summaryLiveObservedTurns = new Set(nextProtected);
        for (const turn of nextProtected) {
          if (!turn.isConnected) continue;
          state.summaryLiveObserver.observe(turn, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['aria-label', 'aria-expanded', 'title', 'role']
          });
        }
      }
      state.liveProtectedTurns = nextProtected;
      state.latestTurnIndex = latestTurnIndex;
      for (const turn of changed) if (turn.isConnected) scheduleScan(turn);
    }

    function summaryBoundaryMutationTouchesTurn(mutation) {
      if (mutation.type === 'childList') {
        return [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
          node instanceof Element &&
          (node.matches(TURN_SELECTOR) || Boolean(node.querySelector?.(TURN_SELECTOR)))
        );
      }
      if (mutation.type !== 'attributes') return false;
      const oldId = String(mutation.oldValue || '');
      return mutation.target.matches?.(TURN_SELECTOR) || oldId.startsWith('conversation-turn-');
    }

    function bindSummaryBoundaryObserver() {
      const turns = [...document.querySelectorAll(TURN_SELECTOR)];
      const roots = new Set();
      for (const turn of turns) {
        if (!turn.isConnected) continue;
        roots.add(turn);
        const parent = turn.parentElement;
        if (parent instanceof Element) roots.add(parent);
        const grandparent = parent?.parentElement;
        if (grandparent instanceof Element && grandparent !== document.body) roots.add(grandparent);
      }
      const sameRoots = state.summaryBoundaryRoots.size === roots.size &&
        [...roots].every((root) => state.summaryBoundaryRoots.has(root) && root.isConnected);
      if (sameRoots && state.summaryBoundaryObserver) return;
      if (!state.summaryBoundaryObserver) {
        state.summaryBoundaryObserver = new MutationObserver((mutations) => {
          if (!mutations.some(summaryBoundaryMutationTouchesTurn)) return;
          refreshSummaryLiveObservation();
          bindSummaryBoundaryObserver();
          bindSummaryGenerationObserver();
        });
      }
      state.summaryBoundaryObserver.disconnect();
      state.summaryBoundaryRoots = roots;
      for (const root of roots) {
        if (root.matches(TURN_SELECTOR)) {
          state.summaryBoundaryObserver.observe(root, {
            attributes: true,
            attributeFilter: ['data-testid'],
            attributeOldValue: true
          });
        } else {
          // Observe only direct structural children of the mounted turn parents.
          // Streaming inside a turn never reaches this observer.
          state.summaryBoundaryObserver.observe(root, { childList: true, subtree: false });
        }
      }
    }

    function summaryGenerationObservationRoot() {
      const stop = document.querySelector(STOP_GENERATING_SELECTOR);
      const composer = document.querySelector('#prompt-textarea,[data-testid="composer-text-input"],textarea[placeholder*="Message" i],textarea[placeholder*="メッセージ"]');
      const form = stop?.closest('form') || composer?.closest('form');
      if (!(form instanceof Element)) return null;
      return form.parentElement instanceof Element ? form.parentElement : form;
    }

    function bindSummaryGenerationObserver() {
      if (!state.settings.enabled || !state.settings.hideToolSummary || needsGeneralMutationScan()) {
        state.summaryGenerationObserver?.disconnect();
        state.summaryGenerationRoot = null;
        state.summaryGenerationActive = false;
        return;
      }
      const root = summaryGenerationObservationRoot();
      const active = isGenerationActive();
      state.summaryGenerationActive = active;
      if (!(root instanceof Element)) return;
      if (root === state.summaryGenerationRoot && root.isConnected && state.summaryGenerationObserver) return;
      if (!state.summaryGenerationObserver) {
        state.summaryGenerationObserver = new MutationObserver(() => {
          const nextActive = isGenerationActive();
          const changed = nextActive !== state.summaryGenerationActive;
          state.summaryGenerationActive = nextActive;
          if (changed) refreshSummaryLiveObservation();
          if (!state.summaryGenerationRoot?.isConnected) bindSummaryGenerationObserver();
        });
      }
      state.summaryGenerationObserver.disconnect();
      state.summaryGenerationRoot = root;
      state.summaryGenerationObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ['data-testid', 'aria-label']
      });
    }

    function startSummaryLiveObservation() {
      refreshSummaryLiveObservation();
      bindSummaryBoundaryObserver();
      bindSummaryGenerationObserver();
    }

    function bootstrapRecoveryRoot(element) {
      if (!(element instanceof Element)) return null;
      const dataRoot = element.closest('[data-testid]');
      if (dataRoot instanceof Element && !dataRoot.matches(TURN_SELECTOR)) return dataRoot;
      const shell = element.closest('[class~="group/tool-message"],.no-scrollbar');
      if (shell instanceof Element) return shell;
      // Rich embed mutations often happen inside a nested header trigger. Walk
      // outward until the turn boundary and recover the adjacent no-scrollbar
      // body so loading/actionable -> passive transitions are reclassified.
      for (let cursor = element; cursor instanceof Element && !cursor.matches(TURN_SELECTOR); cursor = cursor.parentElement) {
        if (cursor.nextElementSibling?.matches?.('.no-scrollbar')) return cursor.nextElementSibling;
        if (cursor.previousElementSibling?.matches?.('.no-scrollbar')) return cursor.previousElementSibling;
      }
      const stack = element.closest('.grow.flex.flex-col');
      const placeholder = stack?.querySelector(':scope > .no-scrollbar');
      return placeholder instanceof Element ? placeholder : null;
    }

    function containsStopGeneratingControl(node) {
      if (!(node instanceof Element)) return false;
      return node.matches(STOP_GENERATING_SELECTOR) || Boolean(node.querySelector(STOP_GENERATING_SELECTOR));
    }

    const observer = new MutationObserver((mutations) => {
      if (!state.settings.enabled) return;
      const generalMutationScan = needsGeneralMutationScan();
      let removed = false;
      let conversationTurnChanged = false;
      let generationStateChanged = false;
      const classifiedSelector = '.csg-thinking, .csg-tool, .csg-tool-ui, .csg-tool-summary, .csg-tool-summary-stealth, .csg-tool-summary-live';

      // Summary mutations are fed into a bounded idle queue. Never process
      // every added React node synchronously in one observer callback.


      const noteTurnNode = (node) => {
        if (!(node instanceof Element)) return;
        if (node.matches(TURN_SELECTOR)) {
          conversationTurnChanged = true;
          scheduleScan(node);
          return;
        }
        const nestedTurns = node.querySelectorAll?.(TURN_SELECTOR);
        if (nestedTurns?.length) {
          conversationTurnChanged = true;
          nestedTurns.forEach((turn) => scheduleScan(turn));
        }
      };

      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
          if (!(target instanceof Element)) continue;
          if (containsStopGeneratingControl(target) ||
              wasStopGeneratingAttribute(mutation.attributeName, mutation.oldValue)) {
            generationStateChanged = true;
          }
          scheduleSummaryMutationRoot(target);
          if (mutation.attributeName === 'data-testid' &&
              (target.matches(TURN_SELECTOR) || String(mutation.oldValue || '').startsWith('conversation-turn-'))) {
            conversationTurnChanged = true;
          }
          const classified = target.closest?.(classifiedSelector);
          // A changed label/action on an already classified summary needs a
          // local reclassification even when summary is the only enabled feature.
          if (state.settings.hideToolSummary && classified) scheduleScan(classified);
          if (!generalMutationScan) continue;
          if (state.settings.hideToolEmbeds) scanPreviewSurfaces(target);
          scheduleScan(classified || bootstrapRecoveryRoot(target) || target);
          continue;
        }

        if (mutation.type === 'characterData') {
          const parent = mutation.target.parentElement;
          scheduleSummaryMutationRoot(mutation.target);
          const classified = parent?.closest?.(classifiedSelector);
          if (state.settings.hideToolSummary && classified) scheduleScan(classified);
          if (!generalMutationScan) continue;
          const recovery = bootstrapRecoveryRoot(parent);
          if (!classified && recovery) scheduleScan(recovery);
          continue;
        }

        if (state.oldAppRoutePending) noteOldAppRouteStructureChange();
        const mutationTarget = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        scheduleSummaryMutationRoot(mutationTarget);
        const classifiedShell = mutationTarget?.closest?.(classifiedSelector);
        if (state.settings.hideToolSummary && classifiedShell) scheduleScan(classifiedShell);

        for (const node of mutation.addedNodes) {
          if (containsStopGeneratingControl(node)) generationStateChanged = true;
          scheduleSummaryMutationRoot(node);
          noteTurnNode(node);
        }
        for (const node of mutation.removedNodes) {
          if (!(node instanceof Element)) continue;
          if (containsStopGeneratingControl(node)) generationStateChanged = true;
          removed = true;
          if (node.matches(TURN_SELECTOR) || Boolean(node.querySelector(TURN_SELECTOR))) {
            conversationTurnChanged = true;
          }
        }

        if (!generalMutationScan) continue;
        if (state.settings.hideToolEmbeds) scanPreviewSurfaces(mutationTarget);
        const recoveryRoot = bootstrapRecoveryRoot(mutationTarget);
        if (!classifiedShell && recoveryRoot) scheduleScan(recoveryRoot);
        if (!classifiedShell && state.settings.hideToolSummary) {
          const toolShell = mutationTarget?.closest?.('[class~="group/tool-message"],details');
          if (toolShell) {
            const marker = [...toolShell.querySelectorAll(TOOL_CHROME_CANDIDATES)].find((candidate) => {
              if (candidate.closest('.markdown')) return false;
              const label = boundedControlLabel(candidate, 181);
              return label.length <= 180 && (isExactToolSummaryLabel(label) || isConfigLabel(label));
            });
            if (marker) scheduleScan(marker);
          }
        }
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (state.settings.hideToolEmbeds) scanPreviewSurfaces(node);
          // Newly added conversation turns were already queued individually by
          // noteTurnNode(); avoid also scheduling a large wrapper around them.
          if (!node.matches(TURN_SELECTOR) && !node.querySelector?.(TURN_SELECTOR)) scheduleScan(node);
        }
      }

      if (removed) scheduleDetachedCleanup();
      if (conversationTurnChanged || generationStateChanged) scheduleScan();
      if (state.settings.autoContinueIncomplete) scheduleAutoContinueCheck();
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'CSG_GET_STATS') {
        sendResponse({ stats: collectStats(), settings: state.settings, url: location.href });
        return;
      }
      if (message?.type === 'CSG_RESCAN') {
        scheduleScan(document.body);
        sendResponse({ ok: true });
      }
    });

    chrome.storage.local.get({ settings: DEFAULTS }, ({ settings }) => {
      state.settings = normalizeSettings(settings);
      if (state.settings.enabled && state.settings.hideOldAppLoadErrors) {
        // Seed route identity synchronously at document_idle. Without this,
        // a very fast SPA navigation can happen before the first idle scan and
        // leave us unable to prove that the subsequently mounted turns belong
        // to a different conversation.
        state.oldAppStableTurns = routeTurnSnapshot();
      }
      applySettings();
      if (!state.settings.enabled) return;
      if (needsGeneralMutationScan()) {
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeOldValue: true,
          attributeFilter: [
            'data-testid', 'href', 'tabindex', 'role', 'contenteditable', 'type',
            'aria-modal', 'aria-label', 'aria-expanded', 'title'
          ]
        });
      } else if (state.settings.hideToolSummary) {
        // Summary-only mode never observes the whole document. Historical real
        // MCP rows are CSS-only; generic fallback observation is confined to the
        // two protected live turns.
        startSummaryLiveObservation();
      }
      // From this point content.js is the sole runtime summary classifier.
      // prehide.js only supplies first-paint structural CSS state and the
      // recent-conversation loading indicator; it owns no MutationObserver.
      root.dataset.csgContentReady = '1';
      window.dispatchEvent(new Event('csg:content-ready'));
    });

  }
})();
