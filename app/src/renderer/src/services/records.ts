// Record service — record-shape helpers (media/screenshot/artwork/density image),
// normalization (postKeyOf / stampPost), grouping (groupRecords) and the per-platform
// likes percentile, extracted 1:1 from viewer.js as the second "pure logic → service"
// slice of the viewer decomposition (final form B), plus (P4 "IPC→service" domain-grouping
// follow-up) the manual-groups.json / ungrouped.json load/persist pairs for the two
// stores makeGroupRecords already consumes. A real ES module (named exports)
// imported directly by viewer.ts / image-tab.ts and the FloatingBar component
// (postIdKey); touches no DOM. Runtime couplings (manual groups / ungrouped opt-outs
// — live viewer state) are INJECTED via makeGroupRecords(deps), so this file loads
// under Node too (scripts/test-records-unit.cts drives it via dynamic import); the
// load/persist pair below goes through hologramIpc (services/ipc.ts). postKeyOf is a
// plain named export now (the planned duplicate-save detection can import the same
// URL→key normalization when it lands).
import { hologramIpc } from './ipc.ts';
// URL→identity-key normalization lives in native-host/ because the bridge owns it
// too (the TL "saved" badge asks it whether a permalink is already in the library,
// #54) and a second copy here would let the badge and the grid disagree about
// which posts are the same post. Re-exported so every renderer importer keeps
// reaching it through this service, unchanged.
import { postKeyOf } from '../../../../../native-host/post-key.mts';
export { postKeyOf };
import type { DisplayShape } from './display.ts';
import { hasVisualMedia, userKey } from './query.ts';

// A post may carry both a capture (screenshot) and real media/artwork. Artwork
// leads everywhere; the capture stands in for posts whose original never downloaded
// and for text-only posts (see densityImage below).
// NOTE: lib-index's cardImageFile() MUST mirror that rule so the masonry
// height reservation (shotW/shotH) sizes the same image the card shows.
const SS_EXT = /\.jpe?g$/i;
// A downloaded media file is a video/animated-loop, not a still — used both to
// pick the gallery's <video> vs Zoomable branch (below) and, here, to keep a
// raw video file out of an <img src> (artworkFile prefers its poster instead).
const isVideoFile = (f: string | null | undefined) => /\.(mp4|webm|mov|m4v)$/i.test(f || '');
// A pixiv ugoira archive (#119 St3). Like a video file it can never be an
// <img src> — its poster stands in wherever a still is required.
const isUgoiraFile = (f: string | null | undefined) => /\.zip$/i.test(f || '');
// p.media entries are a loose JSON shape (same pragmatics as HologramPost itself).
// type/posterFile: animated entries only (#119 St1) — posterFile is the
// downloaded still frame; type distinguishes an mp4-backed 'gif' (X
// animated_gif / Mastodon gifv) from a real .gif file (which has no type), and
// marks a pixiv 'ugoira' archive, whose frames table rides alongside (#119 St3).
type HologramMediaItem = { file?: string; alt?: string; type?: string; posterFile?: string; frames?: { file: string; delay: number }[]; [k: string]: any };
const mediaItemsOf = (p: HologramPost): HologramMediaItem[] => (Array.isArray(p.media) ? (p.media as HologramMediaItem[]).filter((m) => m && m.file) : []);
export const mediaFilesOf = (p: HologramPost): string[] => mediaItemsOf(p).map((m) => m.file as string);
// p.image is a screenshot unless it's a locally-imported artwork or a non-JPEG
// original. Every local-intake `source` belongs in this list (#84's design comment):
// those records are the user's own pictures, not a capture of a post. 'clipboard'
// (#85) writes PNG, so the extension test already excludes it — it is named anyway,
// because "which sources are artwork" is the question this line answers, and leaving
// one out silently changes how that door's items sort into the facets.
export const isScreenshot = (p: HologramPost): boolean => !!p.image && SS_EXT.test(p.image) && p.source !== 'drag' && p.source !== 'clipboard' && p.source !== 'watch' && p.source !== 'eagle-migration' && p.source !== 'bookmark';
// #236: a collected item (an arbitrary local file — pdf/zip/psd/… — that isn't
// IMPORTABLE_MEDIA). image/video/mediaType are all null on these rows
// (lib-local-intake.ts's buildLocalRecord); `file` is the one place its own
// name lives. Every reader that branches card vs generic-file UI checks this,
// not the field directly, so the "which slot is this" rule stays in one place.
export const isFileAsset = (p: HologramPost): boolean => p.assetClass === 'file';
export const captureFile = (p: HologramPost): string => (isScreenshot(p) ? p.image : '');
// The leading media item's THUMBNAIL file — its poster when it's a video/gif
// (a raw video can't be an <img src>), else the file itself. Falls back to the
// capture screenshot (via densityImage) when a video has no poster.
export const artworkFile = (p: HologramPost): string => {
  const items = mediaItemsOf(p);
  if (items.length) {
    const first = items[0];
    if (first.posterFile) return first.posterFile;
    return isVideoFile(first.file) || isUgoiraFile(first.file) ? '' : (first.file as string);
  }
  // The `image` fallback is a still by contract (normalizePostRecord moves a
  // video filename to `video`), but a row written before that rule existed can
  // still name one (#496) — and handing it to an <img> draws a blank card
  // rather than nothing, which reads as a broken record instead of a faceless
  // one. No poster is reachable from here, so there is nothing to substitute.
  return p.image && !isScreenshot(p) && !isVideoFile(p.image) ? p.image : '';
};
/**
 * The one image a post SHOWS: its own artwork, with the capture screenshot standing
 * in only when there is no artwork (a text-only post). The list used to invert this
 * and lead with the screenshot; at row-thumbnail size that is a shrunk picture of
 * text, unreadable and doubled by the row's own text column, so the rule is now the
 * same everywhere (2026-07-19 finalized, #154). Deciding it here also keeps the gallery's
 * "what's shown in the thumbnail is what's shown first" rule true by construction — the
 * gallery column leads with artwork too (#143).
 */
