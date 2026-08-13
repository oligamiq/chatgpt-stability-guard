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
PREHIDE_JS = (ROOT / 'prehide.js').read_text(encoding='utf-8').replace('</script', '<\\/script')
RECENT_JS = (ROOT / 'recent-window.js').read_text(encoding='utf-8').replace(
    'const state = {', 'const state = window.__csgRecentTestState = {', 1
).replace('</script', '<\\/script')
RECENT_JS_FAST_WATCHDOG = RECENT_JS.replace('const LOADING_WATCHDOG_MS = 60000;', 'const LOADING_WATCHDOG_MS = 350;', 1)

if not CHROME:
    raise SystemExit('Chrome/Chromium not found')


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def chrome_stub(n=3):
    return f'''<script>
window.chrome={{storage:{{local:{{get(defaults,cb){{
  if(Object.prototype.hasOwnProperty.call(defaults,'privacyConsent')){{
    const value={{privacyConsent:true,privacyConsentVersion:1}};
    if(Object.prototype.hasOwnProperty.call(defaults,'settings')){{
      value.settings={{enabled:true,showRecentOnly:true,recentExchanges:{n},prehideToolPlaceholders:false}};
    }}
    cb(value);
  }} else {{
    cb({{settings:{{enabled:true,showRecentOnly:true,recentExchanges:{n},prehideToolPlaceholders:false}}}});
  }}
}}}}}}}};
</script>'''


def serve_page(route, page, delay=1200):
    with tempfile.TemporaryDirectory(prefix='csg-loading-') as tmp:
        root = Path(tmp)
        target = root / route.strip('/') / 'index.html' if route != '/' else root / 'index.html'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(page, encoding='utf-8')
        handler = partial(QuietHandler, directory=str(root))
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}{route}'
        try:
            proc = subprocess.run(
                [CHROME, '--headless=new', '--no-sandbox', '--disable-gpu',
                 f'--virtual-time-budget={delay + 700}', '--dump-dom', url],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=25,
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
    match = re.search(r'<pre id="csg-test-result"[^>]*>(.*?)</pre>', proc.stdout, re.S)
    if not match:
        raise AssertionError(f'no result for {route}\n{proc.stderr[-1500:]}\n{proc.stdout[-3500:]}')
    return json.loads(html.unescape(match.group(1)))


def test_prehide_early_loader():
    page = f'''<!doctype html><html><head>{chrome_stub(3)}<script>{PREHIDE_JS}</script></head><body>
<script>setTimeout(()=>{{
 const el=document.getElementById('csg-recent-loading');
 const out=document.createElement('pre');out.id='csg-test-result';
 out.textContent=JSON.stringify({{exists:!!el,stage:el?.dataset.stage,total:el?.dataset.total,confirmed:el?.dataset.confirmed}});
 document.body.appendChild(out);
}},120);</script></body></html>'''
    result = serve_page('/c/early/', page, 350)
    assert result == {'exists': True, 'stage': 'detecting', 'total': '3', 'confirmed': '0'}, result

    root_page = f'''<!doctype html><html><head>{chrome_stub(3)}<script>{PREHIDE_JS}</script></head><body>
<script>setTimeout(()=>{{const out=document.createElement('pre');out.id='csg-test-result';out.textContent=JSON.stringify({{exists:!!document.getElementById('csg-recent-loading')}});document.body.appendChild(out);}},120);</script>
</body></html>'''
    root_result = serve_page('/', root_page, 350)
    assert root_result == {'exists': False}, root_result
    print('PASS prehide-early-recent-loader')


def test_recent_loader_handoff():
    turns = ''.join([
        '<section data-testid="conversation-turn-0" data-turn="user">u0</section>',
        '<section data-testid="conversation-turn-1" data-turn="assistant"><div class="markdown">a1</div></section>',
        '<section data-testid="conversation-turn-2" data-turn="user">u2</section>',
        '<section data-testid="conversation-turn-3" data-turn="assistant"><div class="markdown">a3</div></section>',
        '<section data-testid="conversation-turn-4" data-turn="user">u4</section>',
        '<section data-testid="conversation-turn-5" data-turn="assistant"><div class="markdown">a5</div></section>',
    ])
    trace = '''<script>
window.__loadingTrace=[]; window.__loadingMax=0; window.__loadingMaxNodes=0;
function sampleLoading(){
 const all=[...document.querySelectorAll('#csg-recent-loading')];
 window.__loadingMaxNodes=Math.max(window.__loadingMaxNodes,all.length);
 const el=all[0]; if(!el)return;
 const confirmed=Number(el.dataset.confirmed||0);
 window.__loadingMax=Math.max(window.__loadingMax,confirmed);
 window.__loadingTrace.push({stage:el.dataset.stage||'',confirmed});
}
new MutationObserver(sampleLoading).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-stage','data-confirmed','class']});
sampleLoading();
</script>'''
    page = f'''<!doctype html><html><head><style>html,body{{height:100%;margin:0}}.group\\/scroll-root{{height:320px;overflow-y:auto}}section{{min-height:150px;display:block}}</style>
{chrome_stub(3)}<script>{PREHIDE_JS}</script></head><body>{trace}
<div class="group/scroll-root"><div>{turns}</div></div>
<script>{RECENT_JS}</script>
<script>setTimeout(()=>{{
 const out=document.createElement('pre');out.id='csg-test-result';
 out.textContent=JSON.stringify({{state:document.documentElement.dataset.csgRecentState||'',loaderExists:!!document.getElementById('csg-recent-loading'),maxConfirmed:window.__loadingMax,maxNodes:window.__loadingMaxNodes,stages:[...new Set(window.__loadingTrace.map(x=>x.stage))]}});
 document.body.appendChild(out);
}},4300);</script></body></html>'''
    result = serve_page('/c/handoff/', page, 4700)
    assert result['state'] == 'ready', result
    assert result['loaderExists'] is False, result
    assert result['maxConfirmed'] >= 3, result
    assert result['maxNodes'] == 1, result
    assert 'detecting' in result['stages'], result
    assert 'finalizing' in result['stages'], result
    assert 'ready' in result['stages'], result
    print('PASS recent-loader-progress-and-removal')


def test_recent_loader_watchdog_fails_open():
    page = f'''<!doctype html><html><head>{chrome_stub(3)}<script>{PREHIDE_JS}</script></head><body>
<div class="group/scroll-root"></div>
<script>{RECENT_JS_FAST_WATCHDOG}</script>
<script>setTimeout(()=>{{
 const out=document.createElement('pre');out.id='csg-test-result';
 out.textContent=JSON.stringify({{state:document.documentElement.dataset.csgRecentState||'',loaderExists:!!document.getElementById('csg-recent-loading'),suspended:window.__csgRecentTestState?.suspended||false}});
 document.body.appendChild(out);
}},1100);</script></body></html>'''
    result = serve_page('/c/watchdog/', page, 1400)
    assert result == {'state': 'degraded', 'loaderExists': False, 'suspended': True}, result
    print('PASS recent-loader-watchdog-fails-open')


def main():
    test_prehide_early_loader()
    test_recent_loader_handoff()
    test_recent_loader_watchdog_fails_open()
    print('LOADING INDICATOR TESTS OK')


if __name__ == '__main__':
    main()
