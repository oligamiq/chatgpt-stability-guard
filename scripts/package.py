#!/usr/bin/env python3
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)
subprocess.run([sys.executable, str(ROOT / 'scripts' / 'generate_icons.py')], check=True)
manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
version = manifest['version']
out = DIST / f'stability-guard-for-chatgpt-{version}.zip'

# The source manifest keeps a development key for stable local unpacked IDs.
# Chrome Web Store assigns the item key; do not submit the development key.
store_manifest = dict(manifest)
store_manifest.pop('key', None)

def manifest_files(m):
    out = set()

    def add(value):
        if isinstance(value, str) and value and not value.startswith(("http://", "https://", "*://")):
            out.add(value.lstrip("/"))

    action = m.get("action") or {}
    add(action.get("default_popup"))
    for value in (action.get("default_icon") or {}).values():
        add(value)
    for value in (m.get("icons") or {}).values():
        add(value)
    for entry in m.get("content_scripts") or []:
        for key in ("js", "css"):
            for value in entry.get(key) or []:
                add(value)
    background = m.get("background") or {}
    add(background.get("service_worker"))
    for value in background.get("scripts") or []:
        add(value)
    add(m.get("options_page"))
    add((m.get("options_ui") or {}).get("page"))
    add(m.get("devtools_page"))
    add((m.get("side_panel") or {}).get("default_path"))
    for value in (m.get("chrome_url_overrides") or {}).values():
        add(value)
    for value in (m.get("sandbox") or {}).get("pages") or []:
        add(value)
    for entry in m.get("web_accessible_resources") or []:
        for value in entry.get("resources") or []:
            if not any(ch in value for ch in "*?["):
                add(value)
    return out


# Manifest-declared resources are collected automatically so a future manifest
# change cannot silently produce an archive missing its new script/page/icon.
files = manifest_files(manifest)
# These pages/resources are reached from extension UI rather than the manifest.
files.update({'popup.css', 'popup.js', 'privacy.html', 'privacy.css', 'privacy.js'})
# Ship every source locale, not only the current default locale.
files.update(str(path.relative_to(ROOT)) for path in (ROOT / '_locales').glob('*/messages.json'))
files = sorted(files)


# Normalize ZIP metadata so identical source bytes always produce identical archives.
ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)

def write_entry(z, rel, data):
    info = ZipInfo(rel, ZIP_EPOCH)
    info.compress_type = ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    z.writestr(info, data)

with ZipFile(out, 'w', compression=ZIP_DEFLATED, compresslevel=9) as z:
    write_entry(z, 'manifest.json', (json.dumps(store_manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    for rel in files:
        write_entry(z, rel, (ROOT / rel).read_bytes())
print(out)
