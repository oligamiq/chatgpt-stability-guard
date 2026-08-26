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
<section data-testid="conversation-turn-20" data-turn="assistant"><div id="agent" class="agent-turn" style="display:flex;flex-direction:column;gap:16px;width:768px"><div id="answer">answer</div></div></section>
<script>
const SETTINGS={json.dumps(SETTINGS)};
globalThis.chrome={{runtime:{{onMessage:{{addListener(){{}}}}}},storage:{{local:{{remove(){{}},get(def,cb){{if(Object.prototype.hasOwnProperty.call(def,'uiLanguage'))cb({{uiLanguage:'en'}});else cb({{settings:SETTINGS}});}}}}}}}};
{CONTENT_JS}
function snap(id){{const e=document.getElementById(id),r=e.getBoundingClientRect(),s=getComputedStyle(e);return{{w:r.width,h:r.height,pos:s.position,op:s.opacity,cls:[...e.classList]}}}}
function structuralZero(id){{const s=snap(id);return s.pos==='absolute'&&s.w===0&&s.h===0}}
function zeroShell(id){{const s=snap(id);return s.cls.includes('csg-tool-ui')&&structuralZero(id)}}
function liveOffFlowShell(id){{const s=snap(id);return s.cls.includes('csg-tool-ui')&&s.pos==='absolute'&&s.w>100&&s.h>0}}
function makeToolShell(i){{const sh=document.createElement('span');sh.id=`shell-${{i}}`;sh.className='group/tool-message';const row=document.createElement('span');row.id=`row-${{i}}`;row.className='block my-1.5';const group=document.createElement('div');group.className='group';const outer=document.createElement('button');outer.className='inline-block';const flex=document.createElement('div');flex.className='flex';const list=document.createElement('button');list.id=`list-${{i}}`;list.type='button';list.setAttribute('aria-label','Open tool call list');list.dataset.state='closed';const listIcon=document.createElementNS('http://www.w3.org/2000/svg','svg');listIcon.setAttribute('width','18');listIcon.setAttribute('height','18');list.appendChild(listIcon);const label=document.createElement('span');label.textContent='Called tool';const chevron=document.createElementNS('http://www.w3.org/2000/svg','svg');chevron.setAttribute('width','16');chevron.setAttribute('height','16');flex.append(list,label,chevron);outer.appendChild(flex);group.appendChild(outer);row.appendChild(group);sh.appendChild(row);return sh}}
setTimeout(()=>{{const agent=document.getElementById('agent'),answer=document.getElementById('answer');for(let i=0;i<16;i++)agent.insertBefore(makeToolShell(i),answer)}},100);
setTimeout(()=>{{const rows=[...Array(16)].map((_,i)=>snap(`row-${{i}}`));window.active={{allShellsOffFlow:[...Array(16)].every((_,i)=>liveOffFlowShell(`shell-${{i}}`)),allRowsLive:rows.every(r=>r.cls.includes('csg-tool-summary-live')&&r.op==='0'),compact:document.getElementById('agent').getBoundingClientRect().height<100}}}},1000);
setTimeout(()=>{{const stale=document.createElement('span');stale.id='stale-marker';stale.className='csg-tool-summary-live';document.getElementById('row-0').appendChild(stale)}},1050);
setTimeout(()=>{{const stale=document.getElementById('stale-marker');window.clearRace={{staleRemainsMounted:stale.isConnected,shellStillOwned:liveOffFlowShell('shell-0')}};stale.remove()}},1100);
setTimeout(()=>{{const loader=document.createElement('div');loader.id='loader';loader.className='no-scrollbar';loader.setAttribute('role','progressbar');loader.style.cssText='width:320px;height:80px';loader.textContent='Loading app template';document.getElementById('row-0').appendChild(loader);const sh=snap('shell-0');window.appMountSync={{shellMeasurableBeforeObserver:sh.cls.includes('csg-tool-ui')&&sh.pos==='absolute'&&sh.w>100&&sh.h>=80}}}},1150);
setTimeout(()=>{{const sh=snap('shell-0'),loader=snap('loader');window.appGrow={{shellFailsOpen:!sh.cls.includes('csg-tool-ui')&&sh.pos!=='absolute'&&sh.w>0&&sh.h>0,loaderVisible:loader.w===320&&loader.h===80&&loader.op==='1',othersStayOffFlow:[...Array(15)].every((_,i)=>liveOffFlowShell(`shell-${{i+1}}`))}};document.getElementById('loader').remove()}},1200);
setTimeout(()=>{{const retry=document.createElement('button');retry.id='nested-retry';retry.textContent='Retry';document.getElementById('row-0').appendChild(retry)}},1250);
setTimeout(()=>{{const sh=snap('shell-0'),retry=snap('nested-retry');window.nestedAction={{shellFailsOpen:sh.pos!=='absolute'&&sh.w>0&&sh.h>0,retryVisible:retry.w>0&&retry.h>0&&retry.op==='1'}};document.getElementById('nested-retry').remove()}},1300);
setTimeout(()=>{{const rows=[...Array(16)].map((_,i)=>snap(`row-${{i}}`));window.activeLate={{generationStillActive:!!document.querySelector('button[aria-label="Stop answering" i]'),allShellsOffFlow:[...Array(16)].every((_,i)=>liveOffFlowShell(`shell-${{i}}`)),allRowsLive:rows.every(r=>r.cls.includes('csg-tool-summary-live')&&r.op==='0'),compact:document.getElementById('agent').getBoundingClientRect().height<100}}}},2100);
setTimeout(()=>document.getElementById('stop').setAttribute('aria-label','Send message'),2400);
setTimeout(()=>{{const rows=[...Array(16)].map((_,i)=>snap(`row-${{i}}`));window.done={{stop:!document.querySelector('button[aria-label="Stop answering" i]'),allShellsOffFlow:[...Array(16)].every((_,i)=>zeroShell(`shell-${{i}}`)),allRowsHistorical:rows.every(r=>r.cls.includes('csg-tool-summary')&&!r.cls.includes('csg-tool-summary-live'))}};const out=document.createElement('pre');out.id='result';out.textContent=JSON.stringify({{active:window.active,activeLate:window.activeLate,clearRace:window.clearRace,appMountSync:window.appMountSync,appGrow:window.appGrow,nestedAction:window.nestedAction,done:window.done}});document.body.appendChild(out)}},3200);
</script></body></html>'''
def main():
    with tempfile.TemporaryDirectory(prefix='csg-summary-generation-') as tmp:
        target = Path(tmp) / 'index.html'
        target.write_text(PAGE, encoding='utf-8')
        proc = subprocess.run([
            CHROME, '--headless=new', '--no-sandbox', '--disable-gpu',
            '--virtual-time-budget=3600', '--dump-dom', target.as_uri(),
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
