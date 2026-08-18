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

if not CHROME:
    raise SystemExit('Chrome/Chromium not found')


def js_source(name):
    return (ROOT / name).read_text(encoding='utf-8').replace('</script', '<\\/script')


CONTENT_JS = js_source('content.js')
PREHIDE_JS = js_source('prehide.js')
CONTENT_CSS = (ROOT / 'content.css').read_text(encoding='utf-8').replace('</style', '<\\/style')
PREHIDE_CSS = (ROOT / 'prehide.css').read_text(encoding='utf-8').replace('</style', '<\\/style')

SETTINGS = {
    'enabled': True,
    'hideThinking': True,
    'hideTools': True,
    'hideToolSummary': True,
    'hideToolEmbeds': True,
    'prehideToolPlaceholders': True,
    'hideOldAppLoadErrors': True,
    'dimTraces': True,
    'compactTraces': True,
    'reduceMotion': True,
    'lazyHeavyBlocks': True,
    'freezeOldTurns': False,
    'showRecentOnly': False,
    'recentExchanges': 3,
    'showStatus': False,
}


def build_page():
    settings = json.dumps(SETTINGS)
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
.transition-fixture,.animate-fixture{{transition-duration:2s;animation-duration:2s;}}
body{{font:16px sans-serif;padding:20px}} button{{margin:4px;padding:8px}}
{CONTENT_CSS}
{PREHIDE_CSS}
</style></head><body>
<main id="application-ui">
  <button id="connector" class="transition-fixture" data-testid="connector-connect-button">Connect plugin</button>
  <button id="library" class="transition-fixture" data-testid="tool-library-add-button">Add from library</button>
  <pre id="outside-pre">application pre</pre>
</main>
<section data-testid="conversation-turn-1" data-turn="assistant">
  <div class="agent-turn">
    <div id="passive-tool" data-testid="tool-call">
      <div>Tool trace</div><div id="inside-motion" class="transition-fixture">trace body</div>
    </div>
    <div id="interactive-tool" data-testid="tool-connector-panel">
      <div class="markdown"><button id="inner-connect">Connect account</button></div><div>interactive body</div>
    </div>
    <div id="tool-with-markdown-controls" data-testid="tool-result">
      <div>Tool result</div><div class="markdown"><a href="#source">source</a><pre tabindex="0">code</pre><table tabindex="0"><tr><td>data</td></tr></table></div>
    </div>
    <div id="tool-with-auth-link" data-testid="tool-auth-card">
      <div>Authentication</div><div class="markdown"><a id="auth-link" href="#connect">Connect account</a></div>
    </div>
    <div id="tool-with-aria-action" data-testid="tool-aria-card">
      <div>Account setting</div><div class="markdown"><div id="aria-switch" role="switch" tabindex="0">Enable account</div></div>
    </div>
    <div id="dynamic-input-tool" data-testid="tool-input"><div>Tool input</div><div><input id="dynamic-input" type="hidden"></div></div>
    <div id="passive-thinking" data-testid="reasoning-block"><div>Reasoning</div><div>passive</div></div>
    <div id="interactive-thinking" data-testid="reasoning-panel"><button id="thinking-connect">Authorize</button><div>live auth</div></div>
    <div id="dynamic-tool" data-testid="tool-dynamic"><div>Tool trace</div><div id="dynamic-tool-body">waiting</div></div>
    <div id="passive-shell" class="group/tool-message">
      <button aria-expanded="false">Tools were called</button>
    </div>
    <div id="interactive-shell" class="group/tool-message">
      <button aria-expanded="false">Tools were called</button>
      <button id="shell-connect">Connect service</button>
    </div>
    <details id="passive-details"><summary>Tools were called</summary><div>completed trace</div></details>
    <details id="interactive-details" open><summary>Tools were called</summary><button id="details-connect">Connect plugin</button></details>
    <details id="dynamic-details"><summary>Tools were called</summary><div>initial trace</div></details>
    <pre id="inside-pre">conversation pre</pre>
  </div>
