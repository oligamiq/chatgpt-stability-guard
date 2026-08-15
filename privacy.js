(() => {
  'use strict';
  const select = document.getElementById('privacyLanguage');
  const ja = document.getElementById('privacyJa');
  const en = document.getElementById('privacyEn');
  function resolved(value) {
    if (value === 'ja' || value === 'en') return value;
    return String(navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
  }
  function apply(value) {
    const language = resolved(value);
    document.documentElement.lang = language;
    ja.hidden = language !== 'ja';
    en.hidden = language !== 'en';
  }
  chrome.storage.local.get({ uiLanguage: 'auto' }, ({ uiLanguage }) => {
    const value = ['auto', 'ja', 'en'].includes(uiLanguage) ? uiLanguage : 'auto';
    select.value = value;
    apply(value);
  });
  select.addEventListener('change', async () => {
    const value = ['auto', 'ja', 'en'].includes(select.value) ? select.value : 'auto';
    await chrome.storage.local.set({ uiLanguage: value });
    apply(value);
  });
})();
