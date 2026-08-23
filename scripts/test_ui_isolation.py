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

# Scheduler invariants that are hard to force deterministically through a
# headless MutationObserver race: pending records must be drained before a
# live-boundary disconnect, and resumable historical roots must survive queue
# compaction.
drain = 'consumeSummaryLiveMutations(state.summaryLiveObserver.takeRecords());'
drain_at = CONTENT_JS.find(drain)
disconnect_at = CONTENT_JS.find('state.summaryLiveObserver.disconnect();', drain_at)
if drain_at < 0 or disconnect_at < drain_at:
    raise AssertionError('summary live observer must drain takeRecords() before disconnect()')
compact_at = CONTENT_JS.find('function compactPendingRoots()')
compact_end = CONTENT_JS.find('function scheduleScan(', compact_at)
compact_source = CONTENT_JS[compact_at:compact_end]
if 'for (const root of [...state.toolSummaryPendingRoots])' not in compact_source or 'state.pendingRoots.add(root);' not in compact_source:
    raise AssertionError('resumable summary roots must be requeued after pending-root compaction')
schedule_at = CONTENT_JS.find('function scheduleScan(')
schedule_end = CONTENT_JS.find('function getTurns()', schedule_at)
schedule_source = CONTENT_JS[schedule_at:schedule_end]
if 'const prioritySet = new Set([' not in schedule_source or 'state.toolSummaryPendingRoots.has(node)' not in schedule_source:
    raise AssertionError('resumable summary roots must bypass nested-root batch dedupe')

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
    long_old_prefix = ''.join(f'<span class="long-old-noise">noise{i}</span>' for i in range(600))
    fragmented_bootstrap = ''.join(f'<span>{html.escape(ch)}</span>' for ch in 'loading app template')
    fragmented_english_summary = ''.join(f'<span>{html.escape(ch)}</span>' for ch in 'Tools were called')
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
.transition-fixture,.animate-fixture{{transition-duration:2s;animation-duration:2s;}}
.live-box{{display:block;min-height:24px;min-width:24px;}}
/* Reproduce the Tailwind utility used by the current ChatGPT summary row. */
.block{{display:block;}}
body{{font:16px sans-serif;padding:20px}} button{{margin:4px;padding:8px}}
{CONTENT_CSS}
{PREHIDE_CSS}
</style></head><body>
<main id="application-ui">
  <button id="connector" class="transition-fixture" data-testid="connector-connect-button">Connect plugin</button>
  <button id="library" class="transition-fixture" data-testid="tool-library-add-button">Add from library</button>
  <pre id="outside-pre">application pre</pre>
</main>
<button id="test-stop-generation" data-testid="stop-button" aria-label="Stop answering">Stop</button>
<section data-testid="conversation-turn-1" data-turn="assistant">
  <div class="agent-turn">
    <div id="old-classless-summary"><span>Tools </span><span>were called</span></div>
    <div id="old-classless-body">historical classless tool body</div>
    <div id="old-fragmented-en-summary">{fragmented_english_summary}</div>
    <div id="old-fragmented-en-body">historical fragmented English body</div>
    <div id="long-old-prefix">{long_old_prefix}</div>
    <div id="long-old-summary"><span>Tools </span><span>were called</span></div>
    <div id="long-old-body">historical body after 600 text nodes</div>
    <div id="passive-tool" data-testid="tool-call">
      <div>Tool trace</div><div id="inside-motion" class="transition-fixture" style="margin-block:7px 11px">trace body</div>
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
    <div id="fragmented-bootstrap-tool" data-testid="tool-fragmented-bootstrap"><div>{fragmented_bootstrap}</div><div class="live-box">app bootstrap body</div></div>
    <div id="passive-thinking" data-testid="reasoning-block"><div>Reasoning</div><div>passive</div></div>
    <div id="interactive-thinking" data-testid="reasoning-panel"><button id="thinking-connect">Authorize</button><div>live auth</div></div>
    <div id="dynamic-tool" data-testid="tool-dynamic"><div>Tool trace</div><div id="dynamic-tool-body">waiting</div></div>
    <div id="tool-with-iframe-surface" data-testid="tool-frame-output"><iframe id="tool-surface-frame" src="about:blank" width="180" height="60"></iframe></div>
    <div id="tool-with-markdown-iframe" data-testid="tool-markdown-frame-output"><div class="markdown"><iframe id="tool-markdown-frame" src="about:blank" width="180" height="60"></iframe></div></div>
    <div id="tool-with-image-surface" data-testid="tool-image-output"><img id="tool-surface-image" alt="generated plot" style="display:block;width:90px;height:40px"></div>
    <div id="tool-with-svg-surface" data-testid="tool-chart-output"><svg id="tool-surface-svg" width="90" height="40"><rect width="90" height="40"></rect></svg></div>
    <div id="tool-bootstrap-text-false-positive" data-testid="tool-note"><div class="markdown">Documentation example: <pre id="markdown-loading-pre">loading app states are described here</pre></div><div>passive trace</div></div>
    <pre id="interactive-heavy-pre"><button id="heavy-connect">Connect code tool</button></pre>
    <span id="old-real-called-tool-shell" class="group/tool-message"><span id="old-real-called-tool-row" class="block relative text-token-text-secondary my-1.5"><div><div id="old-real-called-tool-control" role="button" class="inline-block"><div><button id="old-real-tool-list-button" type="button" aria-label="Open tool call list"><svg id="old-real-tool-list-icon" width="18" height="18" aria-hidden="true"></svg></button><span id="old-real-called-tool-label">Called tool</span><svg id="old-real-called-tool-chevron" width="16" height="16" aria-hidden="true"></svg></div></div></div></span></span>
    <span id="old-localized-tool-shell" class="group/tool-message"><span id="old-localized-tool-row" class="block relative text-token-text-secondary my-1.5"><div role="button"><button id="old-localized-list-button" type="button" aria-label="Ouvrir la liste des appels d’outils" data-state="closed"><svg id="old-localized-list-icon" width="18" height="18" aria-hidden="true"></svg></button><span id="old-localized-label">Called tool</span><svg id="old-localized-chevron" width="16" height="16" aria-hidden="true"></svg></div></span></span>
    <span id="old-direct-button-shell" class="group/tool-message"><span id="old-direct-button-placeholder"></span></span>
    <span id="unrelated-stateful-shell" class="group/tool-message"><span id="unrelated-stateful-row" class="block relative text-token-text-secondary my-1.5"><button id="unrelated-stateful-menu" type="button" aria-label="More options" aria-haspopup="menu" data-state="closed"><svg id="unrelated-stateful-menu-icon" width="18" height="18" aria-hidden="true"></svg></button><span id="unrelated-stateful-label">Settings</span><svg id="unrelated-stateful-chevron" width="16" height="16" aria-hidden="true"></svg></span></span>
    <details id="authorize-details"><summary id="authorize-summary">Authorize</summary><div>Account authorization details</div></details>
    <div id="passive-shell" class="group/tool-message">
      <button aria-expanded="false">Tools were called</button>
    </div>
    <div id="aria-only-shell" class="group/tool-message">
      <button id="aria-only-summary" aria-expanded="false" aria-label="Tools were called"></button>
    </div>
    <div id="retry-summary-shell" class="group/tool-message">
      <button aria-expanded="false">Tools were called</button>
      <button id="summary-retry">Retry</button>
    </div>
    <div id="partial-summary-shell" class="group/tool-message">
      <button id="partial-summary-button" aria-expanded="false">Number of tools called: 5</button>
    </div>
    <div id="interactive-shell" class="group/tool-message">
      <button aria-expanded="false">Tools were called</button>
      <button id="shell-connect">Connect service</button>
    </div>
    <details id="passive-details"><summary>Tools were called</summary><div>completed trace</div></details>
    <details id="interactive-details" open><summary>Tools were called</summary><button id="details-connect">Connect plugin</button></details>
    <details id="dynamic-details"><summary>Tools were called</summary><div>initial trace</div></details>
    <details id="recover-details"><summary id="recover-details-summary">Tools were called</summary><button id="recover-details-connect">Connect plugin</button></details>
    <pre id="inside-pre">conversation pre</pre>
  </div>
