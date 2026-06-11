# Corpus — Design System

A refined design language for **Corpus**, a desktop archive app for quietly saving and re-browsing your own SNS posts and illustrations.

> **One line:** A calm, monotone, indigo-accented tool surface — Linear/Vercel restraint applied to a Japanese-first personal media archive — with full light + dark parity.

---

## What Corpus is

Corpus (コーパス) is a personal-archive desktop app (Electron, vanilla HTML/CSS/JS, no build step) that **saves SNS posts and illustrations as images** and lets you browse them later, calmly, for a long time. It pulls from **X / Bluesky / Misskey / Mastodon** posts and **pixiv** illustrations. The UI is **Japanese-first** (English locale available).

The product has two top-level modes and four tabs:

- **投稿閲覧 (Post view)** — a card grid/list of saved posts, each with a platform badge, author, body text, engagement (likes/reposts/replies/bookmarks), date, tags, and a one-click 📁 folder action.
- **画像閲覧 (Image view)** — a dense, resizable tile grid of the saved images themselves, with hover actions (folder / info / open / delete), an ○ multi-select ring, author + like overlay, and ×N group badges for multi-image posts.
- Tabs inside post view: **投稿 (Posts) / ハッシュタグ (Hashtags) / ユーザー (Users) / 設定 (Settings)**.
- A shared **folder-management modal** (set default ★, create / rename / delete).

The design goals, in the user's words: *落ち着いて長時間眺められて、探しやすい* — calm enough to gaze at for a long time, and easy to search. The reference points are **Linear and Vercel**: monotone base, a single restrained **indigo** accent, and a refined, low-noise tool aesthetic. Both light and dark themes are first-class.

