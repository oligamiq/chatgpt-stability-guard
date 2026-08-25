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
CONTENT_JS = (ROOT / 'content.js').read_text(encoding='utf-8').replace('const state = {', 'const state = window.__csgContentTestState = {', 1).replace('</script', '<\\/script')
if not CHROME:
    raise SystemExit('Chrome/Chromium not found')

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

settings = {
    'enabled': True, 'hideThinking': True, 'hideTools': True,
    'hideToolSummary': False, 'hideToolEmbeds': False,
    'prehideToolPlaceholders': False, 'hideOldAppLoadErrors': False,
    'dimTraces': False, 'compactTraces': False, 'reduceMotion': False,
    'lazyHeavyBlocks': False, 'freezeOldTurns': False,
    'showRecentOnly': True, 'recentExchanges': 1,
    'autoContinueIncomplete': False, 'showStatus': False,
}
template = r'''<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="thread">
<section id="old" data-testid="conversation-turn-0" data-turn="assistant" data-csg-prehide-old-turn>
  <div id="old-tool" data-testid="tool-call"><div>Tool trace</div><div>old body</div></div>
</section>
<section id="recent" data-testid="conversation-turn-1" data-turn="assistant">
  <div id="recent-tool" data-testid="tool-call"><div>Tool trace</div><div>recent body</div></div>
</section>
</div>
<script>
window.__turnQueries=0;
const nativeDocumentQsa=document.querySelectorAll.bind(document);
document.querySelectorAll=function(selector){ if(selector==='[data-testid^=\"conversation-turn-\"]') window.__turnQueries+=1; return nativeDocumentQsa(selector); };
const old=document.getElementById('old');
window.__oldQueries=0;
const oldQsa=old.querySelectorAll.bind(old);
old.querySelectorAll=function(selector){ window.__oldQueries+=1; return oldQsa(selector); };
const SETTINGS=__SETTINGS__;
window.chrome={
  runtime:{onMessage:{addListener:function(){}}},
  storage:{local:{
    remove:function(){},
    get:function(defaults,cb){ cb(Object.assign({},defaults,{uiLanguage:'en',settings:SETTINGS})); }
  }}
};
</script>
<script>__CONTENT_JS__</script>
<script>
setTimeout(()=>{
  const initial={
    oldQueries:window.__oldQueries,
    oldTool:document.getElementById('old-tool').classList.contains('csg-tool'),
    recentTool:document.getElementById('recent-tool').classList.contains('csg-tool'),
    turnQueries:window.__turnQueries,
    observerRoot:window.__csgContentTestState?.mainObserverRoot?.id||''
  };
  old.removeAttribute('data-csg-prehide-old-turn');
  old.dispatchEvent(new CustomEvent('csg:recent-turn-visibility',{bubbles:true,detail:{suppressed:false}}));
  document.getElementById('thread').insertAdjacentHTML('beforeend','<section data-testid=\"conversation-turn-2\" data-turn=\"assistant\"><div id=\"dynamic-tool\" data-testid=\"tool-call\"><div>Tool trace</div><div>dynamic body</div></div></section>');
  setTimeout(()=>{
    const out=document.createElement('pre'); out.id='result';
    out.textContent=JSON.stringify({
      initial,
      afterQueries:window.__oldQueries,
      afterTool:document.getElementById('old-tool').classList.contains('csg-tool'),
      turnQueries:window.__turnQueries,
      dynamicTool:document.getElementById('dynamic-tool').classList.contains('csg-tool')
    });
    document.body.appendChild(out);
  },900);
},900);
</script></body></html>'''
page = template.replace('__SETTINGS__', json.dumps(settings)).replace('__CONTENT_JS__', CONTENT_JS)

with tempfile.TemporaryDirectory(prefix='csg-recent-skip-') as tmp:
    root=Path(tmp); (root/'index.html').write_text(page,encoding='utf-8')
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(root)))
    thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
    try:
        proc=subprocess.run([CHROME,'--headless=new','--no-sandbox','--disable-gpu','--virtual-time-budget=2800','--dump-dom',f'http://127.0.0.1:{server.server_port}/'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=25)
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=2)
match=re.search(r'<pre id="result"[^>]*>(.*?)</pre>',proc.stdout,re.S)
if not match:
    raise AssertionError(f'no result\n{proc.stderr[-1500:]}\n{proc.stdout[-4000:]}')
result=json.loads(html.unescape(match.group(1)))
assert result['initial']['oldQueries'] == 0, result
assert result['initial']['oldTool'] is False, result
assert result['initial']['recentTool'] is True, result
assert result['initial']['turnQueries'] == 1 and result['turnQueries'] == 1, result
assert result['initial']['observerRoot'] == 'thread', result
assert result['afterQueries'] > 0 and result['afterTool'] is True, result
assert result['dynamicTool'] is True, result
print('PASS recent-old-turn-analysis-skip-and-expand-resume')
