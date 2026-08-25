#!/usr/bin/env python3
from pathlib import Path
import json, re, sys

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'manifest.json').read_text())
errors = []

def check(cond, msg):
    if not cond: errors.append(msg)

check(manifest.get('manifest_version') == 3, 'manifest_version must be 3')
check(manifest.get('name') == '__MSG_extensionName__', 'extension name must use localized manifest message')
check(manifest.get('default_locale') == 'en', 'default_locale must be en')
check(len('Stability Guard for ChatGPT') <= 75, 'name exceeds 75 characters')
check(manifest.get('description') == '__MSG_extensionDescription__', 'description must use localized manifest message')
check(manifest.get('permissions') == ['storage'], 'runtime permissions must be storage only')
check('host_permissions' not in manifest, 'host_permissions should not be present')
check(manifest.get('incognito') == 'not_allowed', 'incognito should be not_allowed')

for locale in ['en','ja']:
    rel = f'_locales/{locale}/messages.json'
    try:
        messages = json.loads((ROOT / rel).read_text())
        check(messages.get('extensionName', {}).get('message') == 'Stability Guard for ChatGPT', f'{rel} missing extension name')
        description = messages.get('extensionDescription', {}).get('message', '')
        check(bool(description), f'{rel} missing extension description')
        check(len(description) <= 132, f'{rel} extension description exceeds 132 characters')
    except Exception as exc:
        errors.append(f'{rel} invalid: {exc}')

# Public defaults for the long-thread limiter.
for rel in ['content.js', 'popup.js', 'recent-window.js']:
    text = (ROOT / rel).read_text()
    check(re.search(r'showRecentOnly:\s*false', text) is not None, f'{rel} must default recent-only view to OFF')
    check(re.search(r'recentExchanges:\s*3', text) is not None, f'{rel} must default recentExchanges to 3')

for rel in ['content.js', 'popup.js']:
    text = (ROOT / rel).read_text()
    check(re.search(r'hideOldAppLoadErrors:\s*true', text) is not None,
          f'{rel} must default stale app-load error filtering to ON')
check('id="hideOldAppLoadErrors"' in (ROOT / 'popup.html').read_text(),
      'popup.html missing hideOldAppLoadErrors control')
for rel in ['content.js', 'popup.js']:
    text = (ROOT / rel).read_text()
    check(re.search(r'autoContinueIncomplete:\s*false', text) is not None,
          f'{rel} must default autoContinueIncomplete to OFF')
popup_html_text = (ROOT / 'popup.html').read_text()
check('id="autoContinueIncomplete"' in popup_html_text,
      'popup.html missing autoContinueIncomplete control')
check('id="autoContinuePatternMode"' in popup_html_text and 'id="autoContinuePattern"' in popup_html_text,
      'popup.html missing auto-continue pattern controls')
for rel in ['content.js', 'popup.js']:
    text = (ROOT / rel).read_text()
    check(re.search(r"autoContinuePatternMode:\s*'glob'", text) is not None,
          f'{rel} must default autoContinuePatternMode to glob')
    check("autoContinuePattern: '*未完成*'" in text,
          f'{rel} must default autoContinuePattern to *未完成*')
check('csg-old-app-load-error' in (ROOT / 'content.css').read_text(),
      'content.css missing stale app-load error hide selector')

scripts = manifest.get('content_scripts', [])
check(bool(scripts), 'content_scripts missing')
for entry in scripts:
    check(entry.get('matches') == ['https://chatgpt.com/*'], f'unexpected content-script matches: {entry.get("matches")}')

runtime_files = {
    'content.js','recent-window.js','content.css','prehide.js','prehide.css',
    'popup.html','popup.css','popup.js','privacy.html','privacy.css','privacy.js',
    'icons/icon16.png','icons/icon32.png','icons/icon48.png','icons/icon128.png',
    '_locales/en/messages.json','_locales/ja/messages.json'
}
for rel in runtime_files:
    check((ROOT / rel).is_file(), f'missing runtime file: {rel}')

# Static remote-code / telemetry guardrails.
for rel in ['content.js','recent-window.js','prehide.js','popup.js','privacy.js']:
    text = (ROOT / rel).read_text()
    for token in ['eval(', 'new Function', 'XMLHttpRequest', 'WebSocket(', 'fetch(']:
        check(token not in text, f'{rel} contains disallowed/remote-capable token: {token}')
    if rel == 'content.js':
        check("chrome.storage.local.remove?.(['privacyConsent', 'privacyConsentVersion', 'privacyConsentAt'])" in text,
              'content.js missing legacy consent-metadata cleanup')
        check('privacyConsent !==' not in text and 'privacyConsentVersion !==' not in text and
              'privacyConsent:' not in text and 'privacyConsentVersion:' not in text,
              'content.js still uses legacy consent metadata as a runtime gate')
    else:
        check('privacyConsent' not in text, f'{rel} still contains legacy privacy consent gating')

for rel in ['popup.html','privacy.html']:
    text = (ROOT / rel).read_text()
    check(not re.search(r'<script[^>]+src=["\']https?://', text, re.I), f'{rel} contains remote script')

