(() => {
  'use strict';

  const TURN_SELECTOR = '[data-testid^="conversation-turn-"]';
  const ROOT = document.documentElement;
  const DEFAULTS = { enabled: true, showRecentOnly: false, recentExchanges: 3 };

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
    messageIds: new Map(),
    identityEvidence: new Map(),
    keyTops: new Map(),
    missingEvidence: new Map(),
    boundaryKey: '',
    boundaryProvisional: false,
    boundaryGraceTimer: 0,
    suspended: false,
    resizeScrollHeightGuard: null,
    pendingBoundaryKey: '',
    hiddenExchangeCount: 0,
    hiddenTurnCount: 0,
    scrollHost: null,
    recentContentHeight: 0,
    minScrollTop: 0,
    scheduled: 0,
    contentTimer: 0,
    roleConfirmTimer: 0,
    coordinateTimer: 0,
    coordinateGeneration: 0,
    epoch: 0,
    initializing: false,
    initializingEpoch: -1,
    recovering: false,
    recoveryEpoch: -1,
    route: location.pathname,
    observer: null,
    scrollbar: null,
    thumb: null,
    drag: null,
    lastMergeScrollTop: null,
    lastWindowKeys: [],
    bottomTailEvidence: null
  };

  chrome.storage.local.get(
    { privacyConsent: false, privacyConsentVersion: 0, settings: DEFAULTS },
    ({ privacyConsent, privacyConsentVersion, settings }) => {
      if (privacyConsent !== true || privacyConsentVersion !== 1) return;
      const merged = { ...DEFAULTS, ...(settings || {}) };
      state.active = merged.enabled !== false && merged.showRecentOnly === true;
      state.n = Math.max(1, Math.min(100, Number(merged.recentExchanges) || 3));
      if (!state.active) {
        publishState('off');
        return;
      }
      start();
    }
  );

  function isShareRoute() {
    return location.pathname.startsWith('/share/');
  }

  function getTurns() {
    return [...document.querySelectorAll(TURN_SELECTOR)];
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
      state.messageIds.delete(key);
      state.identityEvidence.delete(key);
      state.keyTops.delete(key);
      state.missingEvidence.delete(key);
    }
    if (boundaryRemoved) {
      state.ready = false;
      state.boundaryKey = '';
      state.boundaryProvisional = false;
      state.pendingBoundaryKey = '';
      ROOT.classList.remove('csg-show-recent-only');
      if (state.scrollbar) state.scrollbar.hidden = true;
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
    let pending = false;
    for (const item of items) {
      if (!item.key || !item.messageId) continue;
      const known = state.messageIds.get(item.key);
      if (!known || known === item.messageId) {
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
    const keys = items.map((item) => item.key);
    const numericItems = items.filter((item) => Number.isInteger(item.index));
    if (numericItems.length === items.length) {
      // ChatGPT can keep sparse, old numeric turns mounted outside the active
      // virtualized window (notably image turns on /share/). A numeric gap in
      // querySelectorAll() therefore does not prove that remembered turns inside
      // that [min, max] span were deleted by a branch edit. Numeric keys can be
      // merged back into semantic order when they reappear, so do not prune them.
      for (const item of numericItems) state.missingEvidence.delete(item.key);
      return;
    }

    // Opaque IDs: when the mounted window has at least two known anchors, the
    // DOM between those anchors is authoritative for this branch. Replace only
    // that bounded segment so orphaned edit/branch keys cannot live forever.
    const anchored = keys
      .map((key, domIndex) => ({ key, domIndex, seqIndex: state.sequence.indexOf(key) }))
      .filter((item) => item.seqIndex >= 0 && !Number.isInteger(state.numeric.get(item.key)));
    if (anchored.length < 2) return;
    const first = anchored[0];
    const last = anchored[anchored.length - 1];
    if (first.seqIndex >= last.seqIndex || first.domIndex >= last.domIndex) return;
    const original = [...state.sequence];
    const replacement = keys.slice(first.domIndex, last.domIndex + 1);
    const stale = original
      .slice(first.seqIndex, last.seqIndex + 1)
      .filter((key) => !replacement.includes(key));
    const before = original.slice(0, first.seqIndex);
    const after = original.slice(last.seqIndex + 1).filter((key) => !replacement.includes(key));
    for (const key of replacement) state.missingEvidence.delete(key);
    const confirmedStale = confirmedMissingKeys(stale);
    if (!confirmedStale.length && stale.length) return;
    forgetSequenceKeys(confirmedStale);
    const confirmedSet = new Set(confirmedStale);
    state.sequence = [
      ...before,
      ...replacement,
      ...after
    ].filter((key, index, list) => !confirmedSet.has(key) && list.indexOf(key) === index);
  }

  function mergeWindow(items) {
    if (!items.length) return;
    for (const item of items) {
      if (item.role) observeRole(item.key, item.role);
      refreshAssistantContentEvidence(item);
      if (Number.isInteger(item.index)) state.numeric.set(item.key, item.index);
      if (item.messageId && !state.messageIds.has(item.key)) state.messageIds.set(item.key, item.messageId);
      if (state.scrollHost) {
        const top = topInScrollContent(item.turn);
        if (Number.isFinite(top)) state.keyTops.set(item.key, top);
      }
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
          // Rebuild from the aligned window to correctly handle multiple prepends.
          if (offset < 0) {
            const prefix = keys.slice(0, -offset);
            state.sequence = [...prefix, ...state.sequence.filter((key) => !prefix.includes(key))];
          } else {
            const suffixStart = Math.max(0, state.sequence.length - offset);
            const suffix = keys.slice(suffixStart).filter((key) => !positions.has(key));
            state.sequence = [...state.sequence, ...suffix];
          }
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
    let insertedByAdjacency = 0;
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (working.includes(key)) continue;
      let previous = '';
      let next = '';
      for (let j = i - 1; j >= 0; j -= 1) {
        if (working.includes(keys[j])) { previous = keys[j]; break; }
      }
      for (let j = i + 1; j < keys.length; j += 1) {
        if (working.includes(keys[j])) { next = keys[j]; break; }
      }
      const previousIndex = previous ? working.indexOf(previous) : -1;
      const nextIndex = next ? working.indexOf(next) : -1;
      if (previousIndex >= 0 && nextIndex >= 0 && previousIndex < nextIndex) {
        working.splice(nextIndex, 0, key);
        insertedByAdjacency += 1;
      } else if (previousIndex >= 0 && nextIndex < 0) {
        working.splice(previousIndex + 1, 0, key);
        insertedByAdjacency += 1;
      } else if (nextIndex >= 0 && previousIndex < 0) {
        working.splice(nextIndex, 0, key);
        insertedByAdjacency += 1;
      }
    }
    if (insertedByAdjacency) state.sequence = working;

    // With a fully disjoint opaque-ID window, exact adjacency is unknowable.
    // Direction still tells us whether the new window lies before or after the known sequence.
    const knownAfterAdjacency = new Set(state.sequence);
    const unknown = keys.filter((key) => !knownAfterAdjacency.has(key));
    if (unknown.length && Number.isFinite(currentTop) && Number.isFinite(state.lastMergeScrollTop)) {
      if (currentTop < state.lastMergeScrollTop) {
        state.sequence = [...unknown, ...state.sequence];
      } else if (currentTop > state.lastMergeScrollTop) {
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
          const outside = new Set([...state.sequence.slice(0, start), ...state.sequence.slice(end)]);
          const replacement = keys.filter((key) => !outside.has(key));
          state.sequence = [...state.sequence.slice(0, start), ...replacement, ...state.sequence.slice(end)];
        }
      }
    }
    state.lastMergeScrollTop = currentTop;
  }

  function midSequenceBranchDiverged(items) {
    if (!state.ready || state.initializing || state.recovering || !items.length || !state.sequence.length) return false;
    const keys = items.map((item) => item.key);
    const positions = keys.map((key) => state.sequence.indexOf(key));

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
        state.lastWindowKeys.some((key) => state.sequence.includes(key)) &&
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
    const positions = keys.map((key) => state.sequence.indexOf(key));
    const known = positions.every((index) => index >= 0);
    // Sparse mounted outliers are harmless when DOM order still follows the
    // remembered sequence and the newest mounted key is the semantic tail.
    const ordered = known && positions.every((index, i) => i === 0 || index > positions[i - 1]);
    const isSuffix = ordered && positions[positions.length - 1] === state.sequence.length - 1;
    if (isSuffix) {
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
    return evidence.count >= 3 && evidence.lastAt - evidence.firstAt >= 160;
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
    const starts = exchangeStartKeys();
    if (!starts.length) return '';
    const index = Math.max(0, starts.length - state.n);
    state.hiddenExchangeCount = Math.max(0, starts.length - state.n);
    return starts[index];
  }

  function boundaryDiscoveryComplete() {
    if (!isShareRoute()) {
      const starts = exchangeStartKeys();
      return starts.length >= state.n && Boolean(computeBoundary());
    }
    const starts = shareExchangeStarts();
    if (starts.length < state.n) return false;
    const boundary = starts[Math.max(0, starts.length - state.n)];
    return Boolean(boundary?.key && boundary.confirmed);
  }

  function keyPosition(key) {
    return state.sequence.indexOf(key);
  }

  function isOldKey(key) {
    if (!state.boundaryKey || !key) return false;
    const boundaryPosition = keyPosition(state.boundaryKey);
    const position = keyPosition(key);
    if (boundaryPosition >= 0 && position >= 0) return position < boundaryPosition;

    const boundaryNumeric = state.numeric.get(state.boundaryKey);
    const numeric = state.numeric.get(key);
    if (Number.isInteger(boundaryNumeric) && Number.isInteger(numeric)) return numeric < boundaryNumeric;
    return false;
  }

  function markTurnElement(turn) {
    if (!(turn instanceof Element)) return false;
    const key = turnKey(turn);
    const boundaryPosition = keyPosition(state.boundaryKey);
    const position = keyPosition(key);
    const boundaryNumeric = state.numeric.get(state.boundaryKey);
    const numeric = state.numeric.get(key);
    const semanticKnown = boundaryPosition >= 0 && position >= 0;
    const numericKnown = Number.isInteger(boundaryNumeric) && Number.isInteger(numeric);
    // Semantic ordering is authoritative. An unknown mounted/reused turn is
    // not proven old, so keep it visible until refreshStructure() classifies it.
    let old = false;
    if (semanticKnown) old = position < boundaryPosition;
    else if (numericKnown) old = numeric < boundaryNumeric;
    turn.classList.toggle('csg-hidden-old-turn', old);
    return old;
  }

  function markMountedTurns() {
    let hidden = 0;
    for (const item of currentWindow()) {
      if (markTurnElement(item.turn)) hidden += 1;
    }
    state.hiddenTurnCount = hidden;
    publishCounts();
  }

  function scrollTop() {
    const host = state.scrollHost;
    if (!host) return 0;
    if (host === document.scrollingElement) return window.scrollY || host.scrollTop || 0;
    return host.scrollTop;
  }

  function setScrollTop(value) {
    const host = state.scrollHost;
    if (!host) return;
    const top = Math.max(0, Number(value) || 0);
    if (host === document.scrollingElement) window.scrollTo(0, top);
    else host.scrollTop = top;
  }

  function viewportHeight() {
    const host = state.scrollHost;
    return host === document.scrollingElement ? window.innerHeight : (host?.clientHeight || window.innerHeight);
  }

  function maxScrollTop() {
    return Math.max(0, scrollHeight() - viewportHeight());
  }

  function boundaryCoordinateInvalid() {
    if (!state.ready || state.minScrollTop <= maxScrollTop() + 2) {
      state.resizeScrollHeightGuard = null;
      return false;
    }
    if (Number.isFinite(state.resizeScrollHeightGuard)) {
      const currentHeight = scrollHeight();
      if (Math.abs(currentHeight - state.resizeScrollHeightGuard) <= 2) return false;
      state.resizeScrollHeightGuard = null;
    }
    return true;
  }

  function clampRecentTop(value) {
    const max = maxScrollTop();
    if (state.minScrollTop > max) return max;
    return Math.max(state.minScrollTop, Math.min(max, Number(value) || 0));
  }

  function scrollHeight() {
    return state.scrollHost?.scrollHeight || document.documentElement.scrollHeight || 0;
  }

  function findScrollHost(turn) {
    if (!(turn instanceof Element)) return document.scrollingElement;
    const candidates = [];
    for (let node = turn.parentElement; node && node !== document.body; node = node.parentElement) {
      if (node.clientHeight <= 200 || node.scrollHeight <= node.clientHeight + 2) continue;
      const style = getComputedStyle(node);
      const className = String(node.className || '');
      const ratio = node.scrollHeight / Math.max(1, node.clientHeight);
      let score = 0;
      if (className.includes('csg-recent-scrollhost')) score += 200;
      if (className.includes('group/scroll-root')) score += 120;
      if (node.scrollTop > 0) score += 45;
      if (/(auto|scroll|overlay)/.test(style.overflowY)) score += 30;
      // ChatGPT can keep the real programmatic scroll root at overflow:hidden.
      if (style.overflowY === 'hidden') score += 12;
      if (ratio > 1.25) score += 25;
      else if (ratio < 1.08) score -= 20;
      if (node.clientHeight >= window.innerHeight * 0.55) score += 15;
      if (node.tagName === 'MAIN' && style.overflowY === 'visible') score -= 20;
      candidates.push({ node, score, ratio });
    }
    candidates.sort((a, b) => b.score - a.score || b.ratio - a.ratio);
    return candidates[0]?.node || document.scrollingElement;
  }

  function topInScrollContent(element) {
    const host = state.scrollHost;
    if (!host || !(element instanceof Element)) return null;
    const rect = element.getBoundingClientRect();
    if (host === document.scrollingElement) return rect.top + scrollTop();
    const hostRect = host.getBoundingClientRect();
    return rect.top - hostRect.top + scrollTop();
  }

  function findMountedByKey(key) {
    if (!key) return null;
    for (const item of currentWindow()) if (item.key === key) return item.turn;
    return null;
  }

  function adoptBoundary(key, allowBackward = false) {
    const boundaryTurn = findMountedByKey(key);
    const mountedTop = boundaryTurn instanceof Element ? topInScrollContent(boundaryTurn) : null;
    const cachedTop = state.keyTops.get(key);
    const boundaryTop = Number.isFinite(mountedTop) ? mountedTop : cachedTop;
    if (!Number.isFinite(boundaryTop)) return false;
    if (!allowBackward && state.ready && boundaryTop < state.minScrollTop - 1) return false;
    state.boundaryKey = key;
    state.boundaryProvisional = !(boundaryTurn instanceof Element);
    state.pendingBoundaryKey = '';
    state.minScrollTop = Math.max(0, boundaryTop);
    updateMinimum();
    scheduleCoordinateStabilization();
    return true;
  }

  function clearBoundaryGrace() {
    clearTimeout(state.boundaryGraceTimer);
    state.boundaryGraceTimer = 0;
  }

  function scheduleBoundaryGrace() {
    if (state.boundaryGraceTimer || !state.ready || !state.boundaryProvisional) return;
    const epoch = state.epoch;
    state.boundaryGraceTimer = setTimeout(() => {
      state.boundaryGraceTimer = 0;
      if (!isCurrentEpoch(epoch) || !state.ready || !state.boundaryProvisional) return;
      const boundaryTurn = findMountedByKey(state.boundaryKey);
      if (boundaryTurn) {
        syncBoundaryCoordinate();
        updateMinimum();
        return;
      }
      if (scrollTop() <= state.minScrollTop + 2) failOpenRecent();
    }, 160);
  }

  function syncBoundaryCoordinate() {
    if (!state.ready || !state.boundaryKey) return false;
    const boundaryTurn = findMountedByKey(state.boundaryKey);
    if (!(boundaryTurn instanceof Element)) {
      state.boundaryProvisional = true;
      return false;
    }
    const boundaryTop = topInScrollContent(boundaryTurn);
    if (!Number.isFinite(boundaryTop)) return false;
    state.minScrollTop = Math.max(0, boundaryTop);
    state.boundaryProvisional = false;
    clearBoundaryGrace();
    state.keyTops.set(state.boundaryKey, state.minScrollTop);
    return true;
  }

  function updateMinimum() {
    if (!state.ready) return;
    // ChatGPT's virtualizer can revise its total-height estimate without changing
    // the mounted turn structure. If the semantic boundary is currently mounted,
    // always refresh its physical coordinate before clamping or laying out the bar.
    syncBoundaryCoordinate();
    if (boundaryCoordinateInvalid()) {
      failOpenRecent();
      return;
    }
    state.recentContentHeight = Math.max(viewportHeight(), scrollHeight() - state.minScrollTop);
    const current = scrollTop();
    if (state.boundaryProvisional && !findMountedByKey(state.boundaryKey)) {
      if (current < state.minScrollTop - 2) {
        failOpenRecent();
        return;
      }
      if (current <= state.minScrollTop + 2) {
        scheduleBoundaryGrace();
        layoutScrollbar();
        return;
      }
    }
    if (current < state.minScrollTop - 1) setScrollTop(state.minScrollTop);
    layoutScrollbar();
  }

  function scheduleCoordinateStabilization() {
    state.coordinateGeneration += 1;
    const generation = state.coordinateGeneration;
    const epoch = state.epoch;
    clearTimeout(state.coordinateTimer);
    clearBoundaryGrace();
    state.coordinateTimer = 0;
    let remaining = 12;
    const tick = () => {
      state.coordinateTimer = 0;
      if (generation !== state.coordinateGeneration || !state.ready || !isCurrentEpoch(epoch)) return;
      updateMinimum();
      remaining -= 1;
      if (remaining > 0) state.coordinateTimer = setTimeout(tick, 250);
    };
    state.coordinateTimer = setTimeout(tick, 100);
  }

  function atBottom(tolerance = 8) {
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

  async function settleAtBottom(epoch = null) {
    for (let i = 0; i < 4; i += 1) {
      if (epoch !== null && !isCurrentEpoch(epoch)) return false;
      setScrollTop(scrollHeight());
      await wait(80 + i * 30);
      if (epoch !== null && !isCurrentEpoch(epoch)) return false;
      mergeWindow(currentWindow());
    }
    return true;
  }

  function captureViewportAnchor() {
    const top = scrollTop();
    for (const item of currentWindow()) {
      const itemTop = topInScrollContent(item.turn);
      const height = item.turn.getBoundingClientRect().height;
      if (Number.isFinite(itemTop) && itemTop + height > top + 1) {
        return { key: item.key, offset: itemTop - top };
      }
    }
    return null;
  }

  async function restoreInitialPosition(initialTop, initialWasBottom, initialAnchor, epoch = null) {
    if (initialWasBottom) {
      setScrollTop(maxScrollTop());
      return;
    }
    if (initialTop < state.minScrollTop || (initialAnchor?.key && isOldKey(initialAnchor.key))) {
      setScrollTop(state.minScrollTop);
      return;
    }
    setScrollTop(clampRecentTop(initialTop));
    if (!initialAnchor?.key) return;
    await wait(100);
    if (epoch !== null && !isCurrentEpoch(epoch)) return;
    mergeWindow(currentWindow());
    const anchorTurn = findMountedByKey(initialAnchor.key);
    if (!anchorTurn || isOldKey(initialAnchor.key)) return;
    const anchorTop = topInScrollContent(anchorTurn);
    if (Number.isFinite(anchorTop)) setScrollTop(clampRecentTop(anchorTop - initialAnchor.offset));
  }

  function failOpenRecent() {
    state.coordinateGeneration += 1;
    clearTimeout(state.coordinateTimer);
    state.coordinateTimer = 0;
    state.ready = false;
    state.recovering = false;
    state.suspended = true;
    state.boundaryProvisional = false;
    clearMountedMarks();
    ROOT.classList.remove('csg-show-recent-only');
    if (state.scrollbar) state.scrollbar.hidden = true;
    detachScrollHost();
    publishState('degraded');
  }

  async function discoverBoundary() {
    if (state.recovering || state.initializing) return;
    const epoch = state.epoch;
    state.initializing = true;
    state.initializingEpoch = epoch;
    publishState('preparing');
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

      state.scrollHost = findScrollHost(turns[turns.length - 1]);
      attachScrollHost();
      const initialTop = scrollTop();
      const initialWasBottom = atBottom(24);
      const initialAnchor = captureViewportAnchor();
      if (!(await settleAtBottom(epoch))) return;

      let reachedTop = false;
      let steps = 0;
      while (!boundaryDiscoveryComplete() && steps < 240) {
        const before = scrollTop();
        const next = Math.max(0, before - Math.max(260, viewportHeight() * 0.68));
        setScrollTop(next);
        await wait(75);
        if (!(await mergeStableWindow(epoch))) return;
        steps += 1;
        if (scrollTop() <= 1 || Math.abs(scrollTop() - before) < 1) {
          reachedTop = true;
          break;
        }
      }

      const boundary = computeBoundary();
      if (!boundary) {
        await settleAtBottom(epoch);
        if (!isCurrentEpoch(epoch)) return;
        // A SPA route can briefly expose an incomplete turn tree. Keep the page
        // fail-open while stable role data is still arriving instead of flashing
        // an unavailable state that will immediately retry.
        publishState('waiting');
        return;
      }
      // If fewer than N user turns exist, reaching the physical top proves that
      // the whole conversation is already within the requested recent window.
      if (!boundaryDiscoveryComplete() && !reachedTop) {
        await settleAtBottom(epoch);
        if (!isCurrentEpoch(epoch)) return;
        publishState('waiting');
        return;
      }

      state.boundaryKey = boundary;
      let boundaryTurn = findMountedByKey(state.boundaryKey);
      if (!boundaryTurn) {
        for (let i = 0; i < 160 && !boundaryTurn; i += 1) {
          const before = scrollTop();
          const next = Math.max(0, before - Math.max(260, viewportHeight() * 0.68));
          setScrollTop(next);
          await wait(75);
          if (!(await mergeStableWindow(epoch))) return;
          boundaryTurn = findMountedByKey(state.boundaryKey);
          if (next <= 1 && !boundaryTurn) break;
        }
      }
      if (!boundaryTurn) {
        await settleAtBottom(epoch);
        if (!isCurrentEpoch(epoch)) return;
        publishState('waiting');
        return;
      }

      const boundaryRole = turnRole(boundaryTurn);
      let boundaryAssistant = false;
      if (!isShareRoute()) {
        if (boundaryRole !== 'user') {
          if (boundaryRole === 'assistant') {
            const previous = state.roleValidation.get(state.boundaryKey);
            const count = previous?.role === 'assistant' ? previous.count + 1 : 1;
            state.roleValidation.set(state.boundaryKey, { role: 'assistant', count });
            if (count >= 2) state.roleLocks.set(state.boundaryKey, 'assistant');
          }
          state.roles.delete(state.boundaryKey);
          state.roleEvidence.delete(state.boundaryKey);
          state.boundaryKey = '';
          state.hiddenExchangeCount = Math.max(0, userKeys().length - state.n);
          await settleAtBottom(epoch);
          if (!isCurrentEpoch(epoch)) return;
          publishState('waiting');
          const retryEpoch = epoch;
          setTimeout(() => {
            if (isCurrentEpoch(retryEpoch) && !state.suspended && !state.initializing && !state.recovering) discoverBoundary();
          }, 0);
          return;
        }
      } else {
        boundaryAssistant = boundaryRole === 'assistant' &&
          state.assistantContent.get(state.boundaryKey) === true;
        if (boundaryRole !== 'user' && !boundaryAssistant) {
          state.roles.delete(state.boundaryKey);
          state.assistantContent.delete(state.boundaryKey);
          state.roleEvidence.delete(state.boundaryKey);
          state.boundaryKey = '';
          state.hiddenExchangeCount = Math.max(0, exchangeStartKeys().length - state.n);
          await settleAtBottom(epoch);
          if (!isCurrentEpoch(epoch)) return;
          publishState('waiting');
          const retryEpoch = epoch;
          setTimeout(() => {
            if (isCurrentEpoch(retryEpoch) && !state.suspended && !state.initializing && !state.recovering) discoverBoundary();
          }, 0);
          return;
        }
      }

      state.roleLocks.set(state.boundaryKey, boundaryAssistant ? 'assistant' : 'user');
      state.roles.set(state.boundaryKey, boundaryAssistant ? 'assistant' : 'user');
      if (boundaryAssistant) state.assistantContent.set(state.boundaryKey, true);
      const boundaryTop = topInScrollContent(boundaryTurn);
      if (!Number.isFinite(boundaryTop)) {
        await settleAtBottom(epoch);
        if (!isCurrentEpoch(epoch)) return;
        publishState('waiting');
        return;
      }
      state.minScrollTop = Math.max(0, boundaryTop);
      state.boundaryProvisional = false;
      state.keyTops.set(state.boundaryKey, state.minScrollTop);
      state.ready = true;
      state.recentContentHeight = Math.max(viewportHeight(), scrollHeight() - state.minScrollTop);
      ROOT.classList.add('csg-show-recent-only');
      state.scrollHost?.classList?.add('csg-recent-scrollhost');
      markMountedTurns();
      await restoreInitialPosition(initialTop, initialWasBottom, initialAnchor, epoch);
      if (!isCurrentEpoch(epoch)) return;
      updateMinimum();
      scheduleCoordinateStabilization();
      publishState('ready');
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
      if (isStableBoundaryKey(candidate) && Number.isFinite(state.keyTops.get(candidate)) && adoptBoundary(candidate, true)) {
        return true;
      }
      state.pendingBoundaryKey = candidate;
      return false;
    }
    if (!validateBoundaryKey(candidate)) {
      if (state.pendingBoundaryKey === candidate) state.pendingBoundaryKey = '';
      return false;
    }
    // The candidate is already proven to be semantically newer. ChatGPT may
    // concurrently shrink virtualizer spacer estimates, so its new physical top
    // can legitimately be smaller than the stale previous minScrollTop.
    if (adoptBoundary(candidate, true)) return true;
    state.pendingBoundaryKey = candidate;
    return false;
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
      discoverBoundary();
      return;
    }

    if (state.suspended) return;
    const mountedWindow = currentWindow();
    if (state.ready && messageIdentityDiverged(mountedWindow)) {
      failOpenRecent();
      return;
    }
    if (state.ready && midSequenceBranchDiverged(mountedWindow)) {
      failOpenRecent();
      return;
    }
    mergeWindow(mountedWindow);
    if (state.ready && bottomTailDiverged(mountedWindow)) {
      failOpenRecent();
      return;
    }
    if (!state.ready) {
      if (!state.recovering && !state.initializing) discoverBoundary();
      return;
    }

    if (state.pendingBoundaryKey) tryAdvanceBoundary(state.pendingBoundaryKey);
    const candidate = computeBoundary();
    if (candidate && candidate !== state.boundaryKey) {
      if (!tryAdvanceBoundary(candidate)) tryExpandShareBoundary(candidate);
    }
    markMountedTurns();
    // Hiding old turns can change virtualizer geometry. Re-read the mounted
    // semantic boundary after that DOM change before clamping the scroll range.
    syncBoundaryCoordinate();
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
              target.classList.remove('csg-hidden-old-turn');
            }
          }
          continue;
        }
        if (mutation.type !== 'childList') continue;
        const targetTurn = mutation.target instanceof Element ? mutation.target.closest(TURN_SELECTOR) : null;
        if (targetTurn) {
          const key = turnKey(targetTurn);
          if (!key || !isOldKey(key)) recentContentChanged = true;
          if (isShareRoute() && key && turnRole(targetTurn) === 'assistant' &&
              state.assistantContent.get(key) !== true) {
            state.assistantContentDirty.add(key);
            structureChanged = true;
          }
        }
        for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
          if (!(node instanceof Element)) continue;
          if (node.matches(TURN_SELECTOR)) {
            if (state.ready) markTurnElement(node);
            structureChanged = true;
          } else if (!targetTurn && node.querySelector?.(TURN_SELECTOR)) {
            // React may insert a wrapper containing one or more turns. Ignore
            // unrelated page/UI mutations, but trigger one coalesced structure
            // refresh when the inserted wrapper actually contains a turn.
            structureChanged = true;
          }
        }
      }
      if (structureChanged) scheduleStructureRefresh();
      if (recentContentChanged) scheduleContentRefresh();
    });
    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-testid', 'data-turn', 'data-message-author-role', 'data-message-id', 'data-turn-id'],
      attributeOldValue: true
    });
  }

  function attachScrollHost() {
    if (!state.scrollHost || state.scrollHost.dataset.csgRecentBound === '1') return;
    state.scrollHost.dataset.csgRecentBound = '1';
    if (state.scrollHost === document.scrollingElement) {
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('wheel', onWheel, { passive: false });
    } else {
      state.scrollHost.addEventListener('scroll', onScroll, { passive: true });
      state.scrollHost.addEventListener('wheel', onWheel, { passive: false });
    }
    ensureScrollbar();
  }

  function detachScrollHost() {
    const host = state.scrollHost;
    if (!host) return;
    if (host === document.scrollingElement) {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('wheel', onWheel);
    } else {
      host.removeEventListener('scroll', onScroll);
      host.removeEventListener('wheel', onWheel);
    }
    delete host.dataset.csgRecentBound;
    host.classList?.remove('csg-recent-scrollhost');
    state.scrollHost = null;
  }

  function onResize() {
    if (!state.ready) return;
    state.resizeScrollHeightGuard = scrollHeight();
    syncBoundaryCoordinate();
    layoutScrollbar();
  }

  function onScroll() {
    if (!state.ready) return;
    // Virtualizer height corrections can move the mounted semantic boundary while
    // simultaneously adjusting scrollTop. Re-anchor before enforcing the range.
    syncBoundaryCoordinate();
    if (state.boundaryProvisional && !findMountedByKey(state.boundaryKey)) {
      const current = scrollTop();
      if (current < state.minScrollTop - 2) {
        failOpenRecent();
        return;
      }
      if (current <= state.minScrollTop + 2) {
        scheduleBoundaryGrace();
        layoutScrollbar();
        return;
      }
    }
    if (boundaryCoordinateInvalid()) {
      failOpenRecent();
      return;
    }
    if (scrollTop() < state.minScrollTop - 1) {
      setScrollTop(state.minScrollTop);
      return;
    }
    layoutScrollbar();
  }

  function wheelDeltaPixels(event) {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * viewportHeight();
    return event.deltaY;
  }

  function nestedScrollableFor(target, deltaY) {
    const host = state.scrollHost;
    for (let node = target instanceof Element ? target : target?.parentElement; node && node !== host; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (!/(auto|scroll|overlay)/.test(style.overflowY) || node.scrollHeight <= node.clientHeight + 1) continue;
      if (deltaY < 0 && node.scrollTop > 0) return node;
      if (deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return node;
    }
    return null;
  }

  function onWheel(event) {
    if (!state.ready || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    syncBoundaryCoordinate();
    if (boundaryCoordinateInvalid()) {
      event.preventDefault();
      failOpenRecent();
      return;
    }
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const delta = wheelDeltaPixels(event);
    if (nestedScrollableFor(event.target, delta)) return;
    const before = scrollTop();
    if (state.boundaryProvisional && !findMountedByKey(state.boundaryKey)) {
      if (before < state.minScrollTop - 2) {
        failOpenRecent();
        return;
      }
      if (before <= state.minScrollTop + 2 && delta < 0) {
        event.preventDefault();
        scheduleBoundaryGrace();
        return;
      }
    }
    const target = clampRecentTop(before + delta);
    // Only block a gesture that would cross the semantic recent-N boundary.
    // Otherwise let the browser/ChatGPT keep native trackpad momentum and smoothness.
    if (delta < 0 && before <= state.minScrollTop + 1) {
      event.preventDefault();
      setScrollTop(state.minScrollTop);
      layoutScrollbar();
      return;
    }
    requestAnimationFrame(() => {
      if (!state.ready) return;
      const after = scrollTop();
      // Some ChatGPT builds expose a programmatic scroll root with overflow:hidden.
      // If native/default handling did nothing, fall back once without replacing
      // a functioning native scroll path.
      if (Math.abs(after - before) < 0.5 && Math.abs(target - before) > 0.5) setScrollTop(target);
      else if (after < state.minScrollTop - 1) setScrollTop(state.minScrollTop);
      layoutScrollbar();
    });
  }

  function isInteractiveKeyTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest(
      'input,textarea,select,button,a[href],summary,[contenteditable="true"],' +
      '[role="textbox"],[role="button"],[role="checkbox"],[role="switch"],' +
      '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],' +
      '[role="combobox"],[role="slider"],[role="spinbutton"],[role="radio"],' +
      '[role="tab"],[role="treeitem"],[role="option"]'
    ));
  }

  function onKeyDown(event) {
    if (!state.ready || isInteractiveKeyTarget(event.target) || isInteractiveKeyTarget(document.activeElement)) return;
    const current = scrollTop();
    let target = null;
    if (event.key === 'Home' && !event.ctrlKey && !event.metaKey) target = state.minScrollTop;
    else if (event.key === 'End' && !event.ctrlKey && !event.metaKey) target = maxScrollTop();
    else if (event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) target = current - viewportHeight() * 0.9;
    else if (event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) target = current + viewportHeight() * 0.9;
    else if (event.key === 'ArrowUp') target = current - 48;
    else if (event.key === 'ArrowDown') target = current + 48;
    if (target === null) return;

    const direction = target < current ? -1 : target > current ? 1 : 0;
    const keyTarget = event.target instanceof Element && event.target !== document.body
      ? event.target
      : document.activeElement;
    if (direction && nestedScrollableFor(keyTarget, direction)) return;

    syncBoundaryCoordinate();
    if (state.boundaryProvisional && !findMountedByKey(state.boundaryKey)) {
      if (current < state.minScrollTop - 2) {
        failOpenRecent();
        return;
      }
      if (target <= state.minScrollTop + 2) {
        event.preventDefault();
        setScrollTop(state.minScrollTop);
        scheduleBoundaryGrace();
        return;
      }
    }
    if (boundaryCoordinateInvalid()) {
      event.preventDefault();
      failOpenRecent();
      return;
    }
    event.preventDefault();
    setScrollTop(clampRecentTop(target));
    layoutScrollbar();
  }

  function ensureScrollbar() {
    if (state.scrollbar?.isConnected) return;
    const track = document.createElement('div');
    track.id = 'csg-recent-scrollbar';
    track.setAttribute('aria-hidden', 'true');
    const thumb = document.createElement('div');
    thumb.id = 'csg-recent-scrollbar-thumb';
    track.appendChild(thumb);
    document.documentElement.appendChild(track);
    state.scrollbar = track;
    state.thumb = thumb;

    thumb.addEventListener('pointerdown', (event) => {
      if (!state.ready) return;
      event.preventDefault();
      const thumbRect = thumb.getBoundingClientRect();
      thumb.setPointerCapture?.(event.pointerId);
      state.drag = { grabOffset: Math.max(0, event.clientY - thumbRect.top) };
    });
    thumb.addEventListener('pointermove', (event) => {
      if (!state.drag || !state.ready) return;
      updateMinimum();
      const trackRect = track.getBoundingClientRect();
      const thumbRect = thumb.getBoundingClientRect();
      const recentRange = Math.max(viewportHeight(), state.recentContentHeight);
      const scrollable = Math.max(0, recentRange - viewportHeight());
      const travel = Math.max(1, trackRect.height - thumbRect.height);
      const desired = Math.max(0, Math.min(travel, event.clientY - trackRect.top - state.drag.grabOffset));
      setScrollTop(state.minScrollTop + (desired / travel) * scrollable);
      layoutScrollbar();
    });
    const endDrag = () => { state.drag = null; };
    thumb.addEventListener('pointerup', endDrag);
    thumb.addEventListener('pointercancel', endDrag);
    track.addEventListener('pointerdown', (event) => {
      if (event.target === thumb || !state.ready) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)));
      const scrollable = Math.max(0, state.recentContentHeight - viewportHeight());
      setScrollTop(state.minScrollTop + ratio * scrollable);
    });
    layoutScrollbar();
  }

  function layoutScrollbar() {
    if (!state.scrollbar || !state.thumb || !state.scrollHost || !state.ready) {
      if (state.scrollbar) state.scrollbar.hidden = true;
      return;
    }
    syncBoundaryCoordinate();
    if (boundaryCoordinateInvalid()) {
      state.scrollbar.hidden = true;
      failOpenRecent();
      return;
    }
    const host = state.scrollHost;
    const rect = host === document.scrollingElement
      ? { top: 0, right: window.innerWidth, height: window.innerHeight }
      : host.getBoundingClientRect();
    const trackTop = Math.max(0, rect.top);
    const visibleBottom = Math.min(window.innerHeight, rect.top + rect.height);
    const trackHeight = Math.max(28, visibleBottom - trackTop);
    state.scrollbar.hidden = false;
    Object.assign(state.scrollbar.style, {
      top: `${trackTop}px`,
      right: `${Math.max(0, window.innerWidth - rect.right + 2)}px`,
      height: `${trackHeight}px`
    });

    const recentRange = Math.max(viewportHeight(), state.recentContentHeight);
    const scrollable = Math.max(0, recentRange - viewportHeight());
    if (scrollable <= 1) {
      state.thumb.hidden = true;
      return;
    }
    state.thumb.hidden = false;
    const thumbHeight = Math.max(28, trackHeight * (viewportHeight() / recentRange));
    const current = Math.max(0, Math.min(scrollable, scrollTop() - state.minScrollTop));
    const top = (current / scrollable) * Math.max(0, trackHeight - thumbHeight);
    Object.assign(state.thumb.style, { height: `${thumbHeight}px`, transform: `translateY(${top}px)` });
  }

  function publishCounts() {
    ROOT.dataset.csgRecentHiddenTurns = String(state.hiddenTurnCount);
    ROOT.dataset.csgRecentHiddenExchanges = String(state.hiddenExchangeCount);
  }

  function publishState(value) {
    ROOT.dataset.csgRecentState = value;
    publishCounts();
  }

  function clearMountedMarks() {
    document.querySelectorAll('.csg-hidden-old-turn').forEach((turn) => turn.classList.remove('csg-hidden-old-turn'));
  }

  function resetForRoute() {
    state.epoch += 1;
    state.coordinateGeneration += 1;
    clearTimeout(state.scheduled);
    clearTimeout(state.contentTimer);
    clearTimeout(state.roleConfirmTimer);
    clearTimeout(state.coordinateTimer);
    clearBoundaryGrace();
    state.scheduled = 0;
    state.contentTimer = 0;
    state.roleConfirmTimer = 0;
    state.coordinateTimer = 0;
    state.initializing = false;
    state.initializingEpoch = -1;
    state.recovering = false;
    state.recoveryEpoch = -1;
    state.suspended = false;
    state.boundaryProvisional = false;
    state.resizeScrollHeightGuard = null;
    clearMountedMarks();
    detachScrollHost();
    state.ready = false;
    state.sequence = [];
    state.roles.clear();
    state.assistantContent.clear();
    state.assistantContentChecked.clear();
    state.assistantContentDirty.clear();
    state.roleEvidence.clear();
    state.roleValidation.clear();
    state.roleLocks.clear();
    state.numeric.clear();
    state.messageIds.clear();
    state.identityEvidence.clear();
    state.keyTops.clear();
    state.missingEvidence.clear();
    state.boundaryKey = '';
    state.pendingBoundaryKey = '';
    state.hiddenExchangeCount = 0;
    state.hiddenTurnCount = 0;
    state.recentContentHeight = 0;
    state.minScrollTop = 0;
    state.lastMergeScrollTop = null;
    state.lastWindowKeys = [];
    state.bottomTailEvidence = null;
    ROOT.classList.remove('csg-show-recent-only');
    if (state.scrollbar) state.scrollbar.hidden = true;
    publishState('preparing');
  }

  function onRouteSignal() {
    if (!state.active) return;
    queueMicrotask(() => {
      if (state.active && location.pathname !== state.route) refreshStructure();
    });
  }

  function start() {
    publishState('preparing');
    attachObserver();
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('popstate', onRouteSignal, true);
    window.navigation?.addEventListener?.('currententrychange', onRouteSignal);
    setInterval(() => {
      if (!state.active) return;
      if (location.pathname !== state.route) scheduleStructureRefresh();
      else if (state.ready) {
        updateMinimum();
      }
    }, 750);
    discoverBoundary();
  }
})();