</section>
<section data-testid="conversation-turn-2" data-turn="assistant">
  <div class="agent-turn">
    <div id="embed-passive-header"><div role="button"><img alt="Calendar"><button>Menu</button>Calendar</div></div>
    <div id="embed-passive" class="no-scrollbar">passive tool output</div><div class="h-px"></div>
    <div id="embed-action-header"><div role="button"><img alt="Drive"><button>Menu</button>Drive</div></div>
    <div id="embed-action" class="no-scrollbar"><button id="embed-connect">Connect Drive</button></div><div class="h-px"></div>
    <div id="embed-dynamic-header"><div role="button"><img alt="Files"><button>Menu</button>Files</div></div>
    <div id="embed-dynamic" class="no-scrollbar"><a id="embed-dynamic-connect">Connect Files</a></div><div class="h-px"></div>
    <div id="embed-text-header"><div role="button"><img alt="Mail"><button>Menu</button><span id="embed-text-label">Mail</span></div></div>
    <div id="embed-text-dynamic" class="no-scrollbar">initial mail output</div><div class="h-px"></div>
  </div>
</section>
<section data-testid="conversation-turn-3" data-turn="assistant">
  <div class="agent-turn">
    <div class="grow flex flex-col">
      <div id="placeholder-passive-header" class="mt-2">Loading tool</div>
      <div id="placeholder-passive" class="no-scrollbar"></div><div class="h-px"></div>
    </div>
  </div>
</section>
<section data-testid="conversation-turn-4" data-turn="assistant">
  <div class="agent-turn">
    <div class="grow flex flex-col">
      <div id="placeholder-action-header" class="mt-2">Authentication</div>
      <div id="placeholder-action" class="no-scrollbar"><button id="placeholder-connect" aria-label="Connect"></button></div><div class="h-px"></div>
    </div>
  </div>
</section>
<section data-testid="conversation-turn-5" data-turn="assistant">
  <div class="agent-turn">
    <div class="grow flex flex-col">
      <div id="placeholder-header-action" class="mt-2"><button id="header-connect">Connect account</button></div>
      <div id="placeholder-header-body" class="no-scrollbar"></div><div class="h-px"></div>
    </div>
  </div>
</section>
<section data-testid="conversation-turn-6" data-turn="assistant">
  <div class="agent-turn">
    <div class="grow flex flex-col">
      <div id="dynamic-placeholder-header" class="mt-2">Loading action</div>
      <div id="dynamic-placeholder" class="no-scrollbar"><a id="dynamic-placeholder-connect" aria-label="Connect" style="display:block;width:20px;height:20px"></a></div><div class="h-px"></div>
    </div>
  </div>
</section>
<section data-testid="conversation-turn-7" data-turn="assistant">
  <div class="agent-turn">
    <div class="grow flex flex-col">
      <div id="dynamic-header-placeholder-header" class="mt-2"><a id="dynamic-header-connect" aria-label="Connect" style="display:block;width:20px;height:20px"></a></div>
      <div id="dynamic-header-placeholder-body" class="no-scrollbar"></div><div class="h-px"></div>
    </div>
  </div>
</section>
<script>
const SETTINGS={settings};
window.chrome={{runtime:{{onMessage:{{addListener(){{}}}}}},storage:{{local:{{get(defaults,cb){{
  cb(Object.assign({{}},defaults,{{privacyConsent:true,privacyConsentVersion:1,uiLanguage:'en',settings:SETTINGS}}));
}}}}}}}};
</script>
<script>{PREHIDE_JS}</script>
<script>{CONTENT_JS}</script>
<script>
window.__clicks={{}};
const ACTION_IDS=['connector','library','inner-connect','auth-link','aria-switch','thinking-connect','shell-connect','details-connect','embed-connect',
  'placeholder-connect','header-connect','dynamic-tool-connect','dynamic-details-connect','embed-dynamic-connect','dynamic-placeholder-connect','dynamic-header-connect'];