for rel in ['content.css','prehide.css','popup.css','privacy.css']:
    text = (ROOT / rel).read_text()
    check(not re.search(r'@import\s+[^;]*https?://', text, re.I), f'{rel} contains remote CSS import')
    check(not re.search(r'url\(\s*["\']?https?://', text, re.I), f'{rel} contains remote CSS URL')

popup_css = (ROOT / 'popup.css').read_text()
recent_js = (ROOT / 'recent-window.js').read_text()
content_css = (ROOT / 'content.css').read_text()
check('max-width:100vw' in popup_css and '(pointer: coarse)' in popup_css,
      'popup.css missing responsive coarse-pointer/mobile layout')
check("ROOT.dataset.csgRecentMode = 'per-chat'" in recent_js and '.csg-chat-toggle' in recent_js and
      'setScrollTop' not in recent_js and "addEventListener('wheel'" not in recent_js,
      'recent-window.js must use per-chat folding without owning native scroll')
check('@media (pointer: coarse)' in content_css and '.csg-chat-toggle' in content_css,
      'content.css missing coarse-pointer per-chat toggle sizing')
check('#csg-recent-accordion' not in content_css and '#csg-recent-scrollbar' not in content_css,
      'content.css still contains legacy fixed Recent-N UI')

popup_html = (ROOT / 'popup.html').read_text()
popup_js = (ROOT / 'popup.js').read_text()
privacy_html = (ROOT / 'privacy.html').read_text()
check('id="uiLanguage"' in popup_html and 'value="ja"' in popup_html and 'value="en"' in popup_html,
      'popup language selector must provide Japanese and English')
check('consentPanel' not in popup_html and 'revokeConsent' not in popup_html and
      'acceptConsent' not in popup_js and 'privacyConsent' not in popup_js,
      'popup still contains legacy first-run consent UI or logic')
check("uiLanguage: 'auto'" in popup_js and "const COPY =" in popup_js,
      'popup.js missing persistent Japanese/English localization')
check('id="privacyJa"' in privacy_html and 'id="privacyEn"' in privacy_html and 'privacy.js' in privacy_html,
      'privacy page must provide Japanese and English content')
for rel in ['prehide.js','recent-window.js','content.js']:
    check('uiLanguage' in (ROOT / rel).read_text(), f'{rel} missing UI language propagation')

for rel in ['popup.html','privacy.html']:
    text = (ROOT / rel).read_text()
    check(not re.search(r'<(?:iframe|img|link)[^>]+(?:src|href)=["\']https?://', text, re.I), f'{rel} contains remote embedded resource')

try:
    from PIL import Image
    expected = {16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png'}
    for size, rel in expected.items():
        with Image.open(ROOT / rel) as im:
            check(im.size == (size,size), f'{rel} is {im.size}, expected {(size,size)}')
            check(im.format == 'PNG', f'{rel} must be PNG')
except Exception as exc:
    errors.append(f'icon validation failed: {exc}')


# Publication documentation and compatibility disclosures.
for rel in ['README.md','PRIVACY.md','PUBLISHING.md','EDGE_SUBMISSION.md','store-assets/listing-ja.md','store-assets/listing-en.md','store-assets/edge-listing-ja.md','store-assets/edge-listing-en.md']:
    check((ROOT / rel).is_file(), f'missing publication file: {rel}')

compat_sources = ['README.md','PRIVACY.md','store-assets/listing-ja.md','store-assets/listing-en.md','store-assets/edge-listing-ja.md','store-assets/edge-listing-en.md']
for rel in compat_sources:
    text = (ROOT / rel).read_text().lower()
    check('chatgpt' in text and ('dom' in text or 'ui' in text), f'{rel} missing ChatGPT compatibility context')
    check(any(word in text for word in ['update','更新','change','変更']), f'{rel} missing site-update breakage disclosure')

for rel in ['store-assets/edge-listing-ja.md','store-assets/edge-listing-en.md']:
    text = (ROOT / rel).read_text().lower()
    check('chrome' not in text and 'firefox' not in text and 'safari' not in text,
          f'{rel} must not reference another browser in Edge store metadata')

# Store image assets.
try:
    from PIL import Image
    store_images = {
        'store-assets/edge-logo-300.png': (300,300),
        'store-assets/promo-440x280.png': (440,280),
        'store-assets/screenshot-1-1280x800.png': (1280,800),
        'store-assets/screenshot-2-1280x800.png': (1280,800),
        'store-assets/screenshot-3-1280x800.png': (1280,800),
    }
    for rel, expected_size in store_images.items():
        check((ROOT / rel).is_file(), f'missing store image: {rel}')
        if (ROOT / rel).is_file():
            with Image.open(ROOT / rel) as im:
                check(im.size == expected_size, f'{rel} is {im.size}, expected {expected_size}')
                check(im.format == 'PNG', f'{rel} must be PNG')
except Exception as exc:
    errors.append(f'store asset validation failed: {exc}')

if errors:
    print('VALIDATION FAILED')
    for e in errors: print(' -', e)
    sys.exit(1)
print('VALIDATION OK')
print(' version:', manifest['version'])
print(' scope: https://chatgpt.com/* only')
print(' permissions: storage only')
print(' privacy: local-only processing, no first-use consent gate')
