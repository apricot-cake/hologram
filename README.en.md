# Corpus

**English** | [日本語](README.md)

Collect SNS posts and drag-saved illustrations/images into **one app** to browse, search, and organize later.

Corpus has three parts:

- **Chrome extension** — click a post to capture it as JPEG, or drag an image to save it
- **Native messaging bridge** (Node) — writes captures as plain files into **a folder you choose**
- **Desktop app** (Electron) — browse, search, filter, tag, and export in two modes

No browser storage, no EXIF. Images/videos and metadata sit side by side as ordinary files — move or back them up freely (drop them straight into GitHub, etc.).

## Supported platforms

X (Twitter) / Bluesky / Misskey / Mastodon / **pixiv**

> Metadata comes only from each platform's stable official/public API (no DOM scraping). X has no official API, so an unofficial endpoint (`cdn.syndication.twimg.com`) is used; reposts/bookmarks/views aren't available.

## Two ways to save

- **Click a post** (`Alt+S` → click the post): saves a screenshot of the post plus its original media
- **Drag an image**: drop the dragged image into the drop zone to save the image itself (no screenshot)

Both fetch the same metadata (text, author, date, engagement, hashtags, …) from the post URL.

## Two viewer modes (switch in the left sidebar; the last mode is remembered)

- **Post view** — card display (text, stats, lightbox; filter by platform/user/date/engagement/tags). For URL-bearing SNS posts.
- **Image view** — square tile grid (for an illustration/image library). Filter by search, platform, sort (recently saved / updated / likes), min-likes, and tags (shown grouped).

## Features

- Save to any folder you choose
- Organize and filter by **tags / tag groups**
- **Image grouping** — collapse multiple images of the same post into one tile (×N badge, paged in the fullscreen viewer). Per-post ungroup/regroup (persistent), manual grouping of arbitrary images, and a temporary expand-all
- **Video** (mp4, etc.) and **original-resolution media** in the fullscreen viewer (video muted by default)
- ℹ for a detail popup, ↗ to open the original post, 🗑 to delete
- Export as ZIP (images + metadata) or a single HTML file; restore from that HTML (import)
- Language switch (auto / Japanese / English)

## Setup (development)

The desktop app isn't packaged yet, so run it from source.

1. `cd app && npm install && npm start` — the first launch registers the capture helper. Pick a **save folder** in Settings.
2. Load the extension: `chrome://extensions` → enable Developer mode → **Load unpacked** → select the `extension/` folder. Paste the shown extension ID into the app's **Extension ID** field.
3. Capture with `Alt+S` (if it doesn't work, assign it under `chrome://extensions/shortcuts`). You can also save images by dragging into the drop zone.

## Data format (sidecars)

In the save folder, each item is an image plus its metadata, side by side.

- `<id>.jpg` … the post-click screenshot (or the saved image itself)
- `<id>.json` … metadata (`platform` / `url` / `text` / `title` / `displayName` / `screenName` / `userId` / `likes`·`reposts`·… / `date` / `capturedAt` / `updatedAt` / `mediaType` / `media[]` / `hashtags[]` / `tags[]`, …)
- `<id>-media-N.<ext>` … the post's original-resolution media (if any)
- Library-level metadata: `tag-groups.json` (tag groups) / `ungrouped.json`·`manual-groups.json` (grouping settings)

`<captureId>.json` is the single source of truth. Nothing is sent to any server.

## Privacy

See [PRIVACY.md](PRIVACY.md). Everything is stored in a local folder; nothing is sent to any server.
