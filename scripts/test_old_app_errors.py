#!/usr/bin/env python3
import html
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHROME = shutil.which("google-chrome") or shutil.which("chromium")
CONTENT_JS = (ROOT / "content.js").read_text(encoding="utf-8").replace("</script", "<\\/script")
CONTENT_CSS = (ROOT / "content.css").read_text(encoding="utf-8").replace("</style", "<\\/style")

if not CHROME:
    raise SystemExit("Chrome/Chromium not found")


def make_turn(index, body):
    return f'<section data-testid="conversation-turn-{index}">{body}</section>'


def error_card(text="Failed to fetch template"):
    return (
        '<aside class="text-token-text-error surface-error">'
        '<h3 class="text-token-text-error">アプリの読み込み中にエラーが発生しました</h3>'
        f'<div>{html.escape(text)}</div></aside>'
    )


def current_error_card(text="Failed to fetch template"):
    return (
        '<div class="flex border-token-surface-error/15 text-token-text-error">'
        '<div><div class="font-bold text-token-text-error">Error loading app</div>'
        f'<div class="text-token-text-error">{html.escape(text)}</div></div>'
        '<button type="button">Retry</button></div>'
    )


def normal_card_with_text():
    return '<aside class="surface-error"><div>Failed to fetch template</div></aside>'


def run_case(name, body, checks, settings=None, after_load="", check_delay=1200):
    settings = settings or {"enabled": True, "hideOldAppLoadErrors": True}
    checks_json = json.dumps(checks, ensure_ascii=False)
    settings_json = json.dumps(settings)
    stub = f"""
<script>
const __settings = {settings_json};
window.chrome = {{
  runtime: {{ onMessage: {{ addListener() {{}} }} }},
  storage: {{ local: {{ get(defaults, cb) {{
    cb(Object.assign({{}}, defaults, {{settings: __settings, uiLanguage: 'en'}}));
  }} }} }}
}};
</script>
"""
    runner = f"""
<script>
const __checks = {checks_json};
{after_load}
setTimeout(() => {{
  const result = __checks.map((c) => {{
    const el = document.querySelector(c.selector);
    const hidden = !!el?.classList.contains('csg-old-app-load-error');
    const classChanges = Number(el?.dataset.csgTestClassChanges || 0);
    const classStable = c.maxClassChanges == null || classChanges <= c.maxClassChanges;
    return {{name: c.name, expected: c.hidden, actual: hidden, classChanges, pass: hidden === c.hidden && classStable}};
  }});
  const out = document.createElement('pre');
  out.id = 'csg-test-result';
  out.textContent = JSON.stringify(result);
  document.body.appendChild(out);
}}, {check_delay});
</script>
"""
    page = (
        '<!doctype html><html><head><meta charset="utf-8"><style>' + CONTENT_CSS + '</style>'
        + stub + '</head><body>' + body
        + '<script>' + CONTENT_JS + '</script>'
        + runner + '</body></html>'
    )
    with tempfile.TemporaryDirectory(prefix="csg-old-error-") as tmp:
        fixture = Path(tmp) / "fixture.html"
        fixture.write_text(page, encoding="utf-8")
        proc = subprocess.run(
            [CHROME, "--headless=new", "--no-sandbox", "--disable-gpu",
             "--allow-file-access-from-files", f"--virtual-time-budget={max(2500, check_delay + 500)}",
             "--dump-dom", fixture.as_uri()],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=20,
        )
    match = re.search(r'<pre id="csg-test-result"[^>]*>(.*?)</pre>', proc.stdout, re.S)
    if not match:
        raise AssertionError(
            f"{name}: no test result\nSTDERR:\n{proc.stderr[-2000:]}\nSTDOUT:\n{proc.stdout[-4000:]}"
        )
    results = json.loads(html.unescape(match.group(1)))
    failures = [r for r in results if not r["pass"]]
    if failures:
        raise AssertionError(f"{name}: {failures}\nDOM:\n{proc.stdout[-5000:]}")
    print(f"PASS {name}: {len(results)} checks")


