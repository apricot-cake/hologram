# Privacy Policy — Hologram

## Data Collection

Hologram does **not** collect, store, or transmit any personal data to us or to any third-party server of ours. All captured images and metadata are saved locally to a folder you choose on your device.

## External API Requests

To enrich each capture with post details (text, author, date, engagement counts), the extension makes read-only requests **directly from your browser to the platform the post belongs to**:

- **X (Twitter)** (`cdn.syndication.twimg.com`) — Fetches the post's public data. The post ID (and a token derived from it) is sent.
- **Bluesky** (`public.api.bsky.app`) — Resolves the author's handle to a DID (decentralized identifier), fetches the post, and fetches the author's public profile. The handle, the post's AT-URI (which contains the author's DID and the post key), and the author's DID are sent.
- **Misskey** (`{instance}/api/notes/show`, `{instance}/api/users/show`) — Fetches note and author details from the instance you are browsing. The note ID and the author's user ID are sent.
- **Mastodon** (`{instance}/api/v1/statuses/{id}`) — Fetches the status from the instance you are browsing. The status ID is sent.
- **pixiv** (`www.pixiv.net/ajax/illust/…`, `www.pixiv.net/ajax/user/…`) — Fetches artwork and author details. The artwork ID and the author's user ID are sent. **These requests include your pixiv session cookies** (sent only to pixiv itself, the site you are already browsing), so that works visible to your logged-in account — such as R-18 or follower-only works — can be captured. Your pixiv credentials are never sent anywhere else.

Except for the pixiv requests described above, no authentication tokens, cookies, or personal information are included in these requests. Every request goes straight to the platform in question; nothing passes through any intermediary server.

## Permissions

- **activeTab** — Access the current tab only when you activate the extension.
- **scripting** — Inject the post selection UI into the current page.
- **nativeMessaging** — Hand each capture to the Hologram desktop app on your device, which writes the image and its metadata to the folder you chose. The same local channel is asked which posts you have already saved, so timeline posts already in your library can be marked; the links of the posts on screen are sent to that local companion app and nowhere else.
- **storage** — Keep a per-browsing-session count of recent saves (so repeat saves of the same post can be labelled; cleared when the browser closes), your on/off preference for the "already saved" mark, and a small local ring buffer of capture diagnostics used only when the desktop app cannot be reached. All stay on your device.
- **Host permissions** (`cdn.syndication.twimg.com`, `www.pixiv.net`) — Allow the metadata requests described above.

## Data Storage

Captured posts are **not** stored in the browser. A local companion app on your device writes the image (`<id>.jpg`) to your chosen folder and records its metadata in a local database on the same device. The browser's extension storage holds only the diagnostics and session counters described under Permissions. Nothing is stored in sync storage or sent to any external server.

The platform responses listed under **External API Requests** are also kept, compressed and unaltered, in that same local database, so that details a future version of Hologram learns to read are not lost when a post is deleted. Only the response bodies for the post you are saving are kept — never your cookies, credentials, request headers, or the page itself. Because a response is stored as the platform sent it, it can include third-party fragments Hologram does not display (a quoted post's author, a reply's parent, profile details). This matters when you **export** your library: a complete-library ZIP includes these stored responses, and its manifest says so. An images-only export does not include them.

## AI Features (Local Inference)

AI-powered analysis (tagging, OCR, and similar) is **off by default**. Until you turn it on in Settings → AI Features, it never runs, and no related UI appears anywhere else in the app.

Enabling it adds exactly one new network connection: a one-time download of a model's files from `huggingface.co`, made only when a feature that needs that model first runs. The analysis itself always runs locally on this device — never on a server of ours or anyone else's — and nothing about your library (its images, text, or metadata) is ever sent to `huggingface.co` or anywhere else. Downloaded models are cached on your device and are not re-downloaded or updated automatically; that requires your consent again, the same as the first download.

## Contact

For questions or concerns, please open an issue at https://github.com/apricot-cake/hologram/issues.
