# SNS Post to Save

**English** | [日本語](README.ja.md)

A Chrome extension that lets you click an SNS post and save it as a PNG image together with metadata such as the post URL, handle name, user IDs, and post timestamp, so the post stays searchable later.

## Usage

1. Click the extension icon in the toolbar (or press `Alt+S`)
2. Click the post you want to save
3. The post is saved as a PNG with metadata to your downloads folder


## Demo

![Demo](docs/demo.gif)

## Features

- Save posts from X, Bluesky, and Misskey as images
- Use short filenames like `2026-03-29_08-20-15_x.com_screenname_postid.png`
- Embed metadata into the PNG `iTXt` chunk
- Optionally save a sidecar JSON file with the same base filename

## Metadata Fields

- `schema` — Data format version
- `capturedAt` — When the image was saved
- `platform` — Which SNS (`x` / `bluesky` / `misskey` etc.)
- `pageTitle` — Browser tab title at save time
- `pageUrl` — The page URL that was open
- `postUrl` — The post URL (recorded even when saving from a feed)
- `sourceHost` — Site hostname (`x.com`, `bsky.app` etc.)
- `postId` — Post ID
- `screenName` — Account handle (the `@name` part)
- `userId` — Platform-specific user ID
- `uid` — A more stable user identifier separate from the handle (e.g. Bluesky DID)
- `postPublishedAt` — When the post was published
- `extension.name` / `extension.version` — Name and version of the extension that saved the file

## Where The Metadata Lives

The metadata is inside the PNG itself, not in a separate database. This keeps the image portable even when you move it by itself.

> **Note:** Uploading to social media or re-saving with an image editor may strip the metadata. Keep the original PNG to be safe.

## JSON Option

The `Also save JSON with PNG` option is off by default.

- Benefit: Easier to read from scripts, editors, and external tools
- Benefit: Metadata survives even if the image is re-saved or edited
- Tradeoff: The image and metadata become two separate files to manage

## Metadata

The PNG stores JSON metadata in a UTF-8 `iTXt` chunk with the keyword `sns-post-to-save`.

```json
{
  "schema": "sns-post-to-save/v1",
  "capturedAt": "2026-03-29T12:34:56.789Z",
  "platform": "x",
  "pageTitle": "Home / X",
  "pageUrl": "https://x.com/home",
  "postUrl": "https://x.com/user/status/123",
  "sourceHost": "x.com",
  "postId": "123",
  "screenName": "user",
  "userId": null,
  "uid": null,
  "postPublishedAt": "2026-03-29T08:20:15.000Z",
  "extension": {
    "name": "SNS Post to Save",
    "version": "0.1.0"
  }
}
```

## Other Extensions

- [Reverse Playlist for YouTube](https://chromewebstore.google.com/detail/jhkeggdcdocibfplmbfebiokkbhgipkn)
