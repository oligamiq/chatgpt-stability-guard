# Chrome Web Store / Microsoft Edge Add-ons publishing checklist

This repository is prepared as a Chromium extension release candidate for both Chrome Web Store and Microsoft Edge Add-ons. The remaining steps require the relevant publisher account and a publicly hosted privacy-policy URL.

## 1. Validate and package

```bash
python3 scripts/package.py
python3 scripts/test.py
```

Upload only:

`dist/stability-guard-for-chatgpt-1.0.13.zip`

The packaging script removes the local development `key` from the Store ZIP. After the first Dashboard upload, use the Store item's public key for local development if you want the unpacked build to share the Store item ID.

## 2. Store listing assets

Required assets prepared in `store-assets/`:

- `icon-128.png` — 128x128 padded Chrome Web Store icon
- `edge-logo-300.png` — 300x300 Microsoft Edge Add-ons listing logo
- `promo-440x280.png` — 440x280 promotional image
- `screenshot-1-1280x800.png` — first-run disclosure screenshot
- `screenshot-2-1280x800.png` — settings / compatibility screenshot
- `screenshot-3-1280x800.png` — long-thread controls, including recent-N view (N defaults to 3)
- `marquee-1400x560.png` — optional marquee promotional image
- `promo-video-15s.mp4` — YouTube upload source for the Store promo-video URL
- `listing-ja.md` / `listing-en.md` — Chrome Web Store listing copy
- `edge-listing-ja.md` / `edge-listing-en.md` — browser-neutral Microsoft Edge Add-ons listing copy

The extension package itself includes 16/32/48/128 px PNG icons under `icons/`. Upload `promo-video-15s.mp4` to a YouTube account controlled by the publisher, then paste that video URL into the Store listing field.

## 3. Single purpose

Suggested Dashboard answer:

> Reduce rendering overhead in long ChatGPT web conversations by locally identifying and optionally hiding, compacting, or deferring selected ChatGPT UI elements.

All features in the extension directly support this one purpose.

## 4. Permission justification

### `storage`

> Stores only extension settings, privacy-consent version, and consent timestamp locally in the browser profile.

### `https://chatgpt.com/*` content-script access

> Required to inspect the rendered ChatGPT DOM locally and apply the user-selected rendering optimizations. The extension does not access cookies, authentication tokens, or network requests.

No broad `<all_urls>` permission is requested.

## 5. Privacy disclosures

A privacy policy is required because the extension processes website content locally. Host `PRIVACY.md` at a stable public HTTPS URL and enter that URL in the Developer Dashboard.

Conservative privacy disclosure guidance:

- Website content: **Yes** — rendered ChatGPT DOM is locally processed.
- User-generated content / personal communications: disclose if the Dashboard presents those categories, because conversation DOM can contain them.
- Web browsing history: **No** — the extension does not enumerate or retain browsing history; it is statically limited to chatgpt.com.
- Authentication information: **No** — cookies, tokens, and login credentials are not accessed.
- Analytics / telemetry: **No**.
- Data sold or shared: **No**.
- Remote transmission: **No developer-operated transmission**.
- Limited Use certification: certify only after verifying the final Dashboard wording matches the behavior documented in `PRIVACY.md`.

The first-run popup provides an in-product disclosure and requires affirmative consent before DOM processing starts.

## 6. Compatibility disclosure

Keep this statement visible in the Store listing and popup:

> Built against the current ChatGPT web UI. Changes to ChatGPT's DOM/UI can temporarily break detection until the extension is updated.

Do not describe the extension as permanently compatible with future ChatGPT versions.

## 7. Trademark / affiliation

Use the title **Stability Guard for ChatGPT**, not wording that suggests an official OpenAI product. Keep the statement:

> Independent, unofficial extension. Not created, endorsed, certified, or sponsored by OpenAI.

Do not use the OpenAI or ChatGPT logo as the extension icon.

## 8. Test instructions for reviewers

Suggested review instructions:

1. Install the extension and open `https://chatgpt.com/`.
2. Open the extension popup.
3. Read and accept the local data-processing disclosure.
4. Reload the ChatGPT tab.
5. Open a conversation containing reasoning/tool activity or a long code block.
6. Open the popup to toggle rendering options and inspect hidden/deferred counts.
   The “stale app loading errors” option hides structured `Failed to fetch template` cards only when their conversation turn is not the latest turn.
7. Optionally enable “recent N exchanges only”; its default N is 3. The extension keeps React-managed turn nodes measurable, bounds user scrolling to the recent-N semantic window, and shows a dedicated recent-range scrollbar.
8. Settings intentionally take effect after page reload.

No special account credentials are provided by the extension. Some ChatGPT UI elements only appear when the user's ChatGPT account/session produces those features.

## 9. Microsoft Edge Add-ons / Android

Use the same Store ZIP for Microsoft Edge Add-ons. The runtime remains Manifest V3, requests only `storage`, and uses the same `https://chatgpt.com/*` content-script scope.

For Edge review, explicitly mention that Android/mobile use is supported by the responsive action popup, coarse-pointer controls, and Visual Viewport tracking used by the recent-N scrollbar. Do not claim Android sideloading as the normal installation path; general users should install through Microsoft Edge Add-ons when the listing is available to Edge mobile.

Before submitting to Edge Add-ons, test both a desktop Edge build and a current Android Edge build with the same release ZIP/listing version. Mobile compatibility is a browser/store distribution decision in addition to extension code compatibility, so acceptance into or visibility within Edge's mobile extension catalog is not controlled by the manifest alone.

## 10. Before clicking Submit for Review

- Run `python3 scripts/test.py` again.
- Verify the privacy-policy URL is public and matches the Dashboard disclosures.
- Verify screenshots contain no private conversation data.
- Verify the Store ZIP has no `key`, test artifacts, `.pem`, or private files.
- Confirm the version number was incremented for any changes after upload.
