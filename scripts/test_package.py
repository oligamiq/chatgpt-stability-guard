#!/usr/bin/env python3
from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile
import json
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
SOURCE_MANIFEST = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
ARCHIVE = ROOT / 'dist' / f"stability-guard-for-chatgpt-{SOURCE_MANIFEST['version']}.zip"


def declared_manifest_files(m):
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


def package_digest():
    subprocess.run([sys.executable, 'scripts/package.py'], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    return sha256(ARCHIVE.read_bytes()).hexdigest()


first = package_digest()
time.sleep(2.1)  # ZIP timestamps have 2-second granularity; catches time-dependent archives.
second = package_digest()
assert first == second, f'package is not reproducible: {first} != {second}'

with ZipFile(ARCHIVE) as z:
    names = z.namelist()
    assert len(names) == len(set(names)), 'duplicate ZIP entries found'
    assert all(info.date_time == (1980, 1, 1, 0, 0, 0) for info in z.infolist()), 'ZIP timestamps are not normalized'
    manifest = json.loads(z.read('manifest.json'))
    archive_names = set(names)


required = declared_manifest_files(SOURCE_MANIFEST)
source_locales = {str(path.relative_to(ROOT)) for path in (ROOT / '_locales').glob('*/messages.json')}
runtime_ui = {'popup.css', 'popup.js', 'privacy.html', 'privacy.css', 'privacy.js'}
expected_names = {'manifest.json'} | required | source_locales | runtime_ui
missing = sorted(expected_names - archive_names)
unexpected = sorted(archive_names - expected_names)
assert not missing, f'expected resources missing from archive: {missing}'
assert not unexpected, f'unexpected resources in archive: {unexpected}'
default_locale = SOURCE_MANIFEST.get('default_locale')
if default_locale:
    assert f'_locales/{default_locale}/messages.json' in archive_names, 'default locale missing from archive'

assert 'key' not in manifest, 'development manifest key leaked into store archive'
assert manifest.get('permissions') == ['storage'], f"unexpected permissions: {manifest.get('permissions')}"
content_scripts = manifest.get('content_scripts') or []
assert content_scripts and content_scripts[0].get('matches') == ['https://chatgpt.com/*'], 'unexpected content-script scope'
print(f'PACKAGE TESTS OK sha256={second} entries={len(names)}')
