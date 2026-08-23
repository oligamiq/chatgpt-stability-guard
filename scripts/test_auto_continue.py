#!/usr/bin/env python3
import html
import json
import re
import shutil
import subprocess
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHROME = shutil.which('google-chrome') or shutil.which('chromium')
CONTENT_JS = (ROOT / 'content.js').read_text(encoding='utf-8').replace('</script', '<\\/script')

if not CHROME:
    raise SystemExit('Chrome/Chromium not found')


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def serve(page, budget=3200):
    with tempfile.TemporaryDirectory(prefix='csg-auto-continue-') as tmp:
        root = Path(tmp)
        (root / 'index.html').write_text(page, encoding='utf-8')
        handler = partial(QuietHandler, directory=str(root))
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            proc = subprocess.run(
                [CHROME, '--headless=new', '--no-sandbox', '--disable-gpu',
                 f'--virtual-time-budget={budget}', '--dump-dom',
                 f'http://127.0.0.1:{server.server_port}/'],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=25,
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
    match = re.search(r'<pre id="csg-test-result"[^>]*>(.*?)</pre>', proc.stdout, re.S)
    if not match:
        raise AssertionError(f'no test result\n{proc.stderr[-1200:]}\n{proc.stdout[-3000:]}')
    return json.loads(html.unescape(match.group(1)))


def page(settings, *, response='返答は未完成です', draft='', stop=False, mutate_after_send=False, send_stays_disabled=False):
    settings_json = json.dumps(settings, ensure_ascii=False)
    stop_html = '<button data-testid="stop-button">Stop</button>' if stop else ''
    draft_html = html.escape(draft)
    composer_html = f'<p>{draft_html}</p>' if draft else '<p><br></p>'
    mutation_script = "setTimeout(()=>document.querySelector('.markdown').append(' !'),1700);" if mutate_after_send else ''
    send_stuck = str(send_stays_disabled).lower()
    return f'''<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>window.__testSettings={settings_json};window.__sent=[];window.__whileStopped=-1;window.__inputCount=0;window.__focusCount=0;</script>
<script>
window.chrome={{
  runtime:{{onMessage:{{addListener(){{}}}}}},
  storage:{{local:{{
    remove(){{}},
    get(defaults,cb){{
      if(Object.prototype.hasOwnProperty.call(defaults,'uiLanguage')) cb(Object.assign({{}},defaults,{{uiLanguage:'ja'}}));
      else cb(Object.assign({{}},defaults,{{settings:Object.assign({{}},defaults.settings,window.__testSettings)}}));
    }}
  }}}}
}};
</script>
<section data-testid="conversation-turn-1" data-message-author-role="assistant">
  <div class="agent-turn"><div class="markdown">{html.escape(response)}</div></div>
</section>
{stop_html}
<form id="composer-form">
  <div id="prompt-textarea" contenteditable="true">{composer_html}</div>
  <button type="button" data-testid="send-button" {'disabled' if not draft else ''}>Send</button>
</form>
<script>
const composer=document.getElementById('prompt-textarea');
const send=document.querySelector('[data-testid="send-button"]');
const nativeFocus=composer.focus.bind(composer);
composer.focus=()=>{{window.__focusCount+=1;nativeFocus();}};
composer.addEventListener('input',()=>{{window.__inputCount+=1;send.disabled={send_stuck}||!composer.innerText.trim();}});
send.addEventListener('click',()=>{{window.__sent.push(composer.innerText.trim());composer.textContent='';send.disabled=true;}});
</script>
<script>{CONTENT_JS}</script>
<script>
if({str(stop).lower()}){{
  setTimeout(()=>{{window.__whileStopped=window.__sent.length;document.querySelector('[data-testid="stop-button"]').remove();}},1250);
}}
{mutation_script}
setTimeout(()=>{{
  const out=document.createElement('pre');out.id='csg-test-result';
  out.textContent=JSON.stringify({{
    sent:window.__sent,
    whileStopped:window.__whileStopped,
    inputCount:window.__inputCount,
    focusCount:window.__focusCount,
    draft:composer.innerText.trim(),
    composerHtml:composer.innerHTML,
    autoContinues:document.documentElement.dataset.csgContentReady||''
  }});
  document.body.appendChild(out);
}},2900);
</script></body></html>'''


def enabled_settings():
    return {
        'enabled': True,
        'autoContinueIncomplete': True,
        'hideThinking': False,
        'hideTools': False,
        'hideToolSummary': False,
        'hideToolEmbeds': False,
        'hideOldAppLoadErrors': False,
        'dimTraces': False,
        'compactTraces': False,
        'reduceMotion': False,
        'lazyHeavyBlocks': False,
        'freezeOldTurns': False,
        'showRecentOnly': False,
        'showStatus': False,
    }


def test_default_off():
    result = serve(page({'enabled': True, 'autoContinueIncomplete': False}))
    assert result['sent'] == [], result
    print('PASS auto-continue-default-off')


def test_marker_sends_once():
    result = serve(page(enabled_settings(), mutate_after_send=True))
    assert result['sent'] == ['Continue'], result
    assert result['draft'] == '', result
    print('PASS auto-continue-marker-sends-once')


def test_non_marker_ignored():
    result = serve(page(enabled_settings(), response='正常に完了した返答です'))
    assert result['sent'] == [], result
    print('PASS auto-continue-non-marker-ignored')


def test_user_draft_preserved():
    result = serve(page(enabled_settings(), draft='my draft'))
    assert result['sent'] == [], result
    assert result['draft'] == 'my draft', result
    print('PASS auto-continue-user-draft-preserved')


def test_waits_for_generation_stop():
    result = serve(page(enabled_settings(), stop=True), budget=3600)
    assert result['whileStopped'] == 0, result
    assert result['sent'] == ['Continue'], result
    print('PASS auto-continue-waits-for-generation-stop')


def test_custom_glob():
    settings = enabled_settings() | {'autoContinuePatternMode': 'glob', 'autoContinuePattern': '*途中?です*'}
    result = serve(page(settings, response='これは途中Aです。'))
    assert result['sent'] == ['Continue'], result
    print('PASS auto-continue-custom-glob')


def test_custom_regex():
    settings = enabled_settings() | {'autoContinuePatternMode': 'regex', 'autoContinuePattern': '(未完|途中).{0,4}です'}
    result = serve(page(settings, response='これは途中の状態です'))
    assert result['sent'] == ['Continue'], result
    print('PASS auto-continue-custom-regex')


def test_send_failure_is_single_shot():
    result = serve(page(enabled_settings(), send_stays_disabled=True), budget=3600)
    assert result['sent'] == [], result
    assert result['draft'] == '', result
    assert result['focusCount'] == 1, result
    assert '<p' in result['composerHtml'].lower(), result
    assert 'Continue' not in result['composerHtml'], result
    print('PASS auto-continue-send-failure-single-shot')


def test_invalid_regex_fails_open():
    settings = enabled_settings() | {'autoContinuePatternMode': 'regex', 'autoContinuePattern': '([unterminated'}
    result = serve(page(settings, response='未完成です'))
    assert result['sent'] == [], result
    print('PASS auto-continue-invalid-regex-fails-open')


def main():
    test_default_off()
    test_marker_sends_once()
    test_non_marker_ignored()
    test_user_draft_preserved()
    test_waits_for_generation_stop()
    test_custom_glob()
    test_custom_regex()
    test_send_failure_is_single_shot()
    test_invalid_regex_fails_open()
    print('AUTO CONTINUE TESTS OK')


if __name__ == '__main__':
    main()
