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
PREHIDE_CSS = (ROOT / 'prehide.css').read_text(encoding='utf-8').replace('</style', '<\\/style')
SETTINGS = {
    'enabled': True, 'hideThinking': False, 'hideTools': False,
    'hideToolSummary': True, 'hideToolEmbeds': False, 'hideOldAppLoadErrors': False,
    'dimTraces': False, 'compactTraces': False, 'reduceMotion': False,
    'lazyHeavyBlocks': False, 'freezeOldTurns': False, 'showRecentOnly': False,
    'autoContinueIncomplete': False, 'showStatus': False,
}
PAGE = f'''<!doctype html><html class="csg-prehide-tool-summary"><head><meta charset="utf-8"><style>
html,body{{margin:0}} {PREHIDE_CSS} {CONTENT_CSS}
</style></head><body><main id="root"></main><script>
const SETTINGS={json.dumps(SETTINGS)};
globalThis.chrome={{runtime:{{onMessage:{{addListener(){{}}}}}},storage:{{local:{{remove(){{}},get(def,cb){{
  if(Object.prototype.hasOwnProperty.call(def,'uiLanguage'))cb({{uiLanguage:'en'}});else cb({{settings:SETTINGS}});
}}}}}}}};
function makeRow(turnIndex,rowIndex){{
  const shell=document.createElement('span'); shell.className='group/tool-message'; shell.id=`s-${{turnIndex}}-${{rowIndex}}`;
  const row=document.createElement('span'); row.className='block relative text-token-text-secondary'; row.id=`r-${{turnIndex}}-${{rowIndex}}`;
  const group=document.createElement('div'); group.className='group';
  const outer=document.createElement('button'); outer.className='inline-block';
  const flex=document.createElement('div'); flex.className='flex';
  const list=document.createElement('button'); list.type='button'; list.setAttribute('aria-label','Open tool call list'); list.dataset.state='closed';
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg'); icon.setAttribute('aria-hidden','true'); list.appendChild(icon);
  const label=document.createElement('span'); label.className='label'; label.textContent='Called tool';
  const chev=document.createElementNS('http://www.w3.org/2000/svg','svg'); chev.setAttribute('aria-hidden','true');
  flex.append(list,label,chev); outer.appendChild(flex); group.appendChild(outer); row.appendChild(group); shell.appendChild(row); return shell;
}}
const root=document.getElementById('root');
for(let t=0;t<35;t++){{
  const turn=document.createElement('section'); turn.dataset.testid=`conversation-turn-${{t}}`; turn.className='agent-turn';
  for(let r=0;r<20;r++) turn.appendChild(makeRow(t,r));
  root.appendChild(turn);
}}
{CONTENT_JS}
function hiddenLabel(el){{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.opacity==='0'||r.width===0||r.height===0;}}
setTimeout(()=>{{
  const labels=[...document.querySelectorAll('.label')];
  const rows=[...document.querySelectorAll('[id^="r-"]')];
  const marked=rows.filter(row=>row.matches('.csg-tool-summary,.csg-tool-summary-live,.csg-tool-summary-stealth'));
  const historicalMarked=marked.filter(row=>Number(row.id.split('-')[1])<33);
  const historicalShells=[...document.querySelectorAll('[id^="s-"]')].filter(shell=>Number(shell.id.split('-')[1])<33);
  const historicalShellsCollapsed=historicalShells.every(shell=>{{
    const style=getComputedStyle(shell), rect=shell.getBoundingClientRect();
    return shell.classList.contains('csg-tool-ui') && style.position==='absolute' && rect.width===0 && rect.height===0;
  }});
  const payload={{
    total:labels.length,
    allLabelsInvisible:labels.every(hiddenLabel),
    jsMarkersBounded:marked.length<=40,
    historicalRowsCssOnly:historicalMarked.length===0,
    historicalShellsCollapsed,
    resultTimerFired:true,
  }};
  const out=document.createElement('pre');out.id='result';out.textContent=JSON.stringify(payload);document.body.appendChild(out);
}},1800);
</script></body></html>'''
def main():
    with tempfile.TemporaryDirectory(prefix='csg-summary-history-') as tmp:
        target = Path(tmp) / 'index.html'
        target.write_text(PAGE, encoding='utf-8')
        proc = subprocess.run([
            CHROME, '--headless=new', '--no-sandbox', '--disable-gpu',
            '--virtual-time-budget=2600', '--dump-dom', target.as_uri(),
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=20)
    match = re.search(r'<pre id="result"[^>]*>(.*?)</pre>', proc.stdout, re.S)
    if not match:
        raise AssertionError(f'no stress result\n{proc.stderr[-1500:]}')
    payload = json.loads(html.unescape(match.group(1)))
    expected = {
        'total': 700,
        'allLabelsInvisible': True,
        'jsMarkersBounded': True,
        'historicalRowsCssOnly': True,
        'historicalShellsCollapsed': True,
        'resultTimerFired': True,
    }
    failures = {key: payload.get(key) for key, value in expected.items() if payload.get(key) != value}
    if failures:
        raise AssertionError(f'summary history stress failures: {failures}\npayload={json.dumps(payload, indent=2)}')
    print('PASS summary-history-stress: historical MCP rows stay CSS-only while passive shells leave flex flow')

if __name__ == '__main__':
    main()
