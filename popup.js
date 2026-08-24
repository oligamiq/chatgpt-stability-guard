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
  autoContinueIncomplete: false,
  autoContinuePatternMode: 'glob',
  autoContinuePattern: '*未完成*',
  freezeOldTurns: false,
  keepTurns: 12,
  showStatus: true
};

const IDS = Object.keys(DEFAULTS);
const RELOAD_KEYS = IDS;
let settings = { ...DEFAULTS };
let activeTab = null;
let pageSettings = null;
let targetAvailable = false;
let needsReload = false;
let uiLanguage = 'auto';

const COPY = {
  ja: {
    unofficial: '非公式拡張 · OpenAIとは無関係', masterTitle: '拡張機能全体',
    compatLabel: '互換性:', compat: '現在のChatGPT Web UI向け。ChatGPT側のDOM/UI更新により、一時的に検出・非表示が動作しなくなる場合がある。',
    pending: '設定は保存済み。再読み込み後に反映される。', reload: '現在のタブを再読み込み',
    sections: ['非表示', '描画の軽量化', '長大スレッド', '現在のページ'],
    settings: {
      hideThinking: ['Thinking / reasoning', '推論表示を隠す'], hideTools: ['MCP / tool 本体', 'tool trace本体を隠す'],
      hideToolSummary: ['ツール概要', 'Called tool / ツール呼び出し行'], hideToolEmbeds: ['埋め込みツールUI', 'configカードなどのrich UI'],
      prehideToolPlaceholders: ['読み込み中プレースホルダ', 'rich UI生成前の灰色スケルトン'], hideOldAppLoadErrors: ['古いアプリ読み込みエラー', 'Failed to fetch template。最新turnのものは残す'],
      dimTraces: ['traceを薄くする', 'Thinking / toolを低コントラスト化'], compactTraces: ['traceの高さを制限', '長いtraceをスクロール領域にする'],
      reduceMotion: ['アニメーション抑制', 'transition / progress描画を削減'], lazyHeavyBlocks: ['code / log遅延描画', '画面外preの描画を遅延'],
      showRecentOnly: ['直近N回 + 過去を折りたたむ', '古い対話をアコーディオン化・既定OFF'], autoContinueIncomplete: ['未完成なら自動Continue', '指定パターンに一致した最新返答へ Continue を自動送信・既定OFF'],
      freezeOldTurns: ['古いターンを遅延描画', 'Aggressive・既定OFF・直近N表示中は自動停止'], showStatus: ['Guard状態表示', 'ページ右下の小さなステータス']
    },
    recentRow: '常時表示する対話数 N', keepRow: '完全描画を残すターン数',
    autoContinuePatternModeLabel: '判定方式', autoContinuePatternLabel: 'パターン',
    autoContinuePatternHint: 'Glob は全文一致（例: *未完成*）。Regex は JavaScript 正規表現ソース。空文字・不正なRegexでは送信しない。',
    hint: '1対話 = ユーザー発言から次のユーザー発言直前まで。直近N件を常時表示し、それ以前はアコーディオンから一時展開できる。会話DOMは削除しない。',
    hiddenNow: '非表示中', unit: '件',
    statLabels: { countSummary: 'ツール概要', countEmbeds: '埋め込みUI', countPrehide: 'プレースホルダ', countOldAppErrors: '古いアプリ読込エラー', countOldExchanges: '検出済みの古い対話', countOldTurns: '現在DOMで非表示の古いターン', countFrozen: '遅延描画ターン', countHeavy: '遅延描画code/log' },
    safe: '既定に戻す', max: '最大軽量化', footerCompatibility: 'Compatibility profile: ChatGPT Web UI · 2026-08',
    states: { checking: '対象タブを確認中', targetMissing: '対象ページ未検出 · ChatGPTなら再読み込み', pending: '保存済み · 再読み込み待ち', enabled: '有効', disabled: '停止中', outside: '対象外', afterReload: 'ページ再読み込み後に取得', notDetected: '未検出' }
  },
  en: {
    unofficial: 'Unofficial extension · Not affiliated with OpenAI', masterTitle: 'Enable extension',
    compatLabel: 'Compatibility:', compat: 'Built for the current ChatGPT web UI. ChatGPT DOM/UI changes may temporarily break detection or hiding until the extension is updated.',
    pending: 'Settings are saved and will take effect after reloading the page.', reload: 'Reload current tab',
    sections: ['Hide', 'Rendering optimization', 'Long conversations', 'Current page'],
    settings: {
      hideThinking: ['Thinking / reasoning', 'Hide reasoning displays'], hideTools: ['MCP / tool body', 'Hide tool trace bodies'],
      hideToolSummary: ['Tool summaries', 'Hide Called tool / tool-call summary rows'], hideToolEmbeds: ['Embedded tool UI', 'Hide rich UI such as config cards'],
      prehideToolPlaceholders: ['Loading placeholders', 'Hide gray skeletons before rich UI loads'], hideOldAppLoadErrors: ['Stale app loading errors', 'Hide old Failed to fetch template errors; keep the latest turn'],
      dimTraces: ['Dim traces', 'Lower the contrast of Thinking / tool traces'], compactTraces: ['Limit trace height', 'Put long traces in a scrollable area'],
      reduceMotion: ['Reduce animations', 'Reduce transition / progress rendering'], lazyHeavyBlocks: ['Lazy-render code / logs', 'Defer rendering off-screen pre blocks'],
      showRecentOnly: ['Latest N + collapsed history', 'Put older exchanges in an accordion · Off by default'], autoContinueIncomplete: ['Auto-Continue on incomplete response', 'Automatically send Continue when the latest response matches the configured pattern · Off by default'],
      freezeOldTurns: ['Defer older turns', 'Aggressive · Off by default · Disabled while recent-N is active'], showStatus: ['Show Guard status', 'Small status indicator at the bottom-right of the page']
    },
    recentRow: 'Exchanges always visible N', keepRow: 'Fully rendered turns to keep',
    autoContinuePatternModeLabel: 'Match type', autoContinuePatternLabel: 'Pattern',
    autoContinuePatternHint: 'Glob matches the full response (example: *unfinished*). Regex uses JavaScript regular-expression source. Empty or invalid regex patterns never send.',
    hint: '1 exchange = from one user message up to just before the next user message. The latest N stay visible; earlier exchanges can be temporarily expanded from the accordion. Conversation DOM nodes are not removed.',
    hiddenNow: 'Hidden now', unit: 'items',
    statLabels: { countSummary: 'Tool summaries', countEmbeds: 'Embedded UI', countPrehide: 'Placeholders', countOldAppErrors: 'Stale app loading errors', countOldExchanges: 'Detected older exchanges', countOldTurns: 'Older turns hidden in current DOM', countFrozen: 'Deferred turns', countHeavy: 'Deferred code/log blocks' },
    safe: 'Restore defaults', max: 'Maximum optimization', footerCompatibility: 'Compatibility profile: ChatGPT Web UI · 2026-08',
    states: { checking: 'Checking the active tab', targetMissing: 'ChatGPT page not detected · Reload if this is ChatGPT', pending: 'Saved · Waiting for reload', enabled: 'Enabled', disabled: 'Paused', outside: 'Not applicable', afterReload: 'Available after page reload', notDetected: 'Not detected' }
  }
};

