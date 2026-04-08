# Eagle Info+

**English** | [日本語](README.ja.md)

A companion extension for [Eagle for Chrome](https://chromewebstore.google.com/detail/eagle-for-chrome/lieogkinebikhdchceieedcigeafdkid) that automatically enriches saved images with SNS post metadata.

When you save an image through the official extension, this extension writes author info, post details, and other metadata into Eagle's annotation field.

## Requirements

- [Eagle](https://en.eagle.cool/) desktop app (must be running)
- [Eagle for Chrome](https://chromewebstore.google.com/detail/eagle-for-chrome/lieogkinebikhdchceieedcigeafdkid) browser extension

## Supported Platforms

- X (Twitter)
- Bluesky
- [misskey.io](https://misskey.io/)

## Captured Data

- Platform
- Display Name
- Author (@screenName)
- UID (X numeric ID / Bluesky DID)
- Post ID
- Image Index (e.g. 1/3)
- Published
- Hashtags
- Alt Text
- Text
- Source URL

## How It Works

1. Content script listens for `dragstart` events on images
2. Extracts metadata from the parent post element
3. Background script polls the Eagle API (`localhost:41595`) to detect newly saved items
4. Matches items by URL and writes metadata to the annotation field

Polling only runs after a drag operation (up to 30 seconds) and does not make continuous API calls.

## Annotation Output Example

```
@username - Post text here

Platform: X (Twitter)
Display Name: Display Name
Author: @username
UID: 1234567890
Post ID: 2040000000000000000
Image: 1/3
Published: 2026-04-04T12:00:00.000Z
Hashtags: #illustration #fanart
Alt: Image description set by the poster
Text: Post text here
```

## Installation

1. Clone this repository
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select this folder
5. Make sure the [Eagle](https://en.eagle.cool/) desktop app and [Eagle for Chrome](https://chromewebstore.google.com/detail/eagle-for-chrome/lieogkinebikhdchceieedcigeafdkid) extension are installed

## File Structure

```
manifest.json       Manifest V3
content.js          dragstart event listener + metadata extraction
background.js       Eagle API polling + item update + X Syndication API
page-context.js     X: extracts user ID from React fiber in page context
icons/              Placeholder icons
```

## Limitations

- [Eagle REST API](https://api.eagle.cool/) `/api/item/update` does not support renaming items, so title info is placed in the first line of the annotation
- Tags are intentionally not written to preserve existing tag organization
