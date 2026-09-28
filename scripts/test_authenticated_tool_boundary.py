#!/usr/bin/env python3
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

if not CHROME:
    raise SystemExit('Chrome/Chromium not found')


def exchange(key, tool_id):
    return f'''<div data-turn-key="{key}"><div data-content-search-turn-key="{key}">
<div><h4 class="sr-only">You said:</h4><div>request {key}</div></div>
<div data-chatgpt-search-message-ids="m-{key} m-{key}">
<h4 class="sr-only" data-conversation-role="assistant">ChatGPT said:</h4>
<div data-testid="{tool_id}"><div>tool header</div><div>trace body</div></div>
<div class="markdown">answer {key}</div></div></div></div>'''

PAGE = f'''<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
window.chrome={{
  runtime:{{onMessage:{{addListener(){{}}}}}},
  storage:{{local:{{remove(){{}},get(defaults,cb){{
    if(Object.prototype.hasOwnProperty.call(defaults,'uiLanguage')) cb({{uiLanguage:'en'}});
    else cb({{settings:Object.assign({{}},defaults.settings,{{showStatus:false}})}});
  }}}}}}
}};
</script>
<button data-testid="stop-button">Stop</button>
<div id="thread">
{exchange('ex-1', 'tool-old')}
{exchange('ex-2', 'tool-protected-1')}
{exchange('ex-3', 'tool-protected-2')}
</div>
<script>{CONTENT_JS}</script>
<script>
setTimeout(()=>{{
  const out=document.createElement('pre');out.id='result';
  const snap=(id)=>{{const el=document.getElementById(id)||document.querySelector(`[data-testid="${{id}}"]`);return {{tool:el?.classList.contains('csg-tool')||false,heavy:el?.classList.contains('csg-heavy')||false}}}};
  out.textContent=JSON.stringify({{
    old:snap('tool-old'),
    protected1:snap('tool-protected-1'),
    protected2:snap('tool-protected-2')
  }});
  document.body.appendChild(out);
}},900);
</script></body></html>'''


def main():
    with tempfile.TemporaryDirectory(prefix='csg-auth-tool-boundary-') as tmp:
        target = Path(tmp) / 'index.html'
        target.write_text(PAGE, encoding='utf-8')
        proc = subprocess.run(
            [CHROME, '--headless=new', '--no-sandbox', '--disable-gpu',
             '--virtual-time-budget=1500', '--dump-dom', target.as_uri()],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=20,
        )
    match = re.search(r'<pre id="result"[^>]*>(.*?)</pre>', proc.stdout, re.S)
    if not match:
        raise AssertionError(f'no result\n{proc.stderr[-1500:]}\n{proc.stdout[-3000:]}')
    result = json.loads(html.unescape(match.group(1)))
    assert result['old']['tool'] is True, result
    assert result['protected1']['tool'] is False, result
    assert result['protected2']['tool'] is False, result
    print('PASS authenticated-tool-boundary: old exchange optimized; latest two remain live during generation')


if __name__ == '__main__':
    main()
