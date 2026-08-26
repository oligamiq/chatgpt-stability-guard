(() => {
  'use strict';

  const TURN_SELECTOR = '[data-testid^="conversation-turn-"]';
  const ROOT = document.documentElement;
  const DEFAULTS = { enabled: true, showRecentOnly: false, recentExchanges: 3 };
  const LOADING_WATCHDOG_MS = 60000;
  const INITIAL_SETTLE_MS = 450;
  function normalizeRecentExchanges(value) {
    const numeric = Number(value);
    const normalized = Number.isFinite(numeric) ? numeric : DEFAULTS.recentExchanges;
    return Math.max(1, Math.min(100, Math.round(normalized)));
  }

  const STOP_GENERATING_SELECTOR = [
    'button[data-testid="stop-button"]',
    'button[data-testid="stop-generating-button"]',
    'button[aria-label="Stop generating" i]',
    'button[aria-label="Stop answering" i]',
    'button[aria-label="Stop response" i]',
    'button[aria-label*="生成を停止"]',
    'button[aria-label*="応答を停止"]'
  ].join(',');

  const state = {
    active: false,
    ready: false,
    n: 3,
    sequence: [],
    roles: new Map(),
    assistantContent: new Map(),
    assistantContentChecked: new Set(),
    assistantContentDirty: new Set(),
    roleEvidence: new Map(),
    roleValidation: new Map(),
    roleLocks: new Map(),
    numeric: new Map(),
    ambiguousLateNumeric: new Set(),
    messageIds: new Map(),
    identityEvidence: new Map(),
    missingEvidence: new Map(),
    boundaryKey: '',
    suspended: false,
    pendingBoundaryKey: '',
    hiddenExchangeCount: 0,
    hiddenTurnCount: 0,
    historyAvailable: false,
    scrollHost: null,
    scheduled: 0,
    contentTimer: 0,
    roleConfirmTimer: 0,
    epoch: 0,
    initializing: false,
    initializingEpoch: -1,
    recovering: false,
    recoveryEpoch: -1,
    route: location.pathname,
    observer: null,
    observerRoot: null,
    mountedTurns: new Set(),
    mountedTurnsOrder: [],
    mountedTurnsDirty: true,
    exchangeOverrides: new Map(),
    lastMergeScrollTop: null,
    lastWindowKeys: [],
    bottomTailEvidence: null,
    pendingTailAnchorKey: '',
    loadingRemoveTimer: 0,
    loadingWatchdogTimer: 0,
    loadingUiFinished: false,
    initialFinalized: false,
    finalizeTimer: 0,
    finalScrollCorrections: 0,
    finalScrollDeferredForGeneration: false,
    finalScrollStartTop: null,
    finalScrollSuppressed: false,
    uiLanguage: 'auto'
  };

  chrome.storage.local.get(
    { settings: DEFAULTS, uiLanguage: 'auto' },
    ({ settings, uiLanguage }) => {
      const merged = { ...DEFAULTS, ...(settings || {}) };
      state.uiLanguage = ['auto', 'ja', 'en'].includes(uiLanguage) ? uiLanguage : 'auto';
      state.active = merged.enabled !== false && merged.showRecentOnly === true;
      state.n = normalizeRecentExchanges(merged.recentExchanges);
      if (!state.active) {
        ROOT.dataset.csgRecentRuntime = '1';
        clearProvisionalFold();
        publishState('off');
        return;
      }
      start();
    }
  );

  function isShareRoute() {
    return location.pathname.startsWith('/share/');
  }

  function isConversationRoute() {
    return /^\/(?:g\/[^/]+\/)?c\//.test(location.pathname) || isShareRoute();
  }

  function isJapaneseUi() {
    const preference = String(state.uiLanguage || 'auto').toLowerCase();
    return preference === 'ja' || (preference === 'auto' && String(navigator.language || '').toLowerCase().startsWith('ja'));
  }

  function loadingCopy(stage, confirmed, target, historyStartKnown) {
    const japanese = isJapaneseUi();
    const bounded = Math.min(confirmed, target);
    const provisional = bounded < target;
    const count = japanese
      ? `${bounded} / ${target} 対話を確認済み${historyStartKnown && target < state.n ? '（全履歴）' : ''}`
      : `${bounded} / ${target} exchanges confirmed${historyStartKnown && target < state.n ? ' (all history)' : ''}`;
    const details = japanese
      ? {
          detecting: '会話DOMを検出しています…',
          latest: '最新の対話の役割を確認しています…',
          history: '直近範囲の開始位置を確認しています…',
          finalizing: '折りたたみ境界をDOMへ反映しています…',
          ready: provisional ? '表示範囲を設定しました。境界は継続確認中です…' : '表示範囲を確認しました',
          waiting: 'ChatGPT の会話DOMを待っています…'
        }
      : {
          detecting: 'Detecting conversation DOM…',
          latest: 'Verifying roles in the latest exchanges…',
          history: 'Verifying the start of the recent range…',
          finalizing: 'Applying the fold boundary to the DOM…',
          ready: provisional ? 'Visible range applied; boundary verification is continuing…' : 'Visible range verified',
          waiting: 'Waiting for ChatGPT conversation DOM…'
        };
    return {
      title: japanese ? '直近の会話を準備中' : 'Preparing recent conversation',
      detail: `${details[stage] || details.detecting} ${count}`
    };
  }

  function historyStartKnown() {
    for (const key of state.sequence) {
      if (state.numeric.get(key) === 0 && state.roles.has(key)) return true;
    }
    return false;
  }

  function loadingEvidence() {
    const startKnown = historyStartKnown();
    if (isShareRoute()) {
      const starts = shareExchangeStarts();
      const target = startKnown && starts.length < state.n ? Math.max(1, starts.length) : state.n;
      const recent = starts.slice(-target);
      const confirmed = recent.filter((entry, index) => entry.confirmed || (startKnown && index === 0 && starts.length <= target)).length;
      return { confirmed: Math.min(target, confirmed), target, startKnown };
    }
    const starts = userKeys();
    const target = startKnown && starts.length < state.n ? Math.max(1, starts.length) : state.n;
    return { confirmed: Math.min(target, starts.length), target, startKnown };
  }

  function ensureLoadingIndicator() {
    if (!state.active || state.loadingUiFinished || !isConversationRoute()) return null;
    clearTimeout(state.loadingRemoveTimer);
    state.loadingRemoveTimer = 0;
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
      ROOT.appendChild(loading);
    }
    loading.dataset.owner = 'recent-window';
    return loading;
  }

  function updateLoadingIndicator(stage = 'detecting') {
    const loading = ensureLoadingIndicator();
    if (!loading) return;
    const evidence = loadingEvidence();
    const copy = loadingCopy(stage, evidence.confirmed, evidence.target, evidence.startKnown);
    loading.dataset.stage = stage;
    loading.dataset.confirmed = String(evidence.confirmed);
    loading.dataset.total = String(state.n);
    loading.dataset.target = String(evidence.target);
    loading.dataset.historyStartKnown = evidence.startKnown ? 'true' : 'false';
    loading.querySelector('.csg-recent-loading-title').textContent = copy.title;
    loading.querySelector('.csg-recent-loading-detail').textContent = copy.detail;
    const progress = loading.querySelector('.csg-recent-loading-progress');
    const slots = Math.min(5, evidence.target);
    if (progress.childElementCount !== slots) {
      progress.replaceChildren(...Array.from({ length: slots }, () => {
        const step = document.createElement('span');
        step.className = 'csg-recent-loading-step';
        return step;
      }));
    }
    const visibleDone = evidence.target <= slots
      ? evidence.confirmed
      : Math.floor((evidence.confirmed / evidence.target) * slots);
    [...progress.children].forEach((step, index) => {
      step.dataset.done = index < visibleDone ? 'true' : 'false';
    });
  }

  function finishLoadingUi() {
    if (state.loadingUiFinished) return;
    updateLoadingIndicator('ready');
    state.loadingUiFinished = true;
    clearLoadingWatchdog();
    removeLoadingIndicator(true);
  }

  function removeLoadingIndicator(complete = false) {
    clearTimeout(state.loadingRemoveTimer);
    state.loadingRemoveTimer = 0;
    const loading = document.getElementById('csg-recent-loading');
    if (!loading) return;
    if (!complete) {
      loading.remove();
      return;
    }
    state.loadingRemoveTimer = setTimeout(() => {
      const live = document.getElementById('csg-recent-loading');
      if (!live) {
        state.loadingRemoveTimer = 0;
        return;
      }
      live.classList.add('csg-recent-loading-complete');
      state.loadingRemoveTimer = setTimeout(() => {
        document.getElementById('csg-recent-loading')?.remove();
        state.loadingRemoveTimer = 0;
      }, 140);
    }, 650);
  }

  function clearLoadingWatchdog() {
    clearTimeout(state.loadingWatchdogTimer);
    state.loadingWatchdogTimer = 0;
  }

  function armLoadingWatchdog() {
    clearLoadingWatchdog();
    if (!state.active || !isConversationRoute()) return;
    const epoch = state.epoch;
    state.loadingWatchdogTimer = setTimeout(() => {
      state.loadingWatchdogTimer = 0;
      if (!isCurrentEpoch(epoch) || !state.active || state.ready || state.suspended) return;
      state.epoch += 1;
      state.initializing = false;
      state.initializingEpoch = -1;
      state.recovering = false;
      state.recoveryEpoch = -1;
      failOpenRecent();
    }, LOADING_WATCHDOG_MS);
  }

  function registerMountedTurn(turn) {
    if (!(turn instanceof Element) || !turn.matches(TURN_SELECTOR)) return false;
    if (state.mountedTurns.has(turn)) return false;
    state.mountedTurns.add(turn);
    state.mountedTurnsDirty = true;
    return true;
  }

  function unregisterMountedTurn(turn) {
    if (!(turn instanceof Element) || !state.mountedTurns.delete(turn)) return false;
    state.mountedTurnsDirty = true;
    return true;
  }

  function registerTurnsInNode(node) {
    if (!(node instanceof Element)) return false;
    let changed = registerMountedTurn(node);
    node.querySelectorAll?.(TURN_SELECTOR).forEach((turn) => { changed = registerMountedTurn(turn) || changed; });
    return changed;
  }

  function unregisterTurnsInNode(node) {
    if (!(node instanceof Element)) return false;
    let changed = unregisterMountedTurn(node);
    node.querySelectorAll?.(TURN_SELECTOR).forEach((turn) => { changed = unregisterMountedTurn(turn) || changed; });
    return changed;
  }

  function seedMountedTurns() {
    state.mountedTurns.clear();
    document.querySelectorAll(TURN_SELECTOR).forEach((turn) => state.mountedTurns.add(turn));
    state.mountedTurnsDirty = true;
  }

  function getTurns() {
    if (!state.mountedTurnsDirty) return state.mountedTurnsOrder;
    const ordered = [...state.mountedTurns].filter((turn) => turn.isConnected && turn.matches(TURN_SELECTOR));
    ordered.sort((a, b) => {
      if (a === b) return 0;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    state.mountedTurns = new Set(ordered);
    state.mountedTurnsOrder = ordered;
    state.mountedTurnsDirty = false;
    return ordered;
  }

  function conversationObserverRoot() {
    const turns = getTurns();
    if (!turns.length) return document.documentElement;
    let root = turns[0].parentElement || document.documentElement;
    const last = turns[turns.length - 1];
    while (root !== document.documentElement && !root.contains(last)) {
      root = root.parentElement || document.documentElement;
    }
    return root;
  }

  function bindObserverRoot() {
    if (!state.observer) return;
    if (!isConversationRoute()) {
      state.observer.disconnect();
      state.observerRoot = null;
      return;
    }
    const next = conversationObserverRoot();
    if (state.observerRoot === next && next?.isConnected) return;
    state.observer.disconnect();
    state.observerRoot = next;
    state.observer.observe(next, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-testid', 'data-turn', 'data-message-author-role', 'data-message-id', 'data-turn-id'],
      attributeOldValue: true
    });
  }

  function turnRole(turn) {
    if (!(turn instanceof Element)) return '';
    const direct = turn.getAttribute('data-message-author-role');
    if (direct === 'user' || direct === 'assistant') return direct;
    const dataTurn = turn.getAttribute('data-turn');
    if (dataTurn === 'user' || dataTurn === 'assistant') return dataTurn;
    const roleNode = turn.querySelector('[data-message-author-role]');
    const nested = roleNode?.getAttribute('data-message-author-role');
    if (nested === 'user' || nested === 'assistant') return nested;
    const nestedTurn = turn.querySelector('[data-turn="user"],[data-turn="assistant"]')?.getAttribute('data-turn');
    return nestedTurn === 'user' || nestedTurn === 'assistant' ? nestedTurn : '';
  }

  function assistantTurnHasRenderableContent(turn) {
    if (!(turn instanceof Element)) return false;
    const semanticNodes = turn.querySelectorAll(
      '.markdown,[data-conversation-screenshot-content],[data-writing-block]'
    );
    for (const node of semanticNodes) {
      if (String(node.textContent || '').replace(/\s+/g, ' ').trim()) return true;
      if (node.matches('img,video,canvas,iframe,svg') || node.querySelector('img,video,canvas,iframe,svg')) return true;
    }
    return false;
  }

  function refreshAssistantContentEvidence(item) {
    if (!isShareRoute() || item.role !== 'assistant') return;
    const known = state.assistantContent.get(item.key) === true;
    const dirty = state.assistantContentDirty.delete(item.key);
    if (known || (state.assistantContentChecked.has(item.key) && !dirty)) return;
    state.assistantContentChecked.add(item.key);
    if (assistantTurnHasRenderableContent(item.turn)) state.assistantContent.set(item.key, true);
  }

  function scheduleRoleConfirmation() {
    if (state.roleConfirmTimer) return;
    state.roleConfirmTimer = setTimeout(() => {
      state.roleConfirmTimer = 0;
      scheduleStructureRefresh();
    }, 120);
  }

  function observeRole(key, role) {
    if (!key || (role !== 'user' && role !== 'assistant')) return;
    const locked = state.roleLocks.get(key);
    if (locked) {
      state.roles.set(key, locked);
      return;
    }
    const now = performance.now();
    const previous = state.roleEvidence.get(key);
    const evidence = previous?.role === role
      ? { role, count: previous.count + 1, firstAt: previous.firstAt, lastAt: now }
      : { role, count: 1, firstAt: now, lastAt: now };
    state.roleEvidence.set(key, evidence);

    const committed = state.roles.get(key);
    if (committed && committed !== role) state.roles.delete(key);
    if (evidence.count >= 2 && evidence.lastAt - evidence.firstAt >= 50) {
      state.roles.set(key, role);
    } else {
      scheduleRoleConfirmation();
    }
  }

  function turnKey(turn) {
    if (!(turn instanceof Element)) return '';
    const testId = turn.getAttribute('data-testid');
    if (testId) return `t:${testId}`;
    const ownMessageId = turn.getAttribute('data-message-id');
    if (ownMessageId) return `m:${ownMessageId}`;
    const messageNode = turn.querySelector('[data-message-id]');
    const nestedMessageId = messageNode?.getAttribute('data-message-id');
    return nestedMessageId ? `m:${nestedMessageId}` : '';
  }

  function turnMessageId(turn) {
    if (!(turn instanceof Element)) return '';
    const own = turn.getAttribute('data-message-id');
    if (own) return own;
    return turn.querySelector('[data-message-id]')?.getAttribute('data-message-id') || '';
  }

  function numericTurnIndex(turn) {
    const value = turn?.getAttribute?.('data-testid') || '';
    const match = /^conversation-turn-(\d+)$/.exec(value);
    return match ? Number(match[1]) : null;
  }

  function currentWindow() {
    return getTurns().map((turn) => ({
      turn,
      key: turnKey(turn),
      role: turnRole(turn),
      index: numericTurnIndex(turn),
      messageId: turnMessageId(turn)
    })).filter((item) => item.key);
  }

  function forgetSequenceKeys(keys) {
    if (!keys?.length) return false;
    const stale = new Set(keys);
    const boundaryRemoved = stale.has(state.boundaryKey);
    if (stale.has(state.pendingBoundaryKey)) state.pendingBoundaryKey = '';
    state.sequence = state.sequence.filter((key) => !stale.has(key));
    for (const key of stale) {
      state.roles.delete(key);
      state.assistantContent.delete(key);
      state.assistantContentChecked.delete(key);
      state.assistantContentDirty.delete(key);
      state.roleEvidence.delete(key);
      state.roleValidation.delete(key);
      state.roleLocks.delete(key);
      state.numeric.delete(key);
      state.ambiguousLateNumeric.delete(key);
      state.messageIds.delete(key);
      state.identityEvidence.delete(key);
      state.missingEvidence.delete(key);
      state.exchangeOverrides.delete(key);
    }
    if (boundaryRemoved) {
      state.ready = false;
      state.boundaryKey = '';
        state.pendingBoundaryKey = '';
      delete ROOT.dataset.csgRecentMode;
      ROOT.classList.remove('csg-show-recent-only');
      publishState('waiting');
    }
    return boundaryRemoved;
  }

  function confirmedMissingKeys(candidates) {
    const now = performance.now();
    const currentTop = state.scrollHost ? scrollTop() : 0;
    const confirmed = [];
    const candidateSet = new Set(candidates);
    const signature = [...candidateSet].sort().join('|');
    for (const key of state.sequence) {
      if (!candidateSet.has(key)) {
        if (findMountedByKey(key)) state.missingEvidence.delete(key);
        continue;
      }
      const previous = state.missingEvidence.get(key);
      const stableViewport = previous &&
        Math.abs(previous.scrollTop - currentTop) <= 2 &&
        previous.signature === signature;
      const evidence = stableViewport
        ? { ...previous, count: previous.count + 1, lastAt: now }
        : { count: 1, firstAt: now, lastAt: now, scrollTop: currentTop, signature };
      state.missingEvidence.set(key, evidence);
      if (evidence.count >= 3 && evidence.lastAt - evidence.firstAt >= 160) confirmed.push(key);
    }
    return confirmed;
  }

  function messageIdentityDiverged(items) {
    if (!state.ready) return false;
    const now = performance.now();
    const positions = new Map(state.sequence.map((key, index) => [key, index]));
    const latestStartKey = exchangeStartKeys().at(-1) || '';
    const latestStartPosition = positions.get(latestStartKey) ?? -1;
    const trustTailIdentity = latestStartPosition >= 0;
    let pending = false;
    for (const item of items) {
      if (!item.key || !item.messageId) continue;
      const known = state.messageIds.get(item.key);
      if (!known || known === item.messageId) {
        state.identityEvidence.delete(item.key);
        continue;
      }
      const itemPosition = positions.get(item.key) ?? -1;
      if (trustTailIdentity && itemPosition >= latestStartPosition) {
        // Regenerate/edit can keep the turn key while replacing the message id.
        // At the physical bottom, changes inside the latest exchange are a new
        // semantic tail, not evidence that the remembered middle branch is stale.
        state.messageIds.set(item.key, item.messageId);
        state.identityEvidence.delete(item.key);
        continue;
      }
      const previous = state.identityEvidence.get(item.key);
      const evidence = previous?.messageId === item.messageId
        ? { ...previous, count: previous.count + 1, lastAt: now }
        : { messageId: item.messageId, count: 1, firstAt: now, lastAt: now };
      state.identityEvidence.set(item.key, evidence);
      if (evidence.count >= 2 && evidence.lastAt - evidence.firstAt >= 50) return true;
      pending = true;
    }
    if (pending) scheduleStructureRefresh();
    return false;
  }

  function reconcileMountedWindow(items) {
    if (!state.sequence.length || items.length < 2) return;
    // Absence inside a virtualized DOM window is not deletion evidence. ChatGPT
    // may keep sparse numeric or opaque turns mounted while measuring/remounting
    // content, so destructive reconciliation must be driven by positive branch
    // evidence (unknown replacement keys / message identity), not missing nodes.
    // Clear stale absence samples for keys that are visible again and otherwise
    // preserve the semantic sequence until a stronger path recovers/replaces it.
    for (const item of items) state.missingEvidence.delete(item.key);
  }

  function mergeWindow(items) {
    if (!items.length) return;
    const knownBeforeMerge = new Set(state.sequence);
    const boundaryNumericBeforeMerge = state.numeric.get(state.boundaryKey);
    for (const item of items) {
      if (state.ready && !knownBeforeMerge.has(item.key) && Number.isInteger(item.index) &&
          !Number.isInteger(boundaryNumericBeforeMerge)) {
        state.ambiguousLateNumeric.add(item.key);
      }
      if (item.role) observeRole(item.key, item.role);
      refreshAssistantContentEvidence(item);
      if (Number.isInteger(item.index)) state.numeric.set(item.key, item.index);
      if (item.messageId && !state.messageIds.has(item.key)) state.messageIds.set(item.key, item.messageId);
    }
    const keys = items.map((item) => item.key);
    reconcileMountedWindow(items);
    const previousWindowKeys = state.lastWindowKeys;
    state.lastWindowKeys = [...keys];
    const currentTop = state.scrollHost ? scrollTop() : null;
    if (!state.sequence.length) {
      state.sequence = [...keys];
      state.lastMergeScrollTop = currentTop;
      return;
    }

    const positions = new Map(state.sequence.map((key, index) => [key, index]));
    const overlaps = keys
      .map((key, currentIndex) => positions.has(key) ? { key, currentIndex, knownIndex: positions.get(key) } : null)
      .filter(Boolean);

    if (overlaps.length) {
      const offset = overlaps[0].knownIndex - overlaps[0].currentIndex;
      if (overlaps.every((item) => item.knownIndex - item.currentIndex === offset)) {
        let conflict = false;
        for (let i = 0; i < keys.length; i += 1) {
          const absolute = offset + i;
          if (absolute >= 0 && absolute < state.sequence.length && state.sequence[absolute] !== keys[i]) {
            conflict = true;
            break;
          }
        }
        if (!conflict) {
          // Rebuild both sides of an aligned window. A virtualizer can widen
          // the mounted range in both directions in one frame, so handling only
          // the prepend side would silently drop a simultaneously appended turn.
          const prefix = offset < 0 ? keys.slice(0, -offset) : [];
          const suffixStart = Math.max(0, state.sequence.length - offset);
          const suffix = keys.slice(suffixStart).filter((key) => !positions.has(key));
          const outside = state.sequence.filter((key) => !prefix.includes(key) && !suffix.includes(key));
          state.sequence = [...prefix, ...outside, ...suffix];
          state.lastMergeScrollTop = currentTop;
          return;
        }
      }
    }

    const allKeys = [...new Set([...state.sequence, ...keys])];
    const numericItems = allKeys
      .map((key) => ({ key, index: state.numeric.get(key) }))
      .filter((item) => Number.isInteger(item.index));
    if (numericItems.length === allKeys.length) {
      numericItems.sort((a, b) => a.index - b.index);
      state.sequence = numericItems.map((item) => item.key);
      state.lastMergeScrollTop = currentTop;
      return;
    }

    // For opaque IDs, first use DOM adjacency inside the current virtualized window.
    // This handles mid-chat edits/replacements even when scrollTop is unchanged.
    const working = [...state.sequence];
    const workingSet = new Set(working);
    let insertedByAdjacency = 0;
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (workingSet.has(key)) continue;
      let previous = '';
      let next = '';
      for (let j = i - 1; j >= 0; j -= 1) {
        if (workingSet.has(keys[j])) { previous = keys[j]; break; }
      }
      for (let j = i + 1; j < keys.length; j += 1) {
        if (workingSet.has(keys[j])) { next = keys[j]; break; }
      }
      const previousIndex = previous ? working.indexOf(previous) : -1;
      const nextIndex = next ? working.indexOf(next) : -1;
      if (previousIndex >= 0 && nextIndex >= 0 && previousIndex < nextIndex) {
        working.splice(nextIndex, 0, key);
        workingSet.add(key);
        insertedByAdjacency += 1;
      } else if (previousIndex >= 0 && nextIndex < 0) {
        working.splice(previousIndex + 1, 0, key);
        workingSet.add(key);
        insertedByAdjacency += 1;
      } else if (nextIndex >= 0 && previousIndex < 0) {
        working.splice(nextIndex, 0, key);
        workingSet.add(key);
        insertedByAdjacency += 1;
      }
    }
    if (insertedByAdjacency) state.sequence = working;

    // With a fully disjoint opaque-ID window, exact adjacency is unknowable.
    // Direction still tells us whether the new window lies before or after the known sequence.
    const knownAfterAdjacency = new Set(state.sequence);
    let unknown = keys.filter((key) => !knownAfterAdjacency.has(key));
    if (unknown.length && state.pendingTailAnchorKey) {
      const anchorSequenceIndex = state.sequence.indexOf(state.pendingTailAnchorKey);
      const anchorDomIndex = keys.indexOf(state.pendingTailAnchorKey);
      let tailUnknown = [];
      if (anchorSequenceIndex >= 0 && anchorDomIndex >= 0) {
        tailUnknown = keys.slice(anchorDomIndex + 1).filter((key) => !knownAfterAdjacency.has(key));
      } else if (anchorSequenceIndex === state.sequence.length - 1 && atBottom(48)) {
        // The regenerated tail can remount after its anchor has itself been
        // virtualized out. At physical bottom, a pending replacement anchor
        // still provides semantic ordering independent of scroll direction.
        tailUnknown = [...unknown];
      }
      if (tailUnknown.length) {
        const tailSet = new Set(tailUnknown);
        const outside = state.sequence.filter((key) => !tailSet.has(key));
        const insertAt = outside.indexOf(state.pendingTailAnchorKey) + 1;
        outside.splice(insertAt, 0, ...tailUnknown);
        state.sequence = outside;
        state.pendingTailAnchorKey = '';
        const consumed = new Set(tailUnknown);
        unknown = unknown.filter((key) => !consumed.has(key));
      }
    }
    if (unknown.length && Number.isFinite(currentTop) && Number.isFinite(state.lastMergeScrollTop)) {
      const scrollDelta = currentTop - state.lastMergeScrollTop;
      if (scrollDelta < -2) {
        state.sequence = [...unknown, ...state.sequence];
      } else if (scrollDelta > 2) {
        state.sequence = [...state.sequence, ...unknown];
      } else if (atBottom(24)) {
        // A new opaque-ID turn can appear while the viewport is stationary at
        // the bottom (typical streaming/new-message case). That window is latest.
        state.sequence = [...state.sequence, ...unknown];
      } else if (previousWindowKeys.length) {
        // React can replace an entire mounted branch at the same scroll offset
        // (for example after a mid-chat edit). If the previous virtualized window
        // occupied one contiguous span, treat the new disjoint window as its
        // replacement instead of silently dropping its opaque keys.
        const previousPositions = previousWindowKeys
          .map((key) => state.sequence.indexOf(key))
          .filter((index) => index >= 0)
          .sort((a, b) => a - b);
        const contiguous = previousPositions.length === previousWindowKeys.length &&
          previousPositions.every((value, index) => index === 0 || value === previousPositions[index - 1] + 1);
        if (contiguous) {
          const start = previousPositions[0];
          const end = previousPositions[previousPositions.length - 1] + 1;
          const before = state.sequence.slice(0, start);
          const after = state.sequence.slice(end);
          const outside = new Set([...before, ...after]);
          const replacement = keys.filter((key) => !outside.has(key));
          const dropped = state.sequence.slice(start, end)
            .filter((key) => !replacement.includes(key));
          // Direct branch replacement must not leave role/message/numeric evidence
          // for keys no longer present in the semantic sequence.
          forgetSequenceKeys(dropped);
          state.sequence = [...before, ...replacement, ...after];
        }
      }
    }
    state.lastMergeScrollTop = currentTop;
  }

  function pruneReplacedBottomTail(items) {
    if (!state.ready || state.initializing || state.recovering || !items.length) return false;
    const rememberedTail = state.sequence.at(-1) || '';
    if (!rememberedTail || !state.lastWindowKeys.includes(rememberedTail)) {
      // A virtualizer can make the current DOM sparse while the user is moving
      // through history. Only interpret a missing opaque suffix as replacement
      // when the immediately preceding mounted window actually contained the
      // remembered semantic tail.
      return false;
    }
    const sequencePositions = new Map(state.sequence.map((key, index) => [key, index]));
    let anchorDomIndex = -1;
    let anchorSequenceIndex = -1;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const position = sequencePositions.get(items[i].key) ?? -1;
      if (position < 0) continue;
      anchorDomIndex = i;
      anchorSequenceIndex = position;
      break;
    }
    if (anchorDomIndex < 0) return false;
    const replacementTail = items.slice(anchorDomIndex + 1);
    const staleTail = state.sequence.slice(anchorSequenceIndex + 1)
      .filter((key) => !replacementTail.some((item) => item.key === key));
    if (!staleTail.length) return false;
    if (!replacementTail.length) {
      // A deletion-only frame is indistinguishable from ordinary virtualization,
      // React suspense, or a transient layout remount. Never destroy remembered
      // semantic tail state until replacement nodes actually exist. A delayed
      // regenerate will be handled on the later frame where new opaque keys appear.
      return false;
    }
    // A surviving known anchor followed by entirely-new opaque keys is strong
    // semantic-tail replacement evidence even if the user is slightly above
    // the physical bottom. Upward virtualization adds history before anchors,
    // not an unknown suffix after the last surviving known anchor.
    if (replacementTail.some((item) =>
      Number.isInteger(item.index) || sequencePositions.has(item.key))) return false;
    state.pendingTailAnchorKey = items[anchorDomIndex].key;
    forgetSequenceKeys(staleTail);
    state.bottomTailEvidence = null;
    return true;
  }

  function midSequenceBranchDiverged(items) {
    if (!state.ready || state.initializing || state.recovering || !items.length || !state.sequence.length) return false;
    const keys = items.map((item) => item.key);
    const sequencePositions = new Map(state.sequence.map((key, index) => [key, index]));
    const positions = keys.map((key) => sequencePositions.get(key) ?? -1);

    // Strong branch signal: a new/unknown opaque turn follows a known anchor that
    // is not the semantic tail. Numeric turn indexes are excluded individually:
    // ChatGPT can mount a numeric historic turn inside a mixed numeric/opaque
    // window, and mergeWindow() can place that turn safely by numeric order.
    for (let i = 0; i < keys.length; i += 1) {
      if (positions[i] >= 0 || Number.isInteger(items[i].index)) continue;
      for (let j = i - 1; j >= 0; j -= 1) {
        if (positions[j] < 0) continue;
        if (positions[j] < state.sequence.length - 1) return true;
        break;
      }
    }

    // React can replace an entire branch window at the same scroll offset, in
    // which case there is no surviving anchor inside the new DOM window. Treat
    // a fully-new window as a branch only when it replaced a previously known
    // window at essentially the same viewport position.
    if (positions.every((position) => position < 0) && state.lastWindowKeys.length &&
        state.lastWindowKeys.some((key) => sequencePositions.has(key)) &&
        Number.isFinite(state.lastMergeScrollTop) &&
        Math.abs(scrollTop() - state.lastMergeScrollTop) <= 64) {
      return true;
    }
    return false;
  }

  function bottomTailDiverged(items) {
    if (!state.ready || state.initializing || state.recovering || !atBottom(48) || !items.length) {
      state.bottomTailEvidence = null;
      return false;
    }
    const keys = items.map((item) => item.key);
    const sequencePositions = new Map(state.sequence.map((key, index) => [key, index]));
    const positions = keys.map((key) => sequencePositions.get(key) ?? -1);
    const known = positions.every((index) => index >= 0);
    // Sparse mounted outliers are harmless when DOM order still follows the
    // remembered sequence and the newest mounted key is the semantic tail.
    const ordered = known && positions.every((index, i) => i === 0 || index > positions[i - 1]);
    const isSuffix = ordered && positions[positions.length - 1] === state.sequence.length - 1;
    if (ordered) {
      // A known ordered subset can simply be a sparse virtualized frame. Missing
      // remembered suffix nodes are not positive evidence of branch regression,
      // even at physical bottom. Tail replacement is handled when new opaque
      // replacement keys actually appear.
      state.bottomTailEvidence = null;
      return false;
    }
    const now = performance.now();
    const signature = keys.join('|');
    const previous = state.bottomTailEvidence;
    const evidence = previous?.signature === signature
      ? { ...previous, count: previous.count + 1, lastAt: now }
      : { signature, count: 1, firstAt: now, lastAt: now };
    state.bottomTailEvidence = evidence;
    const confirmed = evidence.count >= 3 && evidence.lastAt - evidence.firstAt >= 160;
    if (!confirmed) scheduleStructureRefresh();
    return confirmed;
  }

  function userKeys() {
    return state.sequence.filter((key) => state.roles.get(key) === 'user');
  }

  function trustedTailKeys() {
    if (!state.sequence.length) return [];
    if (!isShareRoute()) return [...state.sequence];
    const keys = state.sequence;
    const indexes = keys.map((key) => state.numeric.get(key));
    if (!indexes.every(Number.isInteger)) return [...keys];
    let start = keys.length - 1;
    while (start > 0 && indexes[start - 1] === indexes[start] - 1) start -= 1;
    return keys.slice(start);
  }

  function shareExchangeStarts() {
    const starts = [];
    let current = '';
    let assistantResponded = false;
    for (const key of trustedTailKeys()) {
      const role = state.roles.get(key);
      const meaningfulAssistant = role === 'assistant' && state.assistantContent.get(key) === true;
      if (!current) {
        if (role === 'user') {
          current = key;
          // A user at the start of the trusted suffix may actually be a
          // continuation of an exchange whose earlier user/empty-assistant turns
          // are currently virtualized out. Keep searching before trusting it as
          // the recent-N boundary.
          starts.push({ key, confirmed: false });
        } else if (meaningfulAssistant) {
          // Share pages can omit the user-side DOM section for an older exchange
          // while retaining its final assistant section. That rendered response is
          // safe to use as a synthetic exchange boundary.
          current = key;
          starts.push({ key, confirmed: true });
          assistantResponded = true;
        }
        continue;
      }
      if (role === 'user') {
        if (assistantResponded) {
          current = key;
          starts.push({ key, confirmed: true });
          assistantResponded = false;
        }
      } else if (meaningfulAssistant) {
        assistantResponded = true;
      }
    }
    return starts;
  }

  function exchangeStartKeys() {
    if (!isShareRoute()) return userKeys();
    return shareExchangeStarts().map((entry) => entry.key);
  }

  function computeBoundary() {
    if (isShareRoute()) {
      const starts = shareExchangeStarts();
      state.hiddenExchangeCount = Math.max(0, starts.length - state.n);
      if (!starts.length) return '';
      if (starts.length < state.n) return historyStartKnown() ? starts[0].key : '';
      const boundary = starts[starts.length - state.n];
      return boundary?.key || '';
    }
    const starts = userKeys();
    state.hiddenExchangeCount = Math.max(0, starts.length - state.n);
    if (!starts.length) return '';
    if (starts.length < state.n) return historyStartKnown() ? starts[0] : '';
    return starts[starts.length - state.n];
  }

  function buildSequenceContext() {
    const positions = new Map(state.sequence.map((key, index) => [key, index]));
    const startPositions = exchangeStartKeys()
      .map((key) => ({ key, position: positions.get(key) ?? -1 }))
      .filter((item) => item.position >= 0);
    return {
      positions,
      startPositions,
      boundaryPosition: positions.get(state.boundaryKey) ?? -1
    };
  }

  function keyPosition(key, context = null) {
    if (context?.positions) return context.positions.get(key) ?? -1;
    return state.sequence.indexOf(key);
  }

  function isOldKey(key, context = null) {
    if (!state.boundaryKey || !key) return false;
    const boundaryPosition = context?.boundaryPosition ?? keyPosition(state.boundaryKey, context);
    const position = keyPosition(key, context);
    if (boundaryPosition >= 0 && position >= 0) return position < boundaryPosition;

    const boundaryNumeric = state.numeric.get(state.boundaryKey);
    const numeric = state.numeric.get(key);
    if (Number.isInteger(boundaryNumeric) && Number.isInteger(numeric)) return numeric < boundaryNumeric;
    return false;
  }

  function exchangeStartForKey(key, context = null) {
    const activeContext = context || buildSequenceContext();
    const position = keyPosition(key, activeContext);
    if (position < 0) return '';
    const boundaryPosition = activeContext.boundaryPosition;
    let start = boundaryPosition >= 0 && position >= boundaryPosition ? state.boundaryKey : '';
    for (const candidate of activeContext.startPositions) {
      if (candidate.position > position) break;
      if (boundaryPosition >= 0 && position >= boundaryPosition && candidate.position < boundaryPosition) continue;
      start = candidate.key;
    }
    if (!start && isOldKey(key, activeContext)) return key;
    return start;
  }

  function exchangeExpanded(startKey, context = null) {
    if (!startKey) return true;
    if (state.exchangeOverrides.has(startKey)) return state.exchangeOverrides.get(startKey) === true;
    return !isOldKey(startKey, context);
  }

  function updateExchangeToggle(button, startKey, context = null) {
    if (!(button instanceof HTMLButtonElement)) return;
    const expanded = exchangeExpanded(startKey, context);
    const glyph = expanded ? '^' : '>';
    const expandedText = String(expanded);
    const label = expanded ? 'Collapse this chat' : 'Expand this chat';
    if (button.textContent !== glyph) button.textContent = glyph;
    if (button.dataset.expanded !== expandedText) button.dataset.expanded = expandedText;
    if (button.getAttribute('aria-expanded') !== expandedText) button.setAttribute('aria-expanded', expandedText);
    if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
  }

  function ensureExchangeToggle(turn, startKey, context = null) {
    if (!(turn instanceof Element) || !startKey) return null;
    let button = turn.querySelector(':scope > .csg-chat-toggle');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'csg-chat-toggle';
      button.dataset.exchangeKey = startKey;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const key = button.dataset.exchangeKey || '';
        state.exchangeOverrides.set(key, !exchangeExpanded(key));
        markMountedTurns();
      });
      turn.prepend(button);
    }
    button.dataset.exchangeKey = startKey;
    updateExchangeToggle(button, startKey, context);
    return button;
  }

  function applyProvisionalFold() {
    if (!state.active || state.initialFinalized || state.suspended) return;
    ROOT.classList.add('csg-prehide-recent-fast');
    const items = currentWindow();
    const starts = [];
    items.forEach((item, index) => {
      if (item.role === 'user') starts.push(index);
    });
    const boundaryIndex = starts.length > state.n ? starts[starts.length - state.n] : -1;
    items.forEach((item, index) => {
      item.turn.toggleAttribute('data-csg-prehide-old-turn', boundaryIndex > 0 && index < boundaryIndex);
    });
  }

  function clearProvisionalFold() {
    const released = [];
    document.querySelectorAll('[data-csg-prehide-old-turn]').forEach((turn) => {
      turn.removeAttribute('data-csg-prehide-old-turn');
      if (!turn.hasAttribute('data-csg-recent-old')) released.push(turn);
    });
    ROOT.classList.remove('csg-prehide-recent-fast');
    released.forEach((turn) => notifyTurnAnalysisVisibility(turn, false));
  }

  function notifyTurnAnalysisVisibility(turn, suppressed) {
    if (!(turn instanceof Element)) return;
    turn.dispatchEvent(new CustomEvent('csg:recent-turn-visibility', {
      bubbles: true,
      detail: { suppressed: Boolean(suppressed) }
    }));
  }

  function setTurnAnalysisSuppressed(turn, suppressed) {
    if (!(turn instanceof Element)) return;
    const next = Boolean(suppressed);
    const previous = turn.hasAttribute('data-csg-recent-old');
    if (previous === next) return;
    turn.toggleAttribute('data-csg-recent-old', next);
    notifyTurnAnalysisVisibility(turn, next);
  }

  function markTurnElement(turn, context) {
    if (!(turn instanceof Element)) return false;
    const key = turnKey(turn);
    const startKey = exchangeStartForKey(key, context);
    if (!startKey || state.ambiguousLateNumeric.has(key)) {
      setTurnAnalysisSuppressed(turn, false);
      turn.classList.remove('csg-hidden-old-turn', 'csg-chat-collapsed');
      turn.querySelector(':scope > .csg-chat-toggle')?.remove();
      return false;
    }
    const expanded = exchangeExpanded(startKey, context);
    if (key === startKey) {
      ensureExchangeToggle(turn, startKey, context);
      setTurnAnalysisSuppressed(turn, !expanded);
      turn.classList.remove('csg-hidden-old-turn');
      turn.classList.toggle('csg-chat-collapsed', !expanded);
      return !expanded;
    }
    setTurnAnalysisSuppressed(turn, !expanded);
    turn.classList.remove('csg-chat-collapsed');
    turn.querySelector(':scope > .csg-chat-toggle')?.remove();
    turn.classList.toggle('csg-hidden-old-turn', !expanded);
    return !expanded;
  }

  function markMountedTurns() {
    const context = buildSequenceContext();
    let hidden = 0;
    for (const item of currentWindow()) if (markTurnElement(item.turn, context)) hidden += 1;
    state.hiddenTurnCount = hidden;
    state.historyAvailable = state.hiddenExchangeCount > 0 || keyPosition(state.boundaryKey, context) > 0;
    publishCounts();
    updateAccordion(context);
  }

  function syncAccordionModeClasses() {
    if (!state.active || !state.ready || state.suspended) return;
    ROOT.dataset.csgRecentMode = 'per-chat';
    ROOT.classList.remove('csg-show-recent-only', 'csg-recent-accordion-expanded');
  }

  function updateAccordion(context = null) {
    if (!state.active) return;
    document.getElementById('csg-recent-accordion')?.remove();
    document.getElementById('csg-recent-scrollbar')?.remove();
    syncAccordionModeClasses();
    document.querySelectorAll('.csg-chat-toggle').forEach((button) => updateExchangeToggle(button, button.dataset.exchangeKey || '', context));
  }

  function scrollTop() {
    const host = state.scrollHost;
    if (!host) return 0;
    if (host === document.scrollingElement) return window.scrollY || host.scrollTop || 0;
    return host.scrollTop;
  }

  function visualViewportRect() {
    const viewport = window.visualViewport;
    if (!viewport) {
      return { top: 0, right: window.innerWidth, bottom: window.innerHeight, height: window.innerHeight };
    }
    const top = Math.max(0, viewport.offsetTop || 0);
    const right = Math.min(window.innerWidth, (viewport.offsetLeft || 0) + viewport.width);
    const height = Math.max(1, viewport.height);
    return { top, right, bottom: top + height, height };
  }

  function viewportHeight() {
    const host = state.scrollHost;
    return host === document.scrollingElement ? visualViewportRect().height : (host?.clientHeight || visualViewportRect().height);
  }

  function scrollHeight() {
    return state.scrollHost?.scrollHeight || document.documentElement.scrollHeight || 0;
  }

  function scheduleFinalScrollCorrection() {
    if (!state.active || !state.ready || state.suspended || state.finalScrollCorrections > 0 || state.finalScrollSuppressed) return;
    if (document.querySelector(STOP_GENERATING_SELECTOR) && !state.finalScrollDeferredForGeneration) {
      const turns = getTurns();
      if (turns.length) {
        state.scrollHost = findScrollHost(turns[turns.length - 1]);
        attachScrollHost();
      }
      state.finalScrollDeferredForGeneration = true;
      state.finalScrollStartTop = state.scrollHost ? scrollTop() : null;
    }
    clearTimeout(state.finalizeTimer);
    const epoch = state.epoch;
    state.finalizeTimer = setTimeout(() => {
      state.finalizeTimer = 0;
      if (!isCurrentEpoch(epoch) || !state.ready || state.suspended || state.finalScrollCorrections > 0 || state.finalScrollSuppressed) return;
      if (document.querySelector(STOP_GENERATING_SELECTOR)) {
        scheduleFinalScrollCorrection();
        return;
      }
      const turns = getTurns();
      if (!turns.length) return;
      state.scrollHost = findScrollHost(turns[turns.length - 1]);
      attachScrollHost();
      const host = state.scrollHost;
      if (!host) return;
      const deferredTop = state.finalScrollStartTop;
      const userMovedDuringGeneration = state.finalScrollDeferredForGeneration &&
        Number.isFinite(deferredTop) && Math.abs(scrollTop() - deferredTop) > 2 && !atBottom(48);
      state.finalScrollDeferredForGeneration = false;
      state.finalScrollStartTop = null;
      if (userMovedDuringGeneration) {
        // Do not yank a user back to the tail after a long generation if they
        // deliberately moved into history while the correction was deferred.
        state.finalScrollSuppressed = true;
        return;
      }
      host.scrollTop = host.scrollHeight;
      state.finalScrollCorrections += 1;
      ROOT.dataset.csgRecentFinalScrollCorrections = String(state.finalScrollCorrections);
    }, INITIAL_SETTLE_MS);
  }

  function findScrollHost(turn) {
    if (!(turn instanceof Element)) return document.scrollingElement;
    const candidates = [];
    for (let node = turn.parentElement; node && node !== document.body; node = node.parentElement) {
      if (node.clientHeight <= 0) continue;
      const style = getComputedStyle(node);
      const className = String(node.className || '');
      const knownRoot = className.includes('csg-recent-scrollhost') || className.includes('group/scroll-root');
      const minimumCandidateHeight = Math.min(200, Math.max(48, window.innerHeight * 0.2));
      if (node.clientHeight < minimumCandidateHeight && !knownRoot) continue;
      const ratio = node.scrollHeight / Math.max(1, node.clientHeight);
      const nativeScrollable = /(auto|scroll|overlay)/.test(style.overflowY);
      const programmaticHidden = style.overflowY === 'hidden';
      const trusted = knownRoot || node.scrollTop > 0 || nativeScrollable || programmaticHidden;
      // ChatGPT can expose the real scroll root before its virtualizer has
      // populated enough height to make it physically scrollable. Keep trusted
      // overflow/known-root candidates even while scrollHeight ~= clientHeight.
      if (node.scrollHeight <= node.clientHeight + 2 && !trusted) continue;
      let score = 0;
      if (className.includes('csg-recent-scrollhost')) score += 200;
      if (className.includes('group/scroll-root')) score += 120;
      if (node.scrollTop > 0) score += 45;
      if (nativeScrollable) score += 30;
      // ChatGPT can keep the real programmatic scroll root at overflow:hidden.
      if (programmaticHidden) score += 12;
      if (ratio > 1.25) score += 25;
      else if (ratio < 1.08) score -= 20;
      if (node.clientHeight >= window.innerHeight * 0.55) score += 15;
      if (node.tagName === 'MAIN' && style.overflowY === 'visible') score -= 20;
      candidates.push({ node, score, ratio, trusted });
    }
    candidates.sort((a, b) => b.score - a.score || b.ratio - a.ratio);
    const best = candidates.find((candidate) => candidate.trusted) || null;
    const host = best?.node || document.scrollingElement;
    return host;
  }

  function findMountedByKey(key) {
    if (!key) return null;
    for (const item of currentWindow()) if (item.key === key) return item.turn;
    return null;
  }

  function adoptBoundary(key, _allowBackward = false) {
    if (!key || keyPosition(key) < 0) return false;
    state.boundaryKey = key;
    state.pendingBoundaryKey = '';
    updateMinimum();
    return true;
  }

  function updateMinimum() {
    if (!state.ready) return;
    syncAccordionModeClasses();
    updateAccordion();
  }

  function atBottom(tolerance = 8) {
    const host = state.scrollHost;
    if (!host) return false;
    if (host === document.scrollingElement && scrollHeight() <= viewportHeight() + 2) {
      // ChatGPT normally scrolls an inner virtualized root. If root discovery
      // fell back to an unscrollable document, a zero gap is not trustworthy
      // physical-bottom evidence for destructive tail reconciliation.
      return false;
    }
    return scrollHeight() - (scrollTop() + viewportHeight()) <= tolerance;
  }

  async function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function mergeStableWindow(epoch, pauseMs = 60) {
    if (epoch !== null && !isCurrentEpoch(epoch)) return false;
    mergeWindow(currentWindow());
    await wait(pauseMs);
    if (epoch !== null && !isCurrentEpoch(epoch)) return false;
    mergeWindow(currentWindow());
    return true;
  }

  function isCurrentEpoch(epoch) {
    return state.active && !state.suspended && state.epoch === epoch && state.route === location.pathname;
  }

  function failOpenRecent() {
    clearTimeout(state.finalizeTimer);
    state.finalizeTimer = 0;
    state.ready = false;
    state.recovering = false;
    state.suspended = true;
    state.exchangeOverrides.clear();
    clearMountedMarks();
    delete ROOT.dataset.csgRecentMode;
    ROOT.classList.remove('csg-show-recent-only', 'csg-recent-accordion-expanded');
    detachScrollHost();
    publishState('degraded');
  }

  function recoverRecentAfterDivergence() {
    if (!state.active || !isConversationRoute()) {
      failOpenRecent();
      return;
    }
    // Branch edits and tail replacements are expected user operations. Reveal
    // everything immediately, forget the old semantic sequence, then learn the
    // current branch again instead of disabling Recent-N for the whole session.
    resetForRoute({ preserveLoadingUi: true, provisional: false });
    const epoch = state.epoch;
    state.recovering = true;
    state.recoveryEpoch = epoch;
    setTimeout(() => {
      if (!state.active || state.epoch !== epoch || state.route !== location.pathname) return;
      state.recovering = false;
      state.recoveryEpoch = -1;
      discoverBoundary();
    }, 120);
  }

  async function discoverBoundary() {
    if (state.recovering || state.initializing) return;
    const epoch = state.epoch;
    state.initializing = true;
    state.initializingEpoch = epoch;
    publishState('preparing');
    updateLoadingIndicator('detecting');
    try {
      let turns = getTurns();
      if (!turns.length) {
        for (let i = 0; i < 30 && !turns.length; i += 1) {
          await wait(100);
          if (!isCurrentEpoch(epoch)) return;
          turns = getTurns();
        }
      }
      if (!turns.length) {
        publishState('waiting');
        return;
      }

      updateLoadingIndicator('latest');
      applyProvisionalFold();

      // Learn only what ChatGPT has already mounted. Recent-N must never scroll
      // the host just to discover older history; native/user scrolling will
      // progressively extend state.sequence later through refreshStructure().
      for (let pass = 0; pass < 3; pass += 1) {
        mergeWindow(currentWindow());
        applyProvisionalFold();
        if (pass < 2) await wait(70);
        if (!isCurrentEpoch(epoch)) return;
      }

      // The visible loading UI tracks processing of the DOM ChatGPT has mounted,
      // not proof that the N-exchange boundary exists in that virtualized window.
      // Older boundary evidence may arrive only after later native/user scrolling.
      // Finish the gauge now and keep boundary discovery running invisibly.
      finishLoadingUi();

      const starts = exchangeStartKeys();
      if (!starts.length) {
        publishState('preparing');
        updateLoadingIndicator('latest');
        const retryEpoch = epoch;
        setTimeout(() => {
          if (isCurrentEpoch(retryEpoch) && !state.suspended && !state.initializing && !state.recovering) discoverBoundary();
        }, 150);
        return;
      }

      state.boundaryKey = computeBoundary();
      if (!state.boundaryKey) {
        publishState('preparing');
        updateLoadingIndicator('history');
        const retryEpoch = epoch;
        setTimeout(() => {
          if (isCurrentEpoch(retryEpoch) && !state.suspended && !state.initializing && !state.recovering) discoverBoundary();
        }, 150);
        return;
      }

      updateLoadingIndicator('finalizing');
      const boundaryTurn = findMountedByKey(state.boundaryKey);
      if (!(boundaryTurn instanceof Element) || !validateBoundaryKey(state.boundaryKey)) {
        state.boundaryKey = '';
        publishState('preparing');
        updateLoadingIndicator('history');
        const retryEpoch = epoch;
        setTimeout(() => {
          if (isCurrentEpoch(retryEpoch) && !state.suspended && !state.initializing && !state.recovering) discoverBoundary();
        }, 150);
        return;
      }

      state.ready = true;
      state.initialFinalized = true;
      ROOT.classList.remove('csg-show-recent-only', 'csg-recent-accordion-expanded');
      markMountedTurns();
      clearProvisionalFold();
      updateAccordion();
      updateMinimum();
      if (!isCurrentEpoch(epoch) || !state.ready || state.suspended) return;
      publishState('ready');
      scheduleFinalScrollCorrection();
    } catch (_error) {
      if (isCurrentEpoch(epoch)) failOpenRecent();
    } finally {
      if (state.initializingEpoch === epoch) {
        state.initializing = false;
        state.initializingEpoch = -1;
      }
    }
  }

  function boundaryMovesForward(candidate) {
    if (!candidate || candidate === state.boundaryKey) return false;
    if (!state.boundaryKey) return true;
    const currentPosition = keyPosition(state.boundaryKey);
    const candidatePosition = keyPosition(candidate);
    if (currentPosition >= 0 && candidatePosition >= 0) return candidatePosition > currentPosition;
    const currentNumeric = state.numeric.get(state.boundaryKey);
    const candidateNumeric = state.numeric.get(candidate);
    return Number.isInteger(currentNumeric) && Number.isInteger(candidateNumeric) && candidateNumeric > currentNumeric;
  }

  function boundaryMovesBackward(candidate) {
    if (!candidate || !state.boundaryKey || candidate === state.boundaryKey) return false;
    const currentPosition = keyPosition(state.boundaryKey);
    const candidatePosition = keyPosition(candidate);
    if (currentPosition >= 0 && candidatePosition >= 0) return candidatePosition < currentPosition;
    const currentNumeric = state.numeric.get(state.boundaryKey);
    const candidateNumeric = state.numeric.get(candidate);
    return Number.isInteger(currentNumeric) && Number.isInteger(candidateNumeric) && candidateNumeric < currentNumeric;
  }

  function confirmedShareBoundary() {
    if (!isShareRoute()) return '';
    const starts = shareExchangeStarts();
    if (starts.length < state.n) return '';
    const boundary = starts[Math.max(0, starts.length - state.n)];
    return boundary?.confirmed ? boundary.key : '';
  }

  function isStableUserKey(key) {
    if (state.roleLocks.get(key) === 'user') return true;
    const evidence = state.roleEvidence.get(key);
    return state.roles.get(key) === 'user' && evidence?.role === 'user' && evidence.count >= 2;
  }

  function isStableBoundaryKey(key) {
    if (!isShareRoute()) return isStableUserKey(key);
    const locked = state.roleLocks.get(key);
    if (locked === 'user') return true;
    if (locked === 'assistant' && state.assistantContent.get(key) === true) return true;
    const evidence = state.roleEvidence.get(key);
    if (state.roles.get(key) === 'user' && evidence?.role === 'user' && evidence.count >= 2) return true;
    return state.roles.get(key) === 'assistant' && evidence?.role === 'assistant' &&
      evidence.count >= 2 && state.assistantContent.get(key) === true;
  }

  function validateBoundaryKey(key) {
    const turn = findMountedByKey(key);
    if (!(turn instanceof Element)) return false;
    const actualRole = turnRole(turn);
    if (!isShareRoute()) {
      const stableUser = actualRole === 'user' && isStableUserKey(key);
      if (stableUser) {
        state.roleLocks.set(key, 'user');
        state.roleValidation.delete(key);
        return true;
      }
      if (actualRole === 'assistant') {
        const previous = state.roleValidation.get(key);
        const count = previous?.role === 'assistant' ? previous.count + 1 : 1;
        state.roleValidation.set(key, { role: 'assistant', count });
        if (count >= 2) state.roleLocks.set(key, 'assistant');
        state.roles.delete(key);
        state.roleEvidence.delete(key);
      }
      return false;
    }
    if (actualRole === 'user' && isStableBoundaryKey(key)) {
      state.roleLocks.set(key, 'user');
      state.roleValidation.delete(key);
      return true;
    }
    if (actualRole === 'assistant' && state.assistantContent.get(key) === true) {
      state.assistantContent.set(key, true);
      state.roles.set(key, 'assistant');
      state.roleLocks.set(key, 'assistant');
      state.roleValidation.delete(key);
      return true;
    }
    return false;
  }

  function tryAdvanceBoundary(candidate) {
    if (!boundaryMovesForward(candidate)) return false;
    const mounted = findMountedByKey(candidate);
    if (!mounted) {
      state.pendingBoundaryKey = candidate;
      return false;
    }
    if (!validateBoundaryKey(candidate)) {
      if (state.pendingBoundaryKey === candidate) state.pendingBoundaryKey = '';
      return false;
    }
    if (adoptBoundary(candidate, true)) return true;
    state.pendingBoundaryKey = candidate;
    return false;
  }


  function tryExpandPrivateBoundary(candidate) {
    if (isShareRoute() || !boundaryMovesBackward(candidate)) return false;
    const mounted = findMountedByKey(candidate);
    if (!mounted || !validateBoundaryKey(candidate)) return false;
    return adoptBoundary(candidate, true);
  }

  function tryExpandShareBoundary(candidate) {
    if (!isShareRoute() || !boundaryMovesBackward(candidate)) return false;
    // A backward move can only reveal content, but require the share parser to
    // prove this older key is a real exchange start before changing the window.
    if (confirmedShareBoundary() !== candidate) return false;
    const mounted = findMountedByKey(candidate);
    if (!mounted) return false;
    if (!validateBoundaryKey(candidate)) return false;
    return adoptBoundary(candidate, true);
  }

  function refreshStructure() {
    if (!state.active) return;
    if (location.pathname !== state.route) {
      state.route = location.pathname;
      resetForRoute();
      if (isConversationRoute()) discoverBoundary();
      return;
    }

    if (!isConversationRoute() || state.suspended) return;
    const mountedWindow = currentWindow();
    if (state.ready && messageIdentityDiverged(mountedWindow)) {
      recoverRecentAfterDivergence();
      return;
    }
    if (state.ready) pruneReplacedBottomTail(mountedWindow);
    if (state.ready && midSequenceBranchDiverged(mountedWindow)) {
      recoverRecentAfterDivergence();
      return;
    }
    mergeWindow(mountedWindow);
    if (state.ready && state.scrollHost && bottomTailDiverged(mountedWindow)) {
      recoverRecentAfterDivergence();
      return;
    }
    if (!state.ready) {
      applyProvisionalFold();
      if (!state.recovering && !state.initializing) discoverBoundary();
      return;
    }

    if (state.pendingBoundaryKey) tryAdvanceBoundary(state.pendingBoundaryKey);
    const candidate = computeBoundary();
    if (candidate && candidate !== state.boundaryKey) {
      if (!tryAdvanceBoundary(candidate) && !tryExpandPrivateBoundary(candidate)) tryExpandShareBoundary(candidate);
    }
    markMountedTurns();
    updateMinimum();
  }

  function scheduleStructureRefresh() {
    if (state.scheduled) return;
    state.scheduled = setTimeout(() => {
      state.scheduled = 0;
      refreshStructure();
    }, 90);
  }

  function scheduleContentRefresh() {
    if (state.contentTimer) return;
    state.contentTimer = setTimeout(() => {
      state.contentTimer = 0;
      if (!state.ready) return;
      updateMinimum();
    }, 300);
  }

  function mutationContainsRoleEvidence(mutation) {
    if (mutation.target instanceof Element && mutation.target.closest('.markdown')) return false;
    const selector = '[data-message-author-role],[data-turn="user"],[data-turn="assistant"]';
    for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
      if (!(node instanceof Element)) continue;
      if (node.matches(selector) || (node.firstElementChild && node.querySelector?.(selector))) return true;
    }
    return false;
  }

  function attachObserver() {
    state.observer = new MutationObserver((mutations) => {
      let structureChanged = false;
      let recentContentChanged = false;
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const target = mutation.target instanceof Element ? mutation.target : null;
          const wasTurnTestId = mutation.attributeName === 'data-testid' &&
            String(mutation.oldValue || '').startsWith('conversation-turn-');
          if (wasTurnTestId || target?.matches(TURN_SELECTOR) || target?.closest(TURN_SELECTOR)) {
            structureChanged = true;
            if (wasTurnTestId && target && !target.matches(TURN_SELECTOR)) {
              unregisterMountedTurn(target);
              target.classList.remove('csg-hidden-old-turn', 'csg-chat-collapsed');
              target.querySelector(':scope > .csg-chat-toggle')?.remove();
            } else if (target?.matches(TURN_SELECTOR)) {
              registerMountedTurn(target);
            }
          }
          continue;
        }
        if (mutation.type !== 'childList') continue;
        const targetTurn = mutation.target instanceof Element ? mutation.target.closest(TURN_SELECTOR) : null;
        if (targetTurn) {
          const key = turnKey(targetTurn);
          if (mutationContainsRoleEvidence(mutation)) structureChanged = true;
          const foldedOld = targetTurn.classList.contains('csg-hidden-old-turn') ||
            targetTurn.classList.contains('csg-chat-collapsed');
          if (!key || !foldedOld) recentContentChanged = true;
          if ([...mutation.removedNodes].some((node) =>
            node instanceof Element && node.classList.contains('csg-chat-toggle'))) {
            structureChanged = true;
          }
          if (isShareRoute() && key && turnRole(targetTurn) === 'assistant' &&
              state.assistantContent.get(key) !== true) {
            state.assistantContentDirty.add(key);
            structureChanged = true;
          }
        }
        if (!targetTurn) {
          for (const node of mutation.removedNodes) {
            if (!(node instanceof Element)) continue;
            if (unregisterTurnsInNode(node)) structureChanged = true;
          }
          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) continue;
            const addedTurn = node.matches(TURN_SELECTOR);
            const addedAny = registerTurnsInNode(node);
            if (addedTurn && state.ready) markTurnElement(node);
            if (addedAny) structureChanged = true;
          }
        }
      }
      if (structureChanged) {
        bindObserverRoot();
        if (!state.initialFinalized) applyProvisionalFold();
        scheduleStructureRefresh();
        if (state.ready && state.finalScrollCorrections === 0) scheduleFinalScrollCorrection();
      }
      if (recentContentChanged) {
        scheduleContentRefresh();
        if (state.ready && state.finalScrollCorrections === 0) scheduleFinalScrollCorrection();
      }
    });
    bindObserverRoot();
  }

  function attachScrollHost() {
    if (!state.scrollHost) return;
    state.scrollHost.dataset.csgRecentBound = '1';
  }

  function detachScrollHost() {
    const host = state.scrollHost;
    if (!host) return;
    delete host.dataset.csgRecentBound;
    state.scrollHost = null;
  }

  function onResize() {
    if (state.ready) updateMinimum();
  }

  function publishCounts() {
    ROOT.dataset.csgRecentHiddenTurns = String(state.hiddenTurnCount);
    ROOT.dataset.csgRecentHiddenExchanges = String(state.hiddenExchangeCount);
  }

  function publishState(value) {
    ROOT.dataset.csgRecentState = value;
    publishCounts();
    if (!state.active || value === 'off' || value === 'degraded') {
      clearLoadingWatchdog();
      removeLoadingIndicator(false);
    } else if (value === 'ready') {
      clearLoadingWatchdog();
      updateLoadingIndicator('ready');
      removeLoadingIndicator(true);
    } else if (value === 'waiting') {
      // Once the visual loader has completed, semantic boundary rediscovery must
      // not cancel its in-flight fade/removal and strand the finished DOM node.
      if (!state.loadingUiFinished) {
        clearTimeout(state.loadingRemoveTimer);
        state.loadingRemoveTimer = 0;
        updateLoadingIndicator('waiting');
      }
    } else if (value === 'preparing') {
      updateLoadingIndicator('detecting');
    }
  }

  function clearMountedMarks() {
    for (const turn of getTurns()) {
      setTurnAnalysisSuppressed(turn, false);
      turn.classList.remove('csg-hidden-old-turn', 'csg-chat-collapsed');
      turn.querySelector(':scope > .csg-chat-toggle')?.remove();
    }
    clearProvisionalFold();
  }

  function resetForRoute({ preserveLoadingUi = false, provisional = true } = {}) {
    const keepLoadingUiFinished = preserveLoadingUi && state.loadingUiFinished;
    state.epoch += 1;
    clearTimeout(state.scheduled);
    clearTimeout(state.contentTimer);
    clearTimeout(state.roleConfirmTimer);
    clearTimeout(state.loadingRemoveTimer);
    clearTimeout(state.finalizeTimer);
    state.loadingRemoveTimer = 0;
    state.finalizeTimer = 0;
    clearLoadingWatchdog();
    removeLoadingIndicator(false);
    state.scheduled = 0;
    state.contentTimer = 0;
    state.roleConfirmTimer = 0;
    state.initializing = false;
    state.initializingEpoch = -1;
    state.recovering = false;
    state.recoveryEpoch = -1;
    state.suspended = false;
    clearMountedMarks();
    detachScrollHost();
    state.ready = false;
    state.loadingUiFinished = keepLoadingUiFinished;
    state.initialFinalized = false;
    state.finalScrollCorrections = 0;
    state.finalScrollDeferredForGeneration = false;
    state.finalScrollStartTop = null;
    state.finalScrollSuppressed = false;
    delete ROOT.dataset.csgRecentFinalScrollCorrections;
    seedMountedTurns();
    bindObserverRoot();
    state.sequence = [];
    state.roles.clear();
    state.assistantContent.clear();
    state.assistantContentChecked.clear();
    state.assistantContentDirty.clear();
    state.roleEvidence.clear();
    state.roleValidation.clear();
    state.roleLocks.clear();
    state.numeric.clear();
    state.ambiguousLateNumeric.clear();
    state.messageIds.clear();
    state.identityEvidence.clear();
    state.missingEvidence.clear();
    state.exchangeOverrides.clear();
    state.boundaryKey = '';
    state.pendingBoundaryKey = '';
    state.hiddenExchangeCount = 0;
    state.hiddenTurnCount = 0;
    state.historyAvailable = false;
    state.lastMergeScrollTop = null;
    state.lastWindowKeys = [];
    state.bottomTailEvidence = null;
    state.pendingTailAnchorKey = '';
    delete ROOT.dataset.csgRecentMode;
    ROOT.classList.remove('csg-show-recent-only', 'csg-recent-accordion-expanded');
    if (isConversationRoute()) {
      if (provisional) {
        ROOT.classList.add('csg-prehide-recent-fast');
        applyProvisionalFold();
      } else {
        ROOT.classList.remove('csg-prehide-recent-fast');
      }
      publishState('preparing');
      armLoadingWatchdog();
    } else {
      ROOT.classList.remove('csg-prehide-recent-fast');
      state.observer?.disconnect();
      state.observerRoot = null;
      publishState('outside');
    }
  }

  function onRouteSignal() {
    if (!state.active) return;
    queueMicrotask(() => {
      if (state.active && location.pathname !== state.route) refreshStructure();
    });
  }

  function start() {
    ROOT.dataset.csgRecentRuntime = '1';
    attachObserver();
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('popstate', onRouteSignal, true);
    window.navigation?.addEventListener?.('currententrychange', onRouteSignal);
    setInterval(() => {
      if (!state.active) return;
      if (location.pathname !== state.route) scheduleStructureRefresh();
      else if (isConversationRoute()) {
        if (!state.observerRoot?.isConnected) {
          seedMountedTurns();
          bindObserverRoot();
          scheduleStructureRefresh();
        }
        if (state.ready) updateMinimum();
      }
    }, 750);
    if (isConversationRoute()) {
      seedMountedTurns();
      bindObserverRoot();
      ROOT.classList.add('csg-prehide-recent-fast');
      applyProvisionalFold();
      publishState('preparing');
      armLoadingWatchdog();
      discoverBoundary();
    } else {
      publishState('outside');
    }
  }
})();
