import json
from test_recent_window import opaque_turn, run_case, turn


def body_range(start=0, exchanges=6):
    out = []
    for i in range(exchanges):
        user = start + i * 2
        out.extend([turn(user, 'user'), turn(user + 1, 'assistant')])
    return ''.join(out)


def main():
    for exchanges, n in [(1, 1), (2, 1), (3, 2), (5, 3), (8, 5), (12, 7), (20, 10)]:
        body = body_range(0, exchanges)
        boundary_user = max(0, (exchanges - n) * 2)
        checks = [
            {'name': 'matrix-boundary-visible', 'selector': f'[data-testid="conversation-turn-{boundary_user}"]', 'hidden': False},
            {'name': 'matrix-latest-visible', 'selector': f'[data-testid="conversation-turn-{exchanges * 2 - 1}"]', 'hidden': False},
        ]
        if boundary_user >= 2:
            checks.append({'name': 'matrix-before-boundary-folded', 'selector': f'[data-testid="conversation-turn-{boundary_user - 1}"]', 'hidden': True})
        run_case(
            f'stress-matrix-e{exchanges}-n{n}', f'/c/stress-matrix-{exchanges}-{n}/', body, checks,
            n=n, boundary=f't:conversation-turn-{boundary_user}', expected_recent_mode='per-chat', expected_global_ui=False,
        )
    burst_base = body_range(0, 10)
    burst_html = ''.join(turn(i, 'user' if i % 2 == 0 else 'assistant') for i in range(20, 60))
    burst_after = f'''
const burst=setInterval(()=>{{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(burst);
  const thread=document.getElementById('thread');
  const holder=document.createElement('div');
  holder.innerHTML={json.dumps(burst_html)};
  const nodes=[...holder.children];
  nodes.forEach((node,index)=>setTimeout(()=>thread.appendChild(node),index*8));
}},100);
'''
    run_case(
        'stress-burst-20-exchanges-advances-boundary',
        '/c/stress-burst/', burst_base,
        [
            {'name': 'pre-boundary-folded', 'selector': '[data-testid="conversation-turn-53"]', 'hidden': True},
            {'name': 'final-boundary-visible', 'selector': '[data-testid="conversation-turn-54"]', 'hidden': False},
            {'name': 'final-latest-visible', 'selector': '[data-testid="conversation-turn-59"]', 'hidden': False},
        ],
        n=3, after_js=burst_after, delay=7200,
        boundary='t:conversation-turn-54', expected_recent_mode='per-chat', expected_global_ui=False,
    )

    suffix = body_range(40, 4)
    old_history = body_range(0, 20)
    prepend_after = f'''
const prepend=setInterval(()=>{{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(prepend);
  const holder=document.createElement('div');
  holder.innerHTML={json.dumps(old_history)};
  const thread=document.getElementById('thread');
  const frag=document.createDocumentFragment();
  [...holder.children].forEach(node=>frag.appendChild(node));
  thread.prepend(frag);
}},100);
'''
    run_case(
        'stress-private-prepend-older-history-keeps-tail-boundary',
        '/c/stress-private-prepend/', suffix,
        [
            {'name': 'prepended-first-old-folded', 'selector': '[data-testid="conversation-turn-0"]', 'hidden': True},
            {'name': 'prepended-near-tail-old-folded', 'selector': '[data-testid="conversation-turn-43"]', 'hidden': True},
            {'name': 'boundary-remains-visible', 'selector': '[data-testid="conversation-turn-44"]', 'hidden': False},
            {'name': 'latest-remains-visible', 'selector': '[data-testid="conversation-turn-47"]', 'hidden': False},
        ],
        n=2, after_js=prepend_after, delay=6200,
        boundary='t:conversation-turn-44', expected_recent_mode='per-chat', expected_global_ui=False,
    )
    virtual_body = body_range(0, 6)
    recycle_old_after = r'''
const recycleOld=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(recycleOld);
  const thread=document.getElementById('thread');
  const stash=[];
  for(const id of [0,1,2,3]){
    const node=document.querySelector(`[data-testid="conversation-turn-${id}"]`);
    if(node){ stash.push(node); node.remove(); }
  }
  setTimeout(()=>{
    const frag=document.createDocumentFragment();
    stash.forEach(node=>frag.appendChild(node));
    thread.prepend(frag);
  },650);
},100);
'''
    run_case(
        'stress-virtualizer-old-remove-reinsert-restores-folding',
        '/c/stress-old-recycle/', virtual_body,
        [
            {'name': 'reinserted-old-user-folded', 'selector': '[data-testid="conversation-turn-0"]', 'hidden': True},
            {'name': 'reinserted-old-assistant-folded', 'selector': '[data-testid="conversation-turn-1"]', 'hidden': True},
            {'name': 'boundary-visible', 'selector': '[data-testid="conversation-turn-8"]', 'hidden': False},
        ],
        n=2, after_js=recycle_old_after, delay=6000,
        boundary='t:conversation-turn-8', expected_recent_mode='per-chat', expected_global_ui=False,
    )
    tail_remove_after = r'''
const removeTail=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentFinalScrollCorrections!=='1') return;
  clearInterval(removeTail);
  document.querySelector('[data-testid="conversation-turn-10"]')?.remove();
  document.querySelector('[data-testid="conversation-turn-11"]')?.remove();
  const host=document.getElementById('scroll');
  host.scrollTop=host.scrollHeight;
  setTimeout(()=>{
    const st=window.__csgRecentTestState;
    if(st.ready && st.sequence.includes('t:conversation-turn-10') && st.sequence.includes('t:conversation-turn-11'))
      document.getElementById('thread').dataset.missingTailPreserved='1';
  },900);
},100);
'''
    run_case(
        'stress-tail-virtualization-preserves-remembered-semantic-tail',
        '/c/stress-tail-regression/', virtual_body,
        [
            {'name': 'remembered-missing-tail-preserved', 'selector': '#thread[data-missing-tail-preserved="1"]', 'hidden': False},
            {'name': 'former-old-user-remains-folded', 'selector': '[data-testid="conversation-turn-0"]', 'hidden': True},
            {'name': 'remaining-tail-visible', 'selector': '[data-testid="conversation-turn-9"]', 'hidden': False},
        ],
        n=2, after_js=tail_remove_after, delay=5200,
        expected_state='ready', boundary='t:conversation-turn-8', expected_recent_mode='per-chat', expected_global_ui=False,
    )

    storm_body = body_range(0, 8)
    storm_before = r'''
window.__csgStressDocTurnQueries=0; window.__csgStressElementTurnQueries=0;
const __nativeStressQsa=document.querySelectorAll.bind(document);
document.querySelectorAll=function(selector){
  if(selector==='[data-testid^="conversation-turn-"]') window.__csgStressDocTurnQueries+=1;
  return __nativeStressQsa(selector);
};
const __nativeStressElementQsa=Element.prototype.querySelectorAll;
Element.prototype.querySelectorAll=function(selector){
  if(selector==='[data-testid^="conversation-turn-"]') window.__csgStressElementTurnQueries+=1;
  return __nativeStressElementQsa.call(this,selector);
};
'''
    storm_after = r'''
const contentStorm=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(contentStorm);
  const latest=document.querySelector('[data-testid="conversation-turn-15"] .markdown');
  const elementQueriesBefore=window.__csgStressElementTurnQueries;
  for(let i=0;i<1000;i++){
    const span=document.createElement('span'); span.textContent='x'+i; latest.appendChild(span);
  }
  setTimeout(()=>{
    latest.replaceChildren(document.createTextNode('stable-final'));
    setTimeout(()=>{
      const toggles=[...document.querySelectorAll('.csg-chat-toggle')];
      const unique=new Set(toggles.map(x=>x.dataset.exchangeKey));
      if(window.__csgStressDocTurnQueries===1 &&
         window.__csgStressElementTurnQueries===elementQueriesBefore &&
         toggles.length===8 && unique.size===8)
        document.getElementById('thread').dataset.stormStable='1';
    },700);
  },250);
},100);
'''
    run_case(
        'stress-latest-content-1000-mutations-no-rescan-or-duplicate-toggle',
        '/c/stress-content-storm/', storm_body,
        [
            {'name': 'storm-stable', 'selector': '#thread[data-storm-stable="1"]', 'hidden': False},
            {'name': 'old-stays-folded', 'selector': '[data-testid="conversation-turn-0"]', 'hidden': True},
            {'name': 'latest-stays-visible', 'selector': '[data-testid="conversation-turn-15"]', 'hidden': False},
        ],
        n=3, before_js=storm_before, after_js=storm_after, delay=6500,
        boundary='t:conversation-turn-10', expected_recent_mode='per-chat', expected_global_ui=False,
    )
    toggle_storm_after = r'''
const toggleStorm=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(toggleStorm);
  let rounds=0;
  const timer=setInterval(()=>{
    document.querySelectorAll('.csg-chat-toggle').forEach(button=>button.remove());
    rounds+=1;
    if(rounds>=30){
      clearInterval(timer);
      setTimeout(()=>{
        const users=[...document.querySelectorAll('[data-turn="user"]')];
        const ok=users.every(turn=>turn.querySelectorAll(':scope > .csg-chat-toggle').length===1);
        if(ok && document.querySelectorAll('.csg-chat-toggle').length===8)
          document.getElementById('thread').dataset.toggleStormStable='1';
      },900);
    }
  },35);
},100);
'''
    run_case(
        'stress-toggle-host-clobber-30-rounds-self-heals-once-each',
        '/c/stress-toggle-clobber/', storm_body,
        [
            {'name': 'toggles-self-healed-exactly-once', 'selector': '#thread[data-toggle-storm-stable="1"]', 'hidden': False},
            {'name': 'old-user-still-folded', 'selector': '[data-testid="conversation-turn-0"]', 'hidden': True},
            {'name': 'boundary-still-visible', 'selector': '[data-testid="conversation-turn-10"]', 'hidden': False},
        ],
        n=3, after_js=toggle_storm_after, delay=7200,
        boundary='t:conversation-turn-10', expected_recent_mode='per-chat', expected_global_ui=False,
    )
    route_steps = [{'path': f'/c/stress-route-{i}/', 'body': body_range(i * 100, 4)} for i in range(1, 9)]
    route_storm_after = f'''
const routeSteps={json.dumps(route_steps)};
let routeStep=0;
const routeStorm=setInterval(()=>{{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  if(routeStep>=routeSteps.length){{
    const s=window.__csgRecentTestState;
    if(s.sequence.length===8 && s.sequence[0]==='t:conversation-turn-800' && s.exchangeOverrides.size===0)
      document.getElementById('thread').dataset.routeStormClean='1';
    clearInterval(routeStorm); return;
  }}
  document.querySelector('.csg-chat-toggle')?.click();
  const next=routeSteps[routeStep++];
  history.pushState({{}},'',next.path);
  document.getElementById('thread').innerHTML=next.body;
}},100);
'''
    run_case(
        'stress-eight-spa-route-resets-do-not-leak-state',
        '/c/stress-route-start/', body_range(0, 4),
        [
            {'name': 'route-state-cleared', 'selector': '#thread[data-route-storm-clean="1"]', 'hidden': False},
            {'name': 'final-old-folded', 'selector': '[data-testid="conversation-turn-800"]', 'hidden': True},
            {'name': 'final-boundary-visible', 'selector': '[data-testid="conversation-turn-804"]', 'hidden': False},
            {'name': 'final-latest-visible', 'selector': '[data-testid="conversation-turn-807"]', 'hidden': False},
        ],
        n=2, after_js=route_storm_after, delay=12000,
        boundary='t:conversation-turn-804', expected_recent_mode='per-chat', expected_global_ui=False,
    )

    metadata_body = ''.join([
        opaque_turn('a', 'user', 'ua'), opaque_turn('b', 'assistant', 'ab'),
        opaque_turn('c', 'user', 'uc'), opaque_turn('d', 'assistant', 'ad'),
        opaque_turn('e', 'user', 'ue'), opaque_turn('f', 'assistant', 'af'),
    ])
    metadata_after = r'''
const regenStress=setInterval(()=>{
  if(document.documentElement.dataset.csgRecentState!=='ready') return;
  clearInterval(regenStress);
  let round=0;
  let current='f';
  const timer=setInterval(()=>{
    if(document.documentElement.dataset.csgRecentState!=='ready') return;
    const anchor=document.querySelector('[data-testid="conversation-turn-e"]');
    const old=document.querySelector(`[data-testid="conversation-turn-${current}"]`);
    const next=`r${round}`;
    anchor?.insertAdjacentHTML('afterend', `<section class="turn" data-testid="conversation-turn-${next}" data-turn="assistant"><div class="markdown">${next}</div></section>`);
    old?.remove(); current=next; round++;
    if(round>=20){
      clearInterval(timer);
      setTimeout(()=>{
        const s=window.__csgRecentTestState;
        const bounded=s.sequence.length===6 && s.sequence.at(-1)==='t:conversation-turn-r19' &&
          s.roles.size<=6 && s.roleLocks.size<=6 && s.assistantContent.size<=6 &&
          s.messageIds.size<=6 && s.identityEvidence.size<=2 && s.missingEvidence.size<=2 &&
          s.exchangeOverrides.size===0;
        if(bounded) document.getElementById('thread').dataset.metadataBounded='1';
      },1200);
    }
  },280);
},100);
'''
    run_case(
        'stress-20-tail-regenerations-keep-metadata-bounded',
        '/c/stress-tail-metadata/', metadata_body,
        [
            {'name': 'metadata-maps-bounded', 'selector': '#thread[data-metadata-bounded="1"]', 'hidden': False},
            {'name': 'old-user-still-folded', 'selector': '[data-testid="conversation-turn-a"]', 'hidden': True},
            {'name': 'latest-regenerated-tail-visible', 'selector': '[data-testid="conversation-turn-r19"]', 'hidden': False},
        ],
        n=2, after_js=metadata_after, delay=10500,
        boundary='t:conversation-turn-c', expected_recent_mode='per-chat', expected_global_ui=False,
        sequence_contains=('t:conversation-turn-r19',),
    )
    print('RECENT WINDOW STRESS TESTS OK')


if __name__ == '__main__':
    main()