function $(id) { return document.getElementById(id); }
function resolvedLanguage() {
  if (uiLanguage === 'ja' || uiLanguage === 'en') return uiLanguage;
  return String(navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
}
function currentCopy() { return COPY[resolvedLanguage()]; }
function setSettingCopy(id, pair) {
  const label = $(id)?.closest('.setting');
  if (!label || !pair) return;
  label.querySelector('b').textContent = pair[0];
  label.querySelector('small').textContent = pair[1];
}
function setRowCopy(id, text) {
  const label = $(id)?.closest('.row');
  if (label?.firstChild?.nodeType === Node.TEXT_NODE) label.firstChild.nodeValue = `${text} `;
}
function applyLanguage() {
  const c = currentCopy();
  document.documentElement.lang = resolvedLanguage();
  document.querySelector('.unofficial').textContent = c.unofficial;
  document.querySelector('.master').title = c.masterTitle;
  $('compatNotice').innerHTML = `<b>${c.compatLabel}</b> ${c.compat}`;
  $('pendingNotice').querySelector('span').textContent = c.pending;
  $('reloadTab').textContent = c.reload;
  const sections = [...document.querySelectorAll('#settingsMain > section')];
  c.sections.forEach((text, i) => { const h2 = sections[i]?.querySelector('h2'); if (h2) h2.textContent = text; });
  Object.entries(c.settings).forEach(([id, pair]) => setSettingCopy(id, pair));
  setRowCopy('recentExchanges', c.recentRow);
  setRowCopy('keepTurns', c.keepRow);
  $('autoContinuePatternModeLabel').textContent = c.autoContinuePatternModeLabel;
  $('autoContinuePatternLabel').textContent = c.autoContinuePatternLabel;
  $('autoContinuePatternHint').textContent = c.autoContinuePatternHint;
  document.querySelector('.danger > .hint').textContent = c.hint;
  document.querySelector('.total span').textContent = c.hiddenNow;
  document.querySelector('.total small').textContent = c.unit;
  Object.entries(c.statLabels).forEach(([id, text]) => { const label = $(id)?.previousElementSibling; if (label) label.textContent = text; });
  $('safePreset').textContent = c.safe;
  $('maxPreset').textContent = c.max;
  document.querySelector('footer span').textContent = c.footerCompatibility;
  updatePendingNotice();
}

function normalizeSettings(raw = {}) {
  const legacy = raw.hideToolChrome;
  return {
    ...DEFAULTS,
    ...raw,
    hideToolSummary: raw.hideToolSummary ?? legacy ?? DEFAULTS.hideToolSummary,
    hideToolEmbeds: raw.hideToolEmbeds ?? legacy ?? DEFAULTS.hideToolEmbeds,
    prehideToolPlaceholders: raw.prehideToolPlaceholders ?? legacy ?? DEFAULTS.prehideToolPlaceholders,
    autoContinuePatternMode: raw.autoContinuePatternMode === 'regex' ? 'regex' : 'glob',
    autoContinuePattern: typeof raw.autoContinuePattern === 'string'
      ? raw.autoContinuePattern.slice(0, 512) : DEFAULTS.autoContinuePattern
  };
}

async function getActiveTab() {
  if (!chrome.tabs?.query) {
    activeTab = null;
    return null;
  }
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0] || null;
  } catch {
    activeTab = null;
  }
  return activeTab;
}

