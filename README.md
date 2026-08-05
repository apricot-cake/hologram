<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-en-dark.svg">
    <img src="assets/banner-en-light.svg" alt="Hologram — no more 'where did I see that?' Your social media library." width="440">
  </picture>
</p>

<p align="center"><strong>English</strong> · <a href="README.ja.md">日本語</a></p>

> [!WARNING]
> **Hologram has not had a release yet and is still under active development.**
> There is no installer — running it means building from source. The interface, stored data format, and behaviour described below can still change in breaking ways. Keep your own backups of anything you would hate to lose.

Save the content you come across on the web — text, author, and source included — and find it again whenever you like. **Your own personal content library.** No more "where did I see that?"

Today Hologram is best at social media (X, Bluesky, Misskey, Mastodon, pixiv); the library itself is built for web content in general, and takes local files too.

Hologram is **free and open source** (MIT). Your library is nothing but ordinary files in a folder you own — no account, no server, no lock-in.

## What it does

- **Save the whole post** — not just a screenshot, but the text, author, date, like count, and original URL too. Polls keep their options and vote counts, and the author's profile is snapshotted — so the post stays readable even after the original is gone.
- **Not only posts** — local files join the same library. Images and video get the full treatment; a PDF or an archive is kept as a collected item, sharing the same tags, folders and search.
- **Organize and search freely** — filter by tag, in-text hashtag, platform, date, engagement, and author. Tag aliases keep the different spellings of one thing together.
- **Read it however suits the moment** — a grid for illustrations, a list for text, a timeline feed for drifting back through your saves, or a small always-on-top window beside your drawing app.
- **Everything stays with you** — your data lives on your PC as ordinary files. Nothing is sent to any server; open it in another tool or move the whole library whenever you like.
- **Backup & portability** — export/import as a ZIP, mirror to another folder on a schedule, keep several separate libraries.

## What goes in it

- **Social media** — X (Twitter) ・ Bluesky ・ Misskey ・ Mastodon ・ pixiv
- **Pages elsewhere on the web** — title, author and date are read from whatever the page publishes about itself (schema.org, Open Graph, Dublin Core, Highwire)
- **Files on your own machine** — images and video as full members of the library, anything else as a collected item

## How to use

### 1. Save

**From the browser** (Chrome, Edge, Brave, Vivaldi) —

- **The save button in an image's corner** — one click saves the picture with the post's text, author and source.
- **Press `Alt+S` and click the post** — saves a screenshot plus the text, author, date and engagement. This is the only method that captures how the post *looks*.
- **Drag an image** — save pixiv illustrations and the like as the image itself.
- **A pixiv bookmark page in one go** — saves everything on the page at once, paced so the site is not hammered; you turn the pages.

The extension's toolbar popup shows whether the app is reachable, what saved recently, today's count, and a button to capture the post you are looking at.

**From your desktop** — drag files or folders straight onto the app window.

Saves appear in the desktop app automatically. Images you have already saved get a small mark in the same corner — no more wondering whether you saved that one. The check runs entirely on your computer and works with the app closed; the mark and the save button can be configured on the extension's options page.

### 2. Browse & read

Three ways in from the left rail: **Library** (everything you saved), **Posters** (grouped by the people you saved from), and **Timeline** (a feed for reading rather than hunting).

Library switches between **grid** and **list**. In the grid, **square thumbnails** and **show info** are independent toggles; list is good for reading text.

Click a card's image to open a **gallery** bundling the screenshot and the original-resolution images. Multi-image posts page with `←` `→` or the arrow keys, and videos play right there. Zoom and **fit ⇄ actual size** work from the toolbar, the wheel, a double-click, or `Ctrl+0` / `Ctrl+1`.

- **Pin it** — right-click → "Send to pin window" for a small frameless window that stays above everything else. Reference material beside your drawing app.
- **Practice mode** — deals out the stills in your current filter one at a time on a timer.
- **History (`Ctrl+H`)** — everywhere you have been, in date order, searchable, one click to go back.

### 3. Find

From the left sidebar —

- **Search** — by text or username, forgiving typos and kana variants
- **Filter** — by platform / author / tag / hashtag / date / engagement (likes, etc.) / folder (multi-select)
- **Sort** — newest first, most likes, save date, and more
- **Command palette (`Ctrl+K`)** — run a command or jump straight to a tag, author, folder or another tab. `/` puts the cursor in the search box

Active filters gather at the top of the screen; **Reset** clears them all at once.

Looking for something you *didn't* save? **Search the web** translates the filters you just built into each site's own search syntax, so the same question can go back out to X, Bluesky, pixiv and the rest. Conditions that don't survive the translation are flagged before you leave.

### 4. Organize

- **Tags** — right-click a card → "Edit tags." To tag a batch, filter to "no tags," save that search, then step through with the arrow keys.
- **Tend the vocabulary** — right-click → "Manage tags…" to rename, merge, set a parent, clear out orphans, and give a tag **aliases**.
- **Folders** — right-click → "Add to a folder…" to group by theme or favorites.
- **Bulk actions** — select multiple posts with the ○ on each card, then tag, add to a folder, group, or delete them all at once.
- **Undo (`Ctrl+Z`)** — takes back tag and folder changes one step at a time (a bulk edit's toast has an Undo button too; the stack lasts until you close the app). Deleting is not on this stack — the trash is where a deleted post waits.

### 5. Keep it yours

From the **gear (Settings)** at the bottom-left —

- Export/import the whole library as a **ZIP**
- **Scheduled backup (mirror)** to another folder
- **Several libraries** — switching only opens another folder; the library you were in stays exactly where it is
- Theme (light/dark) and display language

## When post details cannot be fetched

The text, author, date and engagement counts come from the platform's own API, fetched by your browser — Hologram never signs in as you. For some posts that route answers nothing, even though the post is on your screen:

- **X** — age-restricted posts and posts from protected accounts. This endpoint answers anonymous callers only; your x.com sign-in does not reach it.
- **Misskey / Mastodon** — followers-only posts, and servers that close their API to signed-out callers.
- **Bluesky / pixiv** — nothing of this kind (pixiv is fetched with your own session).

What happens then —

- **`Alt+S`** — the screenshot is saved either way, and some details are filled in from what the page shows (counts are the rounded ones the page displays).
- **The other ways of saving** — the picture you pointed at is saved, without the post's text and author.
- If nothing can be obtained and there is no picture to keep either, **nothing is written at all** — no empty entries.

Either way the save says so at the time.

## Setup

Preparing for release (including publishing the extension to the Chrome Web Store).

## Privacy

Everything is stored in a local folder; nothing is sent to any server. See [PRIVACY.md](PRIVACY.md) for details.

### Where your data lives

- **Library** (images + metadata): a plain folder you choose — default `~/Hologram/library`
- **Settings**: `~/.hologram`

Both live outside the app's installation, so **uninstalling the app never deletes them**. To remove everything, delete these two folders yourself.
