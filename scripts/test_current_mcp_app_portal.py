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


def app_card(card_id, title, height=180, header_button='Open app in tab', expanded='true', saved_shape=False):
    outer = ' class="block-BQZwFn"' if saved_shape else ''
    return f'''<div{outer}><div id="{card_id}" data-chatgpt-search-message-ids="m-{card_id}">
<div id="{card_id}-header" class="my-4 flex min-w-0 items-center gap-2 text-base text-secondary select-none">
<a><span>{title}</span></a><button aria-label="{header_button}"></button></div>
<div id="{card_id}-portal" class="relative h-full min-h-0" data-mcp-app-portal-target="true">
<div id="{card_id}-surface" data-mcp-app-inline-surface="standalone" data-mcp-app-expanded="{expanded}" style="height:{height}px"></div>
<div id="{card_id}-frame" data-mcp-app-frame="true" style="position:absolute;top:0;left:0;width:720px;height:{height}px">
<iframe id="{card_id}-iframe" title="{title}" src="about:blank" style="width:100%;height:100%"></iframe>
</div></div></div></div>'''

PAGE = f'''<!doctype html><html><head><meta charset="utf-8"><style>
body{{font:16px sans-serif}} .stack{{width:720px}} {CONTENT_CSS}
</style></head><body>
<button id="stop" aria-label="Stop answering">Stop</button>
<section data-turn-key="ex-1"><div data-conversation-role="assistant"><div class="stack">
{app_card('ready', 'desktop-commander-home', 38, 'アプリをタブで開く', saved_shape=True)}
{app_card('auth', 'desktop-commander-home', 160, 'Connect account')}
{app_card('preparing', 'desktop-commander-home', 0, 'Open app in tab', 'false')}
<div id="answer" class="markdown">assistant answer stays visible</div>
</div></div></section>
<script>
globalThis.chrome={{runtime:{{onMessage:{{addListener(){{}}}}}},storage:{{local:{{remove(){{}},get(def,cb){{
  if(Object.prototype.hasOwnProperty.call(def,'uiLanguage')) cb({{uiLanguage:'en'}});
  else cb({{settings:def.settings}});
}}}}}}}};
{CONTENT_JS}
function snap(id){{
  const e=document.getElementById(id),r=e.getBoundingClientRect(),s=getComputedStyle(e);
  return {{w:r.width,h:r.height,pos:s.position,display:s.display,opacity:s.opacity,overflow:s.overflow,
    hidden:e.classList.contains('csg-hidden-preview')||e.classList.contains('csg-hidden-preview-header')}};
}}
function visible(id){{const x=snap(id);return x.w>0&&x.h>0&&Number(x.opacity)>0}}
setTimeout(()=>{{window.active={{readyPortal:visible('ready-portal'),readyHeader:visible('ready-header'),readyHidden:snap('ready-portal').hidden}}}},500);
setTimeout(()=>document.getElementById('stop').setAttribute('aria-label','Send message'),650);
setTimeout(()=>{{
  // Project/Work can replace the entire <html> className after the guard has
  // already classified and hidden the App. Reproduce the saved-page failure
  // where #csg-status survived but every csg-* root gate disappeared.
  document.documentElement.className='chatgpt-theme host-shell-overwrite';
}},1250);
setTimeout(()=>{{
  window.done={{
    readyPortal:snap('ready-portal'),readyHeader:snap('ready-header'),readyCard:snap('ready'),
    authVisible:visible('auth-portal')&&visible('auth-header'),
    preparingVisible:visible('preparing-header')&&!snap('preparing-portal').hidden,
    frameConnected:document.getElementById('ready-iframe').isConnected,
    answerVisible:visible('answer'),
    rootClass:[...document.documentElement.classList]
  }};
  const out=document.createElement('pre');out.id='result';
  out.textContent=JSON.stringify({{active:window.active,done:window.done}});document.body.appendChild(out)
}},1900);
</script></body></html>'''


def main():
    with tempfile.TemporaryDirectory(prefix='csg-current-mcp-app-') as tmp:
        target = Path(tmp) / 'index.html'
        target.write_text(PAGE, encoding='utf-8')
        proc = subprocess.run([
            CHROME, '--headless=new', '--no-sandbox', '--disable-gpu',
            '--virtual-time-budget=2400', '--dump-dom', target.as_uri()
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=20)
    match = re.search(r'<pre id="result"[^>]*>(.*?)</pre>', proc.stdout, re.S)
    if not match:
        raise AssertionError(f'no result\n{proc.stderr[-1500:]}')
    payload = json.loads(html.unescape(match.group(1)))
    active = payload['active']
    done = payload['done']
    assert active['readyPortal'] and active['readyHeader'] and not active['readyHidden'], payload
    assert done['readyPortal']['display'] == 'none' and done['readyPortal']['w'] == 0 and done['readyPortal']['h'] == 0, payload
    assert done['readyHeader']['display'] == 'none' and done['readyHeader']['w'] == 0 and done['readyHeader']['h'] == 0, payload
    assert done['readyPortal']['overflow'] == 'hidden' and done['readyPortal']['opacity'] == '0', payload
    assert done['readyCard']['h'] == 0, payload
    assert done['authVisible'] is True, payload
    assert done['preparingVisible'] is True, payload
    assert done['frameConnected'] is True and done['answerVisible'] is True, payload
    assert 'host-shell-overwrite' in done['rootClass'], payload
    assert 'csg-hide-tool-embeds' in done['rootClass'], payload
    assert 'csg-hide-tool-summary' in done['rootClass'], payload
    print('PASS current-mcp-app-portal: live/bootstrapping/auth fail open; settled portal and header collapse to 0x0')
    print('PASS root-class-guard: host html.className overwrite self-heals CSG setting gates')
    print('PASS saved-project-mcp: 38px Japanese desktop-commander portal is directly display:none after settle')


if __name__ == '__main__':
    main()
