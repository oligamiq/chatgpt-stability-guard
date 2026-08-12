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
        prehideToolPlaceholders: raw.prehideToolPlaceholders ?? legacy ?? true
      };
    }

    function normalize(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
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
