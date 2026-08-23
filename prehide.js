(() => {
  'use strict';

  chrome.storage.local.get(
    { uiLanguage: 'auto' },
    ({ uiLanguage }) => {
      runGuard(uiLanguage);
    }
  );

  function runGuard(uiLanguage) {
    const root = document.documentElement;

    function normalizeSettings(raw = {}) {
      const legacy = raw.hideToolChrome;
      return {
        enabled: raw.enabled !== false,
        hideToolSummary: raw.hideToolSummary ?? legacy ?? true,
        showRecentOnly: raw.showRecentOnly === true,
        recentExchanges: Math.max(1, Math.min(100, Number(raw.recentExchanges) || 3))
      };
    }

    function isConversationRoute() {
      return location.pathname.startsWith('/c/') || location.pathname.startsWith('/share/');
    }

    function loadingCopy() {
      const preference = String(uiLanguage || 'auto').toLowerCase();
      const japanese = preference === 'ja' || (
        preference === 'auto' && String(navigator.language || '').toLowerCase().startsWith('ja')
      );
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
        root.appendChild(loading);
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

    chrome.storage.local.get({ settings: {} }, ({ settings }) => {
      const loaded = normalizeSettings(settings);
      root.classList.toggle(
        'csg-prehide-tool-summary',
        loaded.enabled && loaded.hideToolSummary
      );
      if (loaded.enabled && loaded.showRecentOnly) {
        ensureRecentLoading(loaded.recentExchanges);
      }
      // Placeholder prehide intentionally remains fail-open. Current ChatGPT
      // `.no-scrollbar` mounts can bootstrap a real App later, so document_start
      // must not hide or observe them before content.js takes over.
    });
  }
})();
