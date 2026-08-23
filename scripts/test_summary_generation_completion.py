import html
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHROME = shutil.which('google-chrome') or shutil.which('chromium') or shutil.which('chromium-browser')
if not CHROME:
    raise SystemExit('Chrome/Chromium not found')

CONTENT_JS = (ROOT / 'content.js').read_text(encoding='utf-8').replace('</script', '<\\/script')
CONTENT_CSS = (ROOT / 'content.css').read_text(encoding='utf-8').replace('</style', '<\\/style')
SETTINGS = {
    'enabled': True, 'hideThinking': False, 'hideTools': False,
    'hideToolSummary': True, 'hideToolEmbeds': False, 'hideOldAppLoadErrors': False,
    'dimTraces': False, 'compactTraces': False, 'reduceMotion': False,
    'lazyHeavyBlocks': False, 'freezeOldTurns': False, 'showRecentOnly': False,
    'autoContinueIncomplete': False, 'showStatus': False,
}
PAGE = f'''<!doctype html><html><head><meta charset="utf-8"><style>
body{{font:16px sans-serif}} {CONTENT_CSS}
</style></head><body>
<div id="composer-host"><form><div id="prompt-textarea" contenteditable="true"></div><button id="stop" aria-label="Stop answering">Stop</button></form></div>
<section data-testid="conversation-turn-20" data-turn="assistant"><div class="agent-turn">
<span id="shell" class="group/tool-message"><span id="row" class="block my-1.5"><div role="button"><button id="list" aria-label="Open tool call list"><svg width="18" height="18"></svg></button><span>Called tool</span><svg width="16" height="16"></svg></div></span></span>
<div id="answer">answer</div></div></section>
<script>
const SETTINGS={json.dumps(SETTINGS)};
globalThis.chrome={{runtime:{{onMessage:{{addListener(){{}}}}}},storage:{{local:{{remove(){{}},get(def,cb){{if(Object.prototype.hasOwnProperty.call(def,'uiLanguage'))cb({{uiLanguage:'en'}});else cb({{settings:SETTINGS}});}}}}}}}};
{CONTENT_JS}
function snap(id){{const e=document.getElementById(id),r=e.getBoundingClientRect(),s=getComputedStyle(e);return{{w:r.width,h:r.height,pos:s.position,op:s.opacity,cls:[...e.classList]}}}}
setTimeout(()=>{{const sh=snap('shell'),row=snap('row');window.active={{shell:!sh.cls.includes('csg-tool-ui')&&sh.pos!=='absolute'&&sh.w>0&&sh.h>0,row:row.cls.includes('csg-tool-summary-live')&&row.op==='0'}}}},500);
setTimeout(()=>document.getElementById('stop').setAttribute('aria-label','Send message'),650);
setTimeout(()=>{{const sh=snap('shell'),row=snap('row'),li=snap('list');window.done={{stop:!document.querySelector('button[aria-label="Stop answering" i]'),shell:sh.cls.includes('csg-tool-ui')&&sh.pos==='absolute'&&sh.w===0&&sh.h===0,row:row.cls.includes('csg-tool-summary')&&!row.cls.includes('csg-tool-summary-live'),control:li.w===0&&li.h===0}};const out=document.createElement('pre');out.id='result';out.textContent=JSON.stringify({{active:window.active,done:window.done}});document.body.appendChild(out)}},1250);
</script></body></html>'''
def main():
    with tempfile.TemporaryDirectory(prefix='csg-summary-generation-') as tmp:
        target = Path(tmp) / 'index.html'
        target.write_text(PAGE, encoding='utf-8')
        proc = subprocess.run([
            CHROME, '--headless=new', '--no-sandbox', '--disable-gpu',
            '--virtual-time-budget=1700', '--dump-dom', target.as_uri(),
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=20)
    match = re.search(r'<pre id="result"[^>]*>(.*?)</pre>', proc.stdout, re.S)
    if not match:
        raise AssertionError(f'no result\n{proc.stderr[-1500:]}')
    payload = json.loads(html.unescape(match.group(1)))
    failures = {
        phase: {key: value for key, value in checks.items() if value is not True}
        for phase, checks in payload.items()
    }
    failures = {phase: checks for phase, checks in failures.items() if checks}
    if failures:
        raise AssertionError(f'summary-only generation failures: {failures}\npayload={json.dumps(payload, indent=2)}')
    print('PASS summary-generation: composer-local observer detects aria-label-only generation completion')

if __name__ == '__main__':
    main()
