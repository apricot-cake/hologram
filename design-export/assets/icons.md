# Iconography — Corpus

Corpus uses **two registers** of icon, both carried over from the shipped app.

## 1. Stroke SVG (primary chrome) — Lucide
The app hand-inlines Feather-style stroke icons (24×24 viewBox, **1.5–2px stroke, round caps & joins, no fill**). This system standardizes on **[Lucide](https://lucide.dev)** as the canonical match — identical weight and corner treatment.

**Load from CDN** in cards / UI kits:
```html
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
<i data-lucide="folder"></i>
<script>lucide.createIcons();</script>
```

Canonical mappings (app action → Lucide name):
| Action | Lucide |
|---|---|
| Add to folder / folder | `folder` |
| Open original post (↗) | `external-link` |
| Edit tags (pencil) | `edit-3` |
| Details (ℹ) | `info` |
| Delete (🗑) | `trash-2` |
| Post-view mode (rows) | `rows-3` |
| Image-view mode (grid) | `layout-grid` |
| Search | `search` |
| Settings | `settings` |
| Default folder (★) | `star` |
| Theme toggle | `sun` / `moon` |
| Select ✓ | drawn with CSS borders (not a glyph) — see ImageTile |

Stroke width inside Corpus controls is **1.75–2px**; size icons at **14–18px** in dense controls, 18px in mode-nav.

## 2. Emoji (dense data layer)
Used **functionally as compact icons**, never decoratively. The established set:

- **Engagement:** ❤ likes · 🔁 reposts · 💬 replies · 🔖 bookmarks
- **Tile / row actions (tightest space):** 📁 add-to-folder · ℹ details · ↗ open · 🗑 delete · ★ default marker

Rule: when both an SVG and an emoji exist for an action (e.g. folder), prefer the **Lucide SVG** in newly-built primary controls; reserve emoji for the densest image-tile overlays where they ship in the source.

## 3. Platform marks
No platform logo SVGs are shipped. Platforms appear only as the **text platform badge** (uppercase name on a brand-colored capsule): X · BLUESKY · MISSKEY · MASTODON · PIXIV. In prose, **pixiv is lowercase**; only the badge uppercases it.

## Don'ts
- No custom icon font.
- No AI-generated or hand-drawn decorative illustration.
- No emoji for tone/flourish — only the functional set above.