### What this refresh changes from the shipped app
The original app is competent but reads as a generic light-mode Twitter client: its accent is **Twitter blue (#1d9bf0)**, it is light-only, and the left sidebar is a stack of slightly-fussy filter sections. This design system:
- swaps the accent to a restrained **indigo** and rebuilds everything on **monotone cool-gray** neutrals;
- adds a true **dark theme** with full token parity;
- tightens type onto **Geist** (sans + mono) for a tool-grade register;
- keeps the *core* parts the user likes — image tile, filter chips, post card — but refines their materials (borders, radii, overlays, hover/press) and frees the sidebar/nav structure.

---

## Sources

This system was built by reading the app's renderer source directly (read-only, mounted):

- **`renderer/`** — the Electron renderer. Key files studied:
  - `renderer/index.html` — the full app shell + all CSS (sidebar, tabs, post grid, image-view tile grid, settings, modals, lightbox).
  - `renderer/viewer.js` — post-card rendering (`.post-card`, `.platform-badge`, `.post-flags`, engagement/date/tags).
  - `renderer/image-viewer.js` — image-tile rendering (`.iv-card`, `.iv-stats`, `.iv-actions`, ○ select).
  - `renderer/i18n.js` — all UI copy (ja + en); the canonical source for tone & terminology.
  - `renderer/folders.js`, `search.js`, `shell.js` — folder model, fuzzy search, mode/tab shell logic.

No Figma or slide decks were provided. The original is light-only with a Twitter-blue accent; the dark theme and indigo palette here are new design work grounded in the existing structure.

---

## CONTENT FUNDAMENTALS

Corpus is **Japanese-first**, written for a single user archiving their own collection. The voice is **quiet, plain, and helpful** — never marketing-y, never cute.

**Language & person.** UI is primarily Japanese; an English locale mirrors it. Japanese copy is **である/だ-neutral and noun-led**, not polite-keigo-heavy. It addresses the user implicitly (no "あなた"), describing what *will happen* rather than commanding. Example hint (ja): 「キャプチャした画像とメタデータの保存先。変更すると次回キャプチャ分から新しい場所に保存されます。」 The English mirror is similarly plain: *"Where captured images and metadata are stored. Changing it affects future captures."*

**Casing (EN).** Sentence case everywhere — buttons ("Export ZIP", "Choose folder"), headings ("Save folder", "Danger Zone"). Only proper nouns and platform names are capitalized (X, Bluesky, Misskey, Mastodon, pixiv — note **pixiv is always lowercase**).

**Terminology is consistent and concrete.** 投稿 (post), 画像 (image), タグ (tag), ハッシュタグ (hashtag), フォルダ (folder), いいね (likes), リポスト (repost), 返信 (reply), キャプチャ (capture). Counts use a unit suffix: `$1 件` (ja) / `$1 posts` (en). Dates read as 「$1 に投稿」 / "Posted $1".

**Tone in destructive & empty states.** Direct and honest, no scare-tactics but no false comfort. Delete confirm (ja): 「この投稿を削除しますか？」; the clear-all hint states plainly it cannot be undone (「この操作は元に戻せません。」). Empty states are gentle and instructive: 「投稿がありません」 / 「SNSで投稿を保存すると、ここに表示されます。」 ("No posts yet" / "Save a post from SNS and it will appear here.").

**Microcopy is terse.** Toggles and filters are single words or short noun phrases: すべて (All), 通常 / あいまい (Exact / Fuzzy), 新しい順 (Newest first), いずれか / すべて含む (Any / All — for AND/OR tag joins).

**Emoji & symbols** are used *functionally as compact icons*, not decoratively — see ICONOGRAPHY. Engagement uses ❤ 🔁 💬 🔖; row actions use 📁 ℹ ↗ 🗑 ★. They carry meaning in a tight space; never use emoji for flourish or tone.

---

## VISUAL FOUNDATIONS

The aesthetic is **calm monotone tool**: cool-gray neutrals, one indigo accent, structure carried by **1px hairline borders** rather than shadow. Think Linear/Vercel — quiet, dense, legible for hours.

**Color.** A cool-slate neutral ramp (`--gray-0…950`) is the entire base; almost everything on screen is a neutral. A single **indigo** accent (`--accent`, indigo-600 light / indigo-500 dark) marks the active/selected/interactive state and nothing else — selection rings, active chips, primary buttons, focus. Status colors are rare: a desaturated red for destructive, green for success/confirmation. **Platform brand colors** (X black, Bluesky #1185fe, Misskey #86b300, Mastodon #6364ff, pixiv #0096fa) appear *only* in the small platform badge — they are brand-locked and never bleed into the rest of the UI. Imagery itself (the saved posts/illustrations) is shown true-to-source, full-color; the chrome around it stays neutral so the images are the only saturated thing on screen.

**Themes.** Light and dark are full peers via semantic aliases that flip under `[data-theme="dark"]`. Dark surfaces lift with elevation (`--surface` #14171c → `--surface-2` → `--surface-3`); the accent brightens one step (indigo-500→ brighter on hover) so it stays legible on near-black; the X badge inverts to light.

**Type.** **Geist Sans** for all UI; **Geist Mono** for anything numeric or identifier-like — engagement counts, @handles, dates, file paths — set with tabular numerals. The scale is dense and tool-grade: body sits at **13–14px**, section eyebrows at 11px uppercase with `0.06em` tracking, screen titles ~21px. Large text gets slight negative tracking; small caps-labels get positive tracking.

**Spacing & layout.** A strict **4px grid**. Controls share fixed heights (28/34/40px) so toolbars align. The shell is a **persistent left sidebar** (brand + mode nav at top, then the active mode's filters) beside a fluid content area; nav is **sticky and always visible in every mode**. Grids are CSS `auto-fill minmax()` — post cards `minmax(280px,1fr)`, image tiles a user-resizable `--iv-tile` (default 180px).

**Borders, radius, elevation.** Hairline borders (`--border`) are the primary separator; shadows are whisper-soft and used only to float overlays. Radii: 4 (badge), 6 (button/input/tile), 8 (card/select), 12 (modal/popover), 999 (chips/tags). Cards are `--surface` + 1px border + `--shadow-sm` at most; they gain a slightly stronger shadow on hover, never a colored glow.

**Hover / press / selection.**
- *Hover:* a neutral wash (`--hover`), or border+text shift to accent on chips/tiles; tiles also lift `scale(1.02)` with a soft shadow.
- *Press:* a slightly deeper wash (`--active`); no scale-down gimmicks.
- *Selected/active:* solid accent fill (chips, primary buttons) or a 3px inset accent outline (`outline-offset:-3px`) on selected cards/tiles. The ○ select ring is a white ring with a dark halo (visible on any image) that fills with accent + a geometric ✓ when on.
- *Focus:* a 3px soft indigo halo (`--ring`), keyboard-only.

**Overlays, transparency & blur.** Image tiles use a bottom **scrim gradient** (`--scrim-grad`, transparent→near-black) so the author/likes overlay stays readable over any image. Hover action buttons sit on a semi-opaque black pill. Modals dim the page with `--overlay`. The fullscreen image lightbox stays **dark in both themes** (conventional for viewing media). Blur is used sparingly if at all — this is a crisp, opaque tool, not a glassy one.

**Motion.** Short and mechanical — `0.1–0.15s`, `ease-out`, **no bounce, no spring**. Fades and small translateY for toasts/popovers; tiles scale a hair on hover. Everything respects `prefers-reduced-motion`. Decorative/infinite animation is avoided entirely.

**Backgrounds.** Flat, opaque surfaces only — **no gradients, no textures, no illustrations, no patterns** in the chrome. The only gradients in the system are the functional scrims over images. The canvas is a single near-white/near-black fill so saved imagery is the focal point.

---

## ICONOGRAPHY

Corpus uses **two icon registers**, both inherited from the source app and kept:

1. **Inline stroke SVG** for primary chrome actions — a Feather/Lucide-style **1.5–2px stroke, round caps/joins, 24×24 viewBox** set. The app hand-inlines these for: folder (`📁` action button → folder SVG), external-link/open (↗), edit (pencil), mode-nav glyphs (rows / grid), and the geometric ✓ on selection (drawn with CSS borders, not a glyph). **This system standardizes on [Lucide](https://lucide.dev) as the canonical match** — same stroke weight and corner style — and loads it from CDN in cards/kits. See `assets/icons.md`. Any icon not already in the source should be pulled from Lucide to stay consistent.

2. **Emoji as compact functional icons** in the dense data layer, exactly as the app ships them — they read instantly and cost no assets:
   - Engagement: ❤ likes · 🔁 reposts · 💬 replies · 🔖 bookmarks
   - Tile/row actions where space is tightest: 📁 add-to-folder · ℹ details · ↗ open original · 🗑 delete · ★ default-folder marker
   - These are **functional, not decorative**. Do not add emoji for tone or flourish. When an emoji and an SVG exist for the same action (e.g. folder), prefer the **SVG** in newly-built primary controls and reserve emoji for the densest overlays.

3. **Platform marks** appear only as text in the small platform badge (X, BLUESKY, MISSKEY, MASTODON, PIXIV) — the system does not ship platform logo SVGs; the badge is a colored capsule with the uppercase name. pixiv stays lowercase in prose, uppercase only inside the badge.

No custom icon font. No generated/AI imagery. When you need an icon, reach for Lucide first; only fall back to an emoji if it's one of the established functional set above.

---

## Index / manifest

Root files:
- **`styles.css`** — the single entry point consumers link (imports only).
- **`tokens/`** — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `base.css`.
- **`assets/`** — logo lockups, `icons.md` (icon usage), sample imagery for tiles/cards.
- **`guidelines/`** — foundation specimen cards (Type / Colors / Spacing / Brand) shown in the Design System tab.
- **`components/`** — reusable React primitives (see below).
- **`ui_kits/corpus-app/`** — full interactive recreation of the Corpus desktop app.
- **`SKILL.md`** — Agent-Skill manifest for downloading this system into Claude Code.

### Components (`components/`)
- `core/Button`, `core/IconButton`, `core/Switch`
- `forms/Input`, `forms/Select`
- `filters/Chip` — the pill filter/tag chip (a brand-core component)
- `data/PlatformBadge`, `data/Tag`, `data/PostCard`, `data/ImageTile` — the information-design core
- `navigation/Tabs`, `navigation/ModeNav`
- `feedback/Toast`, `feedback/Dialog`

### UI kit (`ui_kits/corpus-app/`)
Interactive click-through of the real app: post-view (cards + filter sidebar + theme toggle), image-view (tile grid + hover actions + multi-select), settings, and the folder modal.

---

## Using this system

Link the one stylesheet and set a theme on a root element:

```html
<link rel="stylesheet" href="styles.css">
<body data-theme="dark"> … </body>   <!-- omit attr for light -->
```

Then build with the semantic aliases (`--surface`, `--text`, `--accent`, …) — never the raw `--gray-*`/`--indigo-*` primitives — so light/dark both work for free.