</section>
<section data-testid="conversation-turn-2" data-turn="assistant">
  <div class="agent-turn">
    <div id="old-loading-tool" data-testid="tool-loading"><div id="old-loading-progress" role="progressbar">Loading app template</div></div>
    <div class="grow flex flex-col">
      <div id="old-loading-placeholder-header" class="mt-2">Loading app template</div>
      <div id="old-loading-placeholder" class="no-scrollbar"></div><div class="h-px"></div>
    </div>
    <div class="grow flex flex-col">
      <div id="busy-transition-placeholder-header" class="mt-2">Ready</div>
      <div id="busy-transition-placeholder" class="no-scrollbar"></div><div class="h-px"></div>
    </div>
    <div class="grow flex flex-col">
      <div id="surface-error-placeholder-header" class="mt-2">App result</div>
      <div id="surface-error-placeholder" class="no-scrollbar"><aside id="surface-error-empty" class="surface-error" aria-label="App error" style="display:block;width:40px;height:20px"></aside></div><div class="h-px"></div>
    </div>
    <div class="grow flex flex-col">
      <div id="root-surface-error-header" class="mt-2">App error root</div>
      <aside id="root-surface-error-placeholder" class="no-scrollbar surface-error" aria-label="App error root" style="display:block;width:120px;height:24px"></aside><div class="h-px"></div>
    </div>
    <div id="embed-passive-header"><div role="button"><img alt="Calendar"><button>Menu</button>Calendar</div></div>
    <div id="embed-passive" class="no-scrollbar">passive tool output</div><div class="h-px"></div>
    <div id="embed-app-header"><div role="button"><img alt="App"><button>Menu</button>App</div></div>
    <div id="embed-app" class="no-scrollbar"><iframe id="embed-app-frame" src="about:blank" width="320" height="120"></iframe></div><div class="h-px"></div>
    <div id="config-card-header" class="mt-2 sm:mt-4"><span role="button"><img alt="Configurator">Configurator</span></div>
    <div id="config-card" class="no-scrollbar"><div style="height:240px"><iframe id="config-card-frame" title="ui://other-tool/config-editor?mode=test" src="about:blank" style="width:100%;height:100%"></iframe></div></div>
    <div id="config-card-divider" class="bg-token-border-default my-3 h-px w-full"></div>
    <div id="message-timeout-preview-header" class="mt-2 sm:mt-4"><span role="button"><img alt="Previewer">Previewer</span></div>
    <div id="message-timeout-preview" class="no-scrollbar"><div style="height:240px"><iframe id="message-timeout-preview-frame" title="ui://other-tool/file-preview" src="about:blank" style="width:100%;height:100%"></iframe></div></div>
    <div id="message-timeout-preview-divider" class="bg-token-border-default my-3 h-px w-full"></div>
    <div id="message-delivery-error" class="text-token-text-error">Message delivery timed out. Please try again. <button id="message-delivery-retry">Retry</button></div>
    <div id="preview-broken-header" class="mt-2 sm:mt-4"><span role="button"><img alt="Previewer">Previewer</span></div>
    <div id="preview-broken" class="no-scrollbar"><div id="preview-broken-wrap" style="height:37px"><iframe id="preview-broken-frame" title="ui://other-tool/file-preview" src="about:blank" style="width:100%;height:100%"></iframe></div></div>
    <div id="preview-broken-divider" class="bg-token-border-default my-3 h-px w-full"></div>
    <div id="preview-percent-header" class="mt-2 sm:mt-4"><span role="button"><img alt="Previewer">Previewer</span></div>
    <div id="preview-percent" class="no-scrollbar" style="height:37px"><div id="preview-percent-wrap" style="height:100%"><iframe id="preview-percent-frame" title="ui://other-tool/percent-preview" src="about:blank" style="width:100%;height:100%"></iframe></div></div>
    <div id="preview-percent-divider" class="bg-token-border-default my-3 h-px w-full"></div>
    <div id="preview-sibling-guard-header" class="mt-2 sm:mt-4"><span role="button"><img alt="Previewer">Previewer</span></div>
    <div id="preview-sibling-guard" class="no-scrollbar"><div style="height:37px"><iframe id="preview-sibling-guard-frame" title="ui://other-tool/sibling-preview" src="about:blank" style="width:100%;height:100%"></iframe></div></div>
    <div id="preview-sibling-guard-divider" class="bg-token-border-default my-3 h-px w-full"></div>
    <div id="preview-unrelated-tool" data-testid="tool-other"><button id="preview-unrelated-connect">Connect other tool</button></div>
    <div id="preview-replace-header" class="mt-2 sm:mt-4"><span role="button"><img alt="Previewer">Previewer</span></div>
    <div id="preview-replace" class="no-scrollbar"><div id="preview-replace-wrap" style="height:37px"><iframe id="preview-replace-frame" title="ui://other-tool/file-preview" src="about:blank" style="width:100%;height:100%"></iframe></div></div>
    <div id="preview-replace-divider" class="bg-token-border-default my-3 h-px w-full"></div>
    <div id="preview-iframe-replace-header" class="mt-2 sm:mt-4"><span role="button"><img alt="Previewer">Previewer</span></div>
    <div id="preview-iframe-replace" class="no-scrollbar"><div id="preview-iframe-replace-wrap" style="height:37px"><iframe id="preview-iframe-replace-old" title="ui://other-tool/file-preview" src="about:blank" style="width:100%;height:100%"></iframe></div></div>
    <div id="preview-iframe-replace-divider" class="bg-token-border-default my-3 h-px w-full"></div>
    <div id="preview-full-replace-header" class="mt-2 sm:mt-4"><span role="button"><img alt="Previewer">Previewer</span></div>
    <div id="preview-full-replace" class="no-scrollbar"><div style="height:37px"><iframe id="preview-full-replace-old" title="ui://other-tool/file-preview" src="about:blank" style="width:100%;height:100%"></iframe></div></div>
    <div id="preview-full-replace-divider" class="bg-token-border-default my-3 h-px w-full"></div>
    <div id="preview-success-header" class="mt-2 sm:mt-4"><span role="button"><img alt="Previewer">Previewer</span></div>
    <div id="preview-success" class="no-scrollbar"><div id="preview-success-wrap" style="height:37px"><iframe id="preview-success-frame" title="ui://other-tool/result-preview" src="about:blank" style="width:100%;height:100%"></iframe></div></div>
    <div id="preview-success-divider" class="bg-token-border-default my-3 h-px w-full"></div>
    <div id="preview-late-grow-header" class="mt-2 sm:mt-4"><span role="button"><img alt="Previewer">Previewer</span></div>
    <div id="preview-late-grow" class="no-scrollbar"><div id="preview-late-grow-wrap" style="height:37px"><iframe id="preview-late-grow-frame" title="ui://other-tool/file-preview" src="about:blank" style="width:100%;height:100%"></iframe></div></div>
    <div id="preview-late-grow-divider" class="bg-token-border-default my-3 h-px w-full"></div>
    <div id="preview-shrink-header" class="mt-2 sm:mt-4"><span role="button"><img alt="Previewer">Previewer</span></div>
    <div id="preview-shrink" class="no-scrollbar"><div id="preview-shrink-wrap" style="height:160px"><iframe id="preview-shrink-frame" title="ui://other-tool/file-preview" src="about:blank" style="width:100%;height:100%"></iframe></div></div>
    <div id="preview-shrink-divider" class="bg-token-border-default my-3 h-px w-full"></div>
    <div id="preview-error-header" class="mt-2 sm:mt-4"><span role="button"><img alt="Previewer">Previewer</span></div>
    <div id="preview-error" class="no-scrollbar"><div style="height:37px"><iframe id="preview-error-frame" title="ui://other-tool/file-preview" src="about:blank" style="width:100%;height:100%"></iframe></div></div>
    <div id="preview-error-divider" class="bg-token-border-default my-3 h-px w-full"></div>
    <aside id="preview-error-surface" class="surface-error"><button id="preview-retry">Retry</button></aside>
    <div id="embed-action-header"><div role="button"><img alt="Drive"><button>Menu</button>Drive</div></div>
    <div id="embed-action" class="no-scrollbar"><button id="embed-connect">Connect Drive</button></div><div class="h-px"></div>
    <div id="embed-trigger-action-header"><div id="embed-trigger-action-control" role="button"><img alt="Drive"><button>Menu</button>Connect Drive</div></div>
    <div id="embed-trigger-action" class="no-scrollbar">authentication pending</div><div class="h-px"></div>
    <div id="embed-dynamic-header"><div role="button"><img alt="Files"><button>Menu</button>Files</div></div>
    <div id="embed-dynamic" class="no-scrollbar"><a id="embed-dynamic-connect">Connect Files</a></div><div class="h-px"></div>
    <div id="embed-text-header"><div role="button"><img alt="Mail"><button>Menu</button><span id="embed-text-label">Mail</span></div></div>
    <div id="embed-text-dynamic" class="no-scrollbar">initial mail output</div><div class="h-px"></div>
    <div id="embed-recover-header"><div role="button"><img alt="Calendar"><button>Menu</button><span id="embed-recover-label">Loading app</span></div></div>
    <div id="embed-recover" class="no-scrollbar">passive recovered output</div><div class="h-px"></div>
  </div>
</section>
<section data-testid="conversation-turn-3" data-turn="assistant">
  <div class="agent-turn">
    <div id="reuse-passive-tool" data-testid="tool-reuse"><div>Reusable passive tool</div><div>trace</div></div>
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
<section id="stale-high-turn" data-testid="conversation-turn-99" data-turn="assistant">
  <div class="agent-turn">stale high numeric branch outlier</div>
</section>
<section data-testid="conversation-turn-7" data-turn="assistant">
  <div class="agent-turn">
    <div class="grow flex flex-col">
      <div id="dynamic-header-placeholder-header" class="mt-2"><a id="dynamic-header-connect" aria-label="Connect" style="display:block;width:20px;height:20px"></a></div>
      <div id="dynamic-header-placeholder-body" class="no-scrollbar live-box"></div><div class="h-px"></div>
    </div>
  </div>
