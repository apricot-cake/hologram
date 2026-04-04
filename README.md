# Post Snap

A Chrome extension that captures SNS posts as JPEG images with EXIF metadata. Post text is embedded in the image file, so you can search saved posts by content directly in Windows Explorer — no special tools needed.

## Usage

1. Click the extension icon in the toolbar (or press `Alt+S`)
2. Click the post you want to save
3. The post is saved as a JPEG with EXIF metadata to your downloads folder

## Demo

![Demo](docs/demo.gif)

## Supported Platforms

- X (Twitter)
- Bluesky
- Misskey

## Features

- Save posts as JPEG images with embedded EXIF metadata
- **Search saved posts by content** — post text is stored in the Comment field, searchable via `コメント:keyword` in Explorer
- Search by user with `タグ:@handle` or `タグ:DisplayName`
- View all metadata in Explorer's file properties (Details tab)
- Filenames sorted by post date (e.g. `2026-04-04.jpg`)

## EXIF Metadata Mapping

The extension writes metadata to standard EXIF fields that Windows Explorer can display.

| Explorer property | EXIF field | Content |
|---|---|---|
| Title | XPTitle | Post URL |
| Tags | XPKeywords | Platform, display name, screen name, user ID/UID |
| Comment | XPComment | Post text |
| Date taken | DateTimeOriginal | Post publish date (not capture date) |
| Program name | Software | Extension name and version |

> **Note:** "Date taken" shows the **post publish date**, not when the screenshot was captured. The file creation date reflects the capture time.

## Sorting and Filtering by Post Date

Files are named by post date (e.g. `2026-04-04.jpg`), so sorting by name equals sorting by post date.

To filter by date range in Explorer, add the "Date taken" column:

1. Switch to **Details** view
2. Right-click any column header and select **More...**
3. Check **Date taken** and click OK
4. Click the column header to sort, or click its **▼** to filter by date range

You can also type date range queries in the search bar: `撮影日時:2026/04/01..2026/04/03`

## Extracted Metadata

| Field | X | Bluesky | Misskey |
|---|---|---|---|
| Screen name | From post URL | From `data-testid` / profile link | From profile link |
| Display name | `[data-testid="User-Name"]` | Profile link text | Profile link text |
| User ID | React fiber / follow button | — | — |
| UID | — | DID from profile link | — |
| Post text | `[data-testid="tweetText"]` | `[data-testid="postText"]` | `.mfm` element |
| Post date | `<time>` element | `<time>` element | `<time>` element |

## Privacy

See [PRIVACY.md](PRIVACY.md) for the full privacy policy.
