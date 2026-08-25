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
PREHIDE_CSS = (ROOT / 'prehide.css').read_text(encoding='utf-8').replace('</style', '<\\/style')
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
  cb(Object.assign({{}},defaults,{{
    uiLanguage:'en',
    settings:{{enabled:true,showRecentOnly:true,recentExchanges:{n},prehideToolPlaceholders:false}}
  }}));
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

    group_result = serve_page('/g/example/c/early/', page, 350)
    assert group_result == {'exists': True, 'stage': 'detecting', 'total': '3', 'confirmed': '0'}, group_result
    print('PASS prehide-early-recent-loader')


def test_prehide_folds_old_turns_without_zero_height():
    turns = ''.join([
        '<section data-testid="conversation-turn-0" data-turn="user">u0</section>',
        '<section data-testid="conversation-turn-1" data-turn="assistant">a1</section>',
        '<section data-testid="conversation-turn-2" data-turn="user">u2</section>',
        '<section data-testid="conversation-turn-3" data-turn="assistant">a3</section>',
        '<section data-testid="conversation-turn-4" data-turn="user">u4</section>',
        '<section data-testid="conversation-turn-5" data-turn="assistant">a5</section>',
        '<section data-testid="conversation-turn-6" data-turn="user">u6</section>',
        '<section data-testid="conversation-turn-7" data-turn="assistant">a7</section>',
    ])
    page = f'''<!doctype html><html><head><style>{PREHIDE_CSS}</style>{chrome_stub(2)}<script>{PREHIDE_JS}</script></head><body>{turns}
<script>setTimeout(()=>{{
 const old=document.querySelector('[data-testid="conversation-turn-0"]');
 const recent=document.querySelector('[data-testid="conversation-turn-4"]');
 const style=getComputedStyle(old);
 const out=document.createElement('pre');out.id='csg-test-result';
 out.textContent=JSON.stringify({{
   rootFast:document.documentElement.classList.contains('csg-prehide-recent-fast'),
   oldMarked:old?.hasAttribute('data-csg-prehide-old-turn')||false,
   recentMarked:recent?.hasAttribute('data-csg-prehide-old-turn')||false,
   contentVisibility:style.contentVisibility,
   display:style.display
 }});document.body.appendChild(out);
}},160);</script></body></html>'''
    result = serve_page('/c/prehide-fold/', page, 420)
    assert result['rootFast'] is True, result
    assert result['oldMarked'] is True and result['recentMarked'] is False, result
    assert result['contentVisibility'] == 'hidden', result
    assert result['display'] != 'none', result
    print('PASS prehide-old-turn-render-skip-without-zero-height')


