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
      return /^\/(?:g\/[^/]+\/)?c\//.test(location.pathname) || location.pathname.startsWith('/share/');
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

    function fastTurnRole(turn) {
      const direct = turn.getAttribute('data-message-author-role') || turn.getAttribute('data-turn');
      if (direct === 'user' || direct === 'assistant') return direct;
      const nested = turn.querySelector('[data-message-author-role],[data-turn="user"],[data-turn="assistant"]');
      const role = nested?.getAttribute('data-message-author-role') || nested?.getAttribute('data-turn');
      return role === 'user' || role === 'assistant' ? role : '';
    }

    function installRecentFastPrehide(total) {
      if (!isConversationRoute()) return;
      root.classList.add('csg-prehide-recent-fast');
      const tracked = new Set();
      const roles = new WeakMap();
      let ordered = [];
      let orderDirty = false;
      let scheduled = false;

      const track = (turn) => {
        if (!(turn instanceof Element) || !turn.matches('[data-testid^="conversation-turn-"]')) return;
        if (!tracked.has(turn)) {
          tracked.add(turn);
          orderDirty = true;
        }
        roles.set(turn, fastTurnRole(turn));
      };
      const untrack = (turn) => {
        if (!(turn instanceof Element) || !tracked.delete(turn)) return;
        turn.removeAttribute('data-csg-prehide-old-turn');
        orderDirty = true;
      };
      const trackNode = (node) => {
        if (!(node instanceof Element)) return;
        if (node.matches('[data-testid^="conversation-turn-"]')) track(node);
        node.querySelectorAll?.('[data-testid^="conversation-turn-"]').forEach(track);
      };
      const untrackNode = (node) => {
        if (!(node instanceof Element)) return;
        if (tracked.has(node)) untrack(node);
        node.querySelectorAll?.('[data-testid^="conversation-turn-"]').forEach(untrack);
      };
      const turnsInOrder = () => {
        if (!orderDirty) return ordered;
        ordered = [...tracked].filter((turn) => turn.isConnected && turn.matches('[data-testid^="conversation-turn-"]'));
        ordered.sort((a, b) => {
          if (a === b) return 0;
          return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
        });
        tracked.clear();
        ordered.forEach((turn) => tracked.add(turn));
        orderDirty = false;
        return ordered;
      };
      const fold = () => {
        scheduled = false;
        if (root.dataset.csgRecentRuntime === '1') {
          observer.disconnect();
          return;
        }
        const turns = turnsInOrder();
        const starts = [];
        turns.forEach((turn, index) => {
          if (roles.get(turn) === 'user') starts.push(index);
        });
        const boundaryIndex = starts.length > total ? starts[starts.length - total] : -1;
        turns.forEach((turn, index) => {
          const old = boundaryIndex > 0 && index < boundaryIndex;
          if (turn.hasAttribute('data-csg-prehide-old-turn') !== old) {
            turn.toggleAttribute('data-csg-prehide-old-turn', old);
          }
        });
      };
      const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        setTimeout(fold, 0);
      };
      const observer = new MutationObserver((mutations) => {
        let changed = false;
        for (const mutation of mutations) {
          if (mutation.type === 'attributes') {
            const target = mutation.target instanceof Element ? mutation.target : null;
            if (!target) continue;
            const wasTurn = mutation.attributeName === 'data-testid' && String(mutation.oldValue || '').startsWith('conversation-turn-');
            if (wasTurn && !target.matches('[data-testid^="conversation-turn-"]')) {
              untrack(target);
              changed = true;
            } else {
              const turn = target.matches('[data-testid^="conversation-turn-"]') ? target : target.closest('[data-testid^="conversation-turn-"]');
              if (turn) {
                track(turn);
                changed = true;
              }
            }
            if (mutation.attributeName === 'data-csg-recent-runtime') changed = true;
            continue;
          }
          for (const node of mutation.removedNodes) {
            if (!(node instanceof Element)) continue;
            untrackNode(node);
            changed = true;
          }
          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) continue;
            trackNode(node);
            changed = true;
          }
        }
        if (changed) schedule();
      });
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ['data-testid', 'data-turn', 'data-message-author-role', 'data-csg-recent-runtime']
      });
      schedule();
    }

    chrome.storage.local.get({ settings: {} }, ({ settings }) => {
      const loaded = normalizeSettings(settings);
      root.classList.toggle(
        'csg-prehide-tool-summary',
        loaded.enabled && loaded.hideToolSummary
      );
      if (loaded.enabled && loaded.showRecentOnly) {
        ensureRecentLoading(loaded.recentExchanges);
        installRecentFastPrehide(loaded.recentExchanges);
      }
      // Placeholder prehide intentionally remains fail-open. Current ChatGPT
      // `.no-scrollbar` mounts can bootstrap a real App later, so document_start
      // must not hide or observe them before content.js takes over.
    });
  }
})();
