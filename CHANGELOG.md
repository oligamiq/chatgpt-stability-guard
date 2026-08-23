# Changelog

## 1.0.19 — 2026-08-24

- Fixed `hideToolEmbeds` so passive `ui://.../file-preview` Tool/App previews are removed from conversation layout even when the iframe is healthy or large; this eliminates visible `desktop-commander-home` preview contents and the large blank/black space they could reserve.
- Kept Tool/App iframe nodes mounted for ChatGPT/React while moving their preview mount, header, and divider out of flow; Retry/Auth/Connect/error UI still fails open and remains interactive.
- Added generation-state-aware protection: hidden Tool/App previews stay out of conversation flow but retain a measurable bootstrap box while ChatGPT is actively generating; once generation ends, completed `group/tool-message` shells become true `0×0` boxes to eliminate accumulated flex gaps, and completed hidden preview/header boxes also collapse to `0×0` to eliminate residual oversized geometry.
- Added regression coverage for generation-complete handoff, large/percentage-height previews, growth/shrink transitions, iframe/mount replacement, stale divider cleanup, and unrelated actionable sibling controls.
- Reproduced the reported authenticated `リリースコミット完了` conversation with v1.0.19 directly injected. After generation completed, all 109 Tool shells and all 218 Tool controls measured `0×0`, no visible Tool shell or empty in-flow block ≥100px remained, the two largest affected historical turns shrank from 29,120→4,562px and 4,716→1,442px, and Retry/Add-files/Dictation/Voice UI stayed visible.

## 1.0.18 — 2026-08-23

- Removed the first-run data-processing consent screen and consent gate; the extension now starts immediately with the saved or default settings after installation or update.
- Removed consent-version/timestamp storage and the revoke-consent control while keeping the Privacy page available from the popup.
- Updated privacy, Store/reviewer documentation, validation, and regression fixtures to match the no-consent-gate flow.

## 1.0.17 — 2026-08-22

- Fixed the current ChatGPT MCP `Called tool` / `ツールが呼び出されました` row, including localized tool-list controls and the independently sized tool-list SVG; label, button, icon, chevron, and passive row spacing now reach zero visible geometry without detaching React-owned DOM.
- Added document-start structural suppression for the known passive MCP row while keeping App/bootstrap/action-bearing variants fail-open and interactive.
- Kept healthy mounted App surfaces and mount points rendered; only confirmed tiny broken previews are removed from layout, with measured-width preservation plus ResizeObserver/bounded-probe recovery when a 37px preview later grows into a working App.
- Added support for the current DIV-based `Error loading app` / `Failed to fetch template` card and continue to hide only provably old errors while preserving Retry on the live two-turn boundary.
- Replaced periodic/full-conversation Tool-summary work with event-driven live-boundary observers and a resumable historical fallback sweep capped at 256 text nodes per idle slice; Markdown subtrees remain excluded.
- Removed obsolete placeholder/legacy embed observers and dead `.csg-tool-embed` bookkeeping so document-start code only supplies first-paint summary state and the recent-conversation loader.
- Expanded regression coverage for Japanese/English, aria-label-only and split/classless summaries, 600+ text-node historical turns, Retry/Connect/Auth controls, React preview-node replacement, broken-to-healthy preview growth, and both legacy/current App error DOMs.
- Validated the release in a logged-in Chrome for Testing session against the long real conversation, including 233 Tool-summary rows and live ChatGPT App previews.

## 1.0.16 — 2026-08-19

- Removed remaining `ツールが呼び出されました` / `Tools were called` chrome even when ChatGPT renders it without tool-specific classes, splits the label across multiple spans, or streams fragments incrementally.
- Kept detection scoped to conversation UI and explicitly excluded Markdown content so literal user/assistant text is never hidden.
- Stopped mutating React-owned disclosure state: interactive `button`/`summary` controls stay mounted and clickable while only their redundant visual label/arrow is suppressed.
- Prevented label detection from growing into sibling App/template/output UI, including loaders, `.no-scrollbar` surfaces, Retry/Connect/Auth controls, tables, canvases, iframes, and other app surfaces.
- Added a bounded MutationObserver fast path and incremental long-conversation sweep, with regression coverage for classless, split-span, one-character-per-span, and incrementally streamed labels.

## 1.0.15 — 2026-08-19