</section>
<section data-testid="conversation-turn-8" data-turn="assistant">
  <div class="agent-turn">
    <div id="live-tool" class="live-box" data-testid="tool-live"><div>Live tool</div><div id="live-app-motion" class="transition-fixture" role="progressbar">loading</div></div>
    <pre id="live-pre">streaming code block</pre>
    <div id="live-shell" class="group/tool-message live-box"><button id="live-tool-summary" aria-expanded="false">ツールが呼び出されました</button><div id="live-shell-body">live tool body</div></div>
    <span id="real-called-tool-shell" class="group/tool-message"><span id="real-called-tool-row" class="block first:mt-0 relative text-token-text-secondary hover:text-token-text-primary my-1.5"><div class="group start-0 top-0 me-1.5 overflow-hidden mt-1 text-start"><div id="real-called-tool-control" role="button" class="inline-block"><div class="flex items-center justify-start gap-1"><button id="real-tool-list-button" type="button" aria-label="Open tool call list" data-state="closed"><svg id="real-tool-list-icon" width="18" height="18" aria-hidden="true"></svg></button><span id="real-called-tool-label" class="text-start">Called tool</span><svg id="real-called-tool-chevron" width="16" height="16" aria-hidden="true" class="icon-sm"></svg></div></div></div></span></span>
    <span id="real-called-tool-ja-shell" class="group/tool-message"><span id="real-called-tool-ja-row" class="block my-1.5"><div><div role="button" class="inline-block"><div><button id="real-tool-list-ja-button" type="button" aria-label="ツール呼び出しリストを開く"><svg id="real-tool-list-ja-icon" width="18" height="18" aria-hidden="true"></svg></button><span id="real-called-tool-ja-label">ツールが呼び出されました</span><svg id="real-called-tool-ja-chevron" width="16" height="16" aria-hidden="true"></svg></div></div></div></span></span>
    <span id="real-called-tool-app-shell" class="group/tool-message live-box"><span id="real-called-tool-app-row" class="block my-1.5"><div><div role="button" class="inline-block"><div><button type="button" aria-label="Open tool call list"><svg width="18" height="18" aria-hidden="true"></svg></button><span>Called tool</span><svg width="16" height="16" aria-hidden="true"></svg></div></div></div></span><div id="real-called-tool-app-loader" class="no-scrollbar live-box" role="progressbar">Loading app template</div></span>
    <span id="real-called-tool-action-shell" class="group/tool-message live-box"><span id="real-called-tool-action-row" class="block my-1.5"><div><div role="button" class="inline-block"><div><button type="button" aria-label="Open tool call list"><svg width="18" height="18" aria-hidden="true"></svg></button><span>Called tool</span><svg width="16" height="16" aria-hidden="true"></svg></div></div></div></span><button id="real-called-tool-connect">Connect service</button></span>
    <span id="real-called-tool-play-shell" class="group/tool-message live-box"><span class="block my-1.5"><div><div role="button" class="inline-block"><div><button type="button" aria-label="Open tool call list"><svg width="18" height="18" aria-hidden="true"></svg></button><span>Called tool</span><svg width="16" height="16" aria-hidden="true"></svg></div></div></div></span><div><div><button id="real-called-tool-play">Play</button></div></div></span>
    <span id="real-called-tool-role-link-shell" class="group/tool-message live-box"><span class="block my-1.5"><div role="button"><button type="button" aria-label="Open tool call list"><svg width="18" height="18" aria-hidden="true"></svg></button><span>Called tool</span><svg width="16" height="16" aria-hidden="true"></svg></div></span><div id="real-role-link" role="link" tabindex="0">Called tool</div></span>
    <span id="real-called-tool-role-button-shell" class="group/tool-message live-box"><span class="block my-1.5"><div role="button"><button type="button" aria-label="Open tool call list"><svg width="18" height="18" aria-hidden="true"></svg></button><span>Called tool</span><svg width="16" height="16" aria-hidden="true"></svg></div></span><div id="real-role-button" role="button" tabindex="0">Called tool</div></span>
    <span id="real-called-tool-tabindex-shell" class="group/tool-message live-box"><span class="block my-1.5"><div role="button"><button type="button" aria-label="Open tool call list"><svg width="18" height="18" aria-hidden="true"></svg></button><span>Called tool</span><svg width="16" height="16" aria-hidden="true"></svg></div></span><div id="real-tabindex-control" tabindex="0">Called tool</div></span>
    <span id="real-called-tool-direct-svg-shell" class="group/tool-message live-box"><span class="block my-1.5"><button type="button" aria-label="Open tool call list"><svg width="18" height="18" aria-hidden="true"></svg></button><span>Called tool</span><svg width="16" height="16" aria-hidden="true"></svg></span><svg id="real-called-tool-direct-svg" width="96" height="44"><rect width="96" height="44"></rect></svg></span>
    <span id="real-called-tool-direct-img-shell" class="group/tool-message live-box"><span class="block my-1.5"><button type="button" aria-label="Open tool call list"><svg width="18" height="18" aria-hidden="true"></svg></button><span>Called tool</span><svg width="16" height="16" aria-hidden="true"></svg></span><img id="real-called-tool-direct-img" alt="App output" style="display:block;width:96px;height:44px"></span>
    <span id="real-called-tool-markdown-image-shell" class="group/tool-message live-box"><span class="block my-1.5"><button type="button" aria-label="Open tool call list"><svg width="18" height="18" aria-hidden="true"></svg></button><span>Called tool</span><svg width="16" height="16" aria-hidden="true"></svg></span><div class="markdown"><img id="real-called-tool-markdown-image" alt="Generated result" style="display:block;width:96px;height:44px"></div></span>
    <div id="live-weird-app-shell" class="group/tool-message live-box"><div id="live-weird-summary"><svg width="16" height="16"><path d="M2 5 L8 11 L14 5"></path></svg><span>ツールが呼び出されました</span></div><div id="live-weird-loader" role="progressbar">Loading app template</div></div>
    <div id="live-classless-app" class="live-box"><div id="live-classless-summary"><svg width="16" height="16"><path d="M2 5 L8 11 L14 5"></path></svg><span>ツールが</span><span>呼び出されました</span></div><div id="live-classless-loader" role="progressbar">Loading app template</div><button id="live-classless-retry">Retry</button></div>
    <div id="classless-label-app-media" class="live-box"><span>Called tool</span><svg id="classless-label-app-svg" width="96" height="44" role="img" aria-label="Generated App chart"><rect width="96" height="44"></rect></svg></div>
    <div class="markdown"><p id="literal-tool-summary-text">ツールが呼び出されました</p></div>
    <div id="live-app-shell" class="group/tool-message live-box"><button id="live-app-summary" aria-expanded="false">Tools were called</button><div id="live-app-shell-loader" role="progressbar">Loading app template</div><div id="live-app-shell-placeholder" class="no-scrollbar live-box"></div></div>
    <div id="live-interactive-shell" class="group/tool-message live-box"><button id="live-interactive-summary" aria-expanded="false">Tools were called</button><button id="live-shell-connect">Connect service</button><div id="live-interactive-body">live interactive body</div></div>
    <div id="live-collapsed-shell" class="group/tool-message live-box"><button id="live-collapsed-summary" aria-expanded="false">Tools were called</button><div id="live-collapsed-body" style="display:none"><button id="live-collapsed-connect">Connect account</button></div></div>
    <details id="live-details"><summary id="live-details-summary">Tools were called</summary><button id="live-details-connect">Connect account</button></details>
    <details id="live-bootstrap-details" open><summary id="live-bootstrap-details-summary">Tools were called</summary><div id="live-bootstrap-details-loader" class="no-scrollbar live-box" role="progressbar">Loading app template</div></details>
    <details id="live-passive-details"><summary id="live-passive-details-summary">Tools were called</summary><div>passive live detail</div></details>
    <div id="live-dynamic-summary-shell" class="group/tool-message live-box"><button id="live-dynamic-summary" aria-expanded="false">Tools were called</button><div>dynamic summary body</div></div>
    <div id="live-embed-header"><div role="button"><img alt="LiveApp"><button>Menu</button>LiveApp</div></div>
    <div id="live-embed" class="no-scrollbar live-box">loading app</div><div class="h-px"></div>
    <div class="grow flex flex-col">
      <div id="live-placeholder-header" class="mt-2">Loading app template</div>
      <div id="live-placeholder" class="no-scrollbar live-box"></div><div class="h-px"></div>
    </div>
    <aside id="live-app-error" class="text-token-text-error surface-error">
      <h3 class="text-token-text-error">Error loading app</h3><div>Failed to fetch template</div><button id="live-retry">Retry</button>
    </aside>
  </div>
</section>
<script>
const SETTINGS={settings};
window.chrome={{runtime:{{onMessage:{{addListener(){{}}}}}},storage:{{local:{{get(defaults,cb){{
  cb(Object.assign({{}},defaults,{{uiLanguage:'en',settings:SETTINGS}}));
}}}}}}}};
</script>
<script>{PREHIDE_JS}</script>
<script>
{{
  // Current ChatGPT builds the disclosure wrapper via DOM APIs as a real
  // <button> containing the icon-only Open-tool-list <button>. HTML parsing
  // would auto-close nested buttons, so reproduce the production DOM here
  // after parsing. The outer wrapper is passive chrome, not an App action.
  for (const id of ['real-called-tool-control','old-real-called-tool-control']) {{
    const oldOuter=document.getElementById(id);
    const nativeOuter=document.createElement('button');
    nativeOuter.id=oldOuter.id;
    nativeOuter.type='button';
    nativeOuter.className=oldOuter.className;
    while (oldOuter.firstChild) nativeOuter.appendChild(oldOuter.firstChild);
    oldOuter.replaceWith(nativeOuter);
  }}
  {{
    const placeholder=document.getElementById('old-direct-button-placeholder');
    const outer=document.createElement('button');
    outer.id='old-direct-button-row'; outer.type='button'; outer.className='block relative text-token-text-secondary my-1.5';
    const inner=document.createElement('button');
    inner.id='old-direct-list-button'; inner.type='button'; inner.setAttribute('aria-label','Liste der Werkzeugaufrufe öffnen'); inner.dataset.state='closed';
    const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
    icon.id='old-direct-list-icon'; icon.setAttribute('width','18'); icon.setAttribute('height','18'); icon.setAttribute('aria-hidden','true');
    const label=document.createElement('span'); label.id='old-direct-label'; label.textContent='Called tool';
    const chevron=document.createElementNS('http://www.w3.org/2000/svg','svg');
    chevron.id='old-direct-chevron'; chevron.setAttribute('width','16'); chevron.setAttribute('height','16'); chevron.setAttribute('aria-hidden','true');
    outer.append(inner,label,chevron); inner.appendChild(icon); placeholder.replaceWith(outer);
  }}
  const passiveShell=document.getElementById('real-called-tool-shell');
  const passiveRow=document.getElementById('real-called-tool-row');
  const passiveShellStyle=getComputedStyle(passiveShell), passiveRowStyle=getComputedStyle(passiveRow);
  const passiveRowRect=passiveRow.getBoundingClientRect();
  const passiveIds=['real-tool-list-button','real-tool-list-icon','real-called-tool-label','real-called-tool-chevron'];
  window.__preContentNestedPassiveZero = passiveShellStyle.position!=='absolute' && Number(passiveShellStyle.opacity)!==0 &&
    passiveRowStyle.position==='absolute' && Number(passiveRowStyle.opacity)===0 &&
    passiveRowRect.width===0 && passiveRowRect.height===0 && passiveIds.every(id => {{
      const rect=document.getElementById(id).getBoundingClientRect();
      return rect.width===0 && rect.height===0;
    }});
  const oldPassiveRow=document.getElementById('old-real-called-tool-row');
  const oldPassiveRect=oldPassiveRow.getBoundingClientRect(), oldPassiveStyle=getComputedStyle(oldPassiveRow);
  window.__preContentOldNativePassiveZero = oldPassiveStyle.position==='absolute' && Number(oldPassiveStyle.opacity)===0 &&
    oldPassiveRect.width===0 && oldPassiveRect.height===0 &&
    ['old-real-tool-list-button','old-real-tool-list-icon','old-real-called-tool-label','old-real-called-tool-chevron'].every(id => {{
      const rect=document.getElementById(id).getBoundingClientRect();
      return rect.width===0 && rect.height===0;
    }});
  window.__preContentLocalizedPassiveZero = ['old-localized-tool-row','old-localized-list-button','old-localized-list-icon','old-localized-label','old-localized-chevron'].every(id => {{
    const rect=document.getElementById(id).getBoundingClientRect(); return rect.width===0 && rect.height===0;
  }});
  window.__preContentDirectButtonPassiveZero = ['old-direct-button-row','old-direct-list-button','old-direct-list-icon','old-direct-label','old-direct-chevron'].every(id => {{
    const rect=document.getElementById(id).getBoundingClientRect(); return rect.width===0 && rect.height===0;
  }});
  {{
    const row=document.getElementById('unrelated-stateful-row');
    const menu=document.getElementById('unrelated-stateful-menu');
    const rs=getComputedStyle(row), ms=getComputedStyle(menu), rr=row.getBoundingClientRect(), mr=menu.getBoundingClientRect();
    window.__preContentUnrelatedStatefulVisible = rs.position!=='absolute' && Number(rs.opacity)!==0 && rr.width>0 && rr.height>0 &&
      ms.display!=='none' && Number(ms.opacity)!==0 && mr.width>0 && mr.height>0;
  }}
  const appShell=document.getElementById('real-called-tool-app-shell');
  const appRow=document.getElementById('real-called-tool-app-row');
  const appRowStyle=getComputedStyle(appRow), appRowRect=appRow.getBoundingClientRect();
  const appLoader=document.getElementById('real-called-tool-app-loader');
  const appLoaderStyle=getComputedStyle(appLoader), appLoaderRect=appLoader.getBoundingClientRect();
  window.__preContentAppGeometryPreserved = getComputedStyle(appShell).position!=='absolute' &&
    appRowStyle.position!=='absolute' && appRowRect.width>0 && appRowRect.height>0 &&
    appLoaderStyle.display!=='none' && Number(appLoaderStyle.opacity)!==0 && appLoaderRect.width>0 && appLoaderRect.height>0;
}}
</script>
<script>
{{
  const shell=document.getElementById('real-called-tool-play-shell');
  const play=document.getElementById('real-called-tool-play');
  const ss=getComputedStyle(shell), ps=getComputedStyle(play), pr=play.getBoundingClientRect();
  window.__preContentGenericPlayVisible = ss.position!=='absolute' && Number(ss.opacity)!==0 && ps.display!=='none' && Number(ps.opacity)!==0 && pr.width>0 && pr.height>0;
  window.__preContentSemanticActionsVisible = ['real-role-link','real-role-button','real-tabindex-control'].every(id => {{
    const control=document.getElementById(id), host=control.closest('[class~="group/tool-message"]');
    const hs=getComputedStyle(host), cs=getComputedStyle(control), rect=control.getBoundingClientRect();
    return hs.position!=='absolute' && Number(hs.opacity)!==0 && cs.display!=='none' && Number(cs.opacity)!==0 && rect.width>0 && rect.height>0;
  }});
}}
</script>
<script>{CONTENT_JS}</script>
<script>
window.__clicks={{}};
const ACTION_IDS=['connector','library','inner-connect','auth-link','aria-switch','thinking-connect','shell-connect','summary-retry','details-connect','embed-connect',
  'placeholder-connect','header-connect','dynamic-tool-connect','dynamic-details-connect','embed-dynamic-connect','dynamic-placeholder-connect','dynamic-header-connect','heavy-connect','live-shell-connect','live-collapsed-connect','live-classless-retry','real-called-tool-connect','real-called-tool-play','real-role-link','real-role-button','real-tabindex-control','unrelated-stateful-menu','preview-unrelated-connect','message-delivery-retry','preview-retry'];
