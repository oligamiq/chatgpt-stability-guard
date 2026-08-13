(() => {
  'use strict';

  chrome.storage.local.get({ privacyConsent: false, privacyConsentVersion: 0 }, ({ privacyConsent, privacyConsentVersion }) => {
    if (privacyConsent !== true || privacyConsentVersion !== 1) return;
    runGuard();
  });

  function runGuard() {

    const marked = new Set();
    const partsByBlock = new WeakMap();
    let active = false;
    let observing = false;

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

    function isConversationRoute() {
      return location.pathname.startsWith('/c/') || location.pathname.startsWith('/share/');
    }

    function loadingCopy() {
      const japanese = String(navigator.language || '').toLowerCase().startsWith('ja');
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
      if (block.closest('.markdown')) return null;
      const stack = block.parentElement;
      if (!(stack instanceof Element) || !stack.classList.contains('grow')) return null;
      if (!stack.classList.contains('flex') || !stack.classList.contains('flex-col')) return null;
      if (!stack.parentElement?.classList.contains('agent-turn')) return null;
      const header = block.previousElementSibling;
      if (!(header instanceof Element) || !header.classList.contains('mt-2')) return null;
      const divider = block.nextElementSibling;
      return { header, divider };
    }

    function stillPlaceholder(block) {
      if (!getParts(block)) return false;
      if (block.classList.contains('csg-tool-embed')) return false;
      if (normalize(block.textContent)) return false;
      return !block.querySelector('pre,code,img,picture,canvas,video,svg,iframe,table,audio,object,embed');
    }

    function clearParts(parts) {
      parts?.header?.classList.remove('csg-prehide-tool-block');
      parts?.divider?.classList.remove('csg-prehide-tool-block');
    }

    function clearMark(block) {
      const cached = partsByBlock.get(block);
      const live = getParts(block);
      block.classList.remove('csg-prehide-tool-block');
      clearParts(cached);
      if (!cached || live?.header !== cached.header || live?.divider !== cached.divider) clearParts(live);
      partsByBlock.delete(block);
      marked.delete(block);
      updateCount();
    }

    function mark(block) {
      if (!active) return;
      const parts = getParts(block);
      if (!parts || !stillPlaceholder(block)) {
        if (marked.has(block)) clearMark(block);
        return;
      }
      if (marked.has(block)) {
        const old = partsByBlock.get(block);
        if (old?.header !== parts.header || old?.divider !== parts.divider) clearParts(old);
      }
      block.classList.add('csg-prehide-tool-block');
      parts.header.classList.add('csg-prehide-tool-block');
      if (parts.divider?.classList.contains('h-px')) parts.divider.classList.add('csg-prehide-tool-block');
      marked.add(block);
      partsByBlock.set(block, parts);
      updateCount();
    }

    function scan(node) {
      if (!(node instanceof Element)) return;
      if (node.matches('.no-scrollbar')) mark(node);
      node.querySelectorAll?.('.no-scrollbar').forEach(mark);
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
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) scan(node);
        for (const node of mutation.removedNodes) cleanupRemoved(node);
        const targetElement = mutation.target instanceof Element
          ? mutation.target : mutation.target.parentElement;
        const block = targetElement?.closest?.('.no-scrollbar');
        if (block) mark(block);
      }
    });

    function startObserving() {
      if (observing) return;
      observing = true;
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
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
      startObserving();
      scan(document.documentElement);
    });
  }
})();
