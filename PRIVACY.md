# Privacy Policy — Corpus

## Data Collection

Corpus does **not** collect, store, or transmit any personal data to us or to any third-party server of ours. All captured images and metadata are saved locally to a folder you choose on your device.

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
- **nativeMessaging** — Hand each capture to the Corpus desktop app on your device, which writes the image and its metadata to the folder you chose.
- **storage** — Keep a per-browsing-session count of recent saves (so repeat saves of the same post can be labelled; cleared when the browser closes), and a small local ring buffer of capture diagnostics used only when the desktop app cannot be reached. Both stay on your device.
- **Host permissions** (`cdn.syndication.twimg.com`, `www.pixiv.net`) — Allow the metadata requests described above.

## Data Storage

Captured posts are **not** stored in the browser. Each capture is written to your chosen folder as an image (`<id>.jpg`) plus a metadata sidecar (`<id>.json`) by a local companion app on your device. The browser's extension storage holds only the diagnostics and session counters described under Permissions. Nothing is stored in sync storage or sent to any external server.

## Contact

For questions or concerns, please open an issue at https://github.com/apricot-cake/corpus/issues.