- Made `ツールが呼び出されました` / `Tools were called` fully invisible, including arrow/marker chrome and non-standard div/span+SVG renderings, without hiding the live App/bootstrap parent DOM.
- Zero-sized required disclosure controls while preserving App loaders, placeholders, Connect/Add/Auth/Retry UI, and automatically opening collapsed disclosure containers only when required UI would otherwise remain hidden.
- Kept passive settled tool summaries/shells aggressively removable with `display: none` while live/loading App UI remains fail-open to avoid `Failed to fetch template`.
- Added bounded DOM text scanning for tool/action/bootstrap detection to avoid long-conversation main-thread stalls on very large tool payloads.
- Expanded regression coverage for native/custom disclosures, zero-size arrows, collapsed App loaders, custom React shells, and non-standard summary DOM.

## 1.0.14 — 2026-08-19

- Restored aggressive removal of completed passive tool summaries, shells, embeds, and placeholders while keeping active App UI fail-open.
- Prevented Stability Guard from hiding App/template bootstrap UI, including placeholders that transition from hidden/passive state into loading state.
- Preserved Connect/Add/Auth/Retry controls and prevented active application UI from receiving `content-visibility: auto` or other passive-trace optimizations.
- Added recovery for loading/actionable rich embeds that later become passive, plus Japanese App template error detection.
- Added regression coverage for `Failed to fetch template`, loading-to-ready transitions, nested Markdown false positives, and actionable controls inside code/pre blocks.

## 1.0.13 — 2026-08-19

- Fixed live App/Tool protection when turns age out, rewind, or React reuses an existing conversation-turn DOM node.
- Kept App template error and Retry UI interactive throughout the latest two turns, then safely hid stale errors afterward.
- Added a persistent priority queue for live-boundary rescans so heavy streaming cannot starve protection-state transitions.
- Protected the actual two DOM-tail turns as well as the newest numeric turns, including stale high-number branch/outlier DOM cases.
- Expanded regression coverage for append/remove transitions, reused `data-testid` values, stale numeric outliers, and Retry visibility.

## 1.0.12 — 2026-08-18

- Prevented Stability Guard from hiding or lazy-rendering the newest ChatGPT app/tool turns while their templates and UI are still bootstrapping.
- Restricted reduced-motion overrides to already-classified passive traces so live app loaders keep their native transition/animation lifecycle.
- Reduced global MutationObserver work by moving fine-grained placeholder observation to only the old placeholders that are actually hidden.
- Added regression coverage proving the current app embed, placeholder, Retry UI, and loading motion remain physically rendered and interactive.

## 1.0.11 — 2026-08-18

- Fixed Stability Guard interfering with ChatGPT connector/plugin Connect, Add, authentication, and Library controls.
- Scoped tool/reasoning optimizations to conversation content and made interactive rich UI fail open, including controls that appear dynamically.
- Added regression coverage for dynamic links, ARIA controls, placeholder headers, embedded tool cards, and attribute-only UI transitions.
- Replaced global embedded-tool rescans with localized reconciliation to preserve performance in long conversations.

## 1.0.10 — 2026-08-15

- Added complete Japanese/English extension UI support with automatic browser-language selection.
- Added an `Auto / 日本語 / English` language selector in the popup; the preference is stored locally and does not require new permissions.
- Localized first-use consent, settings, status/statistics text, reload notices, and long-conversation controls.
- Added bilingual in-extension Privacy content with the same persisted language preference.
- Propagated the selected language to recent-N loading progress and the in-page Guard status indicator.
- Kept Japanese ChatGPT UI detection strings intact because they are matching logic, not extension UI copy.

## 1.0.9 — 2026-08-15

- Added Android Microsoft Edge compatibility work for the extension action popup, including responsive width, mobile-safe scrolling, safe-area padding, larger touch targets, and single-column preset controls on narrow/coarse-pointer layouts.
- Made popup tab messaging/reload paths fail safely when a mobile Chromium build exposes a reduced or temporarily unavailable `chrome.tabs` surface.
- Updated recent-N viewport calculations to track the Visual Viewport so its dedicated scrollbar follows mobile browser chrome, soft-keyboard, and viewport-size changes.
- Increased the recent-N scrollbar touch target on coarse-pointer devices and made compact trace scrollers friendlier to touch momentum.
- Added validation guardrails so the mobile/coarse-pointer and Visual Viewport support cannot be removed accidentally.
- Prepared the same Manifest V3 package for Microsoft Edge Add-ons submission; no Edge-specific privileged API or additional permission is required.
- Added Edge-specific browser-neutral store listing copy, a 300×300 listing logo, and a copy-ready Partner Center submission/privacy sheet.

## 1.0.8 — 2026-08-13

