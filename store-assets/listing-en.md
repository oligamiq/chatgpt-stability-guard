# Chrome Web Store listing — English

## Title
Stability Guard for ChatGPT

## Short description
Reduce rendering churn in long ChatGPT web chats by hiding or deferring selected reasoning, tool UI, code/log, and older turns.

## Detailed description
Stability Guard for ChatGPT is an unofficial browser extension focused on one purpose: reducing rendering overhead in long ChatGPT web conversations.

Features include:
- Hide reasoning / Thinking UI
- Hide MCP / tool trace bodies
- Hide tool summary rows such as "Called tool"
- Hide embedded tool UI such as config cards
- Hide stale `Failed to fetch template` app-loading errors while keeping the latest-turn error visible
- Pre-hide loading placeholders for rich tool UI
- Dim or compact long trace blocks
- Defer off-screen code/log rendering
- Optionally show only the most recent N exchanges (off by default; N defaults to 3)
  - If ChatGPT replaces a conversation branch or virtual-scroll structure, recent-N safely disables for that page instead of forcing the scroll position. Reloading the page rebuilds it.
- Optionally defer older conversation turns
- Show how many elements are currently hidden or deferred
- Toggle each optimization independently

### Compatibility
This extension is implemented against the current ChatGPT web UI and its DOM/attribute structure. If ChatGPT changes its site markup or UI, some or all detection, hiding, or placeholder suppression can temporarily stop working until the extension is updated.

### Data handling
The extension locally reads rendered website content on `chatgpt.com` to identify UI elements. The DOM it processes may include conversation content, but conversation content is not transmitted or persistently stored by the extension.

- No conversation upload
- No conversation archive
- No ads, analytics, or telemetry
- No developer-operated backend
- Only extension settings and consent state are stored locally in Chrome Storage

The extension presents this local-processing disclosure in-product and requires affirmative consent before it starts processing ChatGPT page content.

### Unofficial
This is an independent, unofficial extension. It is not created, endorsed, certified, or sponsored by OpenAI.
