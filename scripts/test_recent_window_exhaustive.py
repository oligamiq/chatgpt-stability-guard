import json
from test_recent_window import opaque_turn, run_case, turn


def body_range(start=0, exchanges=4):
    parts = []
    for i in range(exchanges):
        user = start + i * 2
        parts.extend([turn(user, 'user'), turn(user + 1, 'assistant')])
    return ''.join(parts)


def main():
    base = body_range()
    run_case(
        'exhaustive-n1-keeps-exactly-latest-exchange',
        '/c/exhaustive-n1/', base,
        [
            {'name': 'old-user-folded', 'selector': '[data-testid="conversation-turn-4"]', 'hidden': True},
            {'name': 'old-assistant-folded', 'selector': '[data-testid="conversation-turn-5"]', 'hidden': True},
            {'name': 'latest-user-visible', 'selector': '[data-testid="conversation-turn-6"]', 'hidden': False},
            {'name': 'latest-assistant-visible', 'selector': '[data-testid="conversation-turn-7"]', 'hidden': False},
        ],
        n=1, boundary='t:conversation-turn-6', expected_recent_mode='per-chat', expected_global_ui=False,
    )
    run_case(
        'exhaustive-n100-short-history-shows-all',
        '/c/exhaustive-n100/', base,
        [
            {'name': 'first-user-visible', 'selector': '[data-testid="conversation-turn-0"]', 'hidden': False},
            {'name': 'first-assistant-visible', 'selector': '[data-testid="conversation-turn-1"]', 'hidden': False},
            {'name': 'last-user-visible', 'selector': '[data-testid="conversation-turn-6"]', 'hidden': False},
            {'name': 'last-assistant-visible', 'selector': '[data-testid="conversation-turn-7"]', 'hidden': False},
        ],
        n=100, boundary='t:conversation-turn-0', expected_recent_mode='per-chat', expected_global_ui=False,
    )

    unanswered = ''.join([
        turn(0, 'user'), turn(1, 'assistant'),
        turn(2, 'user'), turn(3, 'assistant'),
        turn(4, 'user'), turn(5, 'assistant'),
        turn(6, 'user'),
    ])
    run_case(
        'exhaustive-unanswered-tail-counts-as-exchange',
        '/c/exhaustive-unanswered-tail/', unanswered,
        [
            {'name': 'previous-old-user-folded', 'selector': '[data-testid="conversation-turn-2"]', 'hidden': True},
            {'name': 'previous-old-assistant-folded', 'selector': '[data-testid="conversation-turn-3"]', 'hidden': True},
            {'name': 'penultimate-user-visible', 'selector': '[data-testid="conversation-turn-4"]', 'hidden': False},
            {'name': 'unanswered-user-visible', 'selector': '[data-testid="conversation-turn-6"]', 'hidden': False},
        ],
        n=2, boundary='t:conversation-turn-4', expected_recent_mode='per-chat', expected_global_ui=False,
    )
    route_b = body_range(100)
    route_after = f'''
const routeSwap=setInterval(()=>{{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(routeSwap);
  const oldButton=document.querySelector('[data-testid="conversation-turn-0"] > .csg-chat-toggle');
  oldButton?.click();
  history.pushState({{}},'', '/c/exhaustive-route-b/');
  document.getElementById('thread').innerHTML={json.dumps(route_b)};
}},100);
'''
    run_case(
        'exhaustive-spa-private-to-private-resets-state',
        '/c/exhaustive-route-a/', base,
        [
            {'name': 'new-old-user-folded', 'selector': '[data-testid="conversation-turn-100"]', 'hidden': True},
            {'name': 'new-old-assistant-folded', 'selector': '[data-testid="conversation-turn-103"]', 'hidden': True},
            {'name': 'new-boundary-user-visible', 'selector': '[data-testid="conversation-turn-104"]', 'hidden': False},
            {'name': 'new-latest-visible', 'selector': '[data-testid="conversation-turn-107"]', 'hidden': False},
        ],
        n=2, after_js=route_after, delay=6500,
        boundary='t:conversation-turn-104', expected_recent_mode='per-chat', expected_global_ui=False,
    )
    remount_after = f'''
const remount=setInterval(()=>{{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(remount);
  document.getElementById('scroll').innerHTML='<div id="thread">'+{json.dumps(base)}+'</div>';
  setTimeout(()=>{{
    document.getElementById('thread').insertAdjacentHTML('beforeend',
      {json.dumps(turn(8, 'user') + turn(9, 'assistant'))});
  }},1400);
}},100);
'''
    run_case(
        'exhaustive-observer-root-remount-rebinds-and-advances',
        '/c/exhaustive-root-remount/', base,
        [
            {'name': 'remounted-old-folded', 'selector': '[data-testid="conversation-turn-2"]', 'hidden': True},
            {'name': 'new-boundary-visible', 'selector': '[data-testid="conversation-turn-6"]', 'hidden': False},
            {'name': 'new-user-visible', 'selector': '[data-testid="conversation-turn-8"]', 'hidden': False},
            {'name': 'new-assistant-visible', 'selector': '[data-testid="conversation-turn-9"]', 'hidden': False},
        ],
        n=2, after_js=remount_after, delay=7200,
        boundary='t:conversation-turn-6', expected_recent_mode='per-chat', expected_global_ui=False,
    )
    expanded_remount_after = f'''
const expandedRemount=setInterval(()=>{{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  const button=document.querySelector('[data-testid="conversation-turn-0"] > .csg-chat-toggle');
  if(!button) return;
  clearInterval(expandedRemount);
  button.click();
  setTimeout(()=>{{
    document.getElementById('scroll').innerHTML='<div id="thread">'+{json.dumps(base)}+'</div>';
  }},250);
}},100);
'''
    run_case(
        'exhaustive-expanded-old-exchange-survives-remount',
        '/c/exhaustive-expanded-remount/', base,
        [
            {'name': 'expanded-old-user-visible', 'selector': '[data-testid="conversation-turn-0"]', 'hidden': False},
            {'name': 'expanded-old-assistant-visible', 'selector': '[data-testid="conversation-turn-1"]', 'hidden': False},
            {'name': 'expanded-toggle-restored', 'selector': '[data-testid="conversation-turn-0"] > .csg-chat-toggle[data-expanded="true"]', 'hidden': False},
            {'name': 'other-old-still-folded', 'selector': '[data-testid="conversation-turn-2"]', 'hidden': True},
        ],
        n=2, after_js=expanded_remount_after, delay=6200,
        boundary='t:conversation-turn-4', expected_recent_mode='per-chat', expected_global_ui=False,
    )
    recent_collapse_remount_after = f'''
const recentCollapseRemount=setInterval(()=>{{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  const button=document.querySelector('[data-testid="conversation-turn-4"] > .csg-chat-toggle');
  if(!button) return;
  clearInterval(recentCollapseRemount);
  button.click();
  setTimeout(()=>{{
    document.getElementById('scroll').innerHTML='<div id="thread">'+{json.dumps(base)}+'</div>';
  }},250);
}},100);
'''
    run_case(
        'exhaustive-recent-collapse-survives-remount',
        '/c/exhaustive-recent-collapse-remount/', base,
        [
            {'name': 'recent-user-stays-collapsed', 'selector': '[data-testid="conversation-turn-4"]', 'hidden': True},
            {'name': 'recent-assistant-stays-hidden', 'selector': '[data-testid="conversation-turn-5"]', 'hidden': True},
            {'name': 'recent-toggle-restored-collapsed', 'selector': '[data-testid="conversation-turn-4"] > .csg-chat-toggle[data-expanded="false"]', 'hidden': False},
            {'name': 'latest-exchange-stays-visible', 'selector': '[data-testid="conversation-turn-6"]', 'hidden': False},
        ],
        n=2, after_js=recent_collapse_remount_after, delay=6200,
        boundary='t:conversation-turn-4', expected_recent_mode='per-chat', expected_global_ui=False,
    )
    collapse_then_new = r'''
const collapseThenNew=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  const button=document.querySelector('[data-testid="conversation-turn-4"] > .csg-chat-toggle');
  if(!button) return;
  clearInterval(collapseThenNew);
  button.click();
  setTimeout(()=>{
    document.getElementById('thread').insertAdjacentHTML('beforeend',
      '<section class="turn" data-testid="conversation-turn-8" data-turn="user">u8</section>'+
      '<section class="turn" data-testid="conversation-turn-9" data-turn="assistant"><div class="markdown">a9</div></section>');
  },300);
},100);
'''
    run_case(
        'exhaustive-collapsed-exchange-persists-after-boundary-advance',
        '/c/exhaustive-collapse-advance/', base,
        [
            {'name': 'collapsed-now-old-user-stays-folded', 'selector': '[data-testid="conversation-turn-4"]', 'hidden': True},
            {'name': 'collapsed-now-old-assistant-stays-folded', 'selector': '[data-testid="conversation-turn-5"]', 'hidden': True},
            {'name': 'new-boundary-visible', 'selector': '[data-testid="conversation-turn-6"]', 'hidden': False},
            {'name': 'new-latest-visible', 'selector': '[data-testid="conversation-turn-9"]', 'hidden': False},
        ],
        n=2, after_js=collapse_then_new, delay=6200,
        boundary='t:conversation-turn-6', expected_recent_mode='per-chat', expected_global_ui=False,
    )
    delayed_body = body_range(20)
    delayed_after = f'''
setTimeout(()=>{{
  document.getElementById('thread').innerHTML={json.dumps(delayed_body)};
}},3500);
'''
    run_case(
        'exhaustive-waiting-recovers-when-dom-arrives-late',
        '/c/exhaustive-late-dom/', '',
        [
            {'name': 'late-old-user-folded', 'selector': '[data-testid="conversation-turn-20"]', 'hidden': True},
            {'name': 'late-boundary-visible', 'selector': '[data-testid="conversation-turn-24"]', 'hidden': False},
            {'name': 'late-latest-visible', 'selector': '[data-testid="conversation-turn-27"]', 'hidden': False},
        ],
        n=2, after_js=delayed_after, delay=8200,
        boundary='t:conversation-turn-24', expected_recent_mode='per-chat', expected_global_ui=False,
    )

    mid_init_body = body_range(200)
    mid_init_after = f'''
setTimeout(()=>{{
  history.pushState({{}},'', '/c/exhaustive-mid-init-b/');
  document.getElementById('thread').innerHTML={json.dumps(mid_init_body)};
}},250);
'''
    run_case(
        'exhaustive-route-change-cancels-inflight-discovery',
        '/c/exhaustive-mid-init-a/', '',
        [
            {'name': 'new-route-old-folded', 'selector': '[data-testid="conversation-turn-200"]', 'hidden': True},
            {'name': 'new-route-boundary-visible', 'selector': '[data-testid="conversation-turn-204"]', 'hidden': False},
            {'name': 'new-route-latest-visible', 'selector': '[data-testid="conversation-turn-207"]', 'hidden': False},
        ],
        n=2, after_js=mid_init_after, delay=6200,
        boundary='t:conversation-turn-204', expected_recent_mode='per-chat', expected_global_ui=False,
    )

    dynamic_role_body = ''.join([
        '<section id="dyn0" class="turn" data-testid="conversation-turn-0"><div>u0</div></section>',
        '<section id="dyn1" class="turn" data-testid="conversation-turn-1"><div class="markdown">a1</div></section>',
        '<section id="dyn2" class="turn" data-testid="conversation-turn-2"><div>u2</div></section>',
        '<section id="dyn3" class="turn" data-testid="conversation-turn-3"><div class="markdown">a3</div></section>',
    ])
    dynamic_role_after = r'''
setTimeout(()=>{
  const roles=['user','assistant','user','assistant'];
  roles.forEach((role,index)=>{
    const nested=document.createElement('span');
    nested.setAttribute('data-message-author-role',role);
    document.getElementById('dyn'+index)?.appendChild(nested);
  });
},350);
'''
    run_case(
        'exhaustive-dynamic-nested-role-evidence-reaches-ready',
        '/c/exhaustive-dynamic-role/', dynamic_role_body,
        [
            {'name': 'old-user-folded-after-role-arrives', 'selector': '[data-testid="conversation-turn-0"]', 'hidden': True},
            {'name': 'latest-user-visible-after-role-arrives', 'selector': '[data-testid="conversation-turn-2"]', 'hidden': False},
            {'name': 'latest-assistant-visible-after-role-arrives', 'selector': '[data-testid="conversation-turn-3"]', 'hidden': False},
        ],
        n=1, after_js=dynamic_role_after, delay=6200,
        boundary='t:conversation-turn-2', expected_recent_mode='per-chat', expected_global_ui=False,
    )

    stop_body = base + '<button data-testid="stop-button">Stop</button>'
    stop_before = r'''
const scrollProbe=document.getElementById('scroll');
const scrollTopDescriptor=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
window.__csgStopScrollWrites=0;
Object.defineProperty(scrollProbe,'scrollTop',{
  configurable:true,
  get(){ return scrollTopDescriptor.get.call(this); },
  set(value){ window.__csgStopScrollWrites+=1; return scrollTopDescriptor.set.call(this,value); }
});
'''
    stop_after = r'''
setTimeout(()=>document.querySelector('[data-testid="stop-button"]')?.remove(),2600);
setTimeout(()=>{
  if(window.__csgStopScrollWrites===1 &&
     document.documentElement.dataset.csgRecentFinalScrollCorrections==='1') {
    document.getElementById('scroll').dataset.stopDeferredOneScroll='1';
  }
},4300);
'''
    run_case(
        'exhaustive-generation-stop-defers-one-final-scroll',
        '/c/exhaustive-stop-scroll/', stop_body,
        [
            {'name': 'final-scroll-happened-once', 'selector': '#scroll[data-stop-deferred-one-scroll="1"]', 'hidden': False},
            {'name': 'old-user-folded', 'selector': '[data-testid="conversation-turn-0"]', 'hidden': True},
        ],
        n=2, before_js=stop_before, after_js=stop_after, delay=5600,
        boundary='t:conversation-turn-4', expected_recent_mode='per-chat', expected_global_ui=False,
    )
    run_case(
        'exhaustive-gpt-conversation-route-supported',
        '/g/custom-gpt/c/exhaustive-gpt-route/', base,
        [
            {'name': 'gpt-old-user-folded', 'selector': '[data-testid="conversation-turn-0"]', 'hidden': True},
            {'name': 'gpt-boundary-visible', 'selector': '[data-testid="conversation-turn-4"]', 'hidden': False},
            {'name': 'gpt-latest-visible', 'selector': '[data-testid="conversation-turn-7"]', 'hidden': False},
        ],
        n=2, boundary='t:conversation-turn-4', expected_recent_mode='per-chat', expected_global_ui=False,
    )

    run_case(
        'exhaustive-fractional-n-normalizes-to-integer',
        '/c/exhaustive-fractional-n/', base,
        [
            {'name': 'rounded-old-user-folded', 'selector': '[data-testid="conversation-turn-0"]', 'hidden': True},
            {'name': 'rounded-boundary-visible', 'selector': '[data-testid="conversation-turn-2"]', 'hidden': False},
            {'name': 'rounded-latest-visible', 'selector': '[data-testid="conversation-turn-7"]', 'hidden': False},
        ],
        n=2.5, boundary='t:conversation-turn-2', expected_recent_mode='per-chat', expected_global_ui=False,
    )


    stop_user_move_after = r'''
const moveWhileGenerating=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(moveWhileGenerating);
  setTimeout(()=>{ document.getElementById('scroll').scrollTop=40; },350);
  setTimeout(()=>document.querySelector('[data-testid="stop-button"]')?.remove(),1500);
  setTimeout(()=>{
    const host=document.getElementById('scroll');
    const corrections=document.documentElement.dataset.csgRecentFinalScrollCorrections||'';
    if(window.__csgStopScrollWrites===1 && corrections==='' && Math.abs(host.scrollTop-40)<=1) {
      host.dataset.userScrollPreserved='1';
    }
  },2700);
},100);
'''
    run_case(
        'exhaustive-generation-stop-preserves-user-history-scroll',
        '/c/exhaustive-stop-user-scroll/', stop_body,
        [
            {'name': 'user-history-scroll-preserved', 'selector': '#scroll[data-user-scroll-preserved="1"]', 'hidden': False},
            {'name': 'old-user-still-folded', 'selector': '[data-testid="conversation-turn-0"]', 'hidden': True},
        ],
        n=2, before_js=stop_before, after_js=stop_user_move_after, delay=5600,
        boundary='t:conversation-turn-4', expected_recent_mode='per-chat', expected_global_ui=False,
    )

    stop_route_reset_after = f'''
const moveThenRoute=setInterval(()=>{{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(moveThenRoute);
  setTimeout(()=>{{ document.getElementById('scroll').scrollTop=40; }},350);
  setTimeout(()=>document.querySelector('[data-testid="stop-button"]')?.remove(),1500);
  setTimeout(()=>{{
    history.pushState({{}},'', '/c/exhaustive-stop-reset-b/');
    document.getElementById('thread').innerHTML={json.dumps(route_b)};
  }},2700);
  setTimeout(()=>{{
    const s=window.__csgRecentTestState;
    const corrections=document.documentElement.dataset.csgRecentFinalScrollCorrections||'';
    if(s.ready && !s.finalScrollSuppressed && corrections==='1' && window.__csgStopScrollWrites>=2) {{
      document.getElementById('scroll').dataset.routeScrollReset='1';
    }}
  }},5200);
}},100);
'''
    run_case(
        'exhaustive-generation-scroll-suppression-resets-on-route-change',
        '/c/exhaustive-stop-reset-a/', stop_body,
        [
            {'name': 'new-route-scroll-correction-restored', 'selector': '#scroll[data-route-scroll-reset="1"]', 'hidden': False},
            {'name': 'new-route-old-user-folded', 'selector': '[data-testid="conversation-turn-100"]', 'hidden': True},
        ],
        n=2, before_js=stop_before, after_js=stop_route_reset_after, delay=7600,
        boundary='t:conversation-turn-104', expected_recent_mode='per-chat', expected_global_ui=False,
    )

    tail_identity_body = ''.join([
        turn(0, 'user', message_id='m0'), turn(1, 'assistant', message_id='m1'),
        turn(2, 'user', message_id='m2'), turn(3, 'assistant', message_id='m3'),
        turn(4, 'user', message_id='m4'), turn(5, 'assistant', message_id='m5'),
    ])
    tail_identity_after = r'''
const replaceTailIdentity=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(replaceTailIdentity);
  const host=document.getElementById('scroll'); host.scrollTop=host.scrollHeight;
  document.querySelector('[data-testid="conversation-turn-4"]')?.setAttribute('data-message-id','replacement-m4');
  document.querySelector('[data-testid="conversation-turn-5"]')?.setAttribute('data-message-id','replacement-m5');
  setTimeout(()=>{
    const st=window.__csgRecentTestState;
    if(st.ready && document.documentElement.dataset.csgRecentState==='ready' &&
       st.messageIds.get('t:conversation-turn-4')==='replacement-m4' &&
       st.messageIds.get('t:conversation-turn-5')==='replacement-m5') {
      document.getElementById('thread').dataset.tailIdentityUpdated='1';
    }
  },900);
},100);
'''
    run_case(
        'exhaustive-latest-exchange-message-identity-change-stays-ready',
        '/c/exhaustive-tail-identity-change/', tail_identity_body,
        [
            {'name': 'tail-identity-update-stays-ready', 'selector': '#thread[data-tail-identity-updated="1"]', 'hidden': False},
            {'name': 'latest-user-visible', 'selector': '[data-testid="conversation-turn-4"]', 'hidden': False},
            {'name': 'latest-assistant-visible', 'selector': '[data-testid="conversation-turn-5"]', 'hidden': False},
        ],
        n=2, after_js=tail_identity_after, delay=6000,
        boundary='t:conversation-turn-2', expected_recent_mode='per-chat', expected_global_ui=False,
    )

    tail_identity_scroll_after = r'''
const replaceTailIdentityAfterScroll=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(replaceTailIdentityAfterScroll);
  const host=document.getElementById('scroll');
  host.scrollTop=host.scrollHeight;
  setTimeout(()=>{ host.scrollTop=0; },80);
  setTimeout(()=>{
    document.querySelector('[data-testid="conversation-turn-4"]')?.setAttribute('data-message-id','scrolled-m4');
    document.querySelector('[data-testid="conversation-turn-5"]')?.setAttribute('data-message-id','scrolled-m5');
  },180);
  setTimeout(()=>{
    const st=window.__csgRecentTestState;
    if(st.ready && document.documentElement.dataset.csgRecentState==='ready' &&
       st.messageIds.get('t:conversation-turn-4')==='scrolled-m4' &&
       st.messageIds.get('t:conversation-turn-5')==='scrolled-m5') {
      document.getElementById('thread').dataset.tailIdentityScrolled='1';
    }
  },1200);
},100);
'''
    run_case(
        'exhaustive-latest-identity-change-survives-user-scroll-away',
        '/c/exhaustive-tail-identity-scroll/', tail_identity_body,
        [
            {'name': 'tail-identity-adopted-away-from-bottom', 'selector': '#thread[data-tail-identity-scrolled="1"]', 'hidden': False},
            {'name': 'latest-user-still-visible', 'selector': '[data-testid="conversation-turn-4"]', 'hidden': False},
            {'name': 'latest-assistant-still-visible', 'selector': '[data-testid="conversation-turn-5"]', 'hidden': False},
        ],
        n=2, after_js=tail_identity_scroll_after, delay=6200,
        boundary='t:conversation-turn-2', expected_recent_mode='per-chat', expected_global_ui=False,
    )

    opaque_tail_body = ''.join([
        opaque_turn('a', 'user', 'ua'), opaque_turn('b', 'assistant', 'ab'),
        opaque_turn('c', 'user', 'uc'), opaque_turn('d', 'assistant', 'ad'),
        opaque_turn('e', 'user', 'ue'), opaque_turn('f', 'assistant', 'af'),
    ])
    opaque_regenerate_after = f'''
const regenerateTail=setInterval(()=>{{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(regenerateTail);
  const host=document.getElementById('scroll');
  host.scrollTop=host.scrollHeight;
  window.__csgRecentTestState.pendingBoundaryKey='t:conversation-turn-f';
  document.querySelector('[data-testid="conversation-turn-f"]')?.insertAdjacentHTML('afterend', {json.dumps(opaque_turn('x', 'assistant', 'ax'))});
  document.querySelector('[data-testid="conversation-turn-f"]')?.remove();
  setTimeout(()=>{{
    const st=window.__csgRecentTestState;
    if(st.ready && document.documentElement.dataset.csgRecentState==='ready' &&
       st.sequence.includes('t:conversation-turn-x') && !st.sequence.includes('t:conversation-turn-f') &&
       st.pendingBoundaryKey==='') {{
      document.getElementById('thread').dataset.tailRegenerated='1';
    }}
  }},900);
}},100);
'''
    run_case(
        'exhaustive-opaque-latest-assistant-regenerate-replaces-tail',
        '/c/exhaustive-opaque-tail-regenerate/', opaque_tail_body,
        [
            {'name': 'tail-regenerate-stays-ready', 'selector': '#thread[data-tail-regenerated="1"]', 'hidden': False},
            {'name': 'recent-user-remains-visible', 'selector': '[data-testid="conversation-turn-e"]', 'hidden': False},
            {'name': 'replacement-assistant-visible', 'selector': '[data-testid="conversation-turn-x"]', 'hidden': False},
        ],
        n=2, after_js=opaque_regenerate_after, delay=6200,
        boundary='t:conversation-turn-c', expected_recent_mode='per-chat', expected_global_ui=False,
        sequence_contains=('t:conversation-turn-x',),
    )


    opaque_regenerate_scrolled_after = f'''
const regenerateTailWhileAboveBottom=setInterval(()=>{{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(regenerateTailWhileAboveBottom);
  const host=document.getElementById('scroll');
  host.scrollTop=Math.max(0,host.scrollHeight-host.clientHeight-140);
  const old=document.querySelector('[data-testid="conversation-turn-f"]');
  old?.insertAdjacentHTML('afterend', {json.dumps(opaque_turn('xb', 'assistant', 'axb'))});
  old?.remove();
  setTimeout(()=>{{
    const st=window.__csgRecentTestState;
    if(st.ready && document.documentElement.dataset.csgRecentState==='ready' &&
       st.sequence.includes('t:conversation-turn-xb') && !st.sequence.includes('t:conversation-turn-f')) {{
      document.getElementById('thread').dataset.tailRegeneratedAboveBottom='1';
    }}
  }},1000);
}},100);
'''
    run_case(
        'exhaustive-opaque-tail-replacement-while-above-bottom-stays-ready',
        '/c/exhaustive-opaque-tail-above-bottom/', opaque_tail_body,
        [
            {'name': 'tail-replacement-above-bottom-recovers', 'selector': '#thread[data-tail-regenerated-above-bottom="1"]', 'hidden': False},
            {'name': 'recent-user-remains-visible', 'selector': '[data-testid="conversation-turn-e"]', 'hidden': False},
            {'name': 'replacement-assistant-visible', 'selector': '[data-testid="conversation-turn-xb"]', 'hidden': False},
        ],
        n=2, after_js=opaque_regenerate_scrolled_after, delay=6400,
        boundary='t:conversation-turn-c', expected_recent_mode='per-chat', expected_global_ui=False,
        sequence_contains=('t:conversation-turn-xb',),
    )

    delayed_regenerate_after = f'''
const delayedRegenerate=setInterval(()=>{{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(delayedRegenerate);
  const host=document.getElementById('scroll'); host.scrollTop=host.scrollHeight;
  document.querySelector('[data-testid="conversation-turn-f"]')?.remove();
  setTimeout(()=>{{
    document.querySelector('[data-testid="conversation-turn-e"]')?.insertAdjacentHTML('afterend', {json.dumps(opaque_turn('z', 'assistant', 'az'))});
  }},420);
  setTimeout(()=>{{
    const st=window.__csgRecentTestState;
    if(st.ready && document.documentElement.dataset.csgRecentState==='ready' &&
       st.sequence.includes('t:conversation-turn-z') && !st.sequence.includes('t:conversation-turn-f')) {{
      document.getElementById('thread').dataset.delayedTailRegenerated='1';
    }}
  }},1500);
}},100);
'''
    run_case(
        'exhaustive-opaque-tail-remove-then-delayed-regenerate-recovers',
        '/c/exhaustive-opaque-tail-delayed-regenerate/', opaque_tail_body,
        [
            {'name': 'delayed-tail-regenerate-stays-ready', 'selector': '#thread[data-delayed-tail-regenerated="1"]', 'hidden': False},
            {'name': 'replacement-visible', 'selector': '[data-testid="conversation-turn-z"]', 'hidden': False},
        ],
        n=2, after_js=delayed_regenerate_after, delay=6800,
        boundary='t:conversation-turn-c', expected_recent_mode='per-chat', expected_global_ui=False,
        sequence_contains=('t:conversation-turn-z',),
    )

    delayed_regenerate_scroll_after = f'''
const delayedRegenerateWhileScrolling=setInterval(()=>{{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(delayedRegenerateWhileScrolling);
  const host=document.getElementById('scroll'); host.scrollTop=host.scrollHeight;
  document.querySelector('[data-testid="conversation-turn-f"]')?.remove();
  setTimeout(()=>{{ host.scrollTop=0; }},140);
  setTimeout(()=>{{
    document.querySelector('[data-testid="conversation-turn-e"]')?.insertAdjacentHTML('afterend', {json.dumps(opaque_turn('zs', 'assistant', 'azs'))});
  }},420);
  setTimeout(()=>{{
    const st=window.__csgRecentTestState;
    const e=st.sequence.indexOf('t:conversation-turn-e');
    const z=st.sequence.indexOf('t:conversation-turn-zs');
    if(st.ready && e>=0 && z===e+1 && z===st.sequence.length-1 && !st.sequence.includes('t:conversation-turn-f')) {{
      document.getElementById('thread').dataset.delayedTailScrollOrdered='1';
    }}
  }},1600);
}},100);
'''
    run_case(
        'exhaustive-delayed-tail-remount-keeps-order-after-user-scroll',
        '/c/exhaustive-tail-delayed-scroll/', opaque_tail_body,
        [
            {'name': 'replacement-tail-keeps-semantic-order', 'selector': '#thread[data-delayed-tail-scroll-ordered="1"]', 'hidden': False},
            {'name': 'replacement-assistant-visible', 'selector': '[data-testid="conversation-turn-zs"]', 'hidden': False},
        ],
        n=2, after_js=delayed_regenerate_scroll_after, delay=7000,
        boundary='t:conversation-turn-c', expected_recent_mode='per-chat', expected_global_ui=False,
        sequence_contains=('t:conversation-turn-zs',),
    )

    replacement_exchange = opaque_turn('x', 'user', 'ux') + opaque_turn('y', 'assistant', 'ay')
    opaque_edit_tail_after = f'''
const editTail=setInterval(()=>{{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(editTail);
  const host=document.getElementById('scroll');
  host.scrollTop=host.scrollHeight;
  const oldUser=document.querySelector('[data-testid="conversation-turn-e"]');
  const oldAssistant=document.querySelector('[data-testid="conversation-turn-f"]');
  oldUser?.insertAdjacentHTML('beforebegin', {json.dumps(replacement_exchange)});
  oldUser?.remove(); oldAssistant?.remove();
  setTimeout(()=>{{
    const st=window.__csgRecentTestState;
    if(st.ready && document.documentElement.dataset.csgRecentState==='ready' &&
       st.sequence.includes('t:conversation-turn-x') && st.sequence.includes('t:conversation-turn-y') &&
       !st.sequence.includes('t:conversation-turn-e') && !st.sequence.includes('t:conversation-turn-f')) {{
      document.getElementById('thread').dataset.tailEdited='1';
    }}
  }},1200);
}},100);
'''
    run_case(
        'exhaustive-opaque-last-exchange-edit-replaces-tail',
        '/c/exhaustive-opaque-tail-edit/', opaque_tail_body,
        [
            {'name': 'tail-edit-stays-ready', 'selector': '#thread[data-tail-edited="1"]', 'hidden': False},
            {'name': 'replacement-user-visible', 'selector': '[data-testid="conversation-turn-x"]', 'hidden': False},
            {'name': 'replacement-assistant-visible', 'selector': '[data-testid="conversation-turn-y"]', 'hidden': False},
        ],
        n=2, after_js=opaque_edit_tail_after, delay=6600,
        boundary='t:conversation-turn-c', expected_recent_mode='per-chat', expected_global_ui=False,
        sequence_contains=('t:conversation-turn-x','t:conversation-turn-y'),
    )


    opaque_mid_branch_body = ''.join([
        opaque_turn('a', 'user', 'ua'), opaque_turn('b', 'assistant', 'ab'),
        opaque_turn('c', 'user', 'uc'), opaque_turn('d', 'assistant', 'ad'),
        opaque_turn('e', 'user', 'ue'), opaque_turn('f', 'assistant', 'af'),
    ])
    opaque_mid_branch_after = r'''
const replaceMiddle=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(replaceMiddle);
  const c=document.querySelector('[data-testid=\"conversation-turn-c\"]');
  const d=document.querySelector('[data-testid=\"conversation-turn-d\"]');
  c?.insertAdjacentHTML('beforebegin',
    '<section class=\"turn\" data-testid=\"conversation-turn-x\" data-turn=\"user\">ux</section>'+
    '<section class=\"turn\" data-testid=\"conversation-turn-y\" data-turn=\"assistant\"><div class=\"markdown\">ay</div></section>');
  c?.remove(); d?.remove();
},100);
'''
    run_case(
        'exhaustive-opaque-mid-branch-replacement-recovers',
        '/c/exhaustive-opaque-mid-branch/', opaque_mid_branch_body,
        [
            {'name': 'old-first-user-refolded', 'selector': '[data-testid="conversation-turn-a"]', 'hidden': True},
            {'name': 'replacement-user-refolded', 'selector': '[data-testid="conversation-turn-x"]', 'hidden': True},
            {'name': 'latest-tail-visible', 'selector': '[data-testid="conversation-turn-f"]', 'hidden': False},
        ],
        n=1, after_js=opaque_mid_branch_after, delay=5600,
        expected_state='ready', boundary='t:conversation-turn-e', expected_recent_mode='per-chat', expected_global_ui=False,
    )

    sparse_guard_body = ''.join([
        opaque_turn('a', 'user', 'ua'), opaque_turn('b', 'assistant', 'ab'),
        opaque_turn('c', 'user', 'uc'), opaque_turn('d', 'assistant', 'ad'),
        opaque_turn('e', 'user', 'ue'), opaque_turn('f', 'assistant', 'af'),
    ])
    sparse_guard_after = r'''
const sparseGuard=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(sparseGuard);
  const s=window.__csgRecentTestState;
  // Simulate a sparse virtualized window whose prior DOM did not contain the
  // remembered semantic tail. A shrunken DOM must not be trusted as a tail edit.
  s.lastWindowKeys=['t:conversation-turn-a','t:conversation-turn-b','t:conversation-turn-c','t:conversation-turn-d'];
  document.querySelector('[data-testid="conversation-turn-e"]')?.remove();
  document.querySelector('[data-testid="conversation-turn-f"]')?.remove();
  const host=document.getElementById('scroll'); host.scrollTop=host.scrollHeight;
  setTimeout(()=>{
    if(s.sequence.includes('t:conversation-turn-e') && s.sequence.includes('t:conversation-turn-f'))
      document.getElementById('thread').dataset.sparseTailPreserved='1';
  },900);
},100);
'''
    run_case(
        'exhaustive-opaque-sparse-window-without-prior-tail-does-not-prune',
        '/c/exhaustive-opaque-sparse-bottom/', sparse_guard_body,
        [
            {'name': 'remembered-tail-preserved', 'selector': '#thread[data-sparse-tail-preserved="1"]', 'hidden': False},
            {'name': 'old-prefix-remains-folded', 'selector': '[data-testid="conversation-turn-a"]', 'hidden': True},
            {'name': 'remaining-anchor-visible', 'selector': '[data-testid="conversation-turn-d"]', 'hidden': False},
        ],
        n=2, after_js=sparse_guard_after, delay=5400,
        expected_state='ready', sequence_contains=('t:conversation-turn-e','t:conversation-turn-f'), expected_global_ui=False,
    )

    deletion_only_tail_after = r'''
const deletionOnlyTail=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(deletionOnlyTail);
  const st=window.__csgRecentTestState;
  st.lastWindowKeys=[...st.sequence];
  const host=document.getElementById('scroll'); host.scrollTop=host.scrollHeight;
  document.querySelector('[data-testid="conversation-turn-f"]')?.remove();
  setTimeout(()=>{
    if(st.ready && st.sequence.includes('t:conversation-turn-f') &&
       st.roles.get('t:conversation-turn-f')==='assistant' && st.pendingTailAnchorKey==='')
      document.getElementById('thread').dataset.deletionOnlyTailPreserved='1';
  },1000);
},100);
'''
    run_case(
        'exhaustive-deletion-only-tail-frame-preserves-semantic-tail',
        '/c/exhaustive-deletion-only-tail/', sparse_guard_body,
        [
            {'name': 'missing-tail-and-metadata-preserved', 'selector': '#thread[data-deletion-only-tail-preserved="1"]', 'hidden': False},
            {'name': 'old-prefix-still-folded-after-tail-gap', 'selector': '[data-testid="conversation-turn-a"]', 'hidden': True},
            {'name': 'remaining-recent-user-visible-after-tail-gap', 'selector': '[data-testid="conversation-turn-e"]', 'hidden': False},
        ],
        n=2, after_js=deletion_only_tail_after, delay=5600,
        expected_state='ready', boundary='t:conversation-turn-c',
        sequence_contains=('t:conversation-turn-f',), expected_recent_mode='per-chat', expected_global_ui=False,
    )


    fallback_bottom_after = r'''
const fallbackBottom=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(fallbackBottom);
  const st=window.__csgRecentTestState;
  st.scrollHost=document.scrollingElement;
  st.lastWindowKeys=[...st.sequence];
  document.documentElement.style.overflow='hidden';
  document.body.style.overflow='hidden';
  document.querySelector('[data-testid="conversation-turn-f"]')?.remove();
  setTimeout(()=>{
    if(st.ready && st.pendingTailAnchorKey==='' && st.sequence.includes('t:conversation-turn-f'))
      document.getElementById('thread').dataset.unscrollableFallbackPreserved='1';
  },500);
},100);
'''
    run_case(
        'exhaustive-unscrollable-document-fallback-is-not-bottom-proof',
        '/c/exhaustive-unscrollable-fallback/', sparse_guard_body,
        [
            {'name': 'semantic-tail-not-destructively-pruned', 'selector': '#thread[data-unscrollable-fallback-preserved="1"]', 'hidden': False},
            {'name': 'old-prefix-still-folded', 'selector': '[data-testid="conversation-turn-a"]', 'hidden': True},
            {'name': 'remaining-recent-user-visible', 'selector': '[data-testid="conversation-turn-e"]', 'hidden': False},
        ],
        n=2, after_js=fallback_bottom_after, delay=5200,
        expected_state='ready', sequence_contains=('t:conversation-turn-f',), expected_global_ui=False,
    )

    mixed_anchor_numeric_body = ''.join([
        opaque_turn('oa', 'user', 'uoa'),
        turn(9, 'assistant', 'numeric sparse assistant'),
        opaque_turn('ob', 'user', 'uob'), opaque_turn('oc', 'assistant', 'aoc'),
    ])
    mixed_anchor_numeric_after = r'''
const removeSparseNumeric=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(removeSparseNumeric);
  document.querySelector('[data-testid="conversation-turn-9"]')?.remove();
  setTimeout(()=>{
    const st=window.__csgRecentTestState;
    if(st.ready && st.sequence.includes('t:conversation-turn-9'))
      document.getElementById('thread').dataset.numericSparseRemembered='1';
  },900);
},100);
'''
    run_case(
        'exhaustive-opaque-anchors-do-not-prune-sparse-numeric-key',
        '/c/exhaustive-mixed-anchor-numeric/', mixed_anchor_numeric_body,
        [
            {'name': 'numeric-key-remains-semantic-history', 'selector': '#thread[data-numeric-sparse-remembered="1"]', 'hidden': False},
            {'name': 'old-opaque-user-folded', 'selector': '[data-testid="conversation-turn-oa"]', 'hidden': True},
            {'name': 'latest-opaque-user-visible', 'selector': '[data-testid="conversation-turn-ob"]', 'hidden': False},
        ],
        n=1, after_js=mixed_anchor_numeric_after, delay=5600,
        expected_state='ready', boundary='t:conversation-turn-ob', expected_recent_mode='per-chat',
        sequence_contains=('t:conversation-turn-9',), expected_global_ui=False,
    )

    opaque_delete_body = ''.join([
        opaque_turn('a', 'user', 'ua'), opaque_turn('b', 'assistant', 'ab'),
        opaque_turn('c', 'user', 'uc'), opaque_turn('d', 'assistant', 'ad'),
        opaque_turn('e', 'user', 'ue'), opaque_turn('f', 'assistant', 'af'),
    ])
    opaque_delete_after = r'''
const deleteOnce=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(deleteOnce);
  document.querySelector('[data-testid="conversation-turn-c"]')?.remove();
  document.querySelector('[data-testid="conversation-turn-d"]')?.remove();
  setTimeout(()=>{
    const s=window.__csgRecentTestState;
    if(s.ready && s.sequence.includes('t:conversation-turn-c') && s.sequence.includes('t:conversation-turn-d') &&
       s.roles.get('t:conversation-turn-c')==='user' && s.roles.get('t:conversation-turn-d')==='assistant') {
      document.getElementById('thread').dataset.sparseOpaquePreserved='1';
    }
  },1000);
},100);
'''
    run_case(
        'exhaustive-sparse-opaque-gap-does-not-destroy-semantic-history',
        '/c/exhaustive-opaque-delete/', opaque_delete_body,
        [
            {'name': 'sparse-opaque-metadata-preserved', 'selector': '#thread[data-sparse-opaque-preserved="1"]', 'hidden': False},
            {'name': 'remaining-first-user-stays-folded', 'selector': '[data-testid="conversation-turn-a"]', 'hidden': True},
            {'name': 'remaining-latest-user-visible', 'selector': '[data-testid="conversation-turn-e"]', 'hidden': False},
        ],
        n=2, after_js=opaque_delete_after, delay=6200,
        boundary='t:conversation-turn-c', expected_recent_mode='per-chat', expected_global_ui=False,
    )

    widen_initial = opaque_turn('c', 'user', 'uc') + opaque_turn('d', 'assistant', 'ad')
    widen_full = ''.join([
        opaque_turn('a', 'user', 'ua'), opaque_turn('b', 'assistant', 'ab'),
        opaque_turn('c', 'user', 'uc'), opaque_turn('d', 'assistant', 'ad'),
        opaque_turn('e', 'user', 'ue'),
    ])
    widen_after = f'''
const widenOnce=setInterval(()=>{{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(widenOnce);
  document.getElementById('thread').innerHTML={json.dumps(widen_full)};
  setTimeout(()=>{{
    const s=window.__csgRecentTestState;
    const expected=['t:conversation-turn-a','t:conversation-turn-b','t:conversation-turn-c','t:conversation-turn-d','t:conversation-turn-e'];
    if(expected.every(k=>s.sequence.includes(k))) document.getElementById('thread').dataset.bidirectionalMerged='1';
  }},500);
}},100);
'''
    run_case(
        'exhaustive-bidirectional-window-expansion-merges-prefix-and-suffix',
        '/c/exhaustive-bidirectional-expand/', widen_initial,
        [
            {'name': 'both-sides-merged', 'selector': '#thread[data-bidirectional-merged="1"]', 'hidden': False},
            {'name': 'prepended-user-folded', 'selector': '[data-testid="conversation-turn-a"]', 'hidden': True},
            {'name': 'appended-latest-user-visible', 'selector': '[data-testid="conversation-turn-e"]', 'hidden': False},
        ],
        n=1, after_js=widen_after, delay=5600,
        sequence_contains=('t:conversation-turn-a','t:conversation-turn-b','t:conversation-turn-c','t:conversation-turn-d','t:conversation-turn-e'),
        boundary='t:conversation-turn-e', expected_recent_mode='per-chat', expected_global_ui=False,
    )

    run_case(
        'exhaustive-small-viewport-keeps-known-scroll-root',
        '/c/exhaustive-small-scroll-root/', base,
        [
            {'name': 'old-user-folded', 'selector': '[data-testid="conversation-turn-0"]', 'hidden': True},
            {'name': 'latest-user-visible', 'selector': '[data-testid="conversation-turn-6"]', 'hidden': False},
        ],
        n=2, before_js="document.getElementById('scroll').style.height='120px';",
        boundary='t:conversation-turn-4', expected_scroll_host_id='scroll',
        expected_recent_mode='per-chat', expected_global_ui=False,
    )

    outside_body = '<div id="outside-noise">home</div>'
    outside_after = r'''
const st=window.__csgRecentTestState;
for(let i=0;i<500;i++){
  const n=document.createElement('div'); n.textContent='noise-'+i; document.getElementById('thread').appendChild(n);
}
setTimeout(()=>{
  if(st.observerRoot===null && st.mountedTurns.size===0 && document.documentElement.dataset.csgRecentState==='outside')
    document.getElementById('thread').dataset.outsideObserverIdle='1';
},700);
'''
    run_case(
        'exhaustive-nonconversation-route-keeps-dom-observer-detached',
        '/', outside_body,
        [
            {'name': 'outside-observer-remains-detached', 'selector': '#thread[data-outside-observer-idle="1"]', 'hidden': False},
        ],
        n=3, after_js=outside_after, delay=2400,
        expected_state='outside', expected_global_ui=False,
    )

    outside_to_chat = body_range(300)
    outside_to_chat_after = f'''
setTimeout(()=>{{
  history.pushState({{}},'', '/c/exhaustive-from-home/');
  document.getElementById('thread').innerHTML={json.dumps(outside_to_chat)};
}},350);
'''
    run_case(
        'exhaustive-nonconversation-to-chat-spa-restarts-recent-observer',
        '/', outside_body,
        [
            {'name': 'new-chat-old-user-folded', 'selector': '[data-testid="conversation-turn-300"]', 'hidden': True},
            {'name': 'new-chat-boundary-visible', 'selector': '[data-testid="conversation-turn-304"]', 'hidden': False},
            {'name': 'new-chat-latest-visible', 'selector': '[data-testid="conversation-turn-307"]', 'hidden': False},
        ],
        n=2, after_js=outside_to_chat_after, delay=6500,
        expected_state='ready', boundary='t:conversation-turn-304', expected_recent_mode='per-chat', expected_global_ui=False,
    )

    run_case(
        'exhaustive-zero-n-clamps-to-one',
        '/c/exhaustive-zero-n/', base,
        [
            {'name': 'previous-user-folded', 'selector': '[data-testid="conversation-turn-4"]', 'hidden': True},
            {'name': 'latest-user-visible', 'selector': '[data-testid="conversation-turn-6"]', 'hidden': False},
        ],
        n=0, boundary='t:conversation-turn-6', expected_recent_mode='per-chat', expected_global_ui=False,
    )

    print('RECENT WINDOW EXHAUSTIVE TESTS OK')


if __name__ == '__main__':
    main()