- Added a progressive recent-N loading indicator so long conversations no longer appear blank while the visible range is being discovered.
- Shows staged states for conversation detection, latest-turn checking, earlier-history discovery, final range adjustment, and completion.
- Starts the indicator at `document_start` when recent-N is enabled, then hands it off to the main recent-window logic without duplicating the UI.
- Progress reflects the currently confirmed exchange count and can correct itself when ChatGPT virtualizes or reclassifies turns.
- Added a 60-second fail-open watchdog and exception handling so a stalled initialization cannot leave the loading indicator on screen indefinitely.
- Added delayed completion removal for accessible status announcement and a 12-second early-loader fallback when the main script never adopts it.
- Added headless-Chrome tests for early loading display, progressive handoff/removal, and watchdog fail-open behavior.

## 1.0.7 — 2026-08-13

- Fixed recent-N on long ChatGPT share conversations that keep sparse old turns mounted while virtualizing the middle of the thread.
- Prevented sparse numeric DOM gaps from being mistaken for branch deletion or tail divergence, which could make recent-N fall back to showing the full conversation.
- Kept searching when the first user turn in a share-page suffix may be only a continuation, so N=2 correctly includes the preceding request instead of starting at `Continue`.
- Added safe backward boundary expansion when older virtualized context appears after recent-N is already ready.
- Made semantic turn ordering authoritative over small temporary virtualizer coordinate drift when deciding whether a mounted boundary turn is old.
- Detects attribute-only conversation-turn shell updates so newly appended exchanges advance the recent-N boundary without reloading.
- Preserved branch/edit fail-open safety for sparse numeric turns by confirming `data-message-id` replacement before disabling recent-N.
- Added headless-Chrome regression coverage for sparse share/private DOMs, late-prepended context, coordinate drift, no-reload boundary advancement, message-identity branch fail-open, and mixed numeric/opaque windows.

## 1.0.6 — 2026-08-13

- Replaced the extension and Chrome Web Store icon with a simpler chat-bubble and shield design optimized for small sizes.
- Added a vector SVG source plus a reproducible icon-generation script for 16, 32, 48, and 128 px assets.
- Kept the packaged 128 px extension icon full-size while generating a separate padded 128 px asset for the Chrome Web Store listing.

## 1.0.5 — 2026-08-13

- Added an optional filter for stale ChatGPT app-template loading errors (`Failed to fetch template`), enabled by default.
- The filter only targets ChatGPT's structured error `aside`; matching text in normal conversation content or code blocks is not hidden.
- A matching error remains visible when it belongs to the latest provable conversation turn and becomes hidden after a newer mounted turn proves it old.
- Made latest-turn detection fail open when virtualization or an in-place edit/branch switch reduces the mounted maximum turn index, preventing stale historical maxima from hiding the new branch's latest error.
- Hardened SPA route transitions against rapid navigation, continued streaming mutations, reused turn shells, and delayed route DOM replacement; message IDs are used as additional route identity evidence and a bounded fail-open recovery prevents permanent pending state.
- Relaxed wrapper-class assumptions and added CSS-independent text reconstruction for `Failed to fetch template` split across rendered block elements, avoiding hidden-element `innerText` feedback loops.
- Added headless-Chrome regression coverage with the real extension CSS for latest/old classification, ambiguous IDs, virtualization decreases, dynamic newer turns, route changes/reused shells, DOM shape variation, hide/show-loop detection, and the disabled setting.
- Added a popup toggle and hidden-count statistic for stale app loading errors.

## 1.0.4 — 2026-08-12

- Fixed recent-N on ChatGPT shared conversations whose rendered DOM omits or collapses older user-side turn sections.
- Added `data-turn="user|assistant"` role detection used by the current share-page renderer.
- Cached share-page assistant-content classification without layout reads; empty assistant sections are rechecked only after mutations inside that turn.
- On `/share/` pages only, an empty assistant section no longer completes an exchange; consecutive continuation prompts remain in the same visible exchange until a renderable assistant response appears.
- On `/share/` pages only, a visible assistant section at the start of the trustworthy rendered suffix can serve as a synthetic exchange boundary when its paired user section is not present in the DOM.
- Kept normal `/c/` conversation semantics unchanged: each user turn still starts one exchange, including a pending final user-only turn.
- Verified the reported N=2 share URL with the boundary moved from `conversation-turn-35` to `conversation-turn-34`, plus ten top/middle/bottom cycles without state degradation.

## 1.0.3 — 2026-08-12

