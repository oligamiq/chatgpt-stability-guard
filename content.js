(() => {
  'use strict';

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'CSG_PING') {
      sendResponse({ ok: true, product: 'stability-guard-for-chatgpt' });
    }
  });

  chrome.storage.local.get({ privacyConsent: false, privacyConsentVersion: 0, uiLanguage: 'auto' }, ({ privacyConsent, privacyConsentVersion, uiLanguage }) => {
    if (privacyConsent !== true || privacyConsentVersion !== 1) return;
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
      showStatus: true
    };

    const state = {
      settings: { ...DEFAULTS },
      uiLanguage: ['ja', 'en'].includes(uiLanguage) ? uiLanguage : (String(navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en'),
      pendingRoots: new Set(),
      liveBoundaryRoots: new Set(),
      textToolShells: new Set(),
      toolShellMarkers: new Map(),
      embeddedToolBlocks: new Map(),
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
      stats: { thinking: 0, tools: 0, frozen: 0, scans: 0 }
    };

    const root = document.documentElement;
    function normalizeSettings(raw = {}) {
      const legacy = raw.hideToolChrome;
      return {
        ...DEFAULTS,
        ...raw,
        hideToolSummary: raw.hideToolSummary ?? legacy ?? DEFAULTS.hideToolSummary,
        hideToolEmbeds: raw.hideToolEmbeds ?? legacy ?? DEFAULTS.hideToolEmbeds,
        prehideToolPlaceholders: raw.prehideToolPlaceholders ?? legacy ?? DEFAULTS.prehideToolPlaceholders
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
      return text.startsWith('ツールが呼び出されました') ||
        text.startsWith('Tools were called') || text.startsWith('Tools called') ||
        text.startsWith('Called tool') || text.startsWith('Called tools');
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

    function isPassiveToolDisclosure(control) {
      if (!(control instanceof Element)) return false;
      if (control.matches('summary')) return true;
      const label = normalizeLabel(control.textContent);
      return label.length <= 180 && (isToolSummaryLabel(label) || isConfigLabel(label));
    }

    const ACTION_LINK_LABEL_RE = /(?:\b(?:connect|authori[sz]e|authenticate|sign\s*in|log\s*in|continue|allow|grant|enable|add(?:\s+(?:account|app|connector|plugin|source|library))?)\b|接続|認証|ログイン|追加|許可|連携)/i;

    function hasActionableUi(element, allowPassiveTraceControls = false) {
      if (!(element instanceof Element)) return false;
      const controls = [];
      if (element.matches(ACTIONABLE_UI_SELECTOR)) controls.push(element);
      controls.push(...element.querySelectorAll(ACTIONABLE_UI_SELECTOR));
      return controls.some((control) => {
        if (!allowPassiveTraceControls) return true;
        // Normal assistant output can legitimately contain links, focus-only
        // scroll containers and copy controls. Ignore those narrow cases, but
        // action-looking auth/connect links must fail open even in markdown.
        if (control.closest('pre, code')) return false;
        const label = normalizeLabel(control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent);
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

    function mountedLatestTurnIndex() {
      let latest = -1;
      for (const turn of document.querySelectorAll(TURN_SELECTOR)) {
        latest = Math.max(latest, turnIndexFromId(turnId(turn)));
      }
      return latest;
    }

    function computeLiveProtectedTurns(latestIndex, turns = [...document.querySelectorAll(TURN_SELECTOR)]) {
      const protectedTurns = new Set(turns.slice(-LIVE_TOOL_GUARD_TURNS));
      for (const turn of turns) {
        const index = turnIndexFromId(turnId(turn));
        if (index < 0 || latestIndex < 0 || index >= latestIndex - (LIVE_TOOL_GUARD_TURNS - 1)) {
          protectedTurns.add(turn);
        }
      }
      return protectedTurns;
    }

    function isProtectedLiveToolTurn(element, latestIndex = mountedLatestTurnIndex(), protectedTurns = state.liveProtectedTurns) {
      if (!(element instanceof Element)) return true;
      const turn = element.closest(TURN_SELECTOR);
      if (!(turn instanceof Element)) return true;
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
      for (const turn of changedTurns) state.liveBoundaryRoots.add(turn);
      return changedTurns;
    }

    function isAppErrorShell(aside) {
      if (!(aside instanceof Element) || aside.tagName !== 'ASIDE') return false;
      return String(aside.className || '').includes('surface-error');
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

    function isAppTemplateFetchErrorCard(aside) {
      if (!isAppErrorShell(aside)) return false;
      const heading = aside.querySelector(
        'h1.text-token-text-error,h2.text-token-text-error,h3.text-token-text-error,' +
        'h4.text-token-text-error,h5.text-token-text-error,h6.text-token-text-error,[role="heading"].text-token-text-error'
      );
      if (!(heading instanceof Element)) return false;
      return stableElementText(aside).includes('Failed to fetch template');
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
      for (const aside of document.querySelectorAll('aside[class*="surface-error"]')) {
        if (!isAppErrorShell(aside)) continue;
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
      const currentLiveTurns = computeLiveProtectedTurns(state.latestTurnIndex);
      for (const aside of [...state.oldAppLoadErrors]) {
        if (!aside.isConnected || !isAppTemplateFetchErrorCard(aside)) {
          aside.classList.remove('csg-old-app-load-error');
          state.oldAppLoadErrors.delete(aside);
          if (!aside.isConnected || !isAppErrorShell(aside)) stopOldAppErrorObserver(aside);
          continue;
        }
        const index = turnIndexFromId(turnId(aside.closest(TURN_SELECTOR)));
        const canProveOld = index >= 0 && state.latestTurnIndex >= 0 &&
          !isProtectedLiveToolTurn(aside, state.latestTurnIndex, currentLiveTurns);
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
      const liveToolProtected = inTurn && isProtectedLiveToolTurn(el, latestTurnIndex);
      // Interactive rich UI must fail open. Thinking/tool traces are optimization
      // targets; Connect/Add/auth controls are application UI and stay untouched.
      // Tool wrappers in the newest exchange are also kept live because ChatGPT
      // apps can defer template/bootstrap work until their DOM is visible/laid out.
      const isThinking = inTurn && hasKey(testId, THINK_KEYS) && !hasAppAction && !liveToolProtected;
      const isTool = inTurn && hasKey(testId, TOOL_KEYS) && !hasAppAction && !liveToolProtected;
      const isTrace = isThinking || isTool;
      const traceChildren = [...el.children].filter((child) => child.classList.contains('csg-trace-body'));
      let traceBody = null;
      if (isTrace && el.children.length > 1) {
        const body = el.lastElementChild;
        if (body && !hasActionableUi(body, true)) traceBody = body;
      }
      const isHeavy = inTurn && !liveToolProtected && state.settings.lazyHeavyBlocks &&
        (el.matches('pre') || hasKey(testId, ['code']));
      return { el, isThinking, isTool, isHeavy, traceChildren, traceBody };
    }

    function applyElementAnalysis(plan) {
      if (!plan) return;
      const { el, isThinking, isTool, isHeavy, traceChildren, traceBody } = plan;
      el.classList.toggle('csg-thinking', isThinking);
      el.classList.toggle('csg-tool', isTool);
      el.classList.toggle('csg-heavy', isHeavy);
      for (const child of traceChildren) child.classList.remove('csg-trace-body');
      traceBody?.classList.add('csg-trace-body');
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

    function isPassiveStructuralToolShell(shell, latestTurnIndex) {
      return isConversationTurnScoped(shell) &&
        !isProtectedLiveToolTurn(shell, latestTurnIndex) &&
        shell.matches('[class~="group/tool-message"]') &&
        !hasActionableUi(shell, true);
    }

    function findToolSummaryShell(marker) {
      return marker.closest('[class~="group/tool-message"]') ||
        marker.closest('details') || marker;
    }

    function getEmbeddedToolParts(block, latestTurnIndex) {
      if (!(block instanceof Element) || !block.classList.contains('no-scrollbar')) return null;
      if (!isConversationTurnScoped(block) || !block.closest('.agent-turn')) return null;
      // Never display:none a live/recent ChatGPT app/tool card. Some app loaders
      // bootstrap lazily from visibility/layout and can fail template loading if hidden.
      if (isProtectedLiveToolTurn(block, latestTurnIndex)) return null;
      // Rich tool/app cards can contain authentication, Connect, Add, links, or
      // other controls. Never hide those as a passive embed.
      if (hasActionableUi(block)) return null;
      const header = block.previousElementSibling;
      if (!(header instanceof Element)) return null;
      const trigger = header.querySelector('[role="button"]');
      if (!(trigger instanceof Element)) return null;
      const extraHeaderAction = [...header.querySelectorAll(ACTIONABLE_UI_SELECTOR)]
        .some((control) => control !== trigger && !trigger.contains(control));
      if (extraHeaderAction) return null;
      const icon = trigger.querySelector(':scope > img[alt]');
      const nestedButton = trigger.querySelector(':scope > button');
      if (!(icon instanceof HTMLImageElement) || !(nestedButton instanceof HTMLButtonElement)) return null;
      const alt = normalizeLabel(icon.alt);
      const label = normalizeLabel(trigger.textContent);
      if (!alt || !label || label.length > 160 || !label.includes(alt)) return null;
      return { header, divider: block.nextElementSibling };
    }

    function clearEmbeddedToolBlock(block, parts = state.embeddedToolBlocks.get(block)) {
      if (!(block instanceof Element)) return;
      block.classList.remove('csg-tool-embed');
      parts?.header?.classList.remove('csg-tool-embed');
      parts?.divider?.classList.remove('csg-tool-embed');
      state.embeddedToolBlocks.delete(block);
    }

    function reconcileEmbeddedToolBlock(block, latestTurnIndex) {
      if (!(block instanceof Element)) return;
      const oldParts = state.embeddedToolBlocks.get(block);
      const parts = getEmbeddedToolParts(block, latestTurnIndex);
      if (!parts) {
        if (oldParts || block.classList.contains('csg-tool-embed')) clearEmbeddedToolBlock(block, oldParts);
        return;
      }
      if (oldParts && (oldParts.header !== parts.header || oldParts.divider !== parts.divider)) {
        oldParts.header?.classList.remove('csg-tool-embed');
        oldParts.divider?.classList.remove('csg-tool-embed');
      }
      block.classList.add('csg-tool-embed');
      parts.header.classList.add('csg-tool-embed');
      if (parts.divider?.classList.contains('h-px')) parts.divider.classList.add('csg-tool-embed');
      state.embeddedToolBlocks.set(block, parts);
    }

    function cleanupEmbeddedToolBlocks() {
      const latestTurnIndex = mountedLatestTurnIndex();
      for (const [block] of [...state.embeddedToolBlocks]) {
        if (!block.isConnected || !getEmbeddedToolParts(block, latestTurnIndex)) clearEmbeddedToolBlock(block);
      }
    }

    function embeddedToolCandidatesFor(scanRoot) {
      const blocks = new Set();
      const add = (candidate) => {
        if (candidate instanceof Element && candidate.matches('.no-scrollbar')) blocks.add(candidate);
      };
      add(scanRoot);
      add(scanRoot.closest?.('.no-scrollbar'));
      scanRoot.querySelectorAll?.('.no-scrollbar').forEach(add);
      const nearby = [scanRoot, scanRoot.closest?.('.mt-2'), scanRoot.closest?.('.csg-tool-embed')];
      for (const node of nearby) {
        if (!(node instanceof Element)) continue;
        add(node.previousElementSibling);
        add(node.nextElementSibling);
      }
      return [...blocks];
    }

    const TOOL_CHROME_CANDIDATES = 'button,[role="button"],summary,[aria-expanded]';

    function classifyToolChromeCandidate(el, latestTurnIndex) {
      if (!(el instanceof Element) || el.closest('.markdown') || !isConversationTurnScoped(el)) return;
      const structuralShell = el.closest('[class~="group/tool-message"]');
      if (structuralShell) {
        if (isPassiveStructuralToolShell(structuralShell, latestTurnIndex)) markToolChrome(structuralShell, el);
        else unmarkToolChrome(structuralShell);
        return;
      }
      const label = normalizeLabel(el.textContent);
      if (!label || label.length > 180) return;
      if (isToolSummaryLabel(label)) {
        const shell = findToolSummaryShell(el);
        if (isProtectedLiveToolTurn(shell, latestTurnIndex) || hasActionableUi(shell, true)) unmarkToolChrome(shell);
        else markToolChrome(shell, el);
      } else if (isConfigLabel(label)) {
        if (isProtectedLiveToolTurn(el, latestTurnIndex)) unmarkToolChrome(el);
        else markToolChrome(el, el);
      }
    }

    function shellHasToolLabel(shell, latestTurnIndex) {
      const marker = state.toolShellMarkers.get(shell);
      if (!(marker instanceof Element) || !marker.isConnected || !shell.contains(marker)) return false;
      if (isProtectedLiveToolTurn(shell, latestTurnIndex)) return false;
      if (shell.matches('[class~="group/tool-message"]')) return isPassiveStructuralToolShell(shell, latestTurnIndex);
      if (!isConversationTurnScoped(shell)) return false;
      const label = normalizeLabel(marker.textContent);
      if (label.length > 180) return false;
      if (isToolSummaryLabel(label)) return !hasActionableUi(shell, true);
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
    }

    function scanRoot(scanRoot, latestTurnIndex = mountedLatestTurnIndex()) {
      if (!(scanRoot instanceof Element)) return;
      state.stats.scans += 1;

      // Read phase: collect candidates and classification decisions without
      // mutating classes. This avoids repeated style invalidation while walking
      // a large streaming subtree.
      const candidates = [
        scanRoot,
        ...scanRoot.querySelectorAll('[data-testid], .csg-thinking, .csg-tool, .csg-heavy, pre, aside[class*="surface-error"]')
      ];
      const uniqueCandidates = [...new Set(candidates)];
      const plans = uniqueCandidates.map((el) => analyzeElement(el, latestTurnIndex));
      const oldAppErrorCandidates = state.settings.enabled && state.settings.hideOldAppLoadErrors
        ? uniqueCandidates.filter((el) => el.tagName === 'ASIDE' && (
            String(el.className || '').includes('surface-error') ||
            state.oldAppLoadErrors.has(el) || el.classList.contains('csg-old-app-load-error')
          ))
        : [];
      const turnStructureChanged = uniqueCandidates.some((el) => el.matches(TURN_SELECTOR));
      const scanHasTurn = isConversationTurnScoped(scanRoot) || Boolean(scanRoot.querySelector(TURN_SELECTOR));
      const embeddedToolCandidates = state.settings.enabled && state.settings.hideToolEmbeds && scanHasTurn
        ? embeddedToolCandidatesFor(scanRoot)
        : [];
      const toolCandidates = state.settings.enabled && state.settings.hideToolSummary && scanHasTurn
        ? [scanRoot, ...scanRoot.querySelectorAll(TOOL_CHROME_CANDIDATES)]
            .filter((el, index, list) => el.matches(TOOL_CHROME_CANDIDATES) && list.indexOf(el) === index)
        : [];
      const existingTraceBodies = [...scanRoot.querySelectorAll('.csg-trace-body')];

      // Write phase. Trace-body containment is assigned only by analysis of the
      // trace container itself. Never stamp arbitrary streamed descendants.
      if (scanRoot.classList.contains('csg-trace-body') &&
          !scanRoot.parentElement?.matches('.csg-thinking, .csg-tool')) {
        scanRoot.classList.remove('csg-trace-body');
      }
      for (const plan of plans) applyElementAnalysis(plan);
      for (const el of existingTraceBodies) {
        if (!el.parentElement?.matches('.csg-thinking, .csg-tool')) el.classList.remove('csg-trace-body');
      }
      for (const block of embeddedToolCandidates) reconcileEmbeddedToolBlock(block, latestTurnIndex);
      for (const candidate of toolCandidates) classifyToolChromeCandidate(candidate, latestTurnIndex);
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
        const urgentBoundaryRoots = [...state.liveBoundaryRoots].slice(0, 80);
        const urgentSet = new Set(urgentBoundaryRoots);
        const remainingBudget = Math.max(0, 80 - urgentBoundaryRoots.length);
        const normalRoots = [...state.pendingRoots]
          .filter((node) => !urgentSet.has(node))
          .slice(0, remainingBudget);
        const batch = [...urgentBoundaryRoots, ...normalRoots];
        for (const node of urgentBoundaryRoots) state.liveBoundaryRoots.delete(node);
        for (const node of normalRoots) state.pendingRoots.delete(node);
        const batchSet = new Set(batch);
        const roots = batch.filter((node) => {
          for (let parent = node.parentElement; parent; parent = parent.parentElement) {
            if (batchSet.has(parent)) return false;
          }
          return true;
        });
        roots.forEach((node) => scanRoot(node, latestTurnIndex));
        if (state.textToolShells.size) cleanupToolChrome(latestTurnIndex);
        updateStatus();
        scheduleFreeze();
        if (state.liveBoundaryRoots.size || state.pendingRoots.size) scheduleScan();
      });
    }

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
        toolShellObserver.disconnect();
        for (const shell of state.textToolShells) shell.classList.remove('csg-tool-ui');
        state.textToolShells.clear();
        state.toolShellMarkers.clear();
      }
      if (!state.settings.enabled || !state.settings.hideToolEmbeds) {
        for (const [block, parts] of state.embeddedToolBlocks) {
          block.classList.remove('csg-tool-embed');
          parts.header?.classList.remove('csg-tool-embed');
          parts.divider?.classList.remove('csg-tool-embed');
        }
        state.embeddedToolBlocks.clear();
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
      updateStatus();
      if (!state.settings.enabled) return;
      scheduleScan(document.body);
      scheduleFreeze();
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
        ? [...state.textToolShells].filter((el) => el.isConnected && outsideHiddenTrace(el)).length : 0;
      const hiddenToolEmbeds = enabled && state.settings.hideToolEmbeds
        ? [...state.embeddedToolBlocks.keys()].filter((el) => el.isConnected && outsideHiddenTrace(el)).length : 0;
      const hiddenPrehide = enabled && state.settings.prehideToolPlaceholders ? Number(root.dataset.csgPrehideCount || 0) : 0;
      const independentlyHiddenOldAppError = (el) => outsideHiddenOldTurn(el) &&
        !(state.settings.hideThinking && el.closest('.csg-thinking')) &&
        !(state.settings.hideTools && el.closest('.csg-tool')) &&
        !(state.settings.hideToolSummary && el.closest('.csg-tool-ui')) &&
        !(state.settings.hideToolEmbeds && el.closest('.csg-tool-embed'));
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
        if (state.textToolShells.size) cleanupToolChrome();
        if (state.embeddedToolBlocks.size) cleanupEmbeddedToolBlocks();
        if (state.oldAppErrorObservers.size) cleanupOldAppErrorTracking();
        if (state.oldAppLoadErrors.size) scheduleOldAppErrorRefresh();
      }, 0);
    }

    const observer = new MutationObserver((mutations) => {
      if (!state.settings.enabled) return;
      let removed = false;
      let removedConversationTurn = false;
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
          const classified = target?.closest?.('.csg-thinking, .csg-tool, .csg-tool-ui, .csg-tool-embed');
          scheduleScan(classified || target);
          continue;
        }
        if (mutation.type === 'characterData') {
          const parent = mutation.target.parentElement;
          const classified = parent?.closest?.('.csg-thinking, .csg-tool, .csg-tool-ui, .csg-tool-embed');
          if (classified) scheduleScan(classified);
          if (state.settings.hideToolSummary) {
            const candidate = parent?.closest?.(TOOL_CHROME_CANDIDATES);
            if (candidate && !candidate.closest('.markdown')) scheduleScan(candidate);
          }
          continue;
        }
        if (state.oldAppRoutePending) noteOldAppRouteStructureChange();
        const mutationTarget = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        const classifiedShell = mutationTarget?.closest?.('.csg-thinking, .csg-tool, .csg-tool-ui, .csg-tool-embed');
        if (classifiedShell) scheduleScan(classifiedShell);
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) scheduleScan(node);
        }
        for (const node of mutation.removedNodes) {
          if (!(node instanceof Element)) continue;
          removed = true;
          if (!removedConversationTurn &&
              (node.matches(TURN_SELECTOR) || Boolean(node.querySelector(TURN_SELECTOR)))) {
            removedConversationTurn = true;
          }
        }
      }
      if (removed) scheduleDetachedCleanup();
      // A branch/route transition can lower the latest numeric turn solely by
      // removing DOM. Trigger a boundary-only scan even when no new node exists.
      if (removedConversationTurn) scheduleScan();
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
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          'data-testid', 'href', 'tabindex', 'role', 'contenteditable', 'type',
          'aria-modal', 'aria-label', 'title'
        ]
      });
    });

  }
})();
