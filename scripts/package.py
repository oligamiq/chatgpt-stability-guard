#!/usr/bin/env python3
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)
manifest = json.loads((ROOT / 'manifest.json').read_text())
version = manifest['version']
out = DIST / f'stability-guard-for-chatgpt-{version}.zip'

# The source manifest keeps a development key for stable local unpacked IDs.
# Chrome Web Store assigns the item key; do not submit the development key.
store_manifest = dict(manifest)
store_manifest.pop('key', None)

files = [
    'content.js','recent-window.js','content.css','prehide.js','prehide.css',
    'popup.html','popup.css','popup.js','privacy.html','privacy.css',
    'icons/icon16.png','icons/icon32.png','icons/icon48.png','icons/icon128.png'
]
with ZipFile(out, 'w', ZIP_DEFLATED) as z:
    z.writestr('manifest.json', json.dumps(store_manifest, ensure_ascii=False, indent=2) + '\n')
    for rel in files:
        z.write(ROOT / rel, rel)
print(out)
