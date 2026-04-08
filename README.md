# Post Snap

**English** | [日本語](README.ja.md)

> Chrome Web Store review pending.

A Chrome extension that captures SNS posts and lets you browse, search, and tag them later from a built-in viewer.

## Usage

1. Click the extension icon in the toolbar (or press `Alt+S`)
2. Click the post you want to save
3. The post is saved as a JPEG to your downloads folder, and added to the viewer

Open the viewer with `Alt+V` (or right-click the icon > Options) to browse, search, filter, and export your saved posts.

## Demo

![Demo](docs/demo.gif)

## Supported Platforms

- X (Twitter)
- Bluesky
- Misskey

## Features

- Save posts as JPEG images you can keep forever
- Find a saved post later by text, user, date, engagement, or your own tags
- Tag and bulk-delete posts from the built-in viewer
- Export everything as a ZIP or a single HTML file you can open offline

## Your Data, Your Files

Saved posts live in the viewer, but every capture is also written to your `Downloads/Post Snap/` folder as a JPEG with the post info embedded in the file. That means:

- You always have a copy on disk, outside the browser
- If you uninstall the extension or move to another machine, you can drop the images back in to restore everything
- The JPEGs work in any image viewer — Post Snap is just a nicer way to look at them

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt+S` | Start capture mode |
| `Alt+V` | Open viewer |

Shortcuts can be customized in `chrome://extensions/shortcuts` (or `edge://extensions/shortcuts`).

## Privacy

See [PRIVACY.md](PRIVACY.md) for the full privacy policy.
