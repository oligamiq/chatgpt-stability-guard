# Security

## Scope

This extension intentionally does not communicate with developer-operated servers and does not execute remote code.

## Reporting

For security issues, use the developer contact shown on the Chrome Web Store listing. Do not include private ChatGPT conversation content in a public report.

## Design constraints

- Manifest V3
- no `eval`, `new Function`, remote scripts, or remote configuration
- no network interception
- no cookies or authentication-token access
- content scripts limited to `https://chatgpt.com/*`
- settings stored with `chrome.storage.local`