export function densityImage(p: HologramPost): string {
  return artworkFile(p) || captureFile(p);
}

// #365: the original-aspect grid's height reservation for a text-only card (no
// image to measure, so shotW/H is always 0 and there's no learned-aspect cache
// entry either). Picked from the body's length in discrete steps rather than a
// continuous function — in a grid whose COLUMN width is fixed, a step keeps
// similarly-long posts reading as "the same kind of card" while scanning, the
// way a continuous height would not. Short text sits wide (a caption reads more
// like a labeled tile), long text sits tall (room to actually show it). Bounds
// and thresholds are a first cut — expect these four numbers to move once this
// is on screen with a real library.
const TEXT_PLATE_ASPECT_STEPS: [max: number, ratio: string][] = [
  [80, '4/3'],
  [220, '1/1'],
  [420, '3/4'],
  [Infinity, '2/3'],
];
export function textPlateAspect(text: string | null | undefined): string {
  const len = (text || '').length;
  for (const [max, ratio] of TEXT_PLATE_ASPECT_STEPS) if (len <= max) return ratio;
  return TEXT_PLATE_ASPECT_STEPS[TEXT_PLATE_ASPECT_STEPS.length - 1][1];
}

// --- Grouping (ported from image-view) --------------------------------------
// Auto: records sharing the same post URL (multi-image drags, re-captures of
// one post) collapse into one card. Manual groups (manual-groups.json) win
// over auto. ungrouped.json opts individual post keys out.
export const postIdKey = (p: HologramPost): string => p.captureId || (p.url || '') + '|' + (p.capturedAt || '');
// The "artwork pages" of one record: original media, else the dragged/migrated
// image, else — #236 — a collected item's own file (so drag-out/#132 still
// has something to hand the OS even though it never enters the gallery).
export const groupFilesOf = (p: HologramPost): string[] => {
  const m = mediaFilesOf(p);
  if (m.length) return m;
  const a = artworkFile(p);
  if (a) return [a];
  return p.file ? [p.file] : [];
};

