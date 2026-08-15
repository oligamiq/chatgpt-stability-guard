# Privacy Policy — Stability Guard for ChatGPT

Last updated: 2026-08-15

Stability Guard for ChatGPT is an independent, unofficial browser extension and is not affiliated with or endorsed by OpenAI.

## Data the extension handles

### Website content on chatgpt.com
The extension locally reads the rendered DOM of `chatgpt.com` to identify UI elements such as reasoning displays, tool traces, embedded tool UI, placeholders, and code/log blocks. Because these elements can appear near or inside conversations, the DOM processed by the extension may contain user-generated content or personal communications.

This website content is processed only in the browser tab for the extension's disclosed purpose: reducing rendering churn and optionally hiding or deferring selected ChatGPT UI elements.

The extension does **not** persist conversation content, create conversation archives, transmit conversation content to the developer, or send it to any third party.

### Local extension settings
The extension stores only its settings, privacy-consent version, and consent timestamp using `chrome.storage.local`. These values stay in the browser profile and are not sent to a developer-operated server.

## Network activity
The extension contains no analytics, advertising, telemetry, remote configuration, account system, or developer-operated backend. It does not initiate external network requests.

## Sharing and sale of data
The extension does not sell, share, or transfer user data to third parties.

## Retention, consent, and deletion
Website content is processed transiently in the active page and is not retained by the extension. Local extension settings remain until they are changed, cleared, or the extension is removed. The user can revoke local page-processing consent from the extension popup; when a ChatGPT tab is detected, the extension reloads that tab so DOM processing stops under the revoked consent state. Removing the extension removes its extension-local storage according to browser behavior.

## Permissions
The extension uses the `storage` permission for local settings and runs content scripts only on `https://chatgpt.com/*` so it can perform the UI rendering optimizations described above.

## Compatibility
The extension is implemented against the current ChatGPT web UI. Changes to ChatGPT's DOM or UI can temporarily break detection or hiding until the extension is updated.

## Contact
For privacy questions, use the developer contact method shown on the extension's store listing.
