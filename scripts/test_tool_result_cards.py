import html
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHROME = shutil.which('google-chrome') or shutil.which('chromium')
CONTENT_JS = (ROOT / 'content.js').read_text(encoding='utf-8').replace('</script', '<\\/script')
CONTENT_CSS = (ROOT / 'content.css').read_text(encoding='utf-8').replace('</style', '<\\/style')

if not CHROME:
    raise SystemExit('Chrome/Chromium not found')


def exchange(key, body):
    return f'''<div data-turn-key="{key}"><div data-content-search-turn-key="{key}">
<div><h4 class="sr-only">You said:</h4><div>request {key}</div></div>
<div data-chatgpt-search-message-ids="m-{key} m-{key}">
<h4 class="sr-only" data-conversation-role="assistant">ChatGPT said:</h4>
{body}<div class="markdown">answer {key}</div></div></div></div>'''


def tool_card(card_id, action_id, action_text, extra='', plain=False):
    action = (f'<div id="{action_id}" class="tool-action"><span>View lines 3200–</span><span>3429 · content.js</span></div>'
              if plain else f'<button id="{action_id}" type="button">{action_text}</button>')
    return f'''<div id="{card_id}" class="tool-result-fixture">
<div class="tool-header"><span class="tool-icon"></span><span>xubuntu-desktop-commander</span><button aria-label="Expand tool card">⌄</button></div>
{action}{extra}</div>'''


SETTINGS = '''Object.assign({},defaults.settings,{
  enabled:true,hideThinking:false,hideTools:false,hideToolSummary:true,hideToolEmbeds:false,
  prehideToolPlaceholders:false,hideOldAppLoadErrors:false,dimTraces:false,compactTraces:false,
  reduceMotion:false,lazyHeavyBlocks:false,freezeOldTurns:false,showRecentOnly:false,
  autoContinueIncomplete:false,showStatus:false
})'''

PAGE = f'''<!doctype html><html><head><meta charset="utf-8"><style>{CONTENT_CSS}</style></head><body>
<script>
window.chrome={{
  runtime:{{onMessage:{{addListener(){{}}}}}},
  storage:{{local:{{remove(){{}},get(defaults,cb){{
    if(Object.prototype.hasOwnProperty.call(defaults,'uiLanguage')) cb({{uiLanguage:'en'}});
    else cb({{settings:{SETTINGS}}});
  }}}}}}
}};
</script>
<div id="composer-wrap"><form><textarea id="prompt-textarea"></textarea><button id="stop" data-testid="stop-button">Stop</button></form></div>
<main id="main">
<div id="turnless-card" class="tool-result-fixture"><div class="tool-header"><span>xubuntu-desktop-commander</span></div><div id="turnless-action"><span>View file · </span><span>manifest.json</span></div></div>
<div id="thread">
{exchange('ex-1', tool_card('old-card', 'old-action', 'View lines 1–1000 · content.js', plain=True) + '<div id="flat-header" class="flat-tool-header">xubuntu-desktop-commander</div><div id="flat-action" class="flat-tool-action"><span>View lines 80–108 · README.md</span></div>')}
{exchange('ex-2', '<div>middle answer</div>')}
{exchange('ex-3', tool_card('live-card', 'live-action', 'View file · manifest.json') + tool_card('auth-card', 'auth-action', 'View file · private.json', '<button id="connect">Connect account</button>') + '<div class="markdown"><button id="markdown-view">View file · README.md</button></div>')}
</div>
</main>
<script>{CONTENT_JS}</script>
<script>
const snap=(id)=>{{const e=document.getElementById(id),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {{cls:[...e.classList],w:r.width,h:r.height,pos:s.position,opacity:s.opacity,pointer:s.pointerEvents}}}};
setTimeout(()=>{{window.__beforeStop={{old:snap('old-card'),live:snap('live-card'),auth:snap('auth-card'),markdown:snap('markdown-view'),turnless:snap('turnless-card'),flatHeader:snap('flat-header'),flatAction:snap('flat-action')}};}},350);
setTimeout(()=>document.getElementById('stop')?.remove(),600);
setTimeout(()=>{{
 const out=document.createElement('pre');out.id='result';out.textContent=JSON.stringify({{before:window.__beforeStop,after:{{old:snap('old-card'),live:snap('live-card'),auth:snap('auth-card'),markdown:snap('markdown-view'),turnless:snap('turnless-card'),flatHeader:snap('flat-header'),flatAction:snap('flat-action')}}}});document.body.appendChild(out);
}},1700);
</script></body></html>'''


def hidden(s):
    return 'csg-tool-result-card' in s['cls'] and s['pos'] == 'absolute' and s['w'] == 0 and s['h'] == 0 and s['opacity'] == '0'


def main():
    with tempfile.TemporaryDirectory(prefix='csg-tool-result-card-') as tmp:
        target = Path(tmp) / 'index.html'
        target.write_text(PAGE, encoding='utf-8')
        proc = subprocess.run(
            [CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=2400', '--dump-dom', target.as_uri()],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=25,
        )
    match = re.search(r'<pre id="result"[^>]*>(.*?)</pre>', proc.stdout, re.S)
    if not match:
        raise AssertionError(f'no result\n{proc.stderr[-1500:]}\n{proc.stdout[-4000:]}')
    result = json.loads(html.unescape(match.group(1)))
    assert hidden(result['before']['old']), result
    assert not hidden(result['before']['live']), result
    assert not hidden(result['before']['auth']), result
    assert not hidden(result['before']['markdown']), result
    assert not hidden(result['before']['turnless']), result
    assert hidden(result['before']['flatHeader']) and hidden(result['before']['flatAction']), result
    assert hidden(result['after']['old']), result
    assert hidden(result['after']['live']), result
    assert not hidden(result['after']['auth']), result
    assert not hidden(result['after']['markdown']), result
    assert hidden(result['after']['turnless']), result
    assert hidden(result['after']['flatHeader']) and hidden(result['after']['flatAction']), result
    print('PASS tool-result-cards: control/plain/turnless View lines/file cards hide after generation; auth/markdown fail open')


if __name__ == '__main__':
    main()