// What dragging a card hands to the OS (#132), given what's selected right now:
// a card that IS in the selection drags the WHOLE selection, one that isn't drags
// only itself. Multi-image posts hand over every original they hold, and a file
// shared by two selected groups ships once.
//
// Reading the selection is ALL this does with it — a drag never writes it back.
// Explorer looks like it selects what you drag, but that's its mousedown, not its
// drag; the grabbed-or-selection rule above is the whole of what it does with a
// drag, and it needs no write. Hologram's selection is also a working set built by
// hand across a scroll (the batch tag/folder ops act on it), not Explorer's
// throwaway cursor, so an export gesture must not rewrite it (2026-07-17, user).
//
// Pure so the rule is unit-testable without a real drag: the DOM/IPC glue around
// it is post-grid-builder.ts's handleCardDragStart.
export function dragFilesOf(g: HologramPostGroup, selected: HologramPostGroup[]): string[] {
  const grabbedSelection = selected.some((s) => s.key === g.key);
  return [...new Set((grabbedSelection ? selected : [g]).flatMap((x) => x.files))];
}

// Image-view record resolution (#144: an 'image' history entry carries
// { recs:[captureId…], idx }). recs resolve against the live library on every
// activation via the injected byId lookup, so deletions degrade to a "missing"
// empty state instead of a broken image. Same rep pick as groupRecords (capture
// first, then any record with text). Pure — byId is injected (so this loads
// under Node too).
export function imageTabGroup(view: { id?: string; recs: string[] | null | undefined }, byId: (id: string) => HologramPost | undefined): HologramPostGroup | null {
  const ids: string[] = Array.isArray(view.recs) ? view.recs : [];
  const records = ids.map((id) => byId(id)).filter(Boolean) as HologramPost[];
  if (!records.length) return null;
  const rep = records.find(isScreenshot) || records.find((r) => r.text) || records[0];
  return { key: 'imgtab:' + (view.id || ''), records, rep, files: records.flatMap(groupFilesOf) };
}
// Image-tab title: the rep's title/text trimmed to ≤24 chars, else its author, else the
// caller-supplied "Untitled" fallback (i18n-owned by the caller).
export function imageTabTitleOf(g: HologramPostGroup, fallback: string): string {
  const p = g.rep;
  const raw = (p.title || p.text || '').trim().replace(/\s+/g, ' ');
  const base = raw || p.displayName || fallback;
  return base.length > 24 ? base.slice(0, 24) + '…' : base;
}

