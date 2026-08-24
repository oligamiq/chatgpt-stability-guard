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
html,body{{margin:0}} #host,#lead-host,#multi-host,#recycle-host,#far-host{{height:300px;overflow:auto}} .turn{{height:500px}}
#next-turn{{height:400px}} #tail,#lead-tail,#multi-tail,#recycle-tail,#far-tail{{height:800px}} #lead-next{{height:200px}}
#multi-prev{{height:400px}} #multi-next{{height:250px}} #recycle-next,#far-next{{height:200px}} #far-filler{{height:2000px}}
{CONTENT_CSS}
</style></head><body>
<div id="host" class="group/scroll-root"><div id="stack">
  <div id="prev-wrap"><section id="prev-turn" class="turn" data-testid="conversation-turn-2">prev</section></div>
  <div id="spacer" class="h-[var(--last-known-height,var(--estimated-turn-height,50vh))] min-h-14"
       style="--last-known-height:132px;--estimated-turn-height:132px;height:var(--last-known-height)"></div>
  <div id="next-wrap"><section id="next-turn" data-testid="conversation-turn-4">next</section></div>
  <div id="tail"></div>
</div></div>
<div id="lead-host" class="group/scroll-root"><div id="lead-stack">
  <div id="lead-spacer" class="h-[var(--last-known-height,var(--estimated-turn-height,50vh))] min-h-14"
       style="--last-known-height:74px;--estimated-turn-height:74px;height:var(--last-known-height)"></div>
  <div id="lead-next-wrap"><section id="lead-next" data-testid="conversation-turn-20">lead next</section></div>
  <div id="lead-tail"></div>
</div></div>
<div id="multi-host" class="group/scroll-root"><div id="multi-stack">
  <section id="multi-prev" data-testid="conversation-turn-40">multi prev</section>
  <div id="multi-spacer-a" class="h-[var(--last-known-height,var(--estimated-turn-height,50vh))] min-h-14" style="--last-known-height:60px;--estimated-turn-height:60px;height:var(--last-known-height)"></div>
  <div id="multi-spacer-b" class="h-[var(--last-known-height,var(--estimated-turn-height,50vh))] min-h-14" style="--last-known-height:80px;--estimated-turn-height:80px;height:var(--last-known-height)"></div>
  <section id="multi-next" data-testid="conversation-turn-43">multi next</section><div id="multi-tail"></div>
</div></div>
<div id="recycle-host" class="group/scroll-root"><div>
  <section id="real-estimate" data-testid="conversation-turn-50" class="h-[var(--last-known-height,var(--estimated-turn-height,50vh))] min-h-14" style="--last-known-height:88px;--estimated-turn-height:88px;height:var(--last-known-height)"></section>
  <div id="reuse-spacer" class="h-[var(--last-known-height,var(--estimated-turn-height,50vh))] min-h-14" style="--last-known-height:88px;--estimated-turn-height:88px;height:var(--last-known-height)"></div>
  <section id="recycle-next" data-testid="conversation-turn-51">recycle next</section><div id="recycle-tail"></div>
</div></div>
<div id="far-host" class="group/scroll-root"><div>
  <div id="far-filler"></div>
  <div id="far-spacer" class="h-[var(--last-known-height,var(--estimated-turn-height,50vh))] min-h-14" style="--last-known-height:96px;--estimated-turn-height:96px;height:var(--last-known-height)"></div>
  <section id="far-next" data-testid="conversation-turn-61">far next</section><div id="far-tail"></div>
