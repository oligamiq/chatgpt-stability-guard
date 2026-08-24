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
RECENT_JS = (
    ROOT / 'recent-window.js'
).read_text(encoding='utf-8').replace(
    'const state = {',
    'const state = window.__csgRecentTestState = {',
    1,
).replace('</script', '<\\/script')
CONTENT_CSS = (ROOT / 'content.css').read_text(encoding='utf-8').replace('</style', '<\\/style')

if not CHROME:
    raise SystemExit('Chrome/Chromium not found')


def turn(index, role, text=None, element_id='', message_id=''):
    text = f'{role}-{index}' if text is None else text
    if role == 'assistant':
        body = f'<div class="markdown">{html.escape(text)}</div>' if text else ''
    else:
        body = html.escape(text)
    id_attr = f' id="{element_id}"' if element_id else ''
    message_attr = f' data-message-id="{html.escape(message_id)}"' if message_id else ''
    return (
        f'<section{id_attr} class="turn" data-testid="conversation-turn-{index}" '
        f'data-turn="{role}"{message_attr}>{body}</section>'
    )


def shell(element_id, text, assistant=False):
    body = f'<div class="markdown">{html.escape(text)}</div>' if assistant else html.escape(text)
    return f'<section id="{element_id}" class="turn">{body}</section>'


