# Chrome Web Store listing — English

## Title
Stability Guard for ChatGPT

## Short description
Reduce lag and clutter in long ChatGPT chats by hiding old turns, Thinking, tool traces, stale errors, and other heavy UI locally.

## Detailed description
Long ChatGPT threads can become sluggish and visually crowded as old turns, Thinking/reasoning, tool traces, embedded apps, errors, code, and logs accumulate. Stability Guard for ChatGPT reduces that rendering overhead locally while leaving your ChatGPT conversation history intact.

Everything runs in your browser on `chatgpt.com`: no conversation uploads, ads, analytics, telemetry, developer backend, remote configuration, or remote code.

Highlights:
- Optionally keep only the most recent N exchanges visible (off by default; N defaults to 3)
- Hide Thinking / reasoning UI
- Hide passive MCP / tool traces and summary chrome such as "Called tool"
- Preserve live App, Connect, authentication, and Retry controls instead of hiding their parent UI
- Hide stale app-loading errors such as `Failed to fetch template` while keeping current-turn errors visible
- Suppress confirmed broken app-preview remnants without blocking healthy or still-loading App UI
- Pre-hide loading placeholders for rich tool UI
- Dim or compact long trace blocks
- Defer off-screen code/log rendering and optionally defer older turns
- Show counts of elements currently hidden or deferred
- Toggle each optimization independently

Recent-N is designed around ChatGPT's virtualized conversation UI. If a branch edit or major virtual-scroll structure change makes the safe boundary uncertain, only recent-N fails open for that page instead of forcing the scroll position; reloading rebuilds the boundary.

### Compatibility
This extension is implemented against the current ChatGPT web UI and its DOM/attribute structure. If ChatGPT changes its site markup or UI, some or all detection, hiding, or placeholder suppression can temporarily stop working until the extension is updated.

### Data handling
The extension locally reads rendered website content on `chatgpt.com` to identify UI elements. The DOM it processes may include conversation content, but conversation content is not transmitted or persistently stored by the extension.

- No conversation upload
- No conversation archive
- No ads, analytics, or telemetry
- No developer-operated backend
- Only extension settings and UI language preference are stored locally in Chrome Storage

The popup includes a direct link to the bundled privacy policy.

### Unofficial
This is an independent, unofficial extension. It is not created, endorsed, certified, or sponsored by OpenAI.

The extension UI supports English and Japanese, uses the browser language by default, and can be switched manually from the popup.
