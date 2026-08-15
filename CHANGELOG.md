# Changelog

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
