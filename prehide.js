(() => {
  'use strict';

  chrome.storage.local.get({ privacyConsent: false, privacyConsentVersion: 0, uiLanguage: 'auto' }, ({ privacyConsent, privacyConsentVersion, uiLanguage }) => {
    if (privacyConsent !== true || privacyConsentVersion !== 1) return;
    runGuard(uiLanguage);
  });

  function runGuard(uiLanguage) {

    const marked = new Set();
    const partsByBlock = new WeakMap();
    const placeholderObservers = new WeakMap();
    const TURN_SELECTOR = '[data-testid^="conversation-turn-"]';
    const ACTIONABLE_UI_SELECTOR = [
      'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
      '[contenteditable]:not([contenteditable="false"])', '[role="button"]', '[role="link"]',
      '[role="checkbox"]', '[role="switch"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
      '[role="menuitemradio"]', '[role="combobox"]', '[role="slider"]', '[role="spinbutton"]',
      '[role="radio"]', '[role="tab"]', '[role="treeitem"]', '[role="option"]', '[role="dialog"]',
      '[aria-modal="true"]', '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    let active = false;
    let observing = false;
    let latestTurnIndex = -1;

    function updateCount() {
      document.documentElement.dataset.csgPrehideCount = String(marked.size);
    }

    function normalizeSettings(raw = {}) {
      const legacy = raw.hideToolChrome;
      return {
        enabled: raw.enabled !== false,
        prehideToolPlaceholders: raw.prehideToolPlaceholders ?? legacy ?? true,
        showRecentOnly: raw.showRecentOnly === true,
        recentExchanges: Math.max(1, Math.min(100, Number(raw.recentExchanges) || 3))
      };
    }

    function normalize(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function hasActionableUi(element) {
      return element instanceof Element &&
        (element.matches(ACTIONABLE_UI_SELECTOR) || Boolean(element.querySelector(ACTIONABLE_UI_SELECTOR)));
    }

    const LIVE_TOOL_GUARD_TURNS = 2;

    function turnIndex(turn) {
      const id = turn?.getAttribute?.('data-testid') || '';
      const match = /^conversation-turn-(\d+)$/.exec(id);
      return match ? Number(match[1]) : -1;
    }

    function mountedLatestTurnIndex() {
      let latest = -1;
      for (const turn of document.querySelectorAll(TURN_SELECTOR)) latest = Math.max(latest, turnIndex(turn));
      return latest;
    }

    function nodeContainsConversationTurn(node) {
      return node instanceof Element &&
        (node.matches(TURN_SELECTOR) || Boolean(node.querySelector(TURN_SELECTOR)));
    }

    function isProtectedLiveToolTurn(element, latestIndex) {
      if (!(element instanceof Element)) return true;
      const turn = element.closest(TURN_SELECTOR);
      if (!(turn instanceof Element)) return true;
      const index = turnIndex(turn);
      if (index < 0 || latestIndex < 0) return true;
      return index >= latestIndex - (LIVE_TOOL_GUARD_TURNS - 1);
    }

    function isConversationRoute() {
      return location.pathname.startsWith('/c/') || location.pathname.startsWith('/share/');
    }

    function loadingCopy() {
      const preference = String(uiLanguage || 'auto').toLowerCase();
      const japanese = preference === 'ja' || (preference === 'auto' && String(navigator.language || '').toLowerCase().startsWith('ja'));
      return japanese
        ? { title: '直近の会話を準備中', detail: '会話を検出しています…' }
        : { title: 'Preparing recent conversation', detail: 'Detecting conversation…' };
    }

    function ensureRecentLoading(total) {
      if (!isConversationRoute()) return;
      const copy = loadingCopy();
      let loading = document.getElementById('csg-recent-loading');
      if (!loading) {
        loading = document.createElement('div');
        loading.id = 'csg-recent-loading';
        loading.setAttribute('role', 'status');
        loading.setAttribute('aria-live', 'polite');
        const title = document.createElement('div');
        title.className = 'csg-recent-loading-title';
        const detail = document.createElement('div');
        detail.className = 'csg-recent-loading-detail';
        const progress = document.createElement('div');
        progress.className = 'csg-recent-loading-progress';
        progress.setAttribute('aria-hidden', 'true');
        loading.replaceChildren(title, detail, progress);
        document.documentElement.appendChild(loading);
      }
      loading.dataset.stage = 'detecting';
      loading.dataset.confirmed = '0';
      loading.dataset.total = String(total);
      loading.querySelector('.csg-recent-loading-title').textContent = copy.title;
      loading.querySelector('.csg-recent-loading-detail').textContent = copy.detail;
      const progress = loading.querySelector('.csg-recent-loading-progress');
      const slots = Math.min(5, total);
      progress.replaceChildren(...Array.from({ length: slots }, () => {
        const step = document.createElement('span');
        step.className = 'csg-recent-loading-step';
        return step;
      }));
      setTimeout(() => {
        const live = document.getElementById('csg-recent-loading');
        if (live && live.dataset.owner !== 'recent-window') live.remove();
      }, 12000);
    }

    function getParts(block) {
      if (!(block instanceof Element) || !block.classList.contains('no-scrollbar')) return null;
      if (!block.closest(TURN_SELECTOR) || block.closest('.markdown')) return null;
      const stack = block.parentElement;
      if (!(stack instanceof Element) || !stack.classList.contains('grow')) return null;
      if (!stack.classList.contains('flex') || !stack.classList.contains('flex-col')) return null;
      if (!stack.parentElement?.classList.contains('agent-turn')) return null;
      const header = block.previousElementSibling;
      if (!(header instanceof Element) || !header.classList.contains('mt-2')) return null;
      const divider = block.nextElementSibling;
      return { header, divider };
    }

    function stillPlaceholder(block, latestTurnIndex) {
      if (!getParts(block)) return false;
      // Do not display:none placeholders in the newest exchange. ChatGPT apps
      // may start template/bootstrap work only after the live card is visible.
      if (isProtectedLiveToolTurn(block, latestTurnIndex)) return false;
      if (block.classList.contains('csg-tool-embed')) return false;
      if (normalize(block.textContent)) return false;
      // A text-empty auth/action card can still contain icon buttons or custom
      // controls. Those are live UI, not loading placeholders.
      if (hasActionableUi(block)) return false;
      return !block.querySelector('pre,code,img,picture,canvas,video,svg,iframe,table,audio,object,embed');
    }

    function clearParts(parts) {
      parts?.header?.classList.remove('csg-prehide-tool-block');
      parts?.divider?.classList.remove('csg-prehide-tool-block');
    }

    function stopPlaceholderObserver(block) {
      const watched = placeholderObservers.get(block);
      watched?.observer?.disconnect();
      placeholderObservers.delete(block);
    }

    function watchPlaceholder(block, parts) {
      const stack = block?.parentElement;
      if (!(stack instanceof Element)) return;
      const existing = placeholderObservers.get(block);
      if (existing?.stack === stack) return;
      existing?.observer?.disconnect();
      const observer = new MutationObserver(() => mark(block, latestTurnIndex));
      observer.observe(stack, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['href', 'tabindex', 'role', 'contenteditable', 'type', 'aria-modal', 'aria-label', 'title']
      });
      placeholderObservers.set(block, { observer, stack });
    }

    function clearMark(block) {
      const cached = partsByBlock.get(block);
      const live = getParts(block);
      block.classList.remove('csg-prehide-tool-block');
      clearParts(cached);
      if (!cached || live?.header !== cached.header || live?.divider !== cached.divider) clearParts(live);
      stopPlaceholderObserver(block);
      partsByBlock.delete(block);
      marked.delete(block);
      updateCount();
    }

    function mark(block, latestTurnIndex) {
      if (!active) return;
      const parts = getParts(block);
      if (!parts || !stillPlaceholder(block, latestTurnIndex)) {
        if (marked.has(block)) clearMark(block);
        return;
      }
      if (marked.has(block)) {
        const old = partsByBlock.get(block);
        if (old?.header !== parts.header || old?.divider !== parts.divider) clearParts(old);
      }
      block.classList.add('csg-prehide-tool-block');
      // Keep any live header controls visible even while the empty output body
      // is pre-hidden. A connector can surface auth/Connect actions here first.
      parts.header.classList.toggle('csg-prehide-tool-block', !hasActionableUi(parts.header));
      if (parts.divider?.classList.contains('h-px')) parts.divider.classList.add('csg-prehide-tool-block');
      marked.add(block);
      partsByBlock.set(block, parts);
      watchPlaceholder(block, parts);
      updateCount();
    }

    function scan(node, latestTurnIndex) {
      if (!(node instanceof Element)) return;
      if (node.matches('.no-scrollbar')) mark(node, latestTurnIndex);
      node.querySelectorAll?.('.no-scrollbar').forEach((block) => mark(block, latestTurnIndex));
    }

    function clearAll() {
      for (const block of [...marked]) clearMark(block);
    }

    function cleanupRemoved(node) {
      if (!(node instanceof Element)) return;
      if (marked.has(node)) clearMark(node);
      node.querySelectorAll?.('.no-scrollbar').forEach((block) => {
        if (marked.has(block)) clearMark(block);
      });
    }

    const observer = new MutationObserver((mutations) => {
      if (!active) return;
      let turnsChanged = false;
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const oldId = String(mutation.oldValue || '');
          if (mutation.target.matches?.(TURN_SELECTOR) || oldId.startsWith('conversation-turn-')) {
            turnsChanged = true;
            break;
          }
          continue;
        }
        if (![...mutation.addedNodes, ...mutation.removedNodes].some(nodeContainsConversationTurn)) continue;
        turnsChanged = true;
        break;
      }
      if (turnsChanged) latestTurnIndex = mountedLatestTurnIndex();
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          scan(mutation.target, latestTurnIndex);
          continue;
        }
        for (const node of mutation.addedNodes) scan(node, latestTurnIndex);
        for (const node of mutation.removedNodes) cleanupRemoved(node);
      }
    });

    function startObserving() {
      if (observing) return;
      observing = true;
      // Global observation is structural only. Fine-grained text/attribute
      // changes are observed only inside placeholders that are actually hidden.
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-testid'],
        attributeOldValue: true
      });
    }

    updateCount();
    chrome.storage.local.get({ settings: {} }, ({ settings }) => {
      const loaded = normalizeSettings(settings);
      if (loaded.enabled && loaded.showRecentOnly) ensureRecentLoading(loaded.recentExchanges);
      active = loaded.enabled && loaded.prehideToolPlaceholders;
      if (!active) {
        clearAll();
        return;
      }
      latestTurnIndex = mountedLatestTurnIndex();
      startObserving();
      scan(document.documentElement, latestTurnIndex);
    });
  }
})();