def main():
    run_case(
        "old-error-hidden-latest-visible",
        make_turn(0, '<div>user</div>') +
        make_turn(1, error_card()) +
        make_turn(2, '<div>user newer</div>') +
        make_turn(3, error_card()),
        [
            {"name": "old", "selector": '[data-testid="conversation-turn-1"] aside', "hidden": True},
            {"name": "latest", "selector": '[data-testid="conversation-turn-3"] aside', "hidden": False},
        ],
    )
    run_case(
        "current-div-error-hidden-latest-visible",
        make_turn(0, '<div>user</div>') +
        make_turn(1, current_error_card()) +
        make_turn(2, '<div>user newer</div>') +
        make_turn(3, current_error_card()),
        [
            {"name": "current-old", "selector": '[data-testid="conversation-turn-1"] > div', "hidden": True},
            {"name": "current-latest", "selector": '[data-testid="conversation-turn-3"] > div', "hidden": False},
        ],
    )
    run_case(
        "japanese-old-error-hidden-latest-visible",
        make_turn(0, '<div>user</div>') +
        make_turn(1, error_card('テンプレートの取得に失敗しました')) +
        make_turn(2, '<div>user newer</div>') +
        make_turn(3, error_card('テンプレートの取得に失敗しました')),
        [
            {"name": "old-ja", "selector": '[data-testid="conversation-turn-1"] aside', "hidden": True},
            {"name": "latest-ja", "selector": '[data-testid="conversation-turn-3"] aside', "hidden": False},
        ],
    )
    run_case(
        "structured-only-and-opaque-fail-open",
        make_turn(0, normal_card_with_text()) +
        '<section data-testid="conversation-turn-opaque">' + error_card() + '</section>' +
        make_turn(4, '<div>newest</div>'),
        [
            {"name": "normal-aside", "selector": '[data-testid="conversation-turn-0"] aside', "hidden": False},
            {"name": "opaque", "selector": '[data-testid="conversation-turn-opaque"] aside', "hidden": False},
        ],
    )
    run_case(
        "surface-wrapper-and-split-text",
        make_turn(0, '<aside class="surface-error"><h3 class="text-token-text-error">error</h3><span>Failed to</span><p>fetch template</p></aside>') +
        make_turn(1, '<div>new latest</div>'),
        [{"name": "split-text-live-window", "selector": '[data-testid="conversation-turn-0"] aside', "hidden": False, "maxClassChanges": 1}],
        after_load="""
const splitTarget = document.querySelector('[data-testid="conversation-turn-0"] aside');
if (splitTarget) {
  splitTarget.dataset.csgTestClassChanges = '0';
  new MutationObserver((mutations) => {
    const changes = mutations.filter((m) => m.type === 'attributes' && m.attributeName === 'class').length;
    if (changes) splitTarget.dataset.csgTestClassChanges = String(Number(splitTarget.dataset.csgTestClassChanges || 0) + changes);
  }).observe(splitTarget, {attributes: true, attributeFilter: ['class']});
}
""",
    )
    run_case(
        "mounted-window-decrease-fails-open",
        make_turn(3, error_card()) + make_turn(4, '<div>later</div>') + make_turn(5, '<div>latest</div>'),
        [{"name": "former-old-now-ambiguous", "selector": '[data-testid="conversation-turn-3"] aside', "hidden": False}],
        after_load="""
setTimeout(() => {
  document.querySelector('[data-testid="conversation-turn-4"]')?.remove();
  document.querySelector('[data-testid="conversation-turn-5"]')?.remove();
}, 300);
""",
    )
    run_case(
        "dynamic-one-new-turn-keeps-former-latest-live",
        make_turn(0, '<div>user</div>') + make_turn(1, error_card()),
        [{"name": "former-latest-live", "selector": '[data-testid="conversation-turn-1"] aside', "hidden": False}],
        after_load="""
setTimeout(() => {
  document.body.insertAdjacentHTML('beforeend', '<section data-testid="conversation-turn-2"><div>new turn</div></section>');
}, 250);
""",
    )
    run_case(
        "dynamic-two-new-turns-hide-former-latest",
        make_turn(0, '<div>user</div>') + make_turn(1, error_card()),
        [{"name": "former-latest-old", "selector": '[data-testid="conversation-turn-1"] aside', "hidden": True}],
        after_load="""
setTimeout(() => {
  document.body.insertAdjacentHTML('beforeend', '<section data-testid="conversation-turn-2"><div>new turn</div></section>');
}, 200);
setTimeout(() => {
  document.body.insertAdjacentHTML('beforeend', '<section data-testid="conversation-turn-3"><div>newest turn</div></section>');
}, 500);
""",
    )
    run_case(
        "route-change-fails-open-then-recovers",
        make_turn(0, error_card()) + make_turn(1, '<div>old latest</div>'),
        [
            {"name": "pending-visible", "selector": '#pending-sample', "hidden": False},
            {"name": "new-route-old-hidden", "selector": '#new-route-error', "hidden": True},
        ],
        after_load="""
setTimeout(() => {
  history.pushState({}, '', '?route=b');
  document.body.appendChild(document.createElement('div'));
}, 120);
setTimeout(() => {
  const source = document.querySelector('[data-testid="conversation-turn-0"] aside');
  const sample = document.createElement('div');
  sample.id = 'pending-sample';
  if (source?.classList.contains('csg-old-app-load-error')) sample.classList.add('csg-old-app-load-error');
  document.body.appendChild(sample);
}, 300);
setTimeout(() => {
  document.querySelectorAll('[data-testid^="conversation-turn-"]').forEach((el) => el.remove());
  document.body.insertAdjacentHTML('beforeend', '<section data-testid="conversation-turn-0"><div>new user</div></section><section data-testid="conversation-turn-1"><aside id="new-route-error" class="text-token-text-error surface-error"><h3 class="text-token-text-error">error</h3><div>Failed to fetch template</div></aside></section><section data-testid="conversation-turn-2"><div>later</div></section><section data-testid="conversation-turn-3"><div>new latest</div></section>');
}, 430);
""",
    )
    run_case(
        "route-reuse-fallback-recovers",
        make_turn(0, error_card()) + make_turn(1, error_card()) + make_turn(2, '<div>latest</div>'),
        [
            {"name": "fallback-old-hidden", "selector": '[data-testid="conversation-turn-0"] aside', "hidden": True},
            {"name": "fallback-live-visible", "selector": '[data-testid="conversation-turn-1"] aside', "hidden": False},
        ],
        after_load="""
setTimeout(() => {
  history.pushState({}, '', '?route=reused');
  document.body.appendChild(document.createElement('div'));
}, 120);
""",
        check_delay=3500,
    )
    run_case(
        "feature-disabled",
        make_turn(0, error_card()) + make_turn(1, '<div>newer</div>'),
        [{"name": "disabled", "selector": '[data-testid="conversation-turn-0"] aside', "hidden": False}],
        settings={"enabled": True, "hideOldAppLoadErrors": False},
    )
    print("OLD APP ERROR TESTS OK")


if __name__ == "__main__":
    main()
