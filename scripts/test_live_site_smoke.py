#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = ROOT / 'artifacts' / 'live-site-smoke.json'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass


def turn_html(index, role):
    return (
        f'<section data-testid="conversation-turn-{index}" data-turn="{role}" '
        f'data-turn-id="id-{index}" data-turn-id-container="id-{index}" dir="auto" '
        'style="min-height:140px">'
        f'<div class="agent-turn"><div class="markdown">Fixture turn {index}</div></div>'
        '</section>'
    )


def fixture_page():
    turns = ''.join(
        turn_html(index, 'user' if index % 2 == 0 else 'assistant')
        for index in range(10)
    )
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;height:100%}}
.group\\/scroll-root{{height:360px;overflow-y:auto;position:relative}}
</style></head><body>
<div class="group/scroll-root"><main>{turns}</main></div>
</body></html>'''


def main():
    chrome = shutil.which('google-chrome') or shutil.which('chromium') or shutil.which('chromium-browser')
    if not chrome:
        raise SystemExit('Chrome/Chromium not found')

    with tempfile.TemporaryDirectory(prefix='csg-live-smoke-fixture-') as tmp:
        root = Path(tmp)
        target = root / 'share' / 'fixture' / 'index.html'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(fixture_page(), encoding='utf-8')
        handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(root), **kwargs)
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}/share/fixture/'

        env = os.environ.copy()
        env.update({
            'CSG_LIVE_SMOKE_TEST_MODE': '1',
            'CSG_LIVE_CHAT_URL': url,
            'CHROME_BIN': chrome,
        })
        try:
            ARTIFACT.unlink(missing_ok=True)
            proc = subprocess.run(
                [shutil.which('node') or 'node', 'scripts/live_site_smoke.mjs'],
                cwd=ROOT,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=45,
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    if proc.returncode != 0:
        raise AssertionError(
            f'local live-site smoke failed rc={proc.returncode}\n'
            f'STDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}'
        )
    if not ARTIFACT.exists():
        raise AssertionError('live-site smoke did not produce diagnostics artifact')

    payload = json.loads(ARTIFACT.read_text(encoding='utf-8'))
    assert not payload.get('fatalError'), payload
    assert not payload.get('failures'), payload
    core = payload.get('core') or {}
    recent = payload.get('recent') or {}
    assert core.get('contentReady') == '1', core
    assert recent.get('recentState') == 'ready', recent
    assert recent.get('recentMode') == 'collapsed', recent
    assert int(recent.get('hiddenOldTurns') or 0) >= 1, recent
    assert recent.get('accordionExists') is True and recent.get('accordionHidden') is False, recent
    print('PASS live-site smoke local fixture')


if __name__ == '__main__':
    main()
