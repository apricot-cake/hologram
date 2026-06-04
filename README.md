# Post Snap

**English** | [日本語](README.ja.md)

Capture posts from X, Bluesky, and Misskey, and browse them later in a desktop viewer.

Post Snap has two parts:

- a **Chrome extension** that captures the post you click as a JPEG, and
- a **desktop app** (Electron) that stores captures in a folder you choose and lets you search, filter, tag, and export them.

## How it works

1. Press `Alt+S` (or click the toolbar icon) and click the post you want to save.
2. The capture is written to your chosen folder as `<id>.jpg` plus a `<id>.json` sidecar holding the post's text, author, date, and engagement counts.
3. Open the desktop app to browse, search, filter, tag, and export.

No browser storage, no EXIF — the image and its metadata sit side by side as plain files you own and can move or back up freely.

## Supported Platforms

- X (Twitter)
- Bluesky
- Misskey

## What you can do

- Save posts to a folder you pick
- Search by text, user, date, engagement, or tags
- Tag posts and bulk-delete them
- Export to ZIP (images + metadata) or a standalone HTML file
- Restore by importing an exported HTML file

## Setup (development)

The desktop app isn't packaged yet — run it from source:

1. `cd app && npm install && npm start` — on first launch it registers the capture helper. Use **Save folder** in Settings to choose where captures go.
2. Load the extension: `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder. Copy the shown extension ID into the app's **Extension ID** field.
3. Capture with `Alt+S` (assign the shortcut at `chrome://extensions/shortcuts` if it isn't bound).

## Privacy

See [PRIVACY.md](PRIVACY.md). Nothing is sent to any server; everything stays in your local folder.
