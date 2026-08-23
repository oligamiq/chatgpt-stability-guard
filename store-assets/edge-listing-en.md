# Microsoft Edge Add-ons listing — English

## Title
Stability Guard for ChatGPT

## Short description
Reduce lag and clutter in long ChatGPT chats by hiding old turns, Thinking, tool traces, stale errors, and other heavy UI locally.

## Detailed description
Long ChatGPT threads can become sluggish and visually crowded as old turns, Thinking/reasoning, tool traces, embedded apps, errors, code, and logs accumulate. Stability Guard for ChatGPT reduces that rendering overhead locally without deleting your ChatGPT conversation history.

Everything runs in your browser on `chatgpt.com`: no conversation uploads, ads, analytics, telemetry, developer backend, remote configuration, or remote code.

Highlights:
- Optionally keep only the most recent N exchanges visible (off by default; N=3)
- Hide Thinking / reasoning UI
- Hide passive MCP / tool traces and tool-summary rows
- Preserve live App, Connect, authentication, and Retry controls
- Hide stale `Failed to fetch template` errors while keeping current-turn errors visible
- Suppress confirmed broken preview remnants without blocking healthy or still-loading App UI
- Dim or compact long trace blocks and defer off-screen code/log rendering
- Show counts of hidden or deferred elements
- Toggle each optimization independently

On mobile devices, including Android, the action UI adapts to narrow screens, touch input, safe areas, and Visual Viewport changes.
The extension UI supports English and Japanese, uses the browser language by default, and can be switched manually from the popup.
