#!/usr/bin/env python3
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

PAGE = f'''<!doctype html><html><head><meta charset="utf-8"><style>
body{{font:16px sans-serif}} .stack{{display:flex;flex-direction:column;gap:16px;width:720px}}
.no-scrollbar{{width:100%}} iframe{{border:0}} {CONTENT_CSS}
</style></head><body>
<button id="stop" aria-label="Stop answering">Stop</button>
<section data-testid="conversation-turn-20" data-turn="assistant"><div class="agent-turn"><div id="stack" class="stack">
<span id="shell" class="group/tool-message"><span id="row" class="block relative text-token-text-secondary my-1.5"><div role="button"><button id="list" type="button" aria-label="Open tool call list"><svg width="18" height="18"></svg></button><span>Called tool</span><svg width="16" height="16"></svg></div></span></span>
<div id="header">desktop-commander-home</div>
<div id="preview" class="no-scrollbar"><div style="height:180px"><iframe id="frame" title="ui://desktop-commander/file-preview" src="about:blank" style="width:100%;height:100%"></iframe></div></div>
<div class="h-px"></div><div id="answer">assistant answer stays visible</div>
<div id="app-error" class="text-token-text-error"><div>Error loading app</div><div>Failed to fetch template</div><button id="retry">Retry</button></div>
</div></div></section>
<script>
globalThis.chrome={{runtime:{{onMessage:{{addListener(){{}}}}}},storage:{{local:{{remove(){{}},get(def,cb){{if(Object.prototype.hasOwnProperty.call(def,'uiLanguage'))cb({{uiLanguage:'en'}});else cb({{settings:def.settings}});}}}}}}}};
{CONTENT_JS}
function snap(id){{const e=document.getElementById(id),r=e.getBoundingClientRect(),s=getComputedStyle(e);return{{w:r.width,h:r.height,position:s.position,opacity:s.opacity,display:s.display,visibility:s.visibility,classes:[...e.classList]}}}}
function visible(id){{const x=snap(id);return x.w>0&&x.h>0&&x.display!=='none'&&x.visibility!=='hidden'&&Number(x.opacity)>0}}
setTimeout(()=>{{const shell=snap('shell'),row=snap('row'),preview=snap('preview');window.active={{stop:!!document.getElementById('stop'),shellLive:!shell.classes.includes('csg-tool-ui')&&shell.position!=='absolute'&&shell.w>0&&shell.h>0,rowLive:row.classes.includes('csg-tool-summary-live')&&row.opacity==='0',previewLive:preview.classes.includes('csg-preview-live-layout')&&preview.position==='absolute'&&preview.opacity==='0'&&preview.w>0&&preview.h>=170,retry:visible('retry'),stackH:snap('stack').h}}}},600);
setTimeout(()=>document.getElementById('stop')?.setAttribute('aria-label','Send message'),700);
setTimeout(()=>{{const shell=snap('shell'),row=snap('row'),preview=snap('preview');window.done={{stopGone:!document.querySelector('button[aria-label="Stop answering" i]'),shellZero:shell.classes.includes('csg-tool-ui')&&shell.position==='absolute'&&shell.opacity==='0'&&shell.w===0&&shell.h===0,rowHistorical:row.classes.includes('csg-tool-summary')&&!row.classes.includes('csg-tool-summary-live')&&row.opacity==='0',controlsZero:snap('list').w===0&&snap('list').h===0,previewZero:preview.classes.includes('csg-hidden-preview')&&!preview.classes.includes('csg-preview-live-layout')&&preview.position==='absolute'&&preview.opacity==='0'&&preview.w===0&&preview.h===0,frameConnected:document.getElementById('frame').isConnected,retry:visible('retry'),answer:visible('answer'),stackShrank:snap('stack').h<window.active.stackH-20}};const out=document.createElement('pre');out.id='result';out.textContent=JSON.stringify({{active:window.active,done:window.done}});document.body.appendChild(out)}},1300);
</script></body></html>'''

def main():
    with tempfile.TemporaryDirectory(prefix='csg-generation-complete-') as tmp:
        target = Path(tmp) / 'index.html'
        target.write_text(PAGE, encoding='utf-8')
        proc = subprocess.run([CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=1800', '--dump-dom', target.as_uri()], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=20)
    match = re.search(r'<pre id="result"[^>]*>(.*?)</pre>', proc.stdout, re.S)
    if not match:
        raise AssertionError(f'no result\n{proc.stderr[-1500:]}')
    payload = json.loads(html.unescape(match.group(1)))
    required = {
        'active': {'stop', 'shellLive', 'rowLive', 'previewLive', 'retry'},
        'done': {'stopGone', 'shellZero', 'rowHistorical', 'controlsZero', 'previewZero', 'frameConnected', 'retry', 'answer', 'stackShrank'},
    }
    failures = {
        phase: {key: checks.get(key) for key in required[phase] if checks.get(key) is not True}
        for phase, checks in payload.items() if phase in required
    }
    for phase in required:
        if phase not in payload:
            failures[phase] = {'missingPhase': True}
    failures = {k:v for k,v in failures.items() if v}
    if failures:
        raise AssertionError(f'generation completion failures: {failures}\npayload={json.dumps(payload, indent=2)}')
    print('PASS generation-completion: live Tool/App preview keeps a measurable off-flow box only while generating')
    print('PASS generation-completion: completed Tool shell and preview become 0x0; Retry remains actionable')

if __name__ == '__main__':
    main()