def test_prehide_ignores_streaming_inner_mutations():
    turns = ''.join([
        '<section id="old" data-testid="conversation-turn-0" data-turn="user">u0</section>',
        '<section data-testid="conversation-turn-1" data-turn="assistant">a1</section>',
        '<section data-testid="conversation-turn-2" data-turn="user">u2</section>',
        '<section data-testid="conversation-turn-3" data-turn="assistant">a3</section>',
        '<section data-testid="conversation-turn-4" data-turn="user">u4</section>',
        '<section id="latest" data-testid="conversation-turn-5" data-turn="assistant">a5</section>',
    ])
    probe = '''<script>
window.__turnQueries=0;
const __qsa=document.querySelectorAll.bind(document);
document.querySelectorAll=function(selector){
 if(selector==='[data-testid^="conversation-turn-"]') window.__turnQueries+=1;
 return __qsa(selector);
};
</script>'''
    page = f'''<!doctype html><html><head>{chrome_stub(2)}{probe}<script>{PREHIDE_JS}</script></head><body>{turns}
<script>setTimeout(()=>{{
 const before=window.__turnQueries;
 const latest=document.getElementById('latest');
 for(let i=0;i<80;i++){{const span=document.createElement('span');span.textContent='x';latest.appendChild(span);}}
 setTimeout(()=>{{const out=document.createElement('pre');out.id='csg-test-result';out.textContent=JSON.stringify({{before,after:window.__turnQueries}});document.body.appendChild(out);}},120);
}},180);</script></body></html>'''
    result = serve_page('/c/prehide-streaming/', page, 520)
    assert result['after'] == result['before'], result
    print('PASS prehide-streaming-inner-mutations-do-not-rescan-turns')


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
 out.textContent=JSON.stringify({{state:document.documentElement.dataset.csgRecentState||'',loaderExists:!!document.getElementById('csg-recent-loading'),maxConfirmed:window.__loadingMax,maxNodes:window.__loadingMaxNodes,stages:[...new Set(window.__loadingTrace.map(x=>x.stage))],prehideMarks:document.querySelectorAll('[data-csg-prehide-old-turn]').length,prehideRoot:document.documentElement.classList.contains('csg-prehide-recent-fast')}});
 document.body.appendChild(out);
}},4300);</script></body></html>'''
    result = serve_page('/c/handoff/', page, 4700)
    assert result['state'] == 'ready', result
    assert result['loaderExists'] is False, result
    assert result['maxConfirmed'] >= 3, result
    assert result['maxNodes'] == 1, result
    assert 'detecting' in result['stages'], result
    assert 'latest' in result['stages'], result
    assert 'ready' in result['stages'], result
    assert result['prehideMarks'] == 0 and result['prehideRoot'] is False, result
    print('PASS recent-loader-progress-and-removal')


def test_short_history_uses_real_target():
    turns = ''.join([
        '<section data-testid="conversation-turn-0" data-turn="user">u0</section>',
        '<section data-testid="conversation-turn-1" data-turn="assistant"><div class="markdown">a1</div></section>',
        '<section data-testid="conversation-turn-2" data-turn="user">u2</section>',
        '<section data-testid="conversation-turn-3" data-turn="assistant"><div class="markdown">a3</div></section>',
    ])
    page = f'''<!doctype html><html><head><style>.group\\/scroll-root{{height:320px;overflow-y:auto}}section{{min-height:80px}}</style>
{chrome_stub(3)}<script>{PREHIDE_JS}</script></head><body><div class="group/scroll-root">{turns}</div>
<script>{RECENT_JS}</script><script>setTimeout(()=>{{const el=document.getElementById('csg-recent-loading');const out=document.createElement('pre');out.id='csg-test-result';out.textContent=JSON.stringify({{state:document.documentElement.dataset.csgRecentState||'',stage:el?.dataset.stage||'',confirmed:el?.dataset.confirmed||'',target:el?.dataset.target||'',startKnown:el?.dataset.historyStartKnown||'',detail:el?.querySelector('.csg-recent-loading-detail')?.textContent||''}});document.body.appendChild(out);}},420);</script></body></html>'''
    result = serve_page('/c/short/', page, 700)
    assert result['state'] == 'ready', result
    assert result['stage'] == 'ready', result
    assert result['confirmed'] == '2' and result['target'] == '2', result
    assert result['startKnown'] == 'true', result
    assert 'all history' in result['detail'], result
    print('PASS short-history-loading-target-is-exact')


def test_share_provisional_boundary_is_not_overclaimed():
    turns = ''.join([
        '<section data-testid="conversation-turn-40" data-turn="assistant"></section>',
        '<section data-testid="conversation-turn-41" data-turn="user">Continue</section>',
        '<section data-testid="conversation-turn-42" data-turn="assistant"><div class="markdown">continued</div></section>',
        '<section data-testid="conversation-turn-43" data-turn="user">new request</section>',
        '<section data-testid="conversation-turn-44" data-turn="assistant"><div class="markdown">latest</div></section>',
    ])
    page = f'''<!doctype html><html><head><style>.group\\/scroll-root{{height:320px;overflow-y:auto}}section{{min-height:80px}}</style>
{chrome_stub(2)}<script>{PREHIDE_JS}</script></head><body><div class="group/scroll-root">{turns}</div>
<script>{RECENT_JS}</script><script>setTimeout(()=>{{const el=document.getElementById('csg-recent-loading');const out=document.createElement('pre');out.id='csg-test-result';out.textContent=JSON.stringify({{state:document.documentElement.dataset.csgRecentState||'',stage:el?.dataset.stage||'',confirmed:el?.dataset.confirmed||'',target:el?.dataset.target||'',startKnown:el?.dataset.historyStartKnown||'',detail:el?.querySelector('.csg-recent-loading-detail')?.textContent||''}});document.body.appendChild(out);}},420);</script></body></html>'''
    result = serve_page('/share/provisional/', page, 700)
    assert result['state'] == 'ready', result
    assert result['stage'] == 'ready', result
    assert result['confirmed'] == '1' and result['target'] == '2', result
    assert result['startKnown'] == 'false', result
    assert 'verification is continuing' in result['detail'], result
    print('PASS share-provisional-boundary-not-overclaimed')


def test_virtualized_streaming_tail_does_not_hold_loader_open():
    turns = ''.join([
        '<section data-testid="conversation-turn-80" data-turn="user">u80</section>',
        '<section data-testid="conversation-turn-81" data-turn="assistant"><div class="markdown">a81</div></section>',
        '<section data-testid="conversation-turn-82" data-turn="user">u82</section>',
        '<section id="streaming" data-testid="conversation-turn-83" data-turn="assistant"><div class="markdown">a83</div></section>',
    ])
    page = f'''<!doctype html><html><head><style>.group\\/scroll-root{{height:320px;overflow-y:auto}}section{{min-height:80px}}</style>
{chrome_stub(3)}<script>{PREHIDE_JS}</script></head><body><div class="group/scroll-root">{turns}</div>
<button data-testid="stop-button">Stop</button><script>{RECENT_JS_FAST_WATCHDOG}</script><script>
let ticks=0;const stream=setInterval(()=>{{const el=document.querySelector('#streaming .markdown');if(el)el.append(document.createTextNode(' x'));if(++ticks>=20)clearInterval(stream);}},40);
setTimeout(()=>{{const out=document.createElement('pre');out.id='csg-test-result';out.textContent=JSON.stringify({{
 state:document.documentElement.dataset.csgRecentState||'',
 loaderExists:!!document.getElementById('csg-recent-loading'),
 loadingUiFinished:window.__csgRecentTestState?.loadingUiFinished||false,
 ready:window.__csgRecentTestState?.ready||false,
 suspended:window.__csgRecentTestState?.suspended||false,
 initialFinalized:window.__csgRecentTestState?.initialFinalized||false
}});document.body.appendChild(out);}},1250);</script></body></html>'''
    result = serve_page('/c/virtualized-streaming/', page, 1550)
    assert result['state'] == 'preparing', result
    assert result['loaderExists'] is False, result
    assert result['loadingUiFinished'] is True, result
    assert result['suspended'] is False, result
    assert result['ready'] is False and result['initialFinalized'] is False, result
    print('PASS virtualized-streaming-tail-does-not-hold-loader-open')


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
    test_prehide_folds_old_turns_without_zero_height()
    test_prehide_ignores_streaming_inner_mutations()
    test_recent_loader_handoff()
    test_short_history_uses_real_target()
    test_share_provisional_boundary_is_not_overclaimed()
    test_virtualized_streaming_tail_does_not_hold_loader_open()
    test_recent_loader_watchdog_fails_open()
    print('LOADING INDICATOR TESTS OK')


if __name__ == '__main__':
    main()
