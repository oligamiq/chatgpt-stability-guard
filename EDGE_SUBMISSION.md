# Microsoft Edge Add-ons submission — 1.0.20

## Package
- ZIP: `dist/stability-guard-for-chatgpt-1.0.20.zip`
- Manifest: MV3
- Runtime permission: `storage` only
- Content-script scope: `https://chatgpt.com/*`
- Visibility: Public
- Markets: All markets
- Suggested category: Productivity

## Store assets
- Logo: `store-assets/edge-logo-300.png` (300×300 PNG)
- Optional small promotional tile: `store-assets/promo-440x280.png`
- Optional large promotional tile: `store-assets/marquee-1400x560.png`
- Optional screenshots: existing 1280×800 files may be used only after confirming they do not show another browser's branding.
- Japanese listing: `store-assets/edge-listing-ja.md`
- English listing: `store-assets/edge-listing-en.md`
- UI languages: Japanese and English (`Auto` follows the browser language; manual override is available in the popup).

## Public URLs
- Website: `https://github.com/oligamiq/chatgpt-stability-guard`
- Privacy policy: `https://oligamiq.github.io/chatgpt-stability-guard/`

## Privacy — Single purpose
Reduce rendering overhead in long ChatGPT web conversations by locally identifying and optionally hiding, compacting, or deferring selected ChatGPT UI elements.

## Privacy — permission justification
`storage`: Stores only extension settings and UI language preference in extension-local storage.

`https://chatgpt.com/*`: Content scripts inspect the rendered ChatGPT DOM locally to apply the user-selected rendering optimizations. The extension does not access cookies, authentication tokens, browsing history, or network traffic.

## Privacy — data practices
- Website content / user-generated content: processed locally because the rendered ChatGPT DOM can include conversation content.
- Persistent conversation storage: No.
- Developer/third-party transmission: No.
- Analytics, telemetry, advertising, remote configuration: No.
- Sale or sharing of user data: No.
- Authentication information: Not accessed.
- Browsing history: Not accessed or retained.

## Reviewer notes
1. Install the extension and open `https://chatgpt.com/`.
2. Open the extension action.
3. Reload the ChatGPT tab if it was already open when the extension was installed or updated.
4. Open a long conversation and toggle rendering options from the extension action.
5. Optionally enable “recent N exchanges only”; N defaults to 3 and the feature defaults to off.
6. On Android/mobile, verify that the action UI fits the viewport and recent-N scrolling follows browser chrome / soft-keyboard viewport changes.
7. The extension intentionally has no developer account, backend, telemetry, or test credentials.

## Submission notes
The extension is implemented against the current ChatGPT web UI. If ChatGPT changes its DOM/UI structure, some detection or rendering optimizations can temporarily stop working until the extension is updated. The project is independent and unofficial and is not created, endorsed, certified, affiliated with, or sponsored by OpenAI.
