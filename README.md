# Post Snap

**English** | [日本語](README.ja.md)

> Chrome Web Store review pending.

Capture posts from X, Bluesky, and Misskey, then browse and search them later in a built-in viewer.

## Usage

1. Click the toolbar icon (or press `Alt+S`)
2. Click the post you want to save
3. It's saved as a JPEG and added to the viewer

Open the viewer with `Alt+V` (or right-click the icon > Options).

## Demo

![Demo](docs/demo.gif)

## Supported Platforms

- X (Twitter)
- Bluesky
- Misskey

## What you can do

- Save posts as JPEGs
- Search by text, user, date, engagement, or tags
- Tag posts and bulk-delete them
- Export to ZIP or a standalone HTML file

## About the saved files

Captures go into `Downloads/Post Snap/` as regular JPEGs with the post info embedded. The viewer keeps its own database, but the JPEGs are there as a backup: if you uninstall the extension or move to a new machine, you can import the images and get everything back.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt+S` | Start capture mode |
| `Alt+V` | Open viewer |

Shortcuts can be customized in `chrome://extensions/shortcuts` (or `edge://extensions/shortcuts`).

## Privacy

See [PRIVACY.md](PRIVACY.md) for the full privacy policy.