// deps carry the live viewer state the grouping must not own:
//   manualGroups() → [[captureId,…],…] — user-built groups (win over auto)
//   ungrouped()    → Set of post keys opted out of auto-grouping
// Both are getter functions because viewer.js REASSIGNS the underlying
// bindings on load/edit — a by-value snapshot would go stale.
export function makeGroupRecords(deps: { manualGroups(): string[][]; ungrouped(): Set<string> }) {
  return function groupRecords(list: HologramPost[]): HologramPostGroup[] {
    const manualGroups = deps.manualGroups();
    const ungrouped = deps.ungrouped();
    // url-derived group key, precomputed once per record by stampPost (_postKey);
    // fall back to a live parse for any record that somehow predates the stamp.
    const pk = (p: HologramPost) => (p._postKey !== undefined ? p._postKey : postKeyOf(p.url));
    const manualOf = new Map<string, string>(); // captureId → 'manual:idx' (manual groups win)
    manualGroups.forEach((members, idx) => members.forEach((cid) => manualOf.set(cid, 'manual:' + idx)));
    let solo = 0;
    const base = list.map((p) => {
      let key: any;
      const mg = manualOf.get(p.captureId);
      if (mg) key = mg;
      else {
        const k = pk(p);
        key = k && !ungrouped.has(k) ? k : '__solo' + solo++;
      }
      return { p, key };
    });
    // Self-reply chains: a record replying (replyToId) to another record IN THE
    // LIBRARY by the SAME author joins that record's group, so the reply-source and self-reply
    // render as one card. The platform-local own-id is the last segment of the
    // post key (tweet id / rkey / note id / status id). Opt-outs (ungrouped)
    // suppress the merge for either side.
    const pidOf = (p: HologramPost) => {
      const k = pk(p);
      return k ? k.split(/[/:]/).pop() : null;
    };
    const idIndex = new Map<string, (typeof base)[number]>(); // userId + '|' + ownPostId → entry
    for (const e of base) {
      const id = pidOf(e.p);
      if (id && e.p.userId) idIndex.set(e.p.userId + '|' + id, e);
    }
    const alias = new Map<any, any>(); // child group key → parent group key
    for (const e of base) {
      const p = e.p;
      if (!p.replyToId || !p.userId) continue;
      const ownKey = pk(p);
      if (!ownKey || ungrouped.has(ownKey)) continue;
      const parent = idIndex.get(p.userId + '|' + String(p.replyToId));
      if (!parent || parent.key === e.key) continue;
      if (String(parent.key).indexOf('__solo') === 0) continue; // parent opted out / unkeyed
      alias.set(e.key, parent.key);
    }
    // Follow the alias chain to its root. Depth is unbounded on purpose: each
    // self-reply aliases to its IMMEDIATE parent's key, so chain length equals
    // thread length and a fixed cap would split long threads into several
    // cards. The seen-set guards pathological cycles (dup keys/corrupt data).
    const resolveKey = (k: any) => {
      const seen = new Set();
      while (alias.has(k) && !seen.has(k)) {
        seen.add(k);
        k = alias.get(k);
      }
      return k;
    };
    const map = new Map<string, any>();
    const order: HologramPostGroup[] = [];
    for (const e of base) {
      const key = resolveKey(e.key);
      let g: any = map.get(key);
      if (!g) {
        g = { key, records: [] };
        map.set(key, g);
        order.push(g);
      }
      g.records.push(e.p);
    }
    // Member order within a group = the reading order the image tab / gallery pages
    // through. Reply-chain topology first (root→leaf, so a self-reply thread reads
    // top-to-bottom even when its posts were saved out of order), then post date
    // ascending, then captureId as a stable tiebreak. The old plain-captureId sort
    // put self-replies and re-captures in save order — frequently the reverse of how
    // they should read (#89 page-flip order bug). Imported records carry no replyToId, so
    // they fall through to date/captureId (a known v1 limit).
    for (const g of order) {
      // Reply-chain depth = hops up replyToId to an in-group ancestor by the SAME
      // author (mirrors the idIndex keying used for merging above). byOwnId is built
      // per group, so a manual group mixing authors simply doesn't chain — its
      // members order by date/captureId, which is what we want there.
      const byOwnId = new Map<string, HologramPost>();
      for (const p of g.records) {
        const id = pidOf(p);
        if (id && p.userId) byOwnId.set(p.userId + '|' + id, p);
      }
      const depthCache = new Map<HologramPost, number>();
      const depthOf = (start: HologramPost): number => {
        const cached = depthCache.get(start);
        if (cached !== undefined) return cached;
        let d = 0;
        let cur: HologramPost | undefined = start;
        const seen = new Set<HologramPost>(); // guard corrupt mutual-reply cycles
        while (cur && cur.replyToId != null && cur.userId && !seen.has(cur)) {
          seen.add(cur);
          const parent: HologramPost | undefined = byOwnId.get(cur.userId + '|' + String(cur.replyToId));
          if (!parent || parent === cur) break;
          d++;
          cur = parent;
        }
        depthCache.set(start, d);
        return d;
      };
      g.records.sort((a, b) => {
        const dd = depthOf(a) - depthOf(b);
        if (dd) return dd;
        const md = (a._dateMs || 0) - (b._dateMs || 0);
        if (md) return md;
        return String(a.captureId || '').localeCompare(String(b.captureId || ''));
      });
      // Card rep: prefer the click-capture (screenshot+full meta), then any record
      // with text, then the earliest — drags often carry no text/stats. Independent
      // of the member order above (the card face stays screenshot-first).
      g.rep = g.records.find(isScreenshot) || g.records.find((r) => r.text) || g.records[0];
      g.files = g.records.flatMap(groupFilesOf);
    }
    return order;
  };
}

