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

    function normalizeRecentExchanges(value) {
      const numeric = Number(value);
      return Math.max(1, Math.min(100, Math.round(Number.isFinite(numeric) ? numeric : 3)));
    }

    function normalizeSettings(raw = {}) {
      const legacy = raw.hideToolChrome;
      return {
        enabled: raw.enabled !== false,
        hideToolSummary: raw.hideToolSummary ?? legacy ?? true,
        showRecentOnly: raw.showRecentOnly === true,
        recentExchanges: normalizeRecentExchanges(raw.recentExchanges)
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

      const turnSelector = '[data-testid^="conversation-turn-"]';
      const roleSelector = '[data-message-author-role],[data-turn="user"],[data-turn="assistant"]';
      const track = (turn) => {
        if (!(turn instanceof Element) || !turn.matches(turnSelector)) return false;
        const added = !tracked.has(turn);
        if (added) {
          tracked.add(turn);
          orderDirty = true;
        }
        const previousRole = roles.get(turn) || '';
        const nextRole = fastTurnRole(turn);
        roles.set(turn, nextRole);
        return added || previousRole !== nextRole;
      };
      const untrack = (turn) => {
        if (!(turn instanceof Element) || !tracked.delete(turn)) return false;
        turn.removeAttribute('data-csg-prehide-old-turn');
        orderDirty = true;
        return true;
      };
      const trackNode = (node) => {
        if (!(node instanceof Element)) return false;
        if (node.matches(turnSelector)) return track(node);
        let changed = false;
        node.querySelectorAll?.(turnSelector).forEach((turn) => { changed = track(turn) || changed; });
        return changed;
      };
      const untrackNode = (node) => {
        if (!(node instanceof Element)) return false;
        if (tracked.has(node)) return untrack(node);
        let changed = false;
        node.querySelectorAll?.(turnSelector).forEach((turn) => { changed = untrack(turn) || changed; });
        return changed;
      };
      const nodeContainsRoleEvidence = (node) => node instanceof Element &&
        (node.matches(roleSelector) || (node.firstElementChild && node.querySelector(roleSelector)));
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
            if (wasTurn && !target.matches(turnSelector)) {
              changed = untrack(target) || changed;
            } else {
              const turn = target.matches(turnSelector) ? target : target.closest(turnSelector);
              if (turn) changed = track(turn) || changed;
            }
            if (mutation.attributeName === 'data-csg-recent-runtime') changed = true;
            continue;
          }
          const targetTurn = mutation.target instanceof Element
            ? (mutation.target.matches(turnSelector) ? mutation.target : mutation.target.closest(turnSelector))
            : null;
          if (targetTurn) {
            // Markdown streaming cannot introduce author-role evidence. Avoid a
            // deep role-selector scan on every remounted token/wrapper subtree.
            const insideMarkdown = mutation.target instanceof Element && Boolean(mutation.target.closest('.markdown'));
            const roleChanged = !insideMarkdown && [...mutation.addedNodes, ...mutation.removedNodes]
              .some(nodeContainsRoleEvidence);
            if (roleChanged) changed = track(targetTurn) || changed;
            continue;
          }
          for (const node of mutation.removedNodes) changed = untrackNode(node) || changed;
          for (const node of mutation.addedNodes) changed = trackNode(node) || changed;
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
