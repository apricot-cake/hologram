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

Today Hologram speaks fluent social media (X, Bluesky, Misskey, Mastodon, pixiv); the library itself is built for web content in general, and takes local files too.

Hologram is **free and open source** (MIT). Your library is nothing but ordinary files in a folder you own — no account, no server, no lock-in.

## What it does

- **Save the whole post** — not just a screenshot, but the text, author, date, like count, and original URL too. Polls keep their options and vote counts, and the author's profile is snapshotted as it stood that day. So you can always find "that post" later — and it stays readable after the original is gone.
- **Not only posts** — files from your own machine can live in the same library. Images and video get the full treatment; a PDF or an archive is kept as a collected item, sharing the same tags, folders and search.
- **Organize and search freely** — filter by your own tags, in-text hashtags, platform, date, engagement, and author. Tags can carry aliases, so the several ways you spell one thing stop splitting your vocabulary. Reach what you want even among thousands.
- **Read it however suits the moment** — a grid of illustrations, a list for text, a timeline feed to drift back through what you saved, or a small always-on-top window keeping a reference beside whatever you are drawing in.
- **Everything stays with you** — your data lives on your PC, with images and metadata sitting side by side as ordinary files. Nothing is sent to any server. Open them later in another tool, or move the whole library — it's all yours.
- **Backup & portability** — export/import the whole library as a ZIP, mirror it to another folder on a schedule, and keep several separate libraries if one is not enough.

## What goes in it

- **Social media** — X (Twitter) ・ Bluesky ・ Misskey ・ Mastodon ・ pixiv
- **Pages elsewhere on the web** — title, author and date are read from whatever the page publishes about itself (schema.org, Open Graph, Dublin Core, Highwire)
- **Files on your own machine** — images and video as full members of the library, anything else as a collected item

## How to use

### 1. Save

**From the browser** (Chrome, Edge, Brave, Vivaldi). When you find a post you like —

- **Point at an image and press the save button** in its corner — saves the picture along with the post's text, author and source. One click, without leaving the timeline.
- **Press `Alt+S` and click the post** — saves a screenshot plus the text, author, date, engagement, and other details. This is the one that captures how the post *looks*; the corner button does not.
- **Drag an image** — save pixiv illustrations and the like as the image itself.
- **Take a pixiv bookmark page in one go** — open your own bookmarks and save everything on the page at once, paced so the site is not hammered. You turn the pages; Hologram only takes what is on screen.

The extension's toolbar popup is the small dashboard for all of this: whether the app is reachable, what saved recently, how many you have taken today, and a button to capture the post you are looking at.

**From your desktop** — drag files or folders straight onto the app window. Same destination, no browser involved.

What you save gathers automatically in the desktop app (it watches the save folder, so new captures show up in the list right away).

Point at an image you've already saved and the same corner shows a small mark instead — no more stopping to wonder whether you saved that one. The check happens entirely on your computer, and works with the app closed. On the extension's options page you can have the mark show all the time instead of only on hover, or not at all, and turn the save button off.

### 2. Browse & read

The left rail carries three ways in: **Library** (everything you saved), **Posters** (grouped by the people you saved from), and **Timeline** (a feed for reading rather than hunting).

In Library, switch between **grid** and **list**. In the grid, **square thumbnails** and **show info** are independent toggles — turn on square thumbnails for an even, tile-like grid of illustrations, or leave it off to keep each picture's own proportions; turn on show info to add the author, an excerpt, and other details to each cell. List is good for reading text.

Click a card's image to open a **gallery** that bundles the screenshot and the original-resolution images. Posts with multiple images can be paged with `←` `→` or the arrow keys, and videos play right there. The toolbar at the top carries zoom (− / level / ＋) and a **fit ⇄ actual size** toggle (`Ctrl+0` / `Ctrl+1`); the wheel and a double-click do the same two things.

Two more ways to look at a picture:

- **Pin it** — right-click → "Send to pin window" opens it in a small frameless window that stays above everything else. Reference material beside your drawing app, without alt-tabbing.
- **Practice mode** — deal out the stills in your current filter one at a time on a timer. Whatever you tagged and foldered is already a practice queue.

Can't remember how you got to something? **History** (`Ctrl+H`) lists where you have been in date order, searchable, and takes you back with a click.

### 3. Find

Filter and sort from the left sidebar.

- **Search** — by text or username, with smart matching that forgives typos and kana variants
- **Filter** — by platform / author / tag / hashtag / date / engagement (likes, etc.) / folder (multi-select)
- **Sort** — newest first, most likes, save date, and more
- **Command palette (`Ctrl+K`)** — type to run a command or jump straight to a tag, author, folder or another tab. `/` puts the cursor in the search box instead.

Active filters gather at the top of the screen; **Reset** clears them all at once.

Looking for something you *didn't* save? **Search the web** takes the filters you just built and translates them into each site's own search syntax, so the same question can go back out to X, Bluesky, pixiv and the rest. Conditions that don't survive the translation are flagged before you leave.

### 4. Organize

- **Tags** — right-click a card → "Edit tags." To tag a batch of untagged posts, filter to "no tags," save that search, then step through with the arrow keys and type into the tag field as you go.
- **Tend the vocabulary** — right-click → "Manage tags…" opens the page for work the filter flyout is too cramped for: rename, merge, set a parent, clear out orphans, and give a tag **aliases** so every spelling of it lands in the same place.
- **Folders** — right-click → "Add to a folder…" to group by theme or favorites.
- **Bulk actions** — select multiple posts with the ○ at the top-left of each card, then tag, add to a folder, group, or delete them all at once.
- **Undo (`Ctrl+Z`)** — takes back tag and folder changes one step at a time, and the toast a bulk edit raises carries an Undo button. It lasts until you close the app. A batch that only added a tag to some of the selection gives back exactly that much — posts that already carried the tag keep it. Deleting is not on this stack; the trash is where a deleted post waits.

### 5. Keep it yours

From the **gear (Settings)** at the bottom-left of the screen.

- Export/import the whole library as a **ZIP**
- **Scheduled backup (mirror)** to another folder
- **Several libraries** — keep separate ones and switch between them. Switching only opens another folder; the library you were in stays exactly where it is, and the ones you used recently are a click away.
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