function registerAction(id) {{
  const el=document.getElementById(id);
  if (!el || el.dataset.csgTestBound==='1') return;
  el.dataset.csgTestBound='1';
  el.addEventListener('click', () => {{ window.__clicks[id]=(window.__clicks[id]||0)+1; }});
}}
for (const id of ACTION_IDS) registerAction(id);
function snapshot(id) {{
  const el=document.getElementById(id);
  const style=getComputedStyle(el);
  const rect=el.getBoundingClientRect();
  return {{classes:[...el.classList],display:style.display,visibility:style.visibility,
    pointerEvents:style.pointerEvents,transitionDuration:style.transitionDuration,
    contentVisibility:style.contentVisibility,width:rect.width,height:rect.height}};
}}
function hitClick(id) {{
  const el=document.getElementById(id);
  el.scrollIntoView({{block:'center',inline:'nearest'}});
  const rect=el.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
  const target=hit?.closest?.('button,a[href],[role="button"],[role="switch"]');
  target?.dispatchEvent(new MouseEvent('click',{{bubbles:true,cancelable:true,view:window}}));
  return Boolean(hit && (hit===el || el.contains(hit)));
}}
setTimeout(() => {{
  const streamedWrapper=document.createElement('div'); streamedWrapper.id='streamed-wrapper';
  const streamed=document.createElement('span'); streamed.id='streamed-fragment'; streamed.className='csg-trace-body'; streamed.textContent='streamed';
  streamedWrapper.appendChild(streamed);
  document.getElementById('inside-motion').appendChild(streamedWrapper);

  const dynamicToolButton=document.createElement('button'); dynamicToolButton.id='dynamic-tool-connect'; dynamicToolButton.textContent='Connect later';
  document.getElementById('dynamic-tool').appendChild(dynamicToolButton);

  const dynamicDetails=document.getElementById('dynamic-details'); dynamicDetails.open=true;
  const detailsButton=document.createElement('button'); detailsButton.id='dynamic-details-connect'; detailsButton.textContent='Add account';
  dynamicDetails.appendChild(detailsButton);

  document.getElementById('embed-dynamic-connect').setAttribute('href','#connect-files');
  document.getElementById('embed-text-label').firstChild.data='Authentication required';
  document.getElementById('dynamic-placeholder-connect').setAttribute('href','#connect-placeholder');
  document.getElementById('dynamic-header-connect').setAttribute('href','#connect-header');
  document.getElementById('dynamic-input').setAttribute('type','text');
  for (const id of ACTION_IDS) registerAction(id);
}}, 300);
setTimeout(() => {{
  const hit={{}};
  for (const id of ACTION_IDS) hit[id]=hitClick(id);
  const states={{}};
  for (const id of ['connector','library','outside-pre','passive-tool','interactive-tool','tool-with-markdown-controls','tool-with-auth-link',
    'tool-with-aria-action','dynamic-input-tool','passive-thinking','interactive-thinking','dynamic-tool','passive-shell','interactive-shell','passive-details',
    'interactive-details','dynamic-details','embed-passive','embed-action','embed-dynamic','embed-text-dynamic','placeholder-passive',
    'placeholder-action','placeholder-header-action','placeholder-header-body','dynamic-placeholder','dynamic-header-placeholder-header',
    'dynamic-header-placeholder-body','inside-motion','streamed-fragment','inside-pre']) {{
    states[id]=snapshot(id);
  }}
  const result={{
    outsideConnectorClean: !states.connector.classes.some(c=>c.startsWith('csg-')) && states.connector.display!=='none',
    outsideLibraryClean: !states.library.classes.some(c=>c.startsWith('csg-')) && states.library.display!=='none',
    outsideMotionNative: states.connector.transitionDuration==='2s' && states.library.transitionDuration==='2s',
    outsidePreNative: states['outside-pre'].contentVisibility!=='auto',
    passiveToolHidden: states['passive-tool'].classes.includes('csg-tool') && states['passive-tool'].display==='none',
    interactiveToolVisible: !states['interactive-tool'].classes.includes('csg-tool') && states['interactive-tool'].display!=='none',
    markdownControlsRemainTrace: states['tool-with-markdown-controls'].classes.includes('csg-tool') && states['tool-with-markdown-controls'].display==='none',
    markdownAuthLinkVisible: !states['tool-with-auth-link'].classes.includes('csg-tool') && states['tool-with-auth-link'].display!=='none',
    markdownAriaActionVisible: !states['tool-with-aria-action'].classes.includes('csg-tool') && states['tool-with-aria-action'].display!=='none',
    dynamicInputReleased: !states['dynamic-input-tool'].classes.includes('csg-tool') && states['dynamic-input-tool'].display!=='none',
    passiveThinkingHidden: states['passive-thinking'].classes.includes('csg-thinking') && states['passive-thinking'].display==='none',
    interactiveThinkingVisible: !states['interactive-thinking'].classes.includes('csg-thinking') && states['interactive-thinking'].display!=='none',
    dynamicToolReleased: !states['dynamic-tool'].classes.includes('csg-tool') && states['dynamic-tool'].display!=='none',
    passiveShellHidden: states['passive-shell'].classes.includes('csg-tool-ui') && states['passive-shell'].display==='none',
    interactiveShellVisible: !states['interactive-shell'].classes.includes('csg-tool-ui') && states['interactive-shell'].display!=='none',
    passiveDetailsHidden: states['passive-details'].classes.includes('csg-tool-ui') && states['passive-details'].display==='none',
    interactiveDetailsVisible: !states['interactive-details'].classes.includes('csg-tool-ui') && states['interactive-details'].display!=='none',
    dynamicDetailsReleased: !states['dynamic-details'].classes.includes('csg-tool-ui') && states['dynamic-details'].display!=='none',
    passiveEmbedHidden: states['embed-passive'].classes.includes('csg-tool-embed') && states['embed-passive'].display==='none',
    interactiveEmbedVisible: !states['embed-action'].classes.includes('csg-tool-embed') && states['embed-action'].display!=='none',
    dynamicEmbedReleased: !states['embed-dynamic'].classes.includes('csg-tool-embed') && states['embed-dynamic'].display!=='none',
    dynamicEmbedTextReleased: !states['embed-text-dynamic'].classes.includes('csg-tool-embed') && states['embed-text-dynamic'].display!=='none',
    passivePlaceholderHidden: states['placeholder-passive'].classes.includes('csg-prehide-tool-block') && states['placeholder-passive'].display==='none',
    interactivePlaceholderVisible: !states['placeholder-action'].classes.includes('csg-prehide-tool-block') && states['placeholder-action'].display!=='none',
    placeholderHeaderActionVisible: !states['placeholder-header-action'].classes.includes('csg-prehide-tool-block') && states['placeholder-header-action'].display!=='none',
    placeholderHeaderBodyHidden: states['placeholder-header-body'].classes.includes('csg-prehide-tool-block') && states['placeholder-header-body'].display==='none',
    dynamicPlaceholderReleased: !states['dynamic-placeholder'].classes.includes('csg-prehide-tool-block') && states['dynamic-placeholder'].display!=='none',
    dynamicHeaderActionVisible: !states['dynamic-header-placeholder-header'].classes.includes('csg-prehide-tool-block') && states['dynamic-header-placeholder-header'].display!=='none',
    dynamicHeaderBodyStillHidden: states['dynamic-header-placeholder-body'].classes.includes('csg-prehide-tool-block') && states['dynamic-header-placeholder-body'].display==='none',
    streamedFragmentNotContained: !states['streamed-fragment'].classes.includes('csg-trace-body') && states['streamed-fragment'].contentVisibility!=='auto',
    insideMotionReduced: states['inside-motion'].transitionDuration!=='2s',
    insidePreLazy: states['inside-pre'].contentVisibility==='auto',
    allActionHit: Object.values(hit).every(Boolean),
    allActionsClicked: ACTION_IDS.every(id => window.__clicks[id]===1),
    states, hit, clicks:window.__clicks
  }};
  const out=document.createElement('pre');
  out.id='csg-test-result';
  out.textContent=JSON.stringify(result);
  document.body.appendChild(out);
}}, 1200);
</script></body></html>'''


def main():
    page = build_page()
    with tempfile.TemporaryDirectory(prefix='csg-ui-isolation-') as tmp:
        target = Path(tmp) / 'index.html'
        target.write_text(page, encoding='utf-8')
        proc = subprocess.run([
            CHROME, '--headless=new', '--no-sandbox', '--disable-gpu',
            '--virtual-time-budget=2600', '--dump-dom', target.as_uri(),
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=20)
    match = re.search(r'<pre id="csg-test-result"[^>]*>(.*?)</pre>', proc.stdout, re.S)
    if not match:
        raise AssertionError(f'no result\nSTDERR:\n{proc.stderr[-2000:]}\nDOM:\n{proc.stdout[-5000:]}')
    payload = json.loads(html.unescape(match.group(1)))
    detail_keys = {'states', 'hit', 'clicks'}
    failures = {k: v for k, v in payload.items() if k not in detail_keys and v is not True}
    if failures:
        raise AssertionError(
            f'UI isolation failures: {failures}\n'
            f'states={json.dumps(payload.get("states"), ensure_ascii=False, indent=2)}\n'
            f'hit={payload.get("hit")} clicks={payload.get("clicks")}'
        )
    print('PASS ui-isolation: application Connect/Add controls remain interactive')
    print('PASS ui-isolation: passive conversation tool UI is still optimized')


if __name__ == '__main__':
    main()