- Fixed recent-N discovery when virtualized user turns are visible only briefly; each discovery stop re-observes the mounted window before advancing.
- Fixed pending user-only turns so the semantic boundary advances immediately even when the next kept boundary turn is currently unmounted.
- Added provisional offscreen boundary coordinates with live re-anchoring while the boundary is observable; if the physical boundary disappears or becomes impossible, recent-N fails open immediately rather than sweeping the page.
- Detects mid-chat branch replacement before it can poison the semantic boundary; recent-N safely fails open without moving the viewport, then rebuilds on the next page reload/navigation.
- Requires repeated stable evidence before pruning a missing turn, so ordinary virtualizer churn and height corrections are not mistaken for branch deletion.
- Makes unrecoverable recent-N failures fail open once and suspend rediscovery until navigation/reload instead of repeatedly hijacking the scroll position.
- Preserves native wheel/trackpad/touch behavior inside the recent range; only boundary-crossing wheel input is blocked, with one-frame manual fallback for ChatGPT builds whose scroll root ignores native wheel scrolling.
- Removed the streaming overload fallback to `document.body` scans; queued DOM work is compacted to mounted turns/local parents without dropping classifications.
- Removed redundant per-tool marker observers and retained streamed-label cleanup through the document-level observer.
- Verified on a variable-height virtualized fixture for N=2/3/4/5, ten repeated top/middle/bottom cycles, pending user-only turns, streaming assistant growth, SPA route changes, branch-tail replacement, transient branch-like mismatches, stale cached coordinates, resize changes, mounted-boundary virtualizer re-anchoring, and catastrophic boundary-loss fail-open.

## 1.0.2 — 2026-08-12

- Fixed recent-N counting and scroll boundaries against ChatGPT's virtualized conversation list.
- Defines one exchange from a user turn up to just before the next user turn; a pending final user-only turn counts immediately, while regeneration/tool/assistant turns without a new user turn remain in the same exchange.
- Reconstructs the semantic turn sequence across virtualized windows, checks numeric `conversation-turn-N` coverage when available, and fills intermediate gaps before finalizing the boundary.
- Stabilizes user/assistant role classification against React turn-shell recycling by requiring repeated authoritative `data-message-author-role` evidence and re-validating user boundaries before adoption.
- Detects ChatGPT's real programmatic scroll root even when its computed `overflow-y` is `hidden`, and exposes only the recent-N range through the dedicated scrollbar/input layer.
- Re-anchors the physical boundary while ChatGPT revises virtualizer spacer estimates, including a short post-boundary stabilization period, without permanently polling the page.
- Treats a numeric turn-ID gap as permanently absent only after the same gap survives two full coverage sweeps, preventing both skipped-turn false positives and endless retry loops.
- Invalidates asynchronous discovery across SPA conversation changes and resets promptly on Navigation API / `popstate` signals so old-route boundaries cannot leak into the next chat.
- Preserves keyboard scrolling inside nested code/log scrollers and detects tool-summary labels that arrive through text-node streaming.
- Reduces streaming-time DOM work by batching element classification reads and writes and removing repeated descendant cleanup scans.
- Verified on real ChatGPT conversations for N=2/3/4/5, user-only pending turns, repeated top/middle/bottom cycles, and SPA conversation switching.

## 1.0.1 — 2026-08-12

- Rewrote **recent N exchanges only** for ChatGPT's virtualized conversation list.
- Uses a stable semantic turn boundary instead of treating the currently mounted DOM window as the full conversation.
- Stops deleting layout height with `display:none`; old overscan turns remain measurable but invisible.
- Replaces the native full-history scrollbar with a scrollbar scoped to the recent-N range.
- Handles wheel, keyboard, touch and scrollbar dragging inside the bounded range; nested code/trace scrollers remain usable.
- Added boundary-coordinate self-healing when ChatGPT changes virtualizer spacer estimates, with fail-open behavior if the boundary cannot be recovered.
- Restores the same kept turn/viewport offset after the one-time boundary discovery scan.
- Prevents `freezeOldTurns` from competing with recent-N mode and removes per-mutation recursive conversation scans.

## 1.0.0 — 2026-08-12

- First public-release candidate.
- Renamed to **Stability Guard for ChatGPT** to make third-party status clearer.
- Added first-run privacy disclosure and affirmative consent before ChatGPT DOM processing.
- Restricted runtime scope to `https://chatgpt.com/*`.
- Removed redundant host permissions from the Store package path.
- Added independent extension icons and Chrome Web Store promotional assets.
- Added per-feature toggles, hidden-item counts, compatibility notice, privacy policy, validation and packaging scripts.
- Added optional **recent N exchanges only** rendering; default N is 3 and the feature is off by default. Old turns are hidden with CSS rather than removed from React-managed DOM.
- Documented that ChatGPT DOM/UI changes can temporarily break the extension until selectors are updated.
