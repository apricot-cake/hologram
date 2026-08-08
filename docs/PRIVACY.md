# Privacy Policy — Hologram

## Data Collection

Hologram does **not** collect, store, or transmit any personal data to us. There is no Hologram account, no Hologram server, and nothing is relayed through anything of ours. All captured images and metadata are saved locally to a folder you choose on your device.

Traffic does leave your device, and everything that does is listed below. Hologram is three pieces, and each one reaches the network for a different reason:

| Piece | What it talks to |
| --- | --- |
| The browser extension | the platform whose post you are saving, for the post's details |
| The companion app on your device | the platform's media servers, for the files themselves — plus, if you turn AI features on, a one-time model download |
| Links you open yourself | whichever site you asked for, in your own browser |

## 1. The browser extension — post details

To enrich each capture with post details (text, author, date, engagement counts), the extension makes read-only requests **directly from your browser to the platform the post belongs to**:

- **X (Twitter)** (`cdn.syndication.twimg.com`) — Fetches the post's public data. The post ID (and a token derived from it) is sent.
- **Bluesky** (`public.api.bsky.app`) — Resolves the author's handle to a DID (decentralized identifier), fetches the post, and fetches the author's public profile. The handle, the post's AT-URI (which contains the author's DID and the post key), and the author's DID are sent. Saving a **video** needs one step further, because only the account's DID document names the server that holds its blobs: for a `did:plc:` author that document is read from `plc.directory`, and for a `did:web:` author from the domain the DID itself names. The DID is what is sent.
- **Misskey** (`{instance}/api/notes/show`, `{instance}/api/users/show`) — Fetches note and author details from the instance you are browsing. The note ID and the author's user ID are sent.
- **Mastodon** (`{instance}/api/v1/statuses/{id}`) — Fetches the status from the instance you are browsing. The status ID is sent.
- **pixiv** (`www.pixiv.net/ajax/illust/…`, `www.pixiv.net/ajax/user/…`) — Fetches artwork and author details. The artwork ID and the author's user ID are sent. **These requests include your pixiv session cookies** (sent only to pixiv itself, the site you are already browsing), so that works visible to your logged-in account — such as R-18 or follower-only works — can be captured. Your pixiv credentials are never sent anywhere else.

For a page on any other site, the extension reads the page's own metadata (schema.org, Open Graph, Dublin Core, Highwire) out of the tab you are looking at. That is a read of the page already in front of you; it sends nothing.

Except for the pixiv requests described above, no authentication tokens, cookies, or personal information are included in these requests. Every request goes straight to the platform in question; nothing passes through any intermediary server.

## 2. The companion app — the media files themselves

The pictures and videos are **not** downloaded by the extension. The extension hands the post's media URLs to the companion app on your device, and that app fetches each file — the post's images and video, and the author's avatar — straight from whichever media host the platform's own response points at (`i.pximg.net` for a pixiv original, X's image CDN, the Bluesky account's own server, the Misskey or Mastodon instance you were browsing). The same thing happens when an earlier save is completed later on, for instance when avatars are filled in for posts already in your library.

What travels is the media URL the platform published, and nothing else:

- **No cookies, credentials, or authentication of any kind are attached.** The one header added beyond the request itself is a `Referer` of `https://www.pixiv.net/…` when fetching a pixiv original, because pixiv's image host refuses the request without it. Your pixiv session cookies are not part of it.
- Only `https://` URLs are fetched, addresses inside your own network or machine are refused, and every redirect hop is re-checked against the same rules — so a URL cannot be used to make the app reach something on your local network.
- Nothing about your library is included in these requests. They are ordinary downloads of files the post already points at.

Apart from these downloads and the AI model download described below, the desktop app makes no network requests of its own.

## 3. Links you open yourself

Some parts of the app hand a URL to your normal browser. Nothing is sent when the button is merely on screen — only when you choose it — and **your library's files are never uploaded** by any of them:

- **Open the post, or the author's profile** — the platform's own URL, as recorded with the save.
- **Reverse image search** (`saucenao.com`, `ascii2d.net`) — opens that service with the **platform's public media URL** for the item in the query string, so the service fetches the picture from the platform itself. Your local copy is not uploaded. The URL identifies the post's image on the platform where it was published.
- **Web search from your filters** — translates the filters you currently have applied (keywords, hashtags, author handles, dates) into a search URL for X, Bluesky, Misskey, Mastodon, pixiv, or Google, and opens it. The words that travel are the words in your filters.
- **Web search for selected text** — right-clicking text you have selected inside a saved post offers to search the web for it, which opens a Google query. What travels is the text you selected (its first 1000 characters).

These open in your browser, under whatever session and settings your browser already has.

## AI Features (Local Inference)

AI-powered analysis (tagging, OCR, and similar) is **off by default**. Until you turn it on in Settings → AI Features, it never runs, and no related UI appears anywhere else in the app.

Enabling it adds one network connection the app would not otherwise make: a one-time download of a model's files from `huggingface.co`, made only when a feature that needs that model first runs. The analysis itself always runs locally on this device — never on a server of ours or anyone else's — and nothing about your library (its images, text, or metadata) is ever sent to `huggingface.co` or anywhere else. Downloaded models are cached on your device and are not re-downloaded or updated automatically; that requires your consent again, the same as the first download.

## Permissions

- **activeTab** — Access the current tab only when you activate the extension.
- **scripting** — Inject the post selection UI into the current page.
- **nativeMessaging** — Hand each capture to the Hologram desktop app on your device, which writes the image and its metadata to the folder you chose. The same local channel is asked which posts you have already saved, so timeline posts already in your library can be marked; the links of the posts on screen are sent to that local companion app and nowhere else.
- **storage** — Keep a per-browsing-session count of recent saves (so repeat saves of the same post can be labelled; cleared when the browser closes), your on/off preference for the "already saved" mark, and a small local ring buffer of capture diagnostics used only when the desktop app cannot be reached. All stay on your device.
- **Host permissions** (`cdn.syndication.twimg.com`, `www.pixiv.net`) — Allow the metadata requests described above.

## Data Storage

Captured posts are **not** stored in the browser. A local companion app on your device writes the image (`<id>.jpg`) to your chosen folder and records its metadata in a local database on the same device. The browser's extension storage holds only the diagnostics and session counters described under Permissions. Nothing is stored in sync storage, and nothing is sent to a server of ours.

The platform responses listed under **The browser extension** are also kept, compressed and unaltered, in that same local database, so that details a future version of Hologram learns to read are not lost when a post is deleted. Only the response bodies for the post you are saving are kept — never your cookies, credentials, request headers, or the page itself. Because a response is stored as the platform sent it, it can include third-party fragments Hologram does not display (a quoted post's author, a reply's parent, profile details). This matters when you **export** your library: a complete-library ZIP includes these stored responses, and its manifest says so. An images-only export does not include them.

## Contact

For questions or concerns, please open an issue at https://github.com/apricot-cake/hologram/issues.
