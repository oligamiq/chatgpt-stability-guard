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
  showRecentOnly: false,
  recentExchanges: 3,
  freezeOldTurns: false,
  keepTurns: 12,
  showStatus: true
};

const CONSENT_VERSION = 1;
const IDS = Object.keys(DEFAULTS);
const RELOAD_KEYS = IDS;
let settings = { ...DEFAULTS };
let activeTab = null;
let pageSettings = null;
let targetAvailable = false;
let privacyConsent = false;
let needsReload = false;

function $(id) { return document.getElementById(id); }

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

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabs[0] || null;
  return activeTab;
}

async function send(message) {
  if (!activeTab?.id) return null;
  try { return await chrome.tabs.sendMessage(activeTab.id, message); }
  catch { return null; }
}

async function detectTarget() {
  const ping = await send({ type: 'CSG_PING' });
  targetAvailable = Boolean(ping?.ok && ping?.product === 'stability-guard-for-chatgpt');
  return targetAvailable;
}

function syncForm() {
  for (const id of IDS) {
    const el = $(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(settings[id]);
    else el.value = settings[id];
  }
  document.body.classList.toggle('disabled', !settings.enabled);
  updatePendingNotice();
}

function hasPendingChanges() {
  if (needsReload) return true;
  if (!pageSettings) return false;
  return RELOAD_KEYS.some((key) => settings[key] !== pageSettings[key]);
}

function updatePendingNotice() {
  const pending = privacyConsent && hasPendingChanges();
  $('pendingNotice').hidden = !pending;
  const state = $('pageState');
  if (!privacyConsent) state.textContent = '初回同意が必要';
  else if (!targetAvailable) state.textContent = '対象ページ未検出 · ChatGPTなら再読み込み';
  else if (pending) state.textContent = '保存済み · 再読み込み待ち';
  else state.textContent = settings.enabled ? '有効' : '停止中';
}

function showConsentIfNeeded() {
  const needed = !privacyConsent;
  document.body.classList.toggle('needs-consent', needed);
  $('consentPanel').hidden = !needed;
  $('compatNotice').hidden = needed;
}

async function saveFromForm() {
  for (const id of IDS) {
    const el = $(id);
    if (!el) continue;
    settings[id] = el.type === 'checkbox' ? el.checked : Number(el.value);
  }
  settings.recentExchanges = Math.min(100, Math.max(1, settings.recentExchanges || 3));
  settings.keepTurns = Math.min(100, Math.max(2, settings.keepTurns || 12));
  await chrome.storage.local.set({ settings });
  syncForm();
}

function setCount(id, value) {
  $(id).textContent = Number.isFinite(value) ? String(value) : '—';
}

function clearStats(label = '対象外') {
  $('statsState').textContent = label;
  ['hiddenTotal','countThinking','countTools','countSummary','countEmbeds','countPrehide','countOldAppErrors','countOldExchanges','countOldTurns','countFrozen','countHeavy']
    .forEach((id) => $(id).textContent = '—');
}

function renderStats(response) {
  if (!response) {
    clearStats(privacyConsent ? 'ページ再読み込み後に取得' : '同意待ち');
    return;
  }
  pageSettings = normalizeSettings(response.settings);
  const s = response.stats || {};
  setCount('hiddenTotal', s.hiddenTotal ?? 0);
  setCount('countThinking', s.hiddenThinking ?? 0);
  setCount('countTools', s.hiddenTools ?? 0);
  setCount('countSummary', s.hiddenToolSummary ?? 0);
  setCount('countEmbeds', s.hiddenToolEmbeds ?? 0);
  setCount('countPrehide', s.hiddenPrehide ?? 0);
  setCount('countOldAppErrors', s.hiddenOldAppErrors ?? 0);
  setCount('countOldExchanges', s.hiddenOldExchanges ?? 0);
  setCount('countOldTurns', s.hiddenOldTurns ?? 0);
  setCount('countFrozen', s.frozen ?? 0);
  setCount('countHeavy', s.heavy ?? 0);
  $('statsState').textContent = `Scan ${s.scans ?? 0}`;
  updatePendingNotice();
}

async function refreshStats() {
  await detectTarget();
  if (!targetAvailable) {
    pageSettings = null;
    clearStats('未検出');
    updatePendingNotice();
    return;
  }
  if (!privacyConsent) {
    clearStats('同意待ち');
    updatePendingNotice();
    return;
  }
  renderStats(await send({ type: 'CSG_GET_STATS' }));
}

async function setPreset(maximum) {
  settings = maximum ? {
    ...DEFAULTS,
    hideThinking: true,
    hideTools: true,
    showRecentOnly: true,
    recentExchanges: 3,
    dimTraces: false,
    compactTraces: true,
    freezeOldTurns: false,
    keepTurns: 8
  } : { ...DEFAULTS };
  await chrome.storage.local.set({ settings });
  syncForm();
}

async function reloadCurrentTab() {
  if (!activeTab?.id) return;
  await chrome.tabs.reload(activeTab.id);
  window.close();
}

async function acceptConsent() {
  if (!$('consentCheck').checked) return;
  privacyConsent = true;
  needsReload = true;
  await chrome.storage.local.set({
    privacyConsent: true,
    privacyConsentVersion: CONSENT_VERSION,
    privacyConsentAt: new Date().toISOString()
  });
  showConsentIfNeeded();
  syncForm();
  await refreshStats();
}

async function revokeConsent() {
  privacyConsent = false;
  await chrome.storage.local.remove(['privacyConsent', 'privacyConsentVersion', 'privacyConsentAt']);
  if (activeTab?.id && targetAvailable) {
    await chrome.tabs.reload(activeTab.id);
    window.close();
    return;
  }
  showConsentIfNeeded();
  updatePendingNotice();
}

async function init() {
  const stored = await chrome.storage.local.get({
    settings: DEFAULTS,
    privacyConsent: false,
    privacyConsentVersion: 0
  });
  settings = normalizeSettings(stored.settings);
  privacyConsent = stored.privacyConsent === true && stored.privacyConsentVersion === CONSENT_VERSION;
  await getActiveTab();
  await detectTarget();
  showConsentIfNeeded();
  syncForm();
  await refreshStats();

  for (const id of IDS) {
    const el = $(id);
    if (el) el.addEventListener('change', saveFromForm);
  }
  $('reloadTab').addEventListener('click', reloadCurrentTab);
  $('safePreset').addEventListener('click', () => setPreset(false));
  $('maxPreset').addEventListener('click', () => setPreset(true));
  $('consentCheck').addEventListener('change', () => {
    $('acceptConsent').disabled = !$('consentCheck').checked;
  });
  $('acceptConsent').addEventListener('click', acceptConsent);
  $('declineConsent').addEventListener('click', () => window.close());
  $('revokeConsent').addEventListener('click', revokeConsent);
}

init();