</div></div>
<script>
const SETTINGS={json.dumps(SETTINGS)};
globalThis.chrome={{runtime:{{onMessage:{{addListener(){{}}}}}},storage:{{local:{{remove(){{}},get(def,cb){{if(Object.prototype.hasOwnProperty.call(def,'uiLanguage'))cb({{uiLanguage:'en'}});else cb({{settings:SETTINGS}});}}}}}}}};
const host=document.getElementById('host'), next=document.getElementById('next-turn');
const leadHost=document.getElementById('lead-host'), leadNext=document.getElementById('lead-next');
const multiHost=document.getElementById('multi-host'), multiNext=document.getElementById('multi-next');
const farHost=document.getElementById('far-host'), farNext=document.getElementById('far-next');
host.scrollTop=400; multiHost.scrollTop=300; farHost.scrollTop=0;
window.initial={{nextTop:next.getBoundingClientRect().top,scrollTop:host.scrollTop,
  leadHostTop:leadHost.getBoundingClientRect().top,leadNextTop:leadNext.getBoundingClientRect().top,
  multiNextTop:multiNext.getBoundingClientRect().top,multiScrollTop:multiHost.scrollTop,
  farNextTop:farNext.getBoundingClientRect().top,reuseNextTop:document.getElementById('recycle-next').getBoundingClientRect().top}};
{CONTENT_JS}
function near(a,b,t=2){{return Math.abs(a-b)<=t}}
function rect(id){{const r=document.getElementById(id).getBoundingClientRect();return{{top:r.top,bottom:r.bottom,height:r.height}}}}
function frame(){{return new Promise(resolve=>setTimeout(resolve,20))}}
async function frames(n=4){{for(let i=0;i<n;i++)await frame()}}
async function waitFor(predicate,maxFrames=60){{for(let i=0;i<maxFrames;i++){{if(predicate())return true;await frame()}}return Boolean(predicate())}}
async function run(){{
  const initialReady=await waitFor(()=>
    ['spacer','lead-spacer','multi-spacer-a','multi-spacer-b','reuse-spacer'].every(id=>
      document.getElementById(id).classList.contains('csg-virtual-spacer-overlap')));
  const spacer=document.getElementById('spacer'), sr=rect('spacer'), pr=rect('prev-turn'), nr=rect('next-turn');
  const compact={{ready:initialReady,spacerGeometryKept:near(sr.height,132),anchorStable:near(nr.top,window.initial.nextTop),noFlowGap:near(pr.bottom,nr.top),marginCancels:near(parseFloat(getComputedStyle(spacer).marginBottom),-132)}};
  const leadSpacer=document.getElementById('lead-spacer'), lsr=rect('lead-spacer'), lnr=rect('lead-next');
  const leading={{classed:leadSpacer.classList.contains('csg-virtual-spacer-overlap'),spacerGeometryKept:near(lsr.height,74),noVisibleBlank:near(lnr.top,window.initial.leadHostTop),marginCancels:near(parseFloat(getComputedStyle(leadSpacer).marginBottom),-74)}};
  const ma=document.getElementById('multi-spacer-a'), mb=document.getElementById('multi-spacer-b'), mar=rect('multi-spacer-a'), mbr=rect('multi-spacer-b'), mpr=rect('multi-prev'), mnr=rect('multi-next');
  const multi={{bothClassed:ma.classList.contains('csg-virtual-spacer-overlap')&&mb.classList.contains('csg-virtual-spacer-overlap'),geometryKept:near(mar.height,60)&&near(mbr.height,80),noFlowGap:near(mpr.bottom,mnr.top),anchorStable:near(mnr.top,window.initial.multiNextTop),marginsCancel:near(parseFloat(getComputedStyle(ma).marginBottom),-60)&&near(parseFloat(getComputedStyle(mb).marginBottom),-80)}};
  const recycled=document.getElementById('real-estimate'), rer=rect('real-estimate');
  const recycledRealTurn={{notCompacted:!recycled.classList.contains('csg-virtual-spacer-overlap'),geometryIntact:near(rer.height,88),marginUntouched:near(parseFloat(getComputedStyle(recycled).marginBottom)||0,0)}};

  const farSpacer=document.getElementById('far-spacer');
  const farInitiallyUntracked=!farSpacer.classList.contains('csg-virtual-spacer-overlap');
  farHost.scrollTop=1800;const farBefore=farNext.getBoundingClientRect().top;farHost.dispatchEvent(new Event('scroll'));
  const farReady=await waitFor(()=>farSpacer.classList.contains('csg-virtual-spacer-overlap'));
  const fsr=rect('far-spacer'),ffr=rect('far-filler'),fnr=rect('far-next');
  const farScrolledIntoView={{initiallyUntracked:farInitiallyUntracked,compactedAfterScroll:farReady,geometryKept:near(fsr.height,96),noFlowGap:near(ffr.bottom,fnr.top),anchorStable:near(fnr.top,farBefore,3)}};

  const reuse=document.getElementById('reuse-spacer'),reuseNextBefore=rect('recycle-next').top;
  const reuseInitiallyCompacted=reuse.classList.contains('csg-virtual-spacer-overlap');
  reuse.setAttribute('data-testid','conversation-turn-52');reuse.textContent='recycled real turn';
  const reuseReleased=await waitFor(()=>!reuse.classList.contains('csg-virtual-spacer-overlap'));
  const rur=rect('reuse-spacer');
  const sameNodeReuse={{startedCompacted:reuseInitiallyCompacted,releasedImmediately:reuseReleased,marginRestored:near(parseFloat(getComputedStyle(reuse).marginBottom)||0,0),realTurnIntact:reuse.matches('[data-testid="conversation-turn-52"]')&&reuse.textContent==='recycled real turn'&&near(rur.height,88),anchorStable:near(rect('recycle-next').top,reuseNextBefore,3)}};

  const mainBefore=rect('next-turn').top,multiBefore=rect('multi-next').top;
  const real=document.createElement('div');real.id='real-wrap';real.innerHTML='<section id="real-turn" data-testid="conversation-turn-3" style="height:132px">missing user turn</section>';spacer.replaceWith(real);
  const ra=document.createElement('section');ra.id='multi-real-a';ra.dataset.testid='conversation-turn-41';ra.style.height='60px';ra.textContent='multi A';
  const rb=document.createElement('section');rb.id='multi-real-b';rb.dataset.testid='conversation-turn-42';rb.style.height='80px';rb.textContent='multi B';ma.replaceWith(ra);mb.replaceWith(rb);
  await frames(8);
  const rr=rect('real-turn'),nr2=rect('next-turn');
  const materialized={{anchorStable:near(nr2.top,mainBefore,3),realFillsGap:near(rect('prev-turn').bottom,rr.top)&&near(rr.bottom,nr2.top),realVisible:near(rr.height,132),scrollRecovered:near(host.scrollTop,window.initial.scrollTop,3)}};
  const mar2=rect('multi-real-a'),mbr2=rect('multi-real-b'),mnr2=rect('multi-next');
  const multiMaterialized={{anchorStable:near(mnr2.top,multiBefore,3),realTurnsFillGap:near(rect('multi-prev').bottom,mar2.top)&&near(mar2.bottom,mbr2.top)&&near(mbr2.bottom,mnr2.top),bothVisible:near(mar2.height,60)&&near(mbr2.height,80),scrollRecovered:near(multiHost.scrollTop,window.initial.multiScrollTop,3)}};

  const leadBefore=rect('lead-next').top;const leadReal=document.createElement('div');leadReal.id='lead-real-wrap';leadReal.innerHTML='<section id="lead-real-turn" data-testid="conversation-turn-19" style="height:74px">older turn</section>';leadSpacer.replaceWith(leadReal);
  await frames(8);
  const lrr=rect('lead-real-turn'),lnr2=rect('lead-next');
  const leadingMaterialized={{anchorStable:near(lnr2.top,leadBefore,3),realAboveAnchor:near(lrr.bottom,lnr2.top),realVisible:near(lrr.height,74),scrollCompensated:near(leadHost.scrollTop,74,3)}};

  const payload={{compact,leading,multi,recycledRealTurn,farScrolledIntoView,sameNodeReuse,materialized,leadingMaterialized,multiMaterialized}};
  const out=document.createElement('pre');out.id='result';out.textContent=JSON.stringify(payload);document.body.appendChild(out);
}}
run().catch(error=>{{const out=document.createElement('pre');out.id='result';out.textContent=JSON.stringify({{runtime:{{ok:false}}}});document.body.appendChild(out)}});
</script></body></html>'''

def main():
    with tempfile.TemporaryDirectory(prefix='csg-virtual-spacer-') as tmp:
        target = Path(tmp) / 'index.html'
        target.write_text(PAGE, encoding='utf-8')
        proc = subprocess.run([
            CHROME, '--headless=new', '--no-sandbox', '--disable-gpu',
            '--virtual-time-budget=5000', '--dump-dom', target.as_uri(),
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
        raise AssertionError(f'virtual spacer failures: {failures}\npayload={json.dumps(payload, indent=2)}')
    print('PASS virtual-spacer: no blank gap, geometry preserved, materialization keeps anchor stable')

if __name__ == '__main__':
    main()
