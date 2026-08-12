#!/usr/bin/env python3
from pathlib import Path
import json, re, sys

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'manifest.json').read_text())
errors = []

def check(cond, msg):
    if not cond: errors.append(msg)

check(manifest.get('manifest_version') == 3, 'manifest_version must be 3')
check(manifest.get('name') == 'Stability Guard for ChatGPT', 'unexpected extension name')
check(len(manifest.get('name','')) <= 75, 'name exceeds 75 characters')
check(len(manifest.get('description','')) <= 132, 'description exceeds 132 characters')
check(manifest.get('permissions') == ['storage'], 'runtime permissions must be storage only')
check('host_permissions' not in manifest, 'host_permissions should not be present')
check(manifest.get('incognito') == 'not_allowed', 'incognito should be not_allowed')

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
check('csg-old-app-load-error' in (ROOT / 'content.css').read_text(),
      'content.css missing stale app-load error hide selector')

scripts = manifest.get('content_scripts', [])
check(bool(scripts), 'content_scripts missing')
for entry in scripts:
    check(entry.get('matches') == ['https://chatgpt.com/*'], f'unexpected content-script matches: {entry.get("matches")}')

runtime_files = {
    'content.js','recent-window.js','content.css','prehide.js','prehide.css',
    'popup.html','popup.css','popup.js','privacy.html','privacy.css',
    'icons/icon16.png','icons/icon32.png','icons/icon48.png','icons/icon128.png'
}
for rel in runtime_files:
    check((ROOT / rel).is_file(), f'missing runtime file: {rel}')

# Static remote-code / telemetry guardrails.
for rel in ['content.js','recent-window.js','prehide.js','popup.js']:
    text = (ROOT / rel).read_text()
    for token in ['eval(', 'new Function', 'XMLHttpRequest', 'WebSocket(', 'fetch(']:
        check(token not in text, f'{rel} contains disallowed/remote-capable token: {token}')
    check('privacyConsent' in text if rel != 'popup.js' else True, f'{rel} missing privacy consent gate')

for rel in ['popup.html','privacy.html']:
    text = (ROOT / rel).read_text()
    check(not re.search(r'<script[^>]+src=["\']https?://', text, re.I), f'{rel} contains remote script')

for rel in ['content.css','prehide.css','popup.css','privacy.css']:
    text = (ROOT / rel).read_text()
    check(not re.search(r'@import\s+[^;]*https?://', text, re.I), f'{rel} contains remote CSS import')
    check(not re.search(r'url\(\s*["\']?https?://', text, re.I), f'{rel} contains remote CSS URL')

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
for rel in ['README.md','PRIVACY.md','PUBLISHING.md','store-assets/listing-ja.md','store-assets/listing-en.md']:
    check((ROOT / rel).is_file(), f'missing publication file: {rel}')

compat_sources = ['README.md','PRIVACY.md','store-assets/listing-ja.md','store-assets/listing-en.md']
for rel in compat_sources:
    text = (ROOT / rel).read_text().lower()
    check('chatgpt' in text and ('dom' in text or 'ui' in text), f'{rel} missing ChatGPT compatibility context')
    check(any(word in text for word in ['update','更新','change','変更']), f'{rel} missing site-update breakage disclosure')

# Chrome Web Store image assets.
try:
    from PIL import Image
    store_images = {
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
print(' privacy consent gate: present')