// Likes percentile within each platform — ranks "did well for its SNS" so X's
// raw counts don't dominate. Returns a fn p→[0,1]. (Ported from image-view.)
export function percentileFn(list: HologramPost[]): (p: HologramPost) => number {
  const byPlat: Record<string, number[]> = {};
  list.forEach((p) => {
    const k = p.platform || '';
    (byPlat[k] || (byPlat[k] = [])).push(p.likes || 0);
  });
  Object.values(byPlat).forEach((a) => a.sort((x, y) => x - y));
  return (p) => {
    const arr = byPlat[p.platform || ''] || [];
    if (arr.length <= 1) return 1;
    const v = p.likes || 0;
    let lo = 0,
      hi = arr.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (arr[m] <= v) lo = m + 1;
      else hi = m;
    }
    return (lo - 1) / (arr.length - 1);
  };
}

// --- Lightbox gallery items (twelfth extraction slice) ----------------------
// The URL scheme (asset://) stays viewer-owned: fileSrc is injected so the
// protocol knowledge isn't duplicated here.
// `ugoira` is the archive's library FILE NAME plus its frame table (#119 St3):
// an archive can only be played with the table, and the player reads it over
// IPC rather than from `src` (the renderer is app://bundle, a different origin
// from asset://, which is registered without corsEnabled on purpose — ADR 0012).
// `poster` is what stands in until the archive opens. Both absent otherwise.
export type GalleryItem = { src: string; alt: string; video: boolean; capture?: boolean; ugoira?: { file: string; frames: { file: string; delay: number }[] }; poster?: string };
// deps: fileSrc(file) — renderer media URL builder (viewer.js).
export function makeGallery(deps: { fileSrc(file: string): string }) {
  const { fileSrc } = deps;
  // Gallery items for a post: the original images/video lead, the screenshot
  // capture rides at the TAIL (#143 — "what the thumbnail shows opens first"; the
  // card/inspector thumbnail is the original, so page 1 == that thumbnail zoomed,
  // and the capture is still reachable on the last page). p.image is an original
  // only when it isn't a screenshot (a dragged/migrated artwork); a text-only post
  // has no original, so its screenshot is the sole — hence first — item, which is
  // exactly what its thumbnail shows too.
  function buildGalleryItems(p: HologramPost): GalleryItem[] {
    const items: GalleryItem[] = [];
    const shot = captureFile(p); // '' unless p.image is a screenshot
    // Same caveat as artworkFile's fallback: `image` should never name a video
    // (normalizePostRecord relocates one), but a row written before that rule
    // would otherwise open the detail view on an <img src="…mp4"> — a blank
    // page over a file that plays perfectly (#496). Ask the filename.
    if (p.image && !shot) items.push({ src: fileSrc(p.image), alt: '', video: isVideoFile(p.image) });
    if (p.video) items.push({ src: fileSrc(p.video), alt: '', video: true });
    if (Array.isArray(p.media)) {
      for (const m of p.media as HologramMediaItem[]) {
        if (!m || !m.file) continue;
        const ugoira = m.type === 'ugoira' && Array.isArray(m.frames) && m.frames.length ? { file: m.file, frames: m.frames } : undefined;
        // An ugoira whose frame table didn't survive is not playable — fall
        // back to its poster, the same still the card already shows.
        if (isUgoiraFile(m.file) && !ugoira) {
          if (m.posterFile) items.push({ src: fileSrc(m.posterFile), alt: m.alt || '', video: false });
          continue;
        }
        items.push({ src: fileSrc(m.file), alt: m.alt || '', video: isVideoFile(m.file), ugoira, poster: ugoira && m.posterFile ? fileSrc(m.posterFile) : undefined });
      }
    }
    if (shot) items.push({ src: fileSrc(shot), alt: '', video: false, capture: true });
    return items;
  }
  // Gallery for a whole group: every record's items, deduped by src, with the
  // screenshots pulled past the originals so the group reads originals-first too
  // (#143). Each record already emits its capture last; bucketing keeps that intact
  // across records (a text-only member contributes only its capture → tail).
  function buildGroupGalleryItems(g: HologramPostGroup): GalleryItem[] {
    if (g.records.length === 1) return buildGalleryItems(g.rep);
    const seen = new Set<string>();
    const originals: GalleryItem[] = [];
    const captures: GalleryItem[] = [];
    for (const r of g.records) {
      for (const it of buildGalleryItems(r)) {
        if (seen.has(it.src)) continue;
        seen.add(it.src);
        (it.capture ? captures : originals).push(it);
      }
    }
    return [...originals, ...captures];
  }
  return { buildGalleryItems, buildGroupGalleryItems };
}