def opaque_turn(key, role, text):
    body = f'<div class="markdown">{html.escape(text)}</div>' if role == 'assistant' else html.escape(text)
    return f'<section class="turn" data-testid="conversation-turn-{key}" data-turn="{role}">{body}</section>'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def run_case(
    name,
    route,
    body,
    checks,
    *,
    n=2,
    before_js='',
    after_js='',
    delay=5600,
    boundary=None,
    sequence_contains=(),
    expected_state='ready',
    expected_expanded=None,
    expected_root_recent=None,
    expected_recent_mode=None,
    expected_accordion_hidden=None,
    accordion_label_contains=None,
    expected_scroll_host_id=None,
):
    checks_json = json.dumps(checks, ensure_ascii=False)
    page = f'''<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;height:100%;}}
.group\\/scroll-root{{height:320px;overflow-y:auto;position:relative;}}
.turn{{display:block;min-height:150px;padding:4px;box-sizing:border-box;}}
.gap{{height:900px;}}
{CONTENT_CSS}
</style><script>
window.chrome={{storage:{{local:{{get(defaults,cb){{cb(Object.assign({{}},defaults,{{uiLanguage:'en',settings:{{enabled:true,showRecentOnly:true,recentExchanges:{n}}}}}));}}}}}}}};
</script></head><body>
<div id="scroll" class="group/scroll-root"><div id="thread">{body}</div></div>
<script>{before_js}</script>
<script>{RECENT_JS}</script>
<script>{after_js}</script>
<script>
const __checks={checks_json};
setTimeout(()=>{{
  const results=__checks.map(c=>{{
    const el=document.querySelector(c.selector);
    const hidden=!!el?.classList.contains('csg-hidden-old-turn');
    return {{name:c.name,actual:hidden,expected:c.hidden,exists:!!el,pass:!!el&&hidden===c.hidden}};
  }});
  const s=window.__csgRecentTestState;
  const out=document.createElement('pre');
  out.id='csg-test-result';
  out.textContent=JSON.stringify({{
    state:document.documentElement.dataset.csgRecentState||'',
    boundary:s?.boundaryKey||'',
    expanded:!!s?.expanded,
    rootRecent:document.documentElement.classList.contains('csg-show-recent-only'),
    recentMode:document.documentElement.dataset.csgRecentMode || '',
    accordionHidden:document.getElementById('csg-recent-accordion')?.hidden ?? null,
    accordionLabel:document.getElementById('csg-recent-accordion')?.innerText || '',
    scrollHostId:s?.scrollHost?.id || '',
    sequence:s?.sequence||[],
    results
  }});
  document.body.appendChild(out);
}}, {delay});
</script></body></html>'''

    with tempfile.TemporaryDirectory(prefix='csg-recent-') as tmp:
        root = Path(tmp)
        target = root / route.strip('/') / 'index.html'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(page, encoding='utf-8')
        handler = partial(QuietHandler, directory=str(root))
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}{route}'
        try:
            proc = subprocess.run(
                [
                    CHROME,
                    '--headless=new',
                    '--no-sandbox',
                    '--disable-gpu',
                    f'--virtual-time-budget={delay + 1200}',
                    '--dump-dom',
                    url,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=30,
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    match = re.search(r'<pre id="csg-test-result"[^>]*>(.*?)</pre>', proc.stdout, re.S)
    if not match:
        raise AssertionError(
            f'{name}: no result\nSTDERR:\n{proc.stderr[-2000:]}\nDOM:\n{proc.stdout[-5000:]}'
        )
    payload = json.loads(html.unescape(match.group(1)))
    failures = [r for r in payload['results'] if not r['pass']]
    boundary_bad = boundary is not None and payload.get('boundary') != boundary
    expanded_bad = expected_expanded is not None and payload.get('expanded') is not expected_expanded
    root_recent_bad = expected_root_recent is not None and payload.get('rootRecent') is not expected_root_recent
    recent_mode_bad = expected_recent_mode is not None and payload.get('recentMode') != expected_recent_mode
    accordion_hidden_bad = expected_accordion_hidden is not None and payload.get('accordionHidden') is not expected_accordion_hidden
    accordion_label_bad = accordion_label_contains is not None and accordion_label_contains not in payload.get('accordionLabel', '')
    scroll_host_bad = expected_scroll_host_id is not None and payload.get('scrollHostId') != expected_scroll_host_id
    missing_sequence = [key for key in sequence_contains if key not in payload.get('sequence', [])]
    if (payload.get('state') != expected_state or boundary_bad or expanded_bad or root_recent_bad or recent_mode_bad or
            accordion_hidden_bad or accordion_label_bad or scroll_host_bad or missing_sequence or failures):
        raise AssertionError(
            f'{name}: state={payload.get("state")} boundary={payload.get("boundary")} expanded={payload.get("expanded")} '
            f'rootRecent={payload.get("rootRecent")} recentMode={payload.get("recentMode")} accordionHidden={payload.get("accordionHidden")} label={payload.get("accordionLabel")!r} '
            f'expected_boundary={boundary} expected_expanded={expected_expanded} expected_root_recent={expected_root_recent} expected_recent_mode={expected_recent_mode} '
            f'expected_accordion_hidden={expected_accordion_hidden} label_contains={accordion_label_contains!r} '
            f'scrollHostId={payload.get("scrollHostId")!r} expected_scroll_host_id={expected_scroll_host_id!r} '
            f'missing_sequence={missing_sequence} failures={failures}\n'
            f'DOM:\n{proc.stdout[-6000:]}'
        )
    print(f'PASS {name}: {len(payload["results"])} checks')


def main():
    sparse_body = ''.join([
        turn(3, 'user', 'persistent image turn'),
        '<div class="gap"></div>',
        turn(11, 'user', 'persistent image turn 2'),
        '<div class="gap"></div>',
        turn(40, 'assistant', ''),
        turn(41, 'user', 'Continue'),
        turn(42, 'assistant', 'continued response'),
        turn(43, 'user', 'new request'),
        turn(44, 'assistant', 'latest response'),
    ])
    sparse_after = r'''
setTimeout(()=>{
  const s=window.__csgRecentTestState;
  const before40=s.sequence.indexOf('t:conversation-turn-40');
  if(before40>=0 && !s.sequence.includes('t:conversation-turn-38')){
    s.sequence.splice(before40,0,'t:conversation-turn-38','t:conversation-turn-39');
    s.numeric.set('t:conversation-turn-38',38);
    s.numeric.set('t:conversation-turn-39',39);
    s.roles.set('t:conversation-turn-38','assistant');
    s.assistantContent.set('t:conversation-turn-38',true);
    s.roles.set('t:conversation-turn-39','user');
  }
  for(let i=0;i<6;i++){
    setTimeout(()=>{
      const x=document.createElement('i');
      x.textContent='probe';
      document.getElementById('thread').append(x);
      x.remove();
    },i*230);
  }
},2400);
'''
    run_case(
        'share-sparse-mounted-outliers-stay-ready',
        '/share/sparse/',
        sparse_body,
        [
            {'name':'persistent-3-old','selector':'[data-testid="conversation-turn-3"]','hidden':True},
            {'name':'persistent-11-old','selector':'[data-testid="conversation-turn-11"]','hidden':True},
            {'name':'continue-41-visible','selector':'[data-testid="conversation-turn-41"]','hidden':False},
            {'name':'latest-43-visible','selector':'[data-testid="conversation-turn-43"]','hidden':False},
        ],
        n=2,
        after_js=sparse_after,
        delay=5600,
        boundary='t:conversation-turn-41',
        sequence_contains=('t:conversation-turn-38','t:conversation-turn-39'),
    )

    late_share_after = r'''
const timer=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(timer);
  const anchor=document.querySelector('[data-testid="conversation-turn-40"]');
  anchor.insertAdjacentHTML('beforebegin',
    '<section class="turn" data-testid="conversation-turn-38" data-turn="assistant"><div class="markdown">older response</div></section>'+
    '<section class="turn" data-testid="conversation-turn-39" data-turn="user">original request</section>');
},100);
'''
    run_case(
        'share-late-prepend-expands-confirmed-boundary',
        '/share/late-prepend/',
        sparse_body,
        [
            {'name':'older-response-hidden','selector':'[data-testid="conversation-turn-38"]','hidden':True},
            {'name':'restored-boundary-user-visible','selector':'[data-testid="conversation-turn-39"]','hidden':False},
            {'name':'continue-visible','selector':'[data-testid="conversation-turn-41"]','hidden':False},
            {'name':'latest-user-visible','selector':'[data-testid="conversation-turn-43"]','hidden':False},
        ],
        n=2,
        after_js=late_share_after,
        delay=7600,
        boundary='t:conversation-turn-39',
    )

    base = ''.join([
        turn(0,'user'), turn(1,'assistant'),
        turn(2,'user'), turn(3,'assistant'),
        turn(4,'user'), turn(5,'assistant'),
    ])
    boundary_drift = r'''
const b=document.querySelector('[data-testid="conversation-turn-2"]');
const nativeRect=b.getBoundingClientRect.bind(b);
let shifted=false;
b.getBoundingClientRect=()=>{
  const r=nativeRect();
  if(!shifted && document.documentElement.classList.contains('csg-show-recent-only')){
    shifted=true;
    return {top:r.top-6,bottom:r.bottom-6,left:r.left,right:r.right,width:r.width,height:r.height};
  }
  return r;
};
'''
    run_case(
        'semantic-boundary-beats-coordinate-drift',
        '/c/coordinate-drift/',
        base,
        [
            {'name':'old-user-hidden','selector':'[data-testid="conversation-turn-0"]','hidden':True},
            {'name':'old-assistant-hidden','selector':'[data-testid="conversation-turn-1"]','hidden':True},
            {'name':'boundary-user-visible','selector':'[data-testid="conversation-turn-2"]','hidden':False},
            {'name':'boundary-assistant-visible','selector':'[data-testid="conversation-turn-3"]','hidden':False},
        ],
        n=2,
        before_js=boundary_drift,
        delay=4200,
        boundary='t:conversation-turn-2',
    )

    root_class_clobber = r'''
const rootClassTimer=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(rootClassTimer);
  document.documentElement.className='light';
},100);
'''
    run_case(
        'root-class-clobber-self-heals-recent-mode',
        '/c/root-class-clobber/',
        base,
        [
            {'name':'old-user-stays-hidden','selector':'[data-testid="conversation-turn-0"]','hidden':True},
            {'name':'boundary-user-visible','selector':'[data-testid="conversation-turn-2"]','hidden':False},
        ],
        n=2,
        after_js=root_class_clobber,
        delay=4600,
        boundary='t:conversation-turn-2',
        expected_recent_mode='collapsed',
    )

    initially_unfilled_scroll_root = r'''
document.getElementById('scroll').style.height='1200px';
'''
    run_case(
        'trusted-scroll-root-selected-before-it-overflows',
        '/c/trusted-unfilled-scroll-root/',
        base,
        [
            {'name':'old-user-hidden','selector':'[data-testid="conversation-turn-0"]','hidden':True},
            {'name':'boundary-user-visible','selector':'[data-testid="conversation-turn-2"]','hidden':False},
        ],
        n=2,
        before_js=initially_unfilled_scroll_root,
        delay=4600,
        boundary='t:conversation-turn-2',
        expected_recent_mode='collapsed',
        expected_scroll_host_id='scroll',
    )

    short_tail_before = r'''
for (const id of [2,3,4,5]) {
  const el=document.querySelector(`[data-testid="conversation-turn-${id}"]`);
  if(el) el.style.minHeight='20px';
}
'''
    run_case(
        'short-recent-tail-below-viewport-stays-ready',
        '/c/short-recent-tail/',
        base,
        [
            {'name':'old-user-hidden','selector':'[data-testid="conversation-turn-0"]','hidden':True},
            {'name':'boundary-user-visible','selector':'[data-testid="conversation-turn-2"]','hidden':False},
            {'name':'latest-assistant-visible','selector':'[data-testid="conversation-turn-5"]','hidden':False},
        ],
        n=2,
        before_js=short_tail_before,
        delay=4600,
        boundary='t:conversation-turn-2',
        expected_recent_mode='collapsed',
        expected_accordion_hidden=False,
    )

    finalization_invalid = r'''
const badBoundary=document.querySelector('[data-testid="conversation-turn-2"]');
const badNativeRect=badBoundary.getBoundingClientRect.bind(badBoundary);
badBoundary.getBoundingClientRect=()=>{
  const r=badNativeRect();
  if(document.documentElement.classList.contains('csg-show-recent-only')) {
    return {top:r.top+5000,bottom:r.bottom+5000,left:r.left,right:r.right,width:r.width,height:r.height};
  }
  return r;
};
'''
    run_case(
        'finalization-fail-open-is-not-overwritten-by-ready',
        '/c/finalization-fail-open/',
        base,
        [
            {'name':'old-user-fails-open-visible','selector':'[data-testid="conversation-turn-0"]','hidden':False},
            {'name':'boundary-user-visible','selector':'[data-testid="conversation-turn-2"]','hidden':False},
        ],
        n=2,
        before_js=finalization_invalid,
        delay=4600,
        expected_state='degraded',
        expected_expanded=False,
        expected_recent_mode='',
    )

    recent_ui_clobber = r'''
const recentUiTimer=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(recentUiTimer);
  delete document.documentElement.dataset.csgRecentMode;
  document.getElementById('csg-recent-accordion')?.remove();
},100);
'''
    run_case(
        'ready-mode-and-accordion-self-heal-after-host-clobber',
        '/c/recent-ui-clobber/',
        base,
        [
            {'name':'old-user-remains-hidden','selector':'[data-testid="conversation-turn-0"]','hidden':True},
            {'name':'boundary-user-remains-visible','selector':'[data-testid="conversation-turn-2"]','hidden':False},
        ],
        n=2,
        after_js=recent_ui_clobber,
        delay=5000,
        boundary='t:conversation-turn-2',
        expected_recent_mode='collapsed',
        expected_accordion_hidden=False,
        accordion_label_contains='Show 1 earlier exchange',
    )

    dynamic_body = (
        base
        + shell('future-user','future-user')
        + shell('future-assistant','future-assistant',assistant=True)
    )
    dynamic_after = r'''
setTimeout(()=>{
  const u=document.getElementById('future-user');
  const a=document.getElementById('future-assistant');
  u.setAttribute('data-testid','conversation-turn-6');
  u.setAttribute('data-turn','user');
  a.setAttribute('data-testid','conversation-turn-7');
  a.setAttribute('data-turn','assistant');
},2200);
'''
    run_case(
        'attribute-only-new-exchange-advances-without-reload',
        '/c/dynamic/',
        dynamic_body,
        [
            {'name':'former-boundary-user-hidden','selector':'[data-testid="conversation-turn-2"]','hidden':True},
            {'name':'former-boundary-assistant-hidden','selector':'[data-testid="conversation-turn-3"]','hidden':True},
            {'name':'new-boundary-user-visible','selector':'[data-testid="conversation-turn-4"]','hidden':False},
            {'name':'new-user-visible','selector':'[data-testid="conversation-turn-6"]','hidden':False},
            {'name':'new-assistant-visible','selector':'[data-testid="conversation-turn-7"]','hidden':False},
        ],
        n=2,
        after_js=dynamic_after,
        delay=5600,
        boundary='t:conversation-turn-4',
    )
    private_sparse = ''.join([
        turn(2,'assistant'), turn(4,'assistant'), turn(6,'assistant'),
        turn(8,'assistant'), turn(10,'assistant'), turn(12,'assistant'),
        turn(13,'user'), turn(14,'assistant'), turn(16,'assistant'),
        turn(17,'user'), turn(18,'assistant'), turn(19,'user'),
        turn(20,'assistant'), turn(21,'user'), turn(22,'assistant'),
    ])
    run_case(
        'sparse-current-private-dom-n2',
        '/c/private-sparse/',
        private_sparse,
        [
            {'name':'old-assistant-16','selector':'[data-testid="conversation-turn-16"]','hidden':True},
            {'name':'old-user-17','selector':'[data-testid="conversation-turn-17"]','hidden':True},
            {'name':'old-assistant-18','selector':'[data-testid="conversation-turn-18"]','hidden':True},
            {'name':'boundary-user-19','selector':'[data-testid="conversation-turn-19"]','hidden':False},
            {'name':'boundary-assistant-20','selector':'[data-testid="conversation-turn-20"]','hidden':False},
            {'name':'latest-user-21','selector':'[data-testid="conversation-turn-21"]','hidden':False},
            {'name':'latest-assistant-22','selector':'[data-testid="conversation-turn-22"]','hidden':False},
        ],
        n=2,
        delay=4800,
        boundary='t:conversation-turn-19',
    )

    assistant_only_history = ''.join([
        turn(0,'assistant'), turn(2,'assistant'),
        turn(3,'user'), turn(4,'assistant'),
        turn(5,'user'), turn(6,'assistant'),
    ])
    run_case(
        'assistant-only-known-history-still-offers-accordion',
        '/c/assistant-only-history/',
        assistant_only_history,
        [
            {'name':'old-assistant-0-hidden','selector':'[data-testid="conversation-turn-0"]','hidden':True},
            {'name':'old-assistant-2-hidden','selector':'[data-testid="conversation-turn-2"]','hidden':True},
            {'name':'boundary-user-visible','selector':'[data-testid="conversation-turn-3"]','hidden':False},
        ],
        n=2,
        delay=4600,
        boundary='t:conversation-turn-3',
        expected_recent_mode='collapsed',
        expected_accordion_hidden=False,
        accordion_label_contains='Show earlier exchanges',
    )

    identity_body = ''.join([
        turn(0,'user',message_id='m0'), turn(1,'assistant',message_id='m1'),
        turn(2,'user',message_id='m2'), turn(3,'assistant',message_id='m3'),
        turn(4,'user',message_id='m4'), turn(5,'assistant',message_id='m5'),
    ])
    identity_after = r'''
const identityTimer=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(identityTimer);
  document.querySelector('[data-testid="conversation-turn-2"]').setAttribute('data-message-id','replacement-m2');
},100);
'''
    run_case(
        'numeric-message-identity-change-fails-open',
        '/c/identity-change/',
        identity_body,
        [
            {'name':'old-user-revealed','selector':'[data-testid="conversation-turn-0"]','hidden':False},
            {'name':'old-assistant-revealed','selector':'[data-testid="conversation-turn-1"]','hidden':False},
            {'name':'changed-boundary-visible','selector':'[data-testid="conversation-turn-2"]','hidden':False},
        ],
        n=2,
        after_js=identity_after,
        delay=5200,
        expected_state='degraded',
    )

    mixed_body = ''.join([
        turn(3,'user','persistent numeric'),
        turn(11,'user','numeric anchor'),
        opaque_turn('tail-user','user','opaque latest request'),
        opaque_turn('tail-assistant','assistant','opaque latest response'),
    ])
    mixed_after = r'''
const mixedTimer=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(mixedTimer);
  const anchor=document.querySelector('[data-testid="conversation-turn-11"]');
  anchor.insertAdjacentHTML('beforebegin',
    '<section class="turn" data-testid="conversation-turn-9" data-turn="assistant"><div class="markdown">late numeric history</div></section>');
},100);
'''
    run_case(
        'mixed-numeric-opaque-late-numeric-stays-ready',
        '/c/mixed-identities/',
        mixed_body,
        [
            {'name':'late-numeric-fails-open-visible','selector':'[data-testid="conversation-turn-9"]','hidden':False},
            {'name':'opaque-user-visible','selector':'[data-testid="conversation-turn-tail-user"]','hidden':False},
            {'name':'opaque-assistant-visible','selector':'[data-testid="conversation-turn-tail-assistant"]','hidden':False},
        ],
        n=1,
        after_js=mixed_after,
        delay=5200,
        boundary='t:conversation-turn-tail-user',
    )

    accordion_body = ''.join([
        turn(0,'user'), turn(1,'assistant'),
        turn(2,'user'), turn(3,'assistant'),
        turn(4,'user'), turn(5,'assistant'),
        turn(6,'user'), turn(7,'assistant'),
    ])
    expand_after = r'''
const accordionExpand=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  const button=document.getElementById('csg-recent-accordion');
  if(!button) return;
  clearInterval(accordionExpand);
  button.click();
},100);
'''
    run_case(
        'accordion-expand-reveals-history',
        '/c/accordion-expand/',
        accordion_body,
        [
            {'name':'old-user-visible','selector':'[data-testid="conversation-turn-0"]','hidden':False},
            {'name':'old-assistant-visible','selector':'[data-testid="conversation-turn-1"]','hidden':False},
            {'name':'boundary-user-visible','selector':'[data-testid="conversation-turn-4"]','hidden':False},
        ],
        n=2,
        after_js=expand_after,
        delay=4600,
        boundary='t:conversation-turn-4',
        expected_expanded=True,
    )

    collapse_after = r'''
const accordionCollapse=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  const button=document.getElementById('csg-recent-accordion');
  if(!button) return;
  clearInterval(accordionCollapse);
  button.click();
  setTimeout(()=>{
    document.getElementById('scroll').scrollTop=0;
    button.click();
  },250);
},100);
'''
    run_case(
        'accordion-collapse-restores-recent-boundary',
        '/c/accordion-collapse/',
        accordion_body,
        [
            {'name':'old-user-hidden-again','selector':'[data-testid="conversation-turn-0"]','hidden':True},
            {'name':'old-assistant-hidden-again','selector':'[data-testid="conversation-turn-1"]','hidden':True},
            {'name':'boundary-user-visible','selector':'[data-testid="conversation-turn-4"]','hidden':False},
        ],
        n=2,
        after_js=collapse_after,
        delay=5200,
        boundary='t:conversation-turn-4',
        expected_expanded=False,
    )

    virtualized_collapse_after = r'''
const virtualizedCollapse=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  const button=document.getElementById('csg-recent-accordion');
  if(!button) return;
  clearInterval(virtualizedCollapse);
  button.click();
  setTimeout(()=>{
    const scroll=document.getElementById('scroll');
    const thread=document.getElementById('thread');
    thread.innerHTML='<section class="turn" data-testid="conversation-turn-0" data-turn="user">user-0</section>'+
      '<section class="turn" data-testid="conversation-turn-1" data-turn="assistant"><div class="markdown">assistant-1</div></section>'+
      '<div style="height:1200px"></div>';
    scroll.scrollTop=0;
    let restored=false;
    const remountTimer=setInterval(()=>{
      if(restored || scroll.scrollTop<700) return;
      restored=true;
      clearInterval(remountTimer);
      thread.innerHTML='<section class="turn" data-testid="conversation-turn-0" data-turn="user">user-0</section>'+
        '<section class="turn" data-testid="conversation-turn-1" data-turn="assistant"><div class="markdown">assistant-1</div></section>'+
        '<section class="turn" data-testid="conversation-turn-2" data-turn="user">user-2</section>'+
        '<section class="turn" data-testid="conversation-turn-3" data-turn="assistant"><div class="markdown">assistant-3</div></section>'+
        '<section class="turn" data-testid="conversation-turn-4" data-turn="user">user-4</section>'+
        '<section class="turn" data-testid="conversation-turn-5" data-turn="assistant"><div class="markdown">assistant-5</div></section>'+
        '<section class="turn" data-testid="conversation-turn-6" data-turn="user">user-6</section>'+
        '<section class="turn" data-testid="conversation-turn-7" data-turn="assistant"><div class="markdown">assistant-7</div></section>';
    },20);
    setTimeout(()=>button.click(),260);
  },180);
},100);
'''
    run_case(
        'accordion-collapse-recovers-virtualized-boundary-from-tail',
        '/c/accordion-virtualized-collapse/',
        accordion_body,
        [
            {'name':'old-user-hidden-after-remount','selector':'[data-testid="conversation-turn-0"]','hidden':True},
            {'name':'old-assistant-hidden-after-remount','selector':'[data-testid="conversation-turn-1"]','hidden':True},
            {'name':'boundary-user-visible-after-remount','selector':'[data-testid="conversation-turn-4"]','hidden':False},
        ],
        n=2,
        after_js=virtualized_collapse_after,
        delay=6200,
        boundary='t:conversation-turn-4',
        expected_expanded=False,
    )

    print('RECENT WINDOW TESTS OK')


if __name__ == '__main__':
    main()
