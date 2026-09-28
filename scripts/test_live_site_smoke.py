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


def legacy_turn_html(index, role):
    return (
        f'<section data-testid="conversation-turn-{index}" data-turn="{role}" '
        f'data-turn-id="id-{index}" data-turn-id-container="id-{index}" dir="auto" '
        'style="min-height:140px">'
        f'<div class="agent-turn"><div class="markdown">Fixture turn {index}</div></div>'
        '</section>'
    )


def exchange_html(index):
    key = f'ex-{index}'
    return (
        f'<div class="exchange-cell" style="min-height:140px"><div data-turn-key="{key}">'
        f'<div data-content-search-turn-key="{key}">'
        f'<div><h4 class="sr-only">You said:</h4><div>request {index}</div></div>'
        f'<div data-chatgpt-search-message-ids="m-{key} m-{key}">'
        '<h4 class="sr-only" data-conversation-role="assistant">ChatGPT said:</h4>'
        f'<div class="markdown">response {index}</div></div></div></div></div>'
    )


def fixture_page(kind):
    if kind == 'legacy':
        turns = ''.join(legacy_turn_html(index, 'user' if index % 2 == 0 else 'assistant') for index in range(10))
    elif kind == 'exchange':
        turns = ''.join(exchange_html(index) for index in range(10))
    elif kind == 'unknown':
        turns = ''.join(f'<article data-chat-row="{index}">unknown {index}</article>' for index in range(10))
    else:
        raise ValueError(kind)
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;height:100%}}
.group\\/scroll-root{{height:360px;overflow-y:auto;position:relative}}
</style></head><body>
<div class="group/scroll-root"><main>{turns}</main></div>
</body></html>'''


def run_smoke(chrome, url, root_timeout_ms='4000'):
    env = os.environ.copy()
    env.update({
        'CSG_LIVE_SMOKE_TEST_MODE': '1',
        'CSG_LIVE_SMOKE_ROOT_TIMEOUT_MS': root_timeout_ms,
        'CSG_LIVE_CHAT_URL': url,
        'CHROME_BIN': chrome,
    })
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
    if not ARTIFACT.exists():
        raise AssertionError('live-site smoke did not produce diagnostics artifact')
    return proc, json.loads(ARTIFACT.read_text(encoding='utf-8'))


def assert_success(kind, proc, payload):
    if proc.returncode != 0:
        raise AssertionError(
            f'{kind} live-site smoke failed rc={proc.returncode}\n'
            f'STDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}'
        )
    assert not payload.get('fatalError'), payload
    assert not payload.get('failures'), payload
    core = payload.get('core') or {}
    recent = payload.get('recent') or {}
    assert core.get('contentReady') == '1', core
    assert recent.get('recentState') == 'ready', recent
    assert recent.get('recentMode') == 'per-chat', recent
    assert int(recent.get('hiddenOldTurns') or 0) + int(recent.get('foldedTurns') or 0) >= 1, recent
    assert int(recent.get('chatToggleCount') or 0) >= 1, recent
    assert recent.get('globalRecentUi') is False, recent


def main():
    chrome = shutil.which('google-chrome') or shutil.which('chromium') or shutil.which('chromium-browser')
    if not chrome:
        raise SystemExit('Chrome/Chromium not found')

    with tempfile.TemporaryDirectory(prefix='csg-live-smoke-fixture-') as tmp:
        root = Path(tmp)
        fixture_paths = {
            'legacy': root / 'share' / 'legacy' / 'index.html',
            'exchange': root / 'c' / 'exchange' / 'index.html',
            'unknown': root / 'share' / 'unknown' / 'index.html',
        }
        for kind, target in fixture_paths.items():
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(fixture_page(kind), encoding='utf-8')

        handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(root), **kwargs)
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            origin = f'http://127.0.0.1:{server.server_port}'
            fixture_urls = {
                'legacy': f'{origin}/share/legacy/',
                'exchange': f'{origin}/c/exchange/',
            }
            for kind, url in fixture_urls.items():
                proc, payload = run_smoke(chrome, url)
                assert_success(kind, proc, payload)
                recent = payload.get('recent') or {}
                if kind == 'legacy':
                    assert int(recent.get('legacyTurnCount') or 0) >= 4, recent
                else:
                    assert int(recent.get('exchangeTurnCount') or 0) >= 4, recent
                print(f'PASS live-site smoke {kind} fixture')

            proc, payload = run_smoke(chrome, f'{origin}/share/unknown/', root_timeout_ms='900')
            assert proc.returncode == 2, (proc.returncode, proc.stdout, proc.stderr, payload)
            assert payload.get('errorType') == 'compatibility', payload
            assert 'known conversation roots' in payload.get('fatalError', ''), payload
            print('PASS live-site smoke unknown-root drift is reportable compatibility failure')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == '__main__':
    main()