// Fallback-avatar tint (#107): a stable hue per identity so avatar-less cards stay
// distinguishable at a glance, the way GitHub / Google fallback avatars do. Hue only —
// the cell picks saturation and lightness, so light and dark each keep their own tonal
// range from one number. FNV-1a over the identity key (not a display name, which can
// change under us), so the letter+color pairing is stable across renders and restarts.
// Exported (moved here from poster-grid-builder.ts, #658) so the post grid's cards and
// the poster grid share one implementation — same seed (userKey), same color, for the
// same identity in both places.
export function monoHue(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 360;
}

// --- Card view model (per-card presentation derivation) ---------------------
// The model PostCard.tsx / ListRow.tsx render (grid modelOf). Pure field-mapping over
// a group + the live display shape (#618); every runtime coupling (the shape,
// learned-aspect cache, thumb widths, i18n messages,
// asset URLs) is INJECTED so this stays DOM-free and Node-testable. The subtle
// rules that used to live inside renderPosts are locked here: engagement
// zero-suppression and its relevance gate, both-date same-day dedup, body-text dedup
// vs the author line, GIF full-size (no thumb) at original aspect, which shapes loop
// an mp4-backed GIF in place vs. leave it on its poster (#476), masonry height
// reservation (shotW/H → learned cache), and the multi-image back-stack sheets.
//   deps.shape() / imgAspect() are getters (viewer reassigns the lets);
//   fileSrc keeps folder + asset knowledge viewer-owned. Selection is
//   NOT here — the grid component derives .selected straight from hologramStore's
//   'selectedSet' (same pattern as inspectedKey), so this stays selection-free.
export function makeCardModel(deps: {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  formatCount(n: number): string;
  formatDate(d: string): string;
  compactDate(d: string): string;
  fileSrc(file: string, w?: number): string;
  smokeCapture: boolean;
  shape(): DisplayShape;
  imgAspect(): Record<string, string>;
  gridThumbW(): number;
  listThumbW(): number;
  /** Engagement counts are library noise unless a sort or filter made them relevant. */
  showEngagement(): boolean;
  /** Likewise the capture date, which is otherwise a second date saying "today-ish". */
  showCaptured(): boolean;
}) {
  const { t, formatCount, formatDate, compactDate, fileSrc, smokeCapture, shape, imgAspect, gridThumbW, listThumbW, showEngagement, showCaptured } = deps;
  return function cardModel(g: HologramPostGroup, i: number): Record<string, any> {
    const p = g.rep;
    const view = shape();
    const aspectCache = imgAspect();
    // Engagement: nonzero only (zeros are noise), and only while something on screen
    // is ABOUT engagement. Formatted here; the component owns the outline TEXT glyphs
    // (♡ ⇄ 🗨 🔖). This used to be a CSS gate on a container class (.show-eng), which
    // meant every card carried counts nobody could see.
    const stats = showEngagement()
      ? {
          likes: p.likes > 0 ? formatCount(p.likes) : null,
          reposts: p.reposts > 0 ? formatCount(p.reposts) : null,
          replies: p.replies > 0 ? formatCount(p.replies) : null,
          bookmarks: p.bookmarks > 0 ? formatCount(p.bookmarks) : null,
        }
      : {};
    // Both dates: post date bare (primary) + capture date with a 📷 mark
    // (secondary). Deduped when they land on the same day.
    const dateStr = p.date ? t('postedOn', [formatDate(p.date)]) : '';
    const capturedStr = p.capturedAt ? t('captured', [formatDate(p.capturedAt)]) : '';
    const postCompact = p.date ? compactDate(p.date) : '';
    const capCompact = p.capturedAt ? compactDate(p.capturedAt) : '';
    const footDates = {
      post: postCompact ? { label: postCompact, title: dateStr || '' } : null,
      cap: showCaptured() && capCompact && capCompact !== postCompact ? { label: capCompact, title: capturedStr || '' } : null,
    };
    const userName = p.displayName || p.screenName || p.title || '';
    const avatarSrc = p.avatarFile ? fileSrc(p.avatarFile) : null;
    const monogram = p.avatarFile ? null : userName ? userName[0].toUpperCase() : '?';
    const cardMonoHue = p.avatarFile ? null : monoHue(userKey(p) || userName);
    const handle = p.screenName ? `@${p.screenName}` : '';
    // Library images carry the filename as BOTH title and text — drop the
    // duplicate body when they match the user line.
    const textRaw = p.text || p.title || '';
    const text = textRaw === userName ? '' : textRaw;
    const imgFile = densityImage(p); // artwork, capture only as its stand-in
    // A square cell is a crop, so it always takes a thumbnail; anything showing the
    // image at its own proportions keeps a real .gif full-size, or it stops animating
    // (the thumbnailer flattens GIF to a static JPEG).
    const cellW = view.list ? listThumbW() : gridThumbW();
    const imgW = view.square || !/\.gif$/i.test(imgFile || '') ? cellW : 0;
    // Reserve the height up front so the masonry packs right the first time — pixel
    // size from the index, learned cache fallback, and (#365) a text-only post's own
    // discrete step when there is no image to have sized or learned from at all. Only
    // the original-aspect grid needs any of this: square cells and list rows have a
    // height the layout already knows.
    const aspRatio = view.list || view.square ? '' : p.shotW > 0 && p.shotH > 0 ? p.shotW + '/' + p.shotH : p.captureId && aspectCache[p.captureId] ? aspectCache[p.captureId] : !hasVisualMedia(p) ? textPlateAspect(text) : '';
    // Post-type + media flags. The list row spends its width on the post text and
    // leaves these out (ListRow), so they are grid furniture.
    const flags: string[] = [];
    if (p.isThread) flags.push(t('qfThread'));
    if (p.isReply) flags.push(t('qfReply'));
    if (p.isQuote) flags.push(t('qfQuote'));
    // 'image' is the default media type for the vast majority of cards — an
    // always-on "Image" label is pure noise there (#110: mark exceptions only).
    const mediaLabel = p.mediaType === 'video' ? t('qfVideo') : p.mediaType === 'gif' ? t('qfGif') : '';
    const leadMedia = mediaItemsOf(p)[0];
    // An mp4-backed GIF (X animated_gif / Mastodon gifv) is a GIF to the reader —
    // mp4 is only how the platform ships it, and the source site loops it right in
    // the timeline. So card and list PLAY it in place (#476), which is also what a
    // real .gif entry already does there (no per-item type → plain <img>, served
    // full-size by the imgW carve-out above). The per-item `type` is the mark that
    // tells the two mp4 kinds apart: 'gif' is the short silent loop, 'video' has a
    // length and must not start itself, 'ugoira' needs the zip unpacked first
    // (#119 St3) — neither of those autoplays anywhere.
    //   The SQUARE grid stays on the still, and that is the shape axis carrying
    // playback with it (2026-07-19 finalized): squares are the even lattice you scan, and
    // the back-stack sheets of a group are stills by construction (background-image),
    // so a looping front face would be the odd one out. imgSrc below is left as the
    // still either way, so the context menu's "Copy image" / "Show in folder" still
    // name a real image file.
    const gifVideo = !view.square && leadMedia && leadMedia.type === 'gif' && leadMedia.file ? leadMedia : null;
    // Full size, never the thumbnailer: it hands back a single flattened frame.
    const videoSrc = gifVideo ? fileSrc(gifVideo.file as string) : '';
    // Painted until the first frame decodes, so the cell does not flash empty.
    const videoPoster = gifVideo?.posterFile ? fileSrc(gifVideo.posterFile, cellW) : '';
    // ▶ badge over the thumb: only when the leading media item's downloaded
    // TRANSPORT is a video (type 'video'/'gif' — an mp4-backed X animated_gif
    // / Mastodon gifv). A real .gif file has no per-item type (still-image
    // transport, #119 St1) and already reads as animated once loaded — no badge.
    // Nor does anything that is already playing: a ▶ over a moving picture would
    // be telling the reader to start what they are watching.
    const videoBadge = !videoSrc && !!leadMedia && (leadMedia.type === 'video' || leadMedia.type === 'gif' || leadMedia.type === 'ugoira');
    const postKey = postIdKey(p);
    // Multi-image stack: the 2nd/3rd images ride the back sheets (real
    // thumbnails — motion-study canvas 2026-07-05). Downscaled like the front
    // image (GIFs too: a static flattened thumb is right for a back sheet).
    const stackSrcs = g.files.length > 1 ? g.files.slice(1, 3).map((f) => fileSrc(f, cellW)) : [];
    // #236: a collected item has no image/video (densityImage/imgFile above is
    // always '' for these — image/video/media[] are all empty on a 'file' row),
    // so it needs its own thumb branch: request the SAME asset://…?w= route
    // everything else uses (the OS-shell/negative-cache path in
    // lib-thumbnails.ts's getThumbnail answers it, or answers null and the
    // card falls back to its generic icon+name+ext — CardThumb's onError).
    const fileAsset = isFileAsset(p);
    const fileName = fileAsset && p.file ? (p.title || p.file).replace(/\.[^./\\]+$/, '') : '';
    const fileExt = fileAsset && p.file ? (p.file.match(/\.([^./\\]+)$/)?.[1] || '').toUpperCase() : '';
    return {
      index: i,
      postKey,
      // videoSrc counts: a gif whose poster download failed AND whose post has no
      // capture has no still to show, but it still has something to play.
      hasThumb: !!(imgFile || p.video || videoSrc || (fileAsset && p.file)),
      imgSrc: imgFile ? fileSrc(imgFile, imgW) : fileAsset && p.file ? fileSrc(p.file, imgW) : '',
      isFileCard: fileAsset,
      fileName,
      fileExt,
      videoSrc,
      videoPoster,
      videoBadge,
      captureId: p.captureId || '',
      aspRatio,
      eager: !!smokeCapture,
      nImg: g.files.length,
      stackSrcs,
      userName,
      avatarSrc,
      monogram,
      monoHue: cardMonoHue,
      handle,
      flags,
      mediaLabel,
      text,
      stats,
      footDates,
      tags: p.tags || [],
    };
  };
}

