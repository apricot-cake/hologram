---
name: corpus-design
description: Use this skill to generate well-branded interfaces and assets for Corpus, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick orientation
- **What it is:** Corpus — a calm, monotone, indigo-accented desktop archive app for saving and re-browsing SNS posts (X / Bluesky / Misskey / Mastodon) and pixiv illustrations. Japanese-first. Light + dark.
- **Aesthetic:** Linear/Vercel restraint. Cool-gray neutrals, one indigo accent, structure from 1px borders not shadow. Dense, tool-grade, hours-friendly.
- **Type:** Geist Sans (UI) + Geist Mono (counts/handles/dates). Loaded from Google Fonts CDN.

## Files
- `styles.css` — the single entry point; link it, then set `data-theme="dark"` (or omit for light) on a root element. Build with the **semantic** tokens (`--surface`, `--text`, `--accent`, …), never the raw `--gray-*`/`--indigo-*` primitives.
- `tokens/` — colors, typography, spacing, fonts, base.
- `guidelines/` — foundation specimen cards.
- `assets/` — `icons.md` (Lucide + functional-emoji icon system), `sample/` placeholder imagery.
- `components/` — React primitives: Button, IconButton, Switch, Input, Select, Chip, PlatformBadge, Tag, PostCard, ImageTile, Tabs, ModeNav, Toast, Dialog.
- `ui_kits/corpus-app/` — full interactive recreation of the app (post view, image view, settings, folders).

## How to use the components
The compiler bundles components into `_ds_bundle.js` under the namespace `window.CorpusDesignSystem_59d196`. In an HTML artifact:
```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
<script type="text/babel">
  const { PostCard, Chip, Button } = window.CorpusDesignSystem_59d196;
</script>
```
(See any file in `components/*/` `*.card.html` for the full React+Babel setup.)

## House rules
- One indigo accent only — selection / active / primary / focus. Everything else neutral.
- Platform brand colors appear **only** in PlatformBadge.
- Icons: Lucide (stroke 1.75–2px) for chrome; the functional emoji set (❤🔁💬🔖 / 📁ℹ↗🗑★) only in dense data overlays. No other emoji.
- Motion: 0.1–0.15s ease-out, no bounce. Flat opaque backgrounds — no decorative gradients/textures.
- Copy: Japanese-first, plain and quiet; sentence case in EN; pixiv lowercase.
