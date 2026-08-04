<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-en-dark.svg">
    <img src="assets/banner-en-light.svg" alt="Hologram — no more 'where did I see that?' Posts and art, saved with who made them. Search it all later." width="440">
  </picture>
</p>

<p align="center"><strong>English</strong> · <a href="README.ja.md">日本語</a></p>

> [!WARNING]
> **Hologram has not had a release yet and is still under active development.**
> There is no installer to download — running it means building from source. The interface, the stored data format, and the behaviour described below can all still change in ways that break what came before. Keep your own backups of anything you would hate to lose.

Save the content you come across on the web — and find it again whenever you like. **Your own personal content library — every save keeps its creator, context, and source.**

No more "where did I see that?" Illustrations you loved, text you want to keep — gather them in one place, organize them, and pull them up anytime.

Today Hologram speaks fluent social media (X, Bluesky, Misskey, Mastodon, pixiv); the library itself is built for web content in general.

Hologram is **free and open source** (MIT). Your library is nothing but ordinary files in a folder you own — no account, no server, no lock-in.

## What it does

- **Save the whole post** — not just a screenshot, but the text, author, date, like count, and original URL too. So you can always find "that post" later.
- **Organize and search freely** — filter by your own tags, in-text hashtags, platform, date, engagement, and author. Reach what you want even among thousands.
- **Illustrations and posts in one place** — from pixiv illustrations to X text posts, all in a single library. View images in a grid (with square thumbnails and info as independent toggles), or read text in a list — switch to whatever suits the moment.
- **Everything stays with you** — your data lives on your PC, with images and metadata sitting side by side as ordinary files. Nothing is sent to any server. Open them later in another tool, or move the whole library — it's all yours.
- **Backup & portability** — export/import the whole library as a ZIP. You can also set up a **scheduled backup (mirror)** to another folder.

## Supported platforms

X (Twitter) ・ Bluesky ・ Misskey ・ Mastodon ・ pixiv

## How to use

### 1. Save (Chrome extension)

When you find a post you like —

- **Point at an image and press the save button** in its corner — saves the picture along with the post's text, author and source. One click, without leaving the timeline.
- **Press `Alt+S` and click the post** — saves a screenshot plus the text, author, date, engagement, and other details. This is the one that captures how the post *looks*; the corner button does not.
- **Drag an image** — save pixiv illustrations and the like as the image itself.

What you save gathers automatically in the desktop app (it watches the save folder, so new captures show up in the list right away).

Point at an image you've already saved and the same corner shows a small mark instead — no more stopping to wonder whether you saved that one. The check happens entirely on your computer, and works with the app closed. On the extension's options page you can have the mark show all the time instead of only on hover, or not at all, and turn the save button off.

### 2. Browse & read

Switch between **grid** and **list** at the top of the left sidebar. In the grid, **square thumbnails** and **show info** are independent toggles — turn on square thumbnails for an even, tile-like grid of illustrations, or leave it off to keep each picture's own proportions; turn on show info to add the author, an excerpt, and other details to each cell. List is good for reading text.

Click a card's image to open a **gallery** that bundles the screenshot and the original-resolution images. Posts with multiple images can be paged with `←` `→` or the arrow keys, and videos play right there. The toolbar at the top carries zoom (− / level / ＋) and a **fit ⇄ actual size** toggle (`Ctrl+0` / `Ctrl+1`); the wheel and a double-click do the same two things.

### 3. Find

Filter and sort from the left sidebar.

- **Search** — by text or username, with smart matching that forgives typos and kana variants
- **Filter** — by platform / author / tag / hashtag / date / engagement (likes, etc.) / folder (multi-select)
- **Sort** — newest first, most likes, save date, and more
- **Command palette (`Ctrl+K`)** — type to run a command or jump straight to a tag, author, folder or another tab. `/` puts the cursor in the search box instead.

Active filters gather at the top of the screen; **Reset** clears them all at once.

### 4. Organize

- **Tags** — right-click a card → "Edit tags." To tag a batch of untagged posts, filter to "no tags," save that search, then step through with the arrow keys and type into the tag field as you go.
- **Folders** — right-click → "Add to a folder…" to group by theme or favorites.
- **Bulk actions** — select multiple posts with the ○ at the top-left of each card, then tag, add to a folder, group, or delete them all at once.
- **Undo (`Ctrl+Z`)** — takes back tag and folder changes one step at a time, and the toast a bulk edit raises carries an Undo button. It lasts until you close the app. A batch that only added a tag to some of the selection gives back exactly that much — posts that already carried the tag keep it. Deleting is not on this stack; the trash is where a deleted post waits.

### 5. Backup & portability

From the **gear (Settings)** at the bottom-left of the screen.

- Export/import the whole library as a **ZIP**
- **Scheduled backup (mirror)** to another folder
- Theme (light/dark) and display language can also be switched here

## When post details cannot be fetched

The text, author, date and engagement counts come from the platform's own API, fetched by your browser — Hologram never signs in as you. For some posts that route answers nothing, even though the post is plainly on your screen:

- **X** — age-restricted posts, and posts from protected accounts. The endpoint X serves post details from answers anonymous callers only, and your x.com sign-in does not reach it.
- **Misskey / Mastodon** — followers-only posts, and servers that turn off API access for callers who are not signed in.
- **Bluesky / pixiv** — nothing of this kind. (pixiv is fetched with your own session, so what you can see, Hologram can read.)

What that means depends on how you save:

- **`Alt+S`** — the screenshot is saved either way, and some of what's missing is filled in from what the page is showing. Counts read off the page are the rounded ones the page displays, not the exact figures the API gives.
- **The other ways of saving** — the picture you pointed at is saved, without the post's text and author.
- If nothing about the post can be obtained and there is no picture to keep either — a post that has been deleted, or a video whose file only the platform's answer would name — **nothing is written at all**, rather than an empty entry.

Either way the save says so at the time, so a post that came in without its details is never a silent one.

## Setup

Preparing for release (including publishing the extension to the Chrome Web Store).

## Privacy

Everything is stored in a local folder; nothing is sent to any server. See [PRIVACY.md](PRIVACY.md) for details.

### Where your data lives

- **Library** (images + metadata): a plain folder you choose — default `~/Hologram/library`
- **Settings**: `~/.hologram`

Both are ordinary folders outside the app's installation, so **uninstalling the app never deletes them**. To remove everything, delete these two folders yourself.