// Pre-compute sort timestamps so getFilteredPosts() never calls new Date() per
// comparison (done once per record on arrival, not per render).
export function stampPost(p: HologramPost): HologramPost {
  p._dateMs = p.date ? +new Date(p.date) : 0;
  p._capturedMs = p.capturedAt ? +new Date(p.capturedAt) : 0;
  p._postKey = postKeyOf(p.url); // url-derived group key; groupRecords would re-parse it 3x/record otherwise
  p._quotedKey = postKeyOf(p.quotedUrl); // quoted-post key — the text-search URL probe matches it per keystroke
  return p;
}

// manual-groups.json / ungrouped.json load/persist (P4 "IPC→service" domain-
// grouping slice — the raw hologramIpc calls move here from viewer.js, next to
// makeGroupRecords/makeGallery which already consume these two stores as
// injected deps). Only called from the browser (viewer.js); never invoked by
// the Node unit test.
export async function loadManualGroups() {
  try {
    const r = await hologramIpc.getManualGroups();
    return (r && r.groups) || [];
  } catch {
    return [];
  }
}
export async function persistManualGroups(groups: string[][]) {
  try {
    await hologramIpc.setManualGroups(groups);
  } catch {
    /* best-effort */
  }
}
export async function loadUngrouped() {
  try {
    const r = await hologramIpc.getUngrouped();
    return new Set<string>((r && r.keys) || []);
  } catch {
    return new Set<string>();
  }
}
export async function persistUngrouped(keys: Set<string> | string[]) {
  try {
    await hologramIpc.setUngrouped([...keys]);
  } catch {
    /* best-effort */
  }
}
