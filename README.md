# Post Snap

> Chrome Web Store review pending.

A Chrome extension that captures SNS posts as JPEG images with searchable metadata. Saved posts can be browsed, searched, and exported from the built-in viewer.

## Usage

1. Click the extension icon in the toolbar (or press `Alt+S`)
2. Click the post you want to save
3. The post is saved as a JPEG to your downloads folder, and added to the viewer

Open the viewer from the extension's options page (right-click the icon > Options) to browse, search, and export your saved posts.

## Demo

![Demo](docs/demo.gif)

## Supported Platforms

- X (Twitter)
- Bluesky
- Misskey

## Features

- Save posts as JPEG images with embedded EXIF metadata
- **Built-in viewer** — browse, search, sort, and filter saved posts by text, username, platform, and engagement
- **Export** — ZIP (images + metadata JSON) or self-contained HTML with search UI
- **Import** — restore data from exported images (EXIF) or exported HTML
- Filenames sorted by post date (e.g. `images/2026-04-04.jpg`)

## File Structure

```
Downloads/Post Snap/
  images/
    2026-04-04.jpg       <- JPEG with EXIF metadata
    2026-04-04 (1).jpg
```

Images saved to the download folder serve as a backup. Even if the extension is removed, you can restore data by importing the image files.

## EXIF Metadata

Post metadata is stored as JSON in the EXIF XPComment field. This is readable in Explorer's file properties (Details tab > Comment).

| EXIF field | Content |
|---|---|
| XPComment | JSON with post URL, platform, text, user info, engagement counts, date |
| DateTimeOriginal | Post publish date |
| Software | Extension name, version, and build hash |

XPComment JSON example:
```json
{
  "url": "https://x.com/user/status/123",
  "platform": "x",
  "text": "Post text",
  "displayName": "User",
  "screenName": "user",
  "userId": "123456",
  "likes": 783,
  "reposts": 72,
  "replies": 4,
  "bookmarks": 128,
  "date": "2026-04-05T12:34:56Z"
}
```

> **Note:** "Date taken" shows the **post publish date**, not when the screenshot was captured.

### EXIF data may be lost

EXIF metadata can be stripped in certain situations:

- Editing and re-saving with image editors (Paint, Photoshop, etc.)
- Re-uploading to social media platforms
- Image conversion by some cloud storage services
- Editing with Windows Photos app

## Privacy

See [PRIVACY.md](PRIVACY.md) for the full privacy policy.
