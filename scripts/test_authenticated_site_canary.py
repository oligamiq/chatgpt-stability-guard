#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = ROOT / 'artifacts' / 'authenticated-site-canary.json'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass


def app_card(index):
    return f'''<div data-turn-key="ex-{index}"><div data-content-search-turn-key="ex-{index}">
<div><h4>You said:</h4><div>request {index}</div></div>
<div data-chatgpt-search-message-ids="m-{index} m-{index}">
<h4 data-conversation-role="assistant">ChatGPT said:</h4>
<div class="tool-row"><div class="tool-header">xubuntu-desktop-commander</div>
<div data-mcp-app-portal-target="true"><div data-mcp-app-inline-surface="standalone" data-mcp-app-expanded="true" style="height:38px"></div>
<div data-mcp-app-frame="true"><iframe title="desktop-commander-home" src="about:blank"></iframe></div></div></div>
<div class="markdown">answer {index}</div></div></div></div>'''

def fixture_page(kind):
    if kind == 'valid':
        body = ''.join(app_card(i) for i in range(5))
    elif kind == 'drift':
        body = ''.join(
            app_card(i).replace('data-turn-key=', 'data-new-turn-key=').replace('data-mcp-app-portal-target', 'data-new-mcp-target')
            for i in range(5)
        )
    else:
        raise ValueError(kind)
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
body{{font:16px sans-serif}} iframe{{width:600px;height:38px}}
</style></head><body>{body}</body></html>'''


def run_canary(chrome, url):
    env = os.environ.copy()
    env.update({
        'CSG_AUTH_CANARY_TEST_MODE': '1',
        'CSG_AUTH_CANARY_ROOT_TIMEOUT_MS': '900',
        'CSG_AUTH_CANARY_URL': url,
        'CHROME_BIN': chrome,
    })
    ARTIFACT.unlink(missing_ok=True)
    proc = subprocess.run(
        [shutil.which('node') or 'node', 'scripts/authenticated_site_canary.mjs'],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=35,
    )
    if not ARTIFACT.exists():
        raise AssertionError('authenticated canary did not produce diagnostics')
    return proc, json.loads(ARTIFACT.read_text(encoding='utf-8'))

def main():
    chrome = shutil.which('google-chrome') or shutil.which('chromium') or shutil.which('chromium-browser')
    if not chrome:
        raise SystemExit('Chrome/Chromium not found')

    with tempfile.TemporaryDirectory(prefix='csg-auth-canary-fixture-') as tmp:
        root = Path(tmp)
        for kind in ('valid', 'drift'):
            target = root / 'c' / kind / 'index.html'
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(fixture_page(kind), encoding='utf-8')

        handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(root), **kwargs)
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            origin = f'http://127.0.0.1:{server.server_port}'
            proc, payload = run_canary(chrome, f'{origin}/c/valid/')
            if proc.returncode != 0:
                raise AssertionError(f'valid canary failed rc={proc.returncode}\n{proc.stdout}\n{proc.stderr}\n{payload}')
            assert not payload.get('failures'), payload
            after = payload.get('after') or {}
            assert int(after.get('exchangeCount') or 0) == 5, after
            assert int(after.get('portalCount') or 0) == 5, after
            assert int(after.get('hiddenPortalCount') or 0) == 5, after
            assert int(after.get('visiblePortalCount') or 0) == 0, after
            print('PASS authenticated-site canary valid fixture')
            proc, payload = run_canary(chrome, f'{origin}/c/drift/')
            assert proc.returncode == 2, (proc.returncode, proc.stdout, proc.stderr, payload)
            assert payload.get('errorType') == 'compatibility', payload
            assert 'authenticated DOM contract changed' in payload.get('fatalError', ''), payload
            print('PASS authenticated-site canary DOM drift is reportable compatibility failure')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == '__main__':
    main()
