<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-en-dark.svg">
    <img src="assets/banner-en-light.svg" alt="Hologram — more than screenshots: your whole library" width="440">
  </picture>
</p>

<p align="center"><strong>English</strong> · <a href="README.ja.md">日本語</a></p>

Save the content you come across on the web — and find it again whenever you like. **Your own personal content library — every save keeps its creator, context, and source.**

No more "where did that post go?" Illustrations you loved, text you want to keep — gather them in one place, organize them, and pull them up anytime.

Today Hologram speaks fluent social media (X, Bluesky, Misskey, Mastodon, pixiv); the library itself is built for web content in general.

Hologram is **free and open source** (MIT). Your library is nothing but ordinary files in a folder you own — no account, no server, no lock-in.

## What it does

- **Save the whole post** — not just a screenshot, but the text, author, date, like count, and original URL too. So you can always find "that post" later.
- **Organize and search freely** — filter by your own tags, in-text hashtags, platform, date, engagement, and author. Reach what you want even among thousands.
- **Illustrations and posts in one place** — from pixiv illustrations to X text posts, all in a single library. View images as cards or tiles, read text in a list — switch to whatever suits the moment.
- **Everything stays with you** — your data lives on your PC, with images and metadata sitting side by side as ordinary files. Nothing is sent to any server. Open them later in another tool, or move the whole library — it's all yours.
- **Backup & portability** — export/import the whole library as a ZIP. You can also set up a **scheduled backup (mirror)** to another folder.

## Supported platforms

X (Twitter) ・ Bluesky ・ Misskey ・ Mastodon ・ pixiv

## How to use

### 1. Save (Chrome extension)

When you find a post you like —

- **Press `Alt+S` and click the post** — saves a screenshot plus the text, author, date, engagement, and other details.
- **Drag an image** — save pixiv illustrations and the like as the image itself.

What you save gathers automatically in the desktop app (it watches the save folder, so new captures show up in the list right away).

### 2. Browse & read

Switch between **card / tile / list** views at the top of the left sidebar. Tile is good for browsing illustrations side by side; list is good for reading text.

Click a card's image to open a **gallery** that bundles the screenshot and the original-resolution images. Posts with multiple images can be paged with `←` `→` or the arrow keys, and videos play right there.

### 3. Find

Filter and sort from the left sidebar.

- **Search** — by text or username, with smart matching that forgives typos and kana variants
- **Filter** — by platform / author / tag / hashtag / date / engagement (likes, etc.) / folder (multi-select)
- **Sort** — newest first, most likes, save date, and more

Active filters gather at the top of the screen; **Reset** clears them all at once.

### 4. Organize

- **Tags** — right-click a card → "Edit tags." There's also a "tagging session" to tag untagged posts one after another.
- **Folders** — right-click → "Add to a folder…" to group by theme or favorites.
- **Clip** — hover a card and hit 📎 to collect items into a temporary tray for comparison.
- **Bulk actions** — select multiple posts with the ○ at the top-left of each card, then tag, add to a folder, group, or delete them all at once.

### 5. Backup & portability

From the **gear (Settings)** at the bottom-left of the screen.

- Export/import the whole library as a **ZIP**
- **Scheduled backup (mirror)** to another folder
- Theme (light/dark) and display language can also be switched here

## Setup

Preparing for release (including publishing the extension to the Chrome Web Store).

## Privacy

Everything is stored in a local folder; nothing is sent to any server. See [PRIVACY.md](PRIVACY.md) for details.

### Where your data lives

- **Library** (images + metadata): a plain folder you choose — default `~/Hologram/library`
- **Settings**: `~/.hologram`

Both are ordinary folders outside the app's installation, so **uninstalling the app never deletes them**. To remove everything, delete these two folders yourself.