function registerAction(id) {{
  const el=document.getElementById(id);
  if (!el || el.dataset.csgTestBound==='1') return;
  el.dataset.csgTestBound='1';
  el.addEventListener('click', () => {{ window.__clicks[id]=(window.__clicks[id]||0)+1; }});
}}
for (const id of ACTION_IDS) registerAction(id);
registerAction('live-retry');
registerAction('live-tool-summary');
registerAction('live-interactive-summary');
registerAction('live-details-summary');
registerAction('live-details-connect');
const liveCollapsedSummary=document.getElementById('live-collapsed-summary');
liveCollapsedSummary.addEventListener('click', () => {{
  liveCollapsedSummary.setAttribute('aria-expanded','true');
  document.getElementById('live-collapsed-body').style.display='block';
  window.__collapsedAutoExpanded=true;
}});
function snapshot(id) {{
  const el=document.getElementById(id);
  const style=getComputedStyle(el);
  const markerStyle=el.matches('summary') ? getComputedStyle(el,'::marker') : null;
  const rect=el.getBoundingClientRect();
  return {{classes:[...el.classList],previewState:el.getAttribute('data-csg-preview-state')||'',previewDivider:el.getAttribute('data-csg-preview-divider')||'',display:style.display,visibility:style.visibility,opacity:style.opacity,
    position:style.position,pointerEvents:style.pointerEvents,transitionDuration:style.transitionDuration,animationDuration:style.animationDuration,
    fontSize:style.fontSize,lineHeight:style.lineHeight,textIndent:style.textIndent,overflow:style.overflow,whiteSpace:style.whiteSpace,
    marginBlockStart:style.marginBlockStart,marginBlockEnd:style.marginBlockEnd,
    collapseBlock:el.style.getPropertyValue('--csg-collapse-block'),
    contentVisibility:style.contentVisibility,width:rect.width,height:rect.height,
    markerContent:markerStyle?.content||'',markerFontSize:markerStyle?.fontSize||''}};
}}
function summaryGone(id) {{
  const el=document.getElementById(id);
  const state=snapshot(id);
  if (state.classes.includes('csg-tool-summary-live') ||
      state.classes.includes('csg-prehide-tool-summary-row-live')) {{
    // Live rows remain mounted. A summary-only structural shell may itself be
    // removed from flex flow; App/action-capable shells must retain geometry.
    const shell=el.closest('[class~="group/tool-message"]');
    if (shell?.classList.contains('csg-tool-ui')) {{
      const ss=getComputedStyle(shell), sr=shell.getBoundingClientRect();
      return state.display!=='none' && state.opacity==='0' && ss.position==='absolute' && sr.width===0 && sr.height===0;
    }}
    return state.display!=='none' && state.opacity==='0' && state.width>0 && state.height>0;
  }}
  if (state.classes.includes('csg-tool-summary')) {{
    return state.display!=='none' && state.opacity==='0' && state.pointerEvents==='none';
  }}
  if (!state.classes.includes('csg-tool-summary-stealth')) return false;
  const markerGone = !el.matches('summary') ||
    state.markerFontSize==='0px' || state.markerContent==='none' || state.markerContent==='""';
  const arrow=el.querySelector('svg,[class*="chevron"],[class*="arrow"]');
  const arrowRect=arrow?.getBoundingClientRect();
  const arrowGone=!arrow || (arrowRect.width===0 && arrowRect.height===0);
  return state.opacity==='0' && state.pointerEvents!=='none' && markerGone && arrowGone;
}}
function summaryHidden(id) {{ return summaryGone(id); }}
function naturalBoxHeight(id) {{
  const source=document.getElementById(id);
  const clone=source.cloneNode(true);
  clone.removeAttribute('id');
  clone.classList.remove(
    'csg-trace-body','csg-heavy','csg-tool-summary','csg-tool-summary-live',
    'csg-tool-summary-stealth','csg-tool-ui'
  );
  clone.style.removeProperty('--csg-collapse-block');
  clone.style.position='absolute'; clone.style.visibility='hidden'; clone.style.pointerEvents='none';
  clone.style.inlineSize=`${{source.getBoundingClientRect().width}}px`;
  document.body.appendChild(clone);
  const height=clone.getBoundingClientRect().height;
  clone.remove();
  return height;
}}
function zeroRect(id) {{
  const state=snapshot(id);
  return state.width===0 && state.height===0;
}}
function physicallyRendered(id) {{
  const el=document.getElementById(id);
  el.scrollIntoView({{block:'center',inline:'nearest'}});
  const style=getComputedStyle(el); const rect=el.getBoundingClientRect();
  if (!rect.width || !rect.height || style.display==='none' || style.visibility==='hidden' || Number(style.opacity)===0) return false;
  const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
  return Boolean(hit && (hit===el || el.contains(hit)));
}}
function hitClick(id) {{
  const el=document.getElementById(id);
  el.scrollIntoView({{block:'center',inline:'nearest'}});
  const rect=el.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
  const target=hit?.closest?.('button,summary,a[href],[role="button"],[role="link"],[role="switch"],[tabindex]:not([tabindex="-1"])');
  target?.dispatchEvent(new MouseEvent('click',{{bubbles:true,cancelable:true,view:window}}));
  return Boolean(hit && (hit===el || el.contains(hit)));
}}
setTimeout(() => {{
  window.__busyTransitionInitiallyHidden = !snapshot('busy-transition-placeholder').classes.includes('csg-prehide-tool-block') && snapshot('busy-transition-placeholder').display!=='none';
}}, 240);
setTimeout(() => {{
  const busyHeader=document.getElementById('busy-transition-placeholder-header');
  busyHeader.textContent='Loading app template';
  busyHeader.setAttribute('role','progressbar');
}}, 270);
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
  const dynamicClassless=document.createElement('div');
  dynamicClassless.id='dynamic-classless-tool';
  dynamicClassless.innerHTML='<div id="dynamic-classless-summary"><svg width="14" height="14"><path d="M2 4 L7 9 L12 4"></path></svg><span>Tools were</span><span> called</span></div><div id="dynamic-classless-body" class="live-box">dynamic body</div>';
  document.querySelector('[data-testid="conversation-turn-8"] .agent-turn').appendChild(dynamicClassless);
  const fragmented=document.createElement('div');
  fragmented.id='dynamic-fragmented-tool';
  const fragmentedSummary=document.createElement('div'); fragmentedSummary.id='dynamic-fragmented-summary';
  for (const ch of 'ツールが呼び出されました') {{ const span=document.createElement('span'); span.textContent=ch; fragmentedSummary.appendChild(span); }}
  const fragmentedBody=document.createElement('div'); fragmentedBody.id='dynamic-fragmented-body'; fragmentedBody.className='live-box'; fragmentedBody.textContent='fragmented body';
  fragmented.append(fragmentedSummary,fragmentedBody);
  document.querySelector('[data-testid="conversation-turn-8"] .agent-turn').appendChild(fragmented);
  const incremental=document.createElement('div'); incremental.id='dynamic-incremental-tool';
  const incrementalSummary=document.createElement('div'); incrementalSummary.id='dynamic-incremental-summary';
  const incrementalText=document.createTextNode(''); incrementalSummary.appendChild(incrementalText);
  const incrementalBody=document.createElement('div'); incrementalBody.id='dynamic-incremental-body'; incrementalBody.className='live-box'; incrementalBody.textContent='incremental body';
  incremental.append(incrementalSummary,incrementalBody);
  document.querySelector('[data-testid="conversation-turn-8"] .agent-turn').appendChild(incremental);
  [...'ツールが呼び出されました'].forEach((ch,index) => setTimeout(() => {{ incrementalText.data+=ch; }}, index*6));
  const lateHistorical=document.createElement('section');
  lateHistorical.setAttribute('data-testid','conversation-turn-0');
  const lateAgent=document.createElement('div'); lateAgent.className='agent-turn';
  for (let i=0;i<400;i++) {{ const span=document.createElement('span'); span.textContent=`late-noise-${{i}}`; lateAgent.appendChild(span); }}
  const lateSummary=document.createElement('div'); lateSummary.id='late-historical-summary'; lateSummary.innerHTML='<span>Tools </span><span>were called</span>';
  const lateBody=document.createElement('div'); lateBody.id='late-historical-body'; lateBody.className='live-box'; lateBody.textContent='late historical body';
  lateAgent.append(lateSummary,lateBody); lateHistorical.appendChild(lateAgent);
  document.body.insertBefore(lateHistorical,document.querySelector('[data-testid="conversation-turn-1"]'));
  for (const id of ACTION_IDS) registerAction(id);
}}, 300);
setTimeout(() => {{
  const motion=snapshot('live-app-motion');
  const trace=snapshot('inside-motion');
  const traceNaturalHeight=naturalBoxHeight('inside-motion');
  window.__liveBeforeAge={{
    tool:physicallyRendered('live-tool'),
    traceFlowOptimizationActive:trace.classes.includes('csg-trace-body') &&
      trace.opacity==='0' && trace.pointerEvents==='none',
    oldLoadingToolVisible:!snapshot('old-loading-tool').classes.includes('csg-tool') && physicallyRendered('old-loading-tool'),
    oldLoadingPlaceholderUnhidden:!snapshot('old-loading-placeholder').classes.includes('csg-prehide-tool-block') && snapshot('old-loading-placeholder').display!=='none' && snapshot('old-loading-placeholder-header').display!=='none',
    busyTransitionWasHidden:window.__busyTransitionInitiallyHidden===true,
    busyTransitionReleased:!snapshot('busy-transition-placeholder').classes.includes('csg-prehide-tool-block') && snapshot('busy-transition-placeholder').display!=='none' && snapshot('busy-transition-placeholder-header').display!=='none',
    embedRecoverLoadingVisible:!snapshot('embed-recover').classes.includes('csg-tool-embed') && physicallyRendered('embed-recover'),
    livePreNative:!snapshot('live-pre').classes.includes('csg-heavy') && snapshot('live-pre').contentVisibility!=='auto' && physicallyRendered('live-pre'),
    shell:physicallyRendered('live-shell'),
    summaryGone:summaryGone('live-tool-summary'),
    shellBody:physicallyRendered('live-shell-body'),
    realCalledToolPrehideEnabled:document.documentElement.classList.contains('csg-prehide-tool-summary'),
    oldNativeHistoricalHandoff:(() => {{
      const row=snapshot('old-real-called-tool-row'), shell=snapshot('old-real-called-tool-shell');
      return row.classes.includes('csg-tool-summary') && row.opacity==='0' &&
        shell.classes.includes('csg-tool-ui') && shell.position==='absolute' && shell.width===0 && shell.height===0 &&
        ['old-real-called-tool-control','old-real-tool-list-button','old-real-tool-list-icon','old-real-called-tool-label','old-real-called-tool-chevron'].every(zeroRect);
    }})(),
    realCalledToolPreContentNestedPassiveZero:window.__preContentNestedPassiveZero===true,
    oldNativePreContentPassiveZero:window.__preContentOldNativePassiveZero===true,
    localizedPreContentPassiveZero:window.__preContentLocalizedPassiveZero===true,
    directOuterButtonPreContentPassiveZero:window.__preContentDirectButtonPassiveZero===true,
    unrelatedStatefulPreContentVisible:window.__preContentUnrelatedStatefulVisible===true,
    unrelatedStatefulRemainsActionable:!snapshot('unrelated-stateful-row').classes.some(c=>c.startsWith('csg-tool-summary')||c==='csg-tool-ui') && physicallyRendered('unrelated-stateful-menu'),
    localizedHistoricalHandoff:(() => {{
      const row=snapshot('old-localized-tool-row'), shell=snapshot('old-localized-tool-shell');
      return row.classes.includes('csg-tool-summary') && row.opacity==='0' &&
        shell.classes.includes('csg-tool-ui') && shell.position==='absolute' && shell.width===0 && shell.height===0 &&
        ['old-localized-list-button','old-localized-list-icon','old-localized-label','old-localized-chevron'].every(zeroRect);
    }})(),
    authorizeSummaryRemainsActionable:!document.getElementById('authorize-details').classList.contains('csg-tool-ui') && physicallyRendered('authorize-summary'),
    realCalledToolPreContentAppGeometryPreserved:window.__preContentAppGeometryPreserved===true,
    realCalledToolLiveSummaryOnlyOffFlow:document.getElementById('real-called-tool-row').classList.contains('csg-tool-summary-live') &&
      snapshot('real-called-tool-shell').classes.includes('csg-tool-ui') && snapshot('real-called-tool-shell').position==='absolute' &&
      zeroRect('real-called-tool-shell') && summaryGone('real-called-tool-row'),
    realCalledToolTextPreserved:document.getElementById('real-called-tool-shell').textContent.includes('Called tool'),
    realCalledToolJaMarked:document.getElementById('real-called-tool-ja-row').classList.contains('csg-tool-summary-live'),
    realCalledToolJaLiveSummaryOnlyOffFlow:snapshot('real-called-tool-ja-shell').classes.includes('csg-tool-ui') &&
      snapshot('real-called-tool-ja-shell').position==='absolute' && zeroRect('real-called-tool-ja-shell') && summaryGone('real-called-tool-ja-row'),
    realCalledToolAppShellVisible:!snapshot('real-called-tool-app-shell').classes.includes('csg-tool-ui') && snapshot('real-called-tool-app-shell').position!=='absolute' && physicallyRendered('real-called-tool-app-shell'),
    realCalledToolAppRowInvisibleAndSized:summaryGone('real-called-tool-app-row'),
    realCalledToolAppLoaderVisible:physicallyRendered('real-called-tool-app-loader'),
    realCalledToolActionShellVisible:!snapshot('real-called-tool-action-shell').classes.includes('csg-tool-ui') && snapshot('real-called-tool-action-shell').position!=='absolute' && physicallyRendered('real-called-tool-action-shell'),
    realCalledToolActionRowInvisibleAndSized:summaryGone('real-called-tool-action-row'),
    realCalledToolConnectVisible:physicallyRendered('real-called-tool-connect'),
    preContentGenericPlayVisible:window.__preContentGenericPlayVisible===true,
    preContentSemanticActionsVisible:window.__preContentSemanticActionsVisible===true,
    genericPlayShellFailsOpen:snapshot('real-called-tool-play-shell').position!=='absolute' && physicallyRendered('real-called-tool-play'),
    semanticActionShellsFailOpen:['real-role-link','real-role-button','real-tabindex-control'].every(id => {{
      const control=document.getElementById(id), host=control.closest('[class~="group/tool-message"]');
      return snapshot(host.id).position!=='absolute' && physicallyRendered(id);
    }}),
    classlessExactLabelAppMediaFailsOpen:!snapshot('classless-label-app-media').classes.some(c=>c.startsWith('csg-tool-summary')||c==='csg-tool-ui') && physicallyRendered('classless-label-app-svg'),
    directSvgAppShellVisible:snapshot('real-called-tool-direct-svg-shell').position!=='absolute' && snapshot('real-called-tool-direct-svg-shell').opacity==='1' && physicallyRendered('real-called-tool-direct-svg'),
    directImgAppShellVisible:snapshot('real-called-tool-direct-img-shell').position!=='absolute' && snapshot('real-called-tool-direct-img-shell').opacity==='1' && physicallyRendered('real-called-tool-direct-img'),
    markdownImgAppShellVisible:snapshot('real-called-tool-markdown-image-shell').position!=='absolute' &&
      snapshot('real-called-tool-markdown-image-shell').opacity==='1' && physicallyRendered('real-called-tool-markdown-image'),
    weirdShellVisible:!snapshot('live-weird-app-shell').classes.includes('csg-tool-ui') && physicallyRendered('live-weird-app-shell'),
    weirdSummaryGone:summaryGone('live-weird-summary'),
    weirdLoaderVisible:physicallyRendered('live-weird-loader'),
    classlessAppVisible:physicallyRendered('live-classless-app'),
    classlessSummaryGone:summaryGone('live-classless-summary'),
    classlessLoaderVisible:physicallyRendered('live-classless-loader'),
    classlessRetryVisible:physicallyRendered('live-classless-retry'),
    literalMarkdownPreserved:!snapshot('literal-tool-summary-text').classes.some(c=>c.startsWith('csg-tool-summary')) && physicallyRendered('literal-tool-summary-text'),
    dynamicClasslessSummaryGone:summaryGone('dynamic-classless-summary'),
    dynamicClasslessBodyVisible:physicallyRendered('dynamic-classless-body'),
    fragmentedSummaryGone:summaryGone('dynamic-fragmented-summary'),
    fragmentedBodyVisible:physicallyRendered('dynamic-fragmented-body'),
    incrementalSummaryGone:summaryGone('dynamic-incremental-summary'),
    incrementalBodyVisible:physicallyRendered('dynamic-incremental-body'),
    appShellVisible:!snapshot('live-app-shell').classes.includes('csg-tool-ui') && physicallyRendered('live-app-shell'),
    appSummaryGone:summaryGone('live-app-summary'),
    appLoaderVisible:physicallyRendered('live-app-shell-loader'),
    appPlaceholderVisible:physicallyRendered('live-app-shell-placeholder'),
    interactiveShell:physicallyRendered('live-interactive-shell'),
    interactiveSummaryGone:summaryGone('live-interactive-summary'),
    interactiveBody:physicallyRendered('live-interactive-body'),
    interactiveConnect:physicallyRendered('live-shell-connect'),
    collapsedSummaryGone:summaryGone('live-collapsed-summary'),
    collapsedNotAutoExpanded:window.__collapsedAutoExpanded!==true && document.getElementById('live-collapsed-summary').getAttribute('aria-expanded')==='false',
    collapsedManualOpen:hitClick('live-collapsed-summary') && window.__collapsedAutoExpanded===true && physicallyRendered('live-collapsed-connect'),
    detailsSummaryGone:summaryGone('live-details-summary'),
    detailsNotAutoOpened:!document.getElementById('live-details').open,
    detailsManualOpen:hitClick('live-details-summary') && document.getElementById('live-details').open && physicallyRendered('live-details-connect') && hitClick('live-details-connect'),
    bootstrapDetailsSummaryGone:summaryGone('live-bootstrap-details-summary'),
    bootstrapDetailsUntouched:document.getElementById('live-bootstrap-details').open && physicallyRendered('live-bootstrap-details-loader'),
    passiveDetailsSummaryGone:summaryGone('live-passive-details-summary') && !document.getElementById('live-passive-details').open,
    dynamicSummaryGone:summaryGone('live-dynamic-summary'),
    embed:physicallyRendered('live-embed'),
    placeholder:physicallyRendered('live-placeholder'),
    recentPlaceholder:physicallyRendered('dynamic-header-placeholder-body'),
    error:physicallyRendered('live-app-error'),
    motion:physicallyRendered('live-app-motion') && motion.transitionDuration==='2s' && motion.animationDuration==='2s',
    retryHit:hitClick('live-retry')
  }};
}}, 500);
setTimeout(() => {{
  document.getElementById('embed-recover-label').textContent='Calendar';
  // A passive native Called tool row may later acquire an App mount. The CSS
  // flow suppression must fail open immediately when that lifecycle surface appears.
  const nativeShell=document.getElementById('real-called-tool-ja-shell');
  const nativeLoader=document.createElement('div');
  nativeLoader.id='real-called-tool-ja-dynamic-loader';
  nativeLoader.className='no-scrollbar live-box';
  nativeLoader.setAttribute('role','progressbar');
  nativeLoader.textContent='Loading app template';
  nativeShell.appendChild(nativeLoader);
}}, 600);
setTimeout(() => {{
  document.body.insertAdjacentHTML('beforeend','<section data-testid="conversation-turn-9" data-turn="assistant"><div class="agent-turn">next assistant turn</div></section>');
}}, 650);
setTimeout(() => {{
  document.getElementById('live-dynamic-summary').textContent='Tool status ready';
  const oldProgress=document.getElementById('old-loading-progress');
  oldProgress.removeAttribute('role');
  oldProgress.textContent='App ready';
  document.getElementById('old-loading-placeholder-header').textContent='App ready';
  const appShellLoader=document.getElementById('live-app-shell-loader');
  appShellLoader.removeAttribute('role');
  appShellLoader.textContent='App ready';
  const weirdLoader=document.getElementById('live-weird-loader');
  weirdLoader.removeAttribute('role');
  weirdLoader.textContent='App ready';
  const bootstrapDetailsLoader=document.getElementById('live-bootstrap-details-loader');
  bootstrapDetailsLoader.removeAttribute('role');
  bootstrapDetailsLoader.textContent='App ready';
  const busyHeader=document.getElementById('busy-transition-placeholder-header');
  busyHeader.removeAttribute('role');
  busyHeader.textContent='Ready';
}}, 800);
setTimeout(() => {{
  document.getElementById('recover-details-connect')?.remove();
  document.getElementById('preview-success-wrap').style.height='160px';
  document.getElementById('preview-shrink-wrap').style.height='37px';
}}, 900);
setTimeout(() => {{
  const settledTrace=snapshot('inside-motion');
  const settledTraceNaturalHeight=naturalBoxHeight('inside-motion');
  window.__oneStepProtected={{
    traceFlowSettledNeutral:settledTrace.classes.includes('csg-trace-body') && settledTraceNaturalHeight>0 &&
      Math.abs((Number.parseFloat(settledTrace.collapseBlock)||0)-settledTraceNaturalHeight)<0.5 &&
      Math.abs(Number.parseFloat(settledTrace.marginBlockStart)||0)<0.5 &&
      Math.abs((Number.parseFloat(settledTrace.marginBlockEnd)||0)+settledTraceNaturalHeight)<0.5,
    error:!snapshot('live-app-error').classes.includes('csg-old-app-load-error') && physicallyRendered('live-app-error'),
    retry:physicallyRendered('live-retry'),
    dynamicSummaryReleased:!snapshot('live-dynamic-summary').classes.some(c=>c.startsWith('csg-tool-summary')) && physicallyRendered('live-dynamic-summary'),
    nativeCalledToolAppFailOpen:snapshot('real-called-tool-ja-shell').position!=='absolute' && physicallyRendered('real-called-tool-ja-dynamic-loader'),
    oldLoadingToolOptimized:snapshot('old-loading-tool').classes.includes('csg-tool') && snapshot('old-loading-tool').display!=='none',
    oldLoadingPlaceholderOptimized:!snapshot('old-loading-placeholder').classes.includes('csg-prehide-tool-block') && snapshot('old-loading-placeholder').display!=='none',
    busyTransitionRehidden:!snapshot('busy-transition-placeholder').classes.includes('csg-prehide-tool-block') && snapshot('busy-transition-placeholder').display!=='none',
    embedRecoverLegacyClassUnused:!snapshot('embed-recover').classes.includes('csg-tool-embed'),
    embedRecoverDisplayPreserved:snapshot('embed-recover').display!=='none',
    weirdReadySummaryHidden:summaryHidden('live-weird-summary') && !snapshot('live-weird-app-shell').classes.includes('csg-tool-ui') && physicallyRendered('live-weird-app-shell'),
    bootstrapDetailsReadyStillGone:summaryGone('live-bootstrap-details-summary') && document.getElementById('live-bootstrap-details').open,
    appShellReadySummaryGone:summaryGone('live-app-summary') && !snapshot('live-app-shell').classes.includes('csg-tool-ui') && physicallyRendered('live-app-shell')
  }};
}}, 1250);
setTimeout(() => {{
  document.body.insertAdjacentHTML('beforeend','<section data-testid="conversation-turn-10" data-turn="assistant"><div class="agent-turn">newest assistant turn</div></section>');
}}, 1350);
setTimeout(() => {{
  document.getElementById('test-stop-generation')?.remove();
}}, 1650);
setTimeout(() => {{
  const motion=snapshot('live-app-motion');
  const realRow=snapshot('real-called-tool-row');
  const realRowNaturalHeight=naturalBoxHeight('real-called-tool-row');
  window.__agedOut={{
    recentPlaceholder:!snapshot('dynamic-header-placeholder-body').classes.includes('csg-prehide-tool-block') && snapshot('dynamic-header-placeholder-body').display!=='none',
    tool:!snapshot('live-tool').classes.includes('csg-tool') && physicallyRendered('live-tool'),
    pre:snapshot('live-pre').classes.includes('csg-heavy') && snapshot('live-pre').contentVisibility==='auto',
    shell:snapshot('live-shell').classes.includes('csg-tool-ui') && snapshot('live-shell').position==='absolute' && zeroRect('live-shell'),
    summary:snapshot('live-tool-summary').opacity==='0' && !physicallyRendered('live-shell-body'),
    realNativeSummaryCollapsesAfterAging:realRow.classes.includes('csg-tool-summary') &&
      snapshot('real-called-tool-shell').classes.includes('csg-tool-ui') &&
      snapshot('real-called-tool-shell').position==='absolute' && zeroRect('real-called-tool-shell'),
    realNativeSummaryPixelsHidden:realRow.opacity==='0' && realRow.pointerEvents==='none',
    realNativeChildrenZeroAfterAging:['real-tool-list-button','real-tool-list-icon','real-called-tool-label','real-called-tool-chevron'].every(zeroRect),
    weirdShellSettled:snapshot('live-weird-app-shell').classes.includes('csg-tool-ui') && snapshot('live-weird-app-shell').display!=='none',
    bootstrapDetailsPreserved:!snapshot('live-bootstrap-details').classes.includes('csg-tool-ui') && document.getElementById('live-bootstrap-details').open && physicallyRendered('live-bootstrap-details-loader') && summaryGone('live-bootstrap-details-summary'),
    appShellNotToolUi:!snapshot('live-app-shell').classes.includes('csg-tool-ui'),
    appShellRendered:physicallyRendered('live-app-shell'),
    appShellSummaryGone:summaryGone('live-app-summary'),
    interactiveShell:!snapshot('live-interactive-shell').classes.includes('csg-tool-ui') && physicallyRendered('live-interactive-shell'),
    interactiveSummaryGone:summaryGone('live-interactive-summary'),
    interactiveConnect:physicallyRendered('live-shell-connect'),
    embed:!snapshot('live-embed').classes.includes('csg-tool-embed') && physicallyRendered('live-embed'),
    placeholder:!snapshot('live-placeholder').classes.includes('csg-prehide-tool-block') && physicallyRendered('live-placeholder'),
    error:snapshot('live-app-error').classes.includes('csg-old-app-load-error'),
    motion:motion.transitionDuration==='2s' && motion.animationDuration==='2s'
  }};
}}, 2000);
setTimeout(() => {{
  document.querySelector('[data-testid="conversation-turn-10"]')?.remove();
  document.querySelector('[data-testid="conversation-turn-9"]')?.remove();
}}, 2150);
setTimeout(() => {{
  // A passive Tool preview can grow after mount. hideToolEmbeds is explicit, so
  // growth must not put it back into the conversation flow.
  document.getElementById('preview-late-grow-wrap').style.height='180px';
}}, 2300);
setTimeout(() => {{
  // React commonly rewrites className on App wrappers. The durable data state
  // must keep a hidden preview suppressed even if those CSG classes vanish.
  document.getElementById('preview-broken')?.classList.remove('csg-hidden-preview');
  document.getElementById('preview-broken-header')?.classList.remove('csg-hidden-preview-header');
}}, 2500);
setTimeout(() => {{
  // Simulate React reparenting a hidden preview iframe into a fresh mount while
  // leaving the old mount connected. Cleanup must detect that the tracked mount
  // no longer contains its iframe; isConnected alone is insufficient.
  const oldMount=document.getElementById('preview-replace');
  const wrap=document.getElementById('preview-replace-wrap');
  if (oldMount && wrap) {{
    window.__recycledPreviewMount=oldMount;
    const fresh=document.createElement('div');
    fresh.id='preview-replace-new';
    fresh.className='no-scrollbar';
    oldMount.before(fresh);
    fresh.appendChild(wrap);
    wrap.style.height='180px';
  }}
}}, 2600);
setTimeout(() => {{
  // Simulate React replacing only the iframe while reusing the same mount.
  // Detached cleanup for the old iframe must not strip the new iframe's
  // hidden state or unobserve the shared mount.
  const oldFrame=document.getElementById('preview-iframe-replace-old');
  if (oldFrame) {{
    const fresh=document.createElement('iframe');
    fresh.id='preview-iframe-replace-new';
    fresh.title='ui://other-tool/file-preview';
    fresh.src='about:blank';
    fresh.style.cssText='width:100%;height:100%';
    oldFrame.replaceWith(fresh);
  }}
}}, 2650);
setTimeout(() => {{
  // Replace iframe + mount + header in one React-like commit while reusing the
  // existing divider. Cleanup of the detached old entry must not clear divider
  // state already adopted by the new entry.
  const oldHeader=document.getElementById('preview-full-replace-header');
  const oldMount=document.getElementById('preview-full-replace');
  const divider=document.getElementById('preview-full-replace-divider');
  if (oldHeader && oldMount && divider) {{
    const header=document.createElement('div');
    header.id='preview-full-replace-header-new';
    header.className='mt-2 sm:mt-4';
    header.textContent='Previewer replacement';
    const mount=document.createElement('div');
    mount.id='preview-full-replace-new';
    mount.className='no-scrollbar';
    const wrap=document.createElement('div'); wrap.style.height='180px';
    const frame=document.createElement('iframe');
    frame.id='preview-full-replace-new-frame'; frame.title='ui://other-tool/file-preview';
    frame.src='about:blank'; frame.style.cssText='width:100%;height:100%';
    wrap.appendChild(frame); mount.appendChild(wrap);
    oldHeader.replaceWith(header); oldMount.replaceWith(mount);
  }}
}}, 2675);
setTimeout(() => {{
  const mount=snapshot('preview-iframe-replace');
  window.__sameMountReplacementProtected =
    mount.previewState==='hidden' && mount.opacity==='0' && mount.position==='absolute' &&
    document.getElementById('preview-iframe-replace-new')?.isConnected===true;
}}, 2750);
setTimeout(() => {{
  document.getElementById('preview-iframe-replace-wrap').style.height='180px';
}}, 2775);
setTimeout(() => {{
  const turn3=document.querySelector('[data-testid="conversation-turn-3"]');
  if (turn3) turn3.setAttribute('data-testid','conversation-turn-100');
}}, 2800);
setTimeout(() => {{
  window.__attributeReuseLive={{
    tool:snapshot('reuse-passive-tool').classes.includes('csg-tool') && snapshot('reuse-passive-tool').display!=='none',
    placeholder:!snapshot('placeholder-passive').classes.includes('csg-prehide-tool-block') && snapshot('placeholder-passive').display!=='none',
    actualTailStillVisible:physicallyRendered('live-tool') && physicallyRendered('live-app-error')
  }};
}}, 3450);
setTimeout(() => {{
  const turn100=document.querySelector('[data-testid="conversation-turn-100"]');
  if (turn100) turn100.setAttribute('data-testid','conversation-turn-3');
}}, 3600);
setTimeout(() => {{
  const hit={{}};
  for (const id of ACTION_IDS) hit[id]=hitClick(id);
  const states={{}};
  for (const id of ['connector','library','outside-pre','old-classless-summary','old-classless-body','old-fragmented-en-summary','old-fragmented-en-body','long-old-summary','long-old-body','passive-tool','interactive-tool','tool-with-markdown-controls','tool-with-auth-link',
    'tool-with-aria-action','dynamic-input-tool','fragmented-bootstrap-tool','passive-thinking','interactive-thinking','dynamic-tool','tool-with-iframe-surface','tool-with-markdown-iframe','tool-with-image-surface','tool-with-svg-surface','tool-bootstrap-text-false-positive','markdown-loading-pre','interactive-heavy-pre','passive-shell','aria-only-shell','aria-only-summary','retry-summary-shell','summary-retry','partial-summary-shell','partial-summary-button','interactive-shell','passive-details',
    'interactive-details','dynamic-details','recover-details','surface-error-placeholder','root-surface-error-placeholder','embed-passive','embed-app','config-card-header','config-card','config-card-frame','config-card-divider','message-timeout-preview-header','message-timeout-preview','message-timeout-preview-frame','message-timeout-preview-divider','message-delivery-error','message-delivery-retry','preview-broken-header','preview-broken','preview-broken-frame','preview-broken-divider','preview-percent-header','preview-percent','preview-percent-frame','preview-percent-divider','preview-sibling-guard-header','preview-sibling-guard','preview-sibling-guard-frame','preview-sibling-guard-divider','preview-unrelated-tool','preview-unrelated-connect','preview-replace-header','preview-replace-new','preview-replace-frame','preview-replace-divider','preview-iframe-replace-header','preview-iframe-replace','preview-iframe-replace-new','preview-iframe-replace-divider','preview-full-replace-header-new','preview-full-replace-new','preview-full-replace-new-frame','preview-full-replace-divider','preview-success-header','preview-success','preview-success-frame','preview-success-divider','preview-late-grow-header','preview-late-grow','preview-late-grow-frame','preview-late-grow-divider','preview-shrink-header','preview-shrink','preview-shrink-frame','preview-shrink-divider','preview-error-header','preview-error','preview-error-frame','preview-error-surface','embed-action','embed-trigger-action','embed-trigger-action-control','embed-dynamic','embed-text-dynamic','placeholder-passive',
    'placeholder-action','placeholder-header-action','placeholder-header-body','dynamic-placeholder','dynamic-header-placeholder-header',
    'dynamic-header-placeholder-body','reuse-passive-tool','live-tool','live-pre','live-shell','live-tool-summary','live-shell-body','live-interactive-shell',
    'live-interactive-summary','live-shell-connect','live-interactive-body','live-embed','live-placeholder','live-app-error','live-app-motion','real-called-tool-play-shell','real-called-tool-play','classless-label-app-media','classless-label-app-svg',
    'inside-motion','streamed-fragment','inside-pre']) {{
    states[id]=snapshot(id);
  }}
  const result={{
    outsideConnectorClean: !states.connector.classes.some(c=>c.startsWith('csg-')) && states.connector.display!=='none',
    outsideLibraryClean: !states.library.classes.some(c=>c.startsWith('csg-')) && states.library.display!=='none',
    outsideMotionNative: states.connector.transitionDuration==='2s' && states.library.transitionDuration==='2s',
    outsidePreNative: states['outside-pre'].contentVisibility!=='auto',
    historicalClasslessInitialSweepHidden: summaryGone('old-classless-summary') && physicallyRendered('old-classless-body'),
    historicalEnglishOneCharSweepHidden: summaryGone('old-fragmented-en-summary') && physicallyRendered('old-fragmented-en-body'),
    lateHistoricalMountSweepHidden: summaryGone('late-historical-summary') && physicallyRendered('late-historical-body'),
    historicalClasslessChunkedSweepHidden: summaryGone('long-old-summary') && physicallyRendered('long-old-body'),
    passiveToolHidden: states['passive-tool'].classes.includes('csg-tool') && states['passive-tool'].display!=='none' &&
      states['inside-motion'].display!=='none' && states['inside-motion'].opacity==='0' && states['inside-motion'].height>0,
    interactiveToolVisible: !states['interactive-tool'].classes.includes('csg-tool') && states['interactive-tool'].display!=='none',
    markdownControlsRemainTrace: states['tool-with-markdown-controls'].classes.includes('csg-tool') && states['tool-with-markdown-controls'].display!=='none',
    markdownAuthLinkVisible: !states['tool-with-auth-link'].classes.includes('csg-tool') && states['tool-with-auth-link'].display!=='none',
    markdownAriaActionVisible: !states['tool-with-aria-action'].classes.includes('csg-tool') && states['tool-with-aria-action'].display!=='none',
    dynamicInputReleased: !states['dynamic-input-tool'].classes.includes('csg-tool') && states['dynamic-input-tool'].display!=='none',
    fragmentedBootstrapFailsOpen: !states['fragmented-bootstrap-tool'].classes.includes('csg-tool') && states['fragmented-bootstrap-tool'].display!=='none',
    passiveThinkingHidden: states['passive-thinking'].classes.includes('csg-thinking') && states['passive-thinking'].display==='none',
    interactiveThinkingVisible: !states['interactive-thinking'].classes.includes('csg-thinking') && states['interactive-thinking'].display!=='none',
    dynamicToolReleased: !states['dynamic-tool'].classes.includes('csg-tool') && states['dynamic-tool'].display!=='none',
    toolIframeSurfaceVisible: !states['tool-with-iframe-surface'].classes.includes('csg-tool') && physicallyRendered('tool-surface-frame'),
    toolMarkdownIframeSurfaceVisible: !states['tool-with-markdown-iframe'].classes.includes('csg-tool') && physicallyRendered('tool-markdown-frame'),
    toolImageSurfaceVisible: !states['tool-with-image-surface'].classes.includes('csg-tool') && physicallyRendered('tool-surface-image'),
    toolSvgSurfaceVisible: !states['tool-with-svg-surface'].classes.includes('csg-tool') && physicallyRendered('tool-surface-svg'),
    markdownBootstrapPhraseStillTraceHidden: states['tool-bootstrap-text-false-positive'].classes.includes('csg-tool') && states['tool-bootstrap-text-false-positive'].display!=='none',
    nestedMarkdownLoadingPreStillHeavy: states['markdown-loading-pre'].classes.includes('csg-heavy') && states['markdown-loading-pre'].contentVisibility==='auto',
    actionablePreNotLazy: !states['interactive-heavy-pre'].classes.includes('csg-heavy') && states['interactive-heavy-pre'].contentVisibility!=='auto',
    passiveShellHidden: states['passive-shell'].classes.includes('csg-tool-ui') && states['passive-shell'].display!=='none',
    ariaOnlyLegacySummaryHidden: states['aria-only-shell'].classes.includes('csg-tool-ui') &&
      states['aria-only-shell'].position==='absolute' && states['aria-only-shell'].width===0 && states['aria-only-shell'].height===0 &&
      states['aria-only-summary'].opacity==='0',
    retryOnlySummaryFailsOpen: !states['retry-summary-shell'].classes.includes('csg-tool-ui') &&
      states['summary-retry'].display!=='none' && hit['summary-retry'],
    partialSummaryFalsePositivePreserved: !states['partial-summary-shell'].classes.some(c=>c.startsWith('csg-')) &&
      !states['partial-summary-button'].classes.some(c=>c.startsWith('csg-')) && states['partial-summary-button'].opacity==='1',
    interactiveShellVisible: !states['interactive-shell'].classes.includes('csg-tool-ui') && states['interactive-shell'].display!=='none',
    passiveDetailsHidden: states['passive-details'].classes.includes('csg-tool-ui') && states['passive-details'].display!=='none',
    interactiveDetailsVisible: !states['interactive-details'].classes.includes('csg-tool-ui') && states['interactive-details'].display!=='none',
    dynamicDetailsReleased: !states['dynamic-details'].classes.includes('csg-tool-ui') && states['dynamic-details'].display!=='none',
    removedActionRecoversOptimization: states['recover-details'].classes.includes('csg-tool-ui') && states['recover-details'].display!=='none',
    surfaceErrorPlaceholderVisible: !states['surface-error-placeholder'].classes.includes('csg-prehide-tool-block') && states['surface-error-placeholder'].display!=='none' && physicallyRendered('surface-error-empty'),
    rootSurfaceErrorPlaceholderVisible: !states['root-surface-error-placeholder'].classes.includes('csg-prehide-tool-block') && physicallyRendered('root-surface-error-placeholder'),
    passiveLegacyEmbedPreserved: !states['embed-passive'].classes.includes('csg-tool-embed') && states['embed-passive'].display!=='none',
    appIframeEmbedVisible: !states['embed-app'].classes.includes('csg-tool-embed') && states['embed-app'].display!=='none' && physicallyRendered('embed-app-frame'),
    uiRouteConfigCardSuppressed: states['config-card'].previewState==='hidden' &&
      states['config-card-header'].previewState==='hidden' &&
      states['config-card'].position==='absolute' && states['config-card'].opacity==='0' &&
      states['config-card'].width===0 && states['config-card'].height===0 &&
      states['config-card-header'].width===0 && states['config-card-header'].height===0 &&
      states['config-card-divider'].previewDivider==='hidden' && states['config-card-divider'].display==='none' &&
      document.getElementById('config-card-frame').isConnected,
    messageDeliveryRetryDoesNotFailOpenPreview: states['message-timeout-preview'].previewState==='hidden' &&
      states['message-timeout-preview-header'].previewState==='hidden' &&
      states['message-timeout-preview'].position==='absolute' && states['message-timeout-preview'].opacity==='0' &&
      states['message-timeout-preview'].width===0 && states['message-timeout-preview'].height===0 &&
      states['message-timeout-preview-header'].width===0 && states['message-timeout-preview-header'].height===0 &&
      states['message-timeout-preview-divider'].previewDivider==='hidden' && states['message-timeout-preview-divider'].display==='none' &&
      document.getElementById('message-timeout-preview-frame').isConnected && physicallyRendered('message-delivery-error') &&
      physicallyRendered('message-delivery-retry') && hit['message-delivery-retry'],
    passivePreviewSuppressedWithoutDetach: states['preview-broken'].previewState==='hidden' &&
      states['preview-broken-header'].previewState==='hidden' &&
      states['preview-broken'].display!=='none' && states['preview-broken'].position==='absolute' && states['preview-broken'].opacity==='0' &&
      states['preview-broken-header'].position==='absolute' && states['preview-broken-header'].opacity==='0' &&
      states['preview-broken'].width===0 && states['preview-broken'].height===0 &&
      states['preview-broken-header'].width===0 && states['preview-broken-header'].height===0 &&
      states['preview-broken-divider'].previewDivider==='hidden' && states['preview-broken-divider'].display==='none' &&
      states['preview-broken-frame'].height>=35 && document.getElementById('preview-broken-frame').isConnected,
    percentHeightPreviewSuppressed: states['preview-percent'].previewState==='hidden' && states['preview-percent-header'].previewState==='hidden' &&
      states['preview-percent'].classes.includes('csg-hidden-preview') && states['preview-percent-header'].classes.includes('csg-hidden-preview-header') &&
      states['preview-percent'].position==='absolute' && states['preview-percent'].opacity==='0' &&
      states['preview-percent-divider'].previewDivider==='hidden' && states['preview-percent-divider'].display==='none' && document.getElementById('preview-percent-frame').isConnected,
    unrelatedSiblingActionDoesNotReleaseHiddenPreview: states['preview-sibling-guard'].previewState==='hidden' &&
      states['preview-sibling-guard'].position==='absolute' && states['preview-sibling-guard'].opacity==='0' &&
      states['preview-sibling-guard-divider'].previewDivider==='hidden' && states['preview-sibling-guard-divider'].display==='none' &&
      physicallyRendered('preview-unrelated-connect') && hit['preview-unrelated-connect'],
    reactMountReplacementClearsStaleStateAndHidesReplacement: Boolean(window.__recycledPreviewMount) &&
      window.__recycledPreviewMount.isConnected===true &&
      !window.__recycledPreviewMount.contains(document.getElementById('preview-replace-frame')) &&
      !window.__recycledPreviewMount.classList.contains('csg-preview-settling') &&
      !window.__recycledPreviewMount.classList.contains('csg-broken-preview') &&
      !window.__recycledPreviewMount.classList.contains('csg-hidden-preview') &&
      !window.__recycledPreviewMount.hasAttribute('data-csg-preview-state') &&
      !window.__recycledPreviewMount.style.getPropertyValue('--csg-preview-inline-size') &&
      states['preview-replace-new'].previewState==='hidden' && states['preview-replace-new'].classes.includes('csg-hidden-preview') &&
      Boolean(document.getElementById('preview-replace-new').style.getPropertyValue('--csg-preview-inline-size')) &&
      states['preview-replace-new'].position==='absolute' && states['preview-replace-new'].opacity==='0' &&
      states['preview-replace-new'].width===0 && states['preview-replace-new'].height===0 &&
      states['preview-replace-frame'].height>=170 && states['preview-replace-header'].position==='absolute' && states['preview-replace-header'].opacity==='0' &&
      states['preview-replace-header'].width===0 && states['preview-replace-header'].height===0 &&
      states['preview-replace-divider'].previewDivider==='hidden' && states['preview-replace-divider'].display==='none',
    sameMountIframeReplacementStaysHidden: window.__sameMountReplacementProtected===true &&
      states['preview-iframe-replace'].previewState==='hidden' && states['preview-iframe-replace'].classes.includes('csg-hidden-preview') &&
      states['preview-iframe-replace'].position==='absolute' && states['preview-iframe-replace'].opacity==='0' &&
      states['preview-iframe-replace'].width===0 && states['preview-iframe-replace'].height===0 && states['preview-iframe-replace-new'].height>=170 &&
      states['preview-iframe-replace-divider'].previewDivider==='hidden' && states['preview-iframe-replace-divider'].display==='none' &&
      document.getElementById('preview-iframe-replace-new').isConnected,
    fullMountReplacementPreservesSharedDivider: states['preview-full-replace-new'].previewState==='hidden' &&
      states['preview-full-replace-new'].classes.includes('csg-hidden-preview') && states['preview-full-replace-new'].position==='absolute' &&
      states['preview-full-replace-new'].opacity==='0' && states['preview-full-replace-new'].width===0 && states['preview-full-replace-new'].height===0 &&
      states['preview-full-replace-header-new'].previewState==='hidden' && states['preview-full-replace-header-new'].width===0 &&
      states['preview-full-replace-header-new'].height===0 && states['preview-full-replace-divider'].previewDivider==='hidden' &&
      states['preview-full-replace-divider'].display==='none' && document.getElementById('preview-full-replace-new-frame').isConnected,
    grownPreviewStaysHidden: states['preview-success'].previewState==='hidden' && states['preview-success'].classes.includes('csg-hidden-preview') &&
      states['preview-success-header'].classes.includes('csg-hidden-preview-header') &&
      states['preview-success'].display!=='none' && states['preview-success'].position==='absolute' && states['preview-success'].opacity==='0' &&
      states['preview-success'].width===0 && states['preview-success'].height===0 &&
      states['preview-success-header'].width===0 && states['preview-success-header'].height===0 &&
      states['preview-success-divider'].previewDivider==='hidden' && states['preview-success-divider'].display==='none' &&
      document.getElementById('preview-success-frame').isConnected,
    hiddenThenGrownPreviewStaysHidden: states['preview-late-grow'].previewState==='hidden' && states['preview-late-grow'].classes.includes('csg-hidden-preview') &&
      states['preview-late-grow-header'].classes.includes('csg-hidden-preview-header') &&
      states['preview-late-grow'].position==='absolute' && states['preview-late-grow'].opacity==='0' &&
      states['preview-late-grow'].width===0 && states['preview-late-grow'].height===0 &&
      states['preview-late-grow-frame'].height>=170 && states['preview-late-grow-divider'].previewDivider==='hidden' && states['preview-late-grow-divider'].display==='none',
    grownThenShrunkPreviewStaysHidden: states['preview-shrink'].previewState==='hidden' && states['preview-shrink'].classes.includes('csg-hidden-preview') &&
      states['preview-shrink-header'].classes.includes('csg-hidden-preview-header') &&
      states['preview-shrink'].display!=='none' && states['preview-shrink'].position==='absolute' && states['preview-shrink'].opacity==='0' &&
      states['preview-shrink'].width===0 && states['preview-shrink'].height===0 &&
      states['preview-shrink-divider'].previewDivider==='hidden' && states['preview-shrink-divider'].display==='none' &&
      states['preview-shrink-frame'].height>=35,
    errorPreviewFailsOpen: !states['preview-error'].classes.some(c=>c.startsWith('csg-preview')||c==='csg-broken-preview') &&
      states['preview-error'].display!=='none' && states['preview-error'].opacity==='1' && physicallyRendered('preview-error-surface') && hit['preview-retry'],
    interactiveEmbedVisible: !states['embed-action'].classes.includes('csg-tool-embed') && states['embed-action'].display!=='none',
    triggerActionEmbedVisible: !states['embed-trigger-action'].classes.includes('csg-tool-embed') && physicallyRendered('embed-trigger-action') && physicallyRendered('embed-trigger-action-control'),
    dynamicEmbedReleased: !states['embed-dynamic'].classes.includes('csg-tool-embed') && states['embed-dynamic'].display!=='none',
    dynamicEmbedTextReleased: !states['embed-text-dynamic'].classes.includes('csg-tool-embed') && states['embed-text-dynamic'].display!=='none',
    passivePlaceholderHidden: !states['placeholder-passive'].classes.includes('csg-prehide-tool-block') && states['placeholder-passive'].display!=='none',
    interactivePlaceholderVisible: !states['placeholder-action'].classes.includes('csg-prehide-tool-block') && states['placeholder-action'].display!=='none',
    placeholderHeaderActionVisible: !states['placeholder-header-action'].classes.includes('csg-prehide-tool-block') && states['placeholder-header-action'].display!=='none',
    placeholderHeaderBodyHidden: !states['placeholder-header-body'].classes.includes('csg-prehide-tool-block') && states['placeholder-header-body'].display!=='none',
    dynamicPlaceholderReleased: !states['dynamic-placeholder'].classes.includes('csg-prehide-tool-block') && states['dynamic-placeholder'].display!=='none',
    dynamicHeaderActionVisible: !states['dynamic-header-placeholder-header'].classes.includes('csg-prehide-tool-block') && states['dynamic-header-placeholder-header'].display!=='none',
    liveProtectionInitiallyPreserved: Object.values(window.__liveBeforeAge || {{}}).every(Boolean) && window.__clicks['live-retry']===1,
    oneStepRetryProtected: Object.values(window.__oneStepProtected || {{}}).every(Boolean),
    agedOutTransitionApplied: Object.values(window.__agedOut || {{}}).every(Boolean),
    attributeReuseTransitionApplied: Object.values(window.__attributeReuseLive || {{}}).every(Boolean) &&
      states['reuse-passive-tool'].classes.includes('csg-tool') && states['reuse-passive-tool'].display!=='none' &&
      !states['placeholder-passive'].classes.includes('csg-prehide-tool-block') && states['placeholder-passive'].display!=='none',
    staleHighNumericTailProtected: physicallyRendered('live-tool') && physicallyRendered('live-app-error'),
    rewindHeaderBodyProtected: !states['dynamic-header-placeholder-body'].classes.includes('csg-prehide-tool-block') && physicallyRendered('dynamic-header-placeholder-body'),
    rewindLiveToolVisible: !states['live-tool'].classes.some(c=>c.startsWith('csg-')) && physicallyRendered('live-tool'),
    rewindLivePreNative: states['live-pre'].classes.includes('csg-heavy') && states['live-pre'].contentVisibility==='auto' && physicallyRendered('live-pre'),
    rewindLiveShellVisible: states['live-shell'].classes.includes('csg-tool-ui') && states['live-shell'].position==='absolute' &&
      states['live-shell'].width===0 && states['live-shell'].height===0 && states['live-shell'].opacity==='0',
    rewindLiveSummaryGone: states['live-tool-summary'].opacity==='0' && !physicallyRendered('live-shell-body'),
    rewindInteractiveShellSafe: !states['live-interactive-shell'].classes.includes('csg-tool-ui') &&
      summaryGone('live-interactive-summary') && physicallyRendered('live-interactive-body') && physicallyRendered('live-shell-connect'),
    rewindLiveEmbedVisible: !states['live-embed'].classes.some(c=>c.startsWith('csg-')) && physicallyRendered('live-embed'),
    rewindLivePlaceholderVisible: !states['live-placeholder'].classes.some(c=>c.startsWith('csg-')) && physicallyRendered('live-placeholder'),
    rewindLiveAppErrorVisible: !states['live-app-error'].classes.some(c=>c.startsWith('csg-')) && physicallyRendered('live-app-error'),
    rewindLiveMotionNative: states['live-app-motion'].transitionDuration==='2s' && states['live-app-motion'].animationDuration==='2s' && physicallyRendered('live-app-motion'),
    streamedFragmentNotContained: !states['streamed-fragment'].classes.includes('csg-trace-body') && states['streamed-fragment'].contentVisibility!=='auto',
    insideMotionReduced: states['inside-motion'].transitionDuration!=='2s',
    insidePreLazy: states['inside-pre'].contentVisibility==='auto',
    allActionHit: Object.values(hit).every(Boolean),
    allActionsClicked: ACTION_IDS.every(id => window.__clicks[id]===1),
    states, hit, clicks:window.__clicks, liveBeforeAge:window.__liveBeforeAge,
    oneStepProtected:window.__oneStepProtected, agedOut:window.__agedOut,
    attributeReuseLive:window.__attributeReuseLive
  }};
  const out=document.createElement('pre');
  out.id='csg-test-result';
  out.textContent=JSON.stringify(result);
  document.body.appendChild(out);
}}, 4300);
</script></body></html>'''


def main():
    page = build_page()
    with tempfile.TemporaryDirectory(prefix='csg-ui-isolation-') as tmp:
        target = Path(tmp) / 'index.html'
        target.write_text(page, encoding='utf-8')
        proc = subprocess.run([
            CHROME, '--headless=new', '--no-sandbox', '--disable-gpu',
            '--virtual-time-budget=5000', '--dump-dom', target.as_uri(),
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=20)
    match = re.search(r'<pre id="csg-test-result"[^>]*>(.*?)</pre>', proc.stdout, re.S)
    if not match:
        raise AssertionError(f'no result\nSTDERR:\n{proc.stderr[-2000:]}\nDOM:\n{proc.stdout[-5000:]}')
    payload = json.loads(html.unescape(match.group(1)))
    detail_keys = {'states', 'hit', 'clicks', 'liveBeforeAge', 'oneStepProtected', 'agedOut', 'attributeReuseLive'}
    failures = {k: v for k, v in payload.items() if k not in detail_keys and v is not True}
    if failures:
        raise AssertionError(
            f'UI isolation failures: {failures}\n'
            f'states={json.dumps(payload.get("states"), ensure_ascii=False, indent=2)}\n'
            f'liveBeforeAge={payload.get("liveBeforeAge")} oneStepProtected={payload.get("oneStepProtected")} agedOut={payload.get("agedOut")}\n'
            f'hit={payload.get("hit")} clicks={payload.get("clicks")}'
        )
    print('PASS ui-isolation: application Connect/Add controls remain interactive')
    print('PASS ui-isolation: passive conversation tool UI is still optimized')


if __name__ == '__main__':
    main()