async function send(message) {
  if (!activeTab?.id || !chrome.tabs?.sendMessage) return null;
  try { return await chrome.tabs.sendMessage(activeTab.id, message); }
  catch { return null; }
}

async function detectTarget() {
  const ping = await send({ type: 'CSG_PING' });
  targetAvailable = Boolean(ping?.ok && ping?.product === 'stability-guard-for-chatgpt');
  return targetAvailable;
}

function updateAutoContinuePatternUi() {
  const disabled = !settings.autoContinueIncomplete;
  const config = $('autoContinuePatternConfig');
  if (config) config.dataset.disabled = String(disabled);
  if ($('autoContinuePatternMode')) $('autoContinuePatternMode').disabled = disabled;
  if ($('autoContinuePattern')) $('autoContinuePattern').disabled = disabled;
  const pattern = $('autoContinuePattern');
  if (pattern) {
    let invalid = false;
    if (settings.autoContinuePatternMode === 'regex' && pattern.value) {
      try { new RegExp(pattern.value); } catch { invalid = true; }
    }
    pattern.setAttribute('aria-invalid', String(invalid));
  }
}

function syncForm() {
  for (const id of IDS) {
    const el = $(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(settings[id]);
    else el.value = settings[id];
  }
  document.body.classList.toggle('disabled', !settings.enabled);
  updateAutoContinuePatternUi();
  updatePendingNotice();
}

function hasPendingChanges() {
  if (needsReload) return true;
  if (!pageSettings) return false;
  return RELOAD_KEYS.some((key) => settings[key] !== pageSettings[key]);
}

function updatePendingNotice() {
  const pending = hasPendingChanges();
  $('pendingNotice').hidden = !pending;
  const state = $('pageState');
  const states = currentCopy().states;
  if (!targetAvailable) state.textContent = states.targetMissing;
  else if (pending) state.textContent = states.pending;
  else state.textContent = settings.enabled ? states.enabled : states.disabled;
}

async function saveFromForm() {
  for (const id of IDS) {
    const el = $(id);
    if (!el) continue;
    if (el.type === 'checkbox') settings[id] = el.checked;
    else if (el.type === 'number') settings[id] = Number(el.value);
    else settings[id] = String(el.value);
  }
  settings.recentExchanges = Math.min(100, Math.max(1, settings.recentExchanges || 3));
  settings.keepTurns = Math.min(100, Math.max(2, settings.keepTurns || 12));
  settings.autoContinuePatternMode = settings.autoContinuePatternMode === 'regex' ? 'regex' : 'glob';
  settings.autoContinuePattern = String(settings.autoContinuePattern || '').slice(0, 512);
  await chrome.storage.local.set({ settings });
  syncForm();
}

function setCount(id, value) {
  $(id).textContent = Number.isFinite(value) ? String(value) : '—';
}

function clearStats(label = currentCopy().states.outside) {
  $('statsState').textContent = label;
  ['hiddenTotal','countThinking','countTools','countSummary','countEmbeds','countPrehide','countOldAppErrors','countOldExchanges','countOldTurns','countFrozen','countHeavy']
    .forEach((id) => $(id).textContent = '—');
}

function renderStats(response) {
  if (!response) {
    clearStats(currentCopy().states.afterReload);
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
    clearStats(currentCopy().states.notDetected);
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
  if (!activeTab?.id || !chrome.tabs?.reload) return;
  try {
    await chrome.tabs.reload(activeTab.id);
    window.close();
  } catch {
    updatePendingNotice();
  }
}

async function init() {
  const stored = await chrome.storage.local.get({
    settings: DEFAULTS,
    uiLanguage: 'auto'
  });
  uiLanguage = ['auto', 'ja', 'en'].includes(stored.uiLanguage) ? stored.uiLanguage : 'auto';
  $('uiLanguage').value = uiLanguage;
  applyLanguage();
  settings = normalizeSettings(stored.settings);
  await getActiveTab();
  await detectTarget();
  syncForm();
  await refreshStats();

  for (const id of IDS) {
    const el = $(id);
    if (el) el.addEventListener('change', saveFromForm);
  }
  $('autoContinuePattern')?.addEventListener('input', saveFromForm);
  $('uiLanguage').addEventListener('change', async () => {
    uiLanguage = ['auto', 'ja', 'en'].includes($('uiLanguage').value) ? $('uiLanguage').value : 'auto';
    await chrome.storage.local.set({ uiLanguage });
    if (targetAvailable) needsReload = true;
    applyLanguage();
  });
  $('reloadTab').addEventListener('click', reloadCurrentTab);
  $('safePreset').addEventListener('click', () => setPreset(false));
  $('maxPreset').addEventListener('click', () => setPreset(true));
}

init();
