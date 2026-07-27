// Record service — record-shape helpers (media/screenshot/artwork/density image),
// normalization (postKeyOf / stampPost), grouping (groupRecords) and the per-platform
// likes percentile, extracted 1:1 from viewer.js as the second "pure logic → service"
// slice of the viewer decomposition (最終形B), plus (P4 "IPC→service" domain-grouping
// follow-up) the manual-groups.json / ungrouped.json load/persist pairs for the two
// stores makeGroupRecords already consumes. A real ES module (named exports)
// imported directly by viewer.ts / image-tab.ts and the FloatingBar island
// (postIdKey); touches no DOM. Runtime couplings (manual groups / ungrouped opt-outs
// — live viewer state) are INJECTED via makeGroupRecords(deps), so this file loads
// under Node too (scripts/test-records-unit.cts drives it via dynamic import); the
// load/persist pair below goes through hologramIpc (renderer/ipc.ts). postKeyOf is a
// plain named export now (the planned duplicate-save detection can import the same
// URL→key normalization when it lands).
import { hologramIpc } from './ipc.ts';
// URL→identity-key normalization lives in native-host/ because the bridge owns it
// too (the TL "saved" badge asks it whether a permalink is already in the library,
// #54) and a second copy here would let the badge and the grid disagree about
// which posts are the same post. Re-exported so every renderer importer keeps
// reaching it through this service, unchanged.
import { postKeyOf } from '../../native-host/post-key.mts';
export { postKeyOf };

// Per-density image source. A post may carry both a capture (screenshot) and
// real media/artwork; the density decides which leads:
//   tile / card → artwork preferred (the actual image leads — a clean grid),
//                 capture as fallback (posts whose original didn't download)
//   list        → capture preferred (the post as it looked in its compact row)
// NOTE: lib-index's cardImageFile() MUST mirror the card branch so the masonry
// height reservation (shotW/shotH) sizes the same image the card shows.
const SS_EXT = /\.jpe?g$/i;
// A downloaded media file is a video/animated-loop, not a still — used both to
// pick the gallery's <video> vs Zoomable branch (below) and, here, to keep a
// raw video file out of an <img src> (artworkFile prefers its poster instead).
const isVideoFile = (f: string | null | undefined) => /\.(mp4|webm|mov|m4v)$/i.test(f || '');
// p.media entries are a loose JSON shape (same pragmatics as HologramPost itself).
// type/posterFile: video/gif entries only (#119 St1) — posterFile is the
// downloaded still frame; type distinguishes an mp4-backed 'gif' (X
// animated_gif / Mastodon gifv) from a real .gif file (which has no type).
type HologramMediaItem = { file?: string; alt?: string; type?: string; posterFile?: string; [k: string]: any };
const mediaItemsOf = (p: HologramPost): HologramMediaItem[] => (Array.isArray(p.media) ? (p.media as HologramMediaItem[]).filter((m) => m && m.file) : []);
export const mediaFilesOf = (p: HologramPost): string[] => mediaItemsOf(p).map((m) => m.file as string);
// p.image is a screenshot unless it's a dragged/migrated artwork or a non-JPEG original.
export const isScreenshot = (p: HologramPost): boolean => !!p.image && SS_EXT.test(p.image) && p.source !== 'drag' && p.source !== 'eagle-migration';
export const captureFile = (p: HologramPost): string => (isScreenshot(p) ? p.image : '');
// The leading media item's THUMBNAIL file — its poster when it's a video/gif
// (a raw video can't be an <img src>), else the file itself. Falls back to the
// capture screenshot (via densityImage) when a video has no poster.
export const artworkFile = (p: HologramPost): string => {
  const items = mediaItemsOf(p);
  if (items.length) {
    const first = items[0];
    if (first.posterFile) return first.posterFile;
    return isVideoFile(first.file) ? '' : (first.file as string);
  }
  return p.image && !isScreenshot(p) ? p.image : '';
};
export function densityImage(p: HologramPost, density: string): string {
  const cap = captureFile(p),
    art = artworkFile(p);
  return density === 'list' ? cap || art : art || cap;
}

// --- Grouping (ported from image-view) --------------------------------------
// Auto: records sharing the same post URL (multi-image drags, re-captures of
// one post) collapse into one card. Manual groups (manual-groups.json) win
// over auto. ungrouped.json opts individual post keys out.
export const postIdKey = (p: HologramPost): string => p.captureId || (p.url || '') + '|' + (p.capturedAt || '');
// The "artwork pages" of one record: original media, else the dragged/migrated image.
export const groupFilesOf = (p: HologramPost): string[] => {
  const m = mediaFilesOf(p);
  if (m.length) return m;
  const a = artworkFile(p);
  return a ? [a] : [];
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
// caller-supplied 無題 fallback (i18n-owned by the caller).
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
    // LIBRARY by the SAME author joins that record's group, so リプ元＋セルフリプ
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
    // they should read (#89 めくり順バグ). Imported records carry no replyToId, so
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
export type GalleryItem = { src: string; alt: string; video: boolean; capture?: boolean };
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
    if (p.image && !shot) items.push({ src: fileSrc(p.image), alt: '', video: false });
    if (p.video) items.push({ src: fileSrc(p.video), alt: '', video: true });
    if (Array.isArray(p.media)) {
      for (const m of p.media as HologramMediaItem[]) {
        if (m && m.file) items.push({ src: fileSrc(m.file), alt: m.alt || '', video: isVideoFile(m.file) });
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

// --- Card view model (per-card presentation derivation) ---------------------
// The model PostCard.tsx renders (grid modelOf). Pure field-mapping over a
// group + the live view density; every runtime coupling (current density,
// learned-aspect cache, thumb widths, i18n messages,
// asset URLs) is INJECTED so this stays DOM-free and Node-testable. The subtle
// rules that used to live inside renderPosts are locked here: engagement
// zero-suppression, both-date same-day dedup, body-text dedup vs the author
// line, GIF full-size (no thumb) in card/list, card-masonry height reservation
// (shotW/H → learned cache), and the multi-image back-stack sheets.
//   deps.currentView() / imgAspect() are getters (viewer reassigns the lets);
//   fileSrc keeps folder + asset knowledge viewer-owned. Selection is
//   NOT here — the grid island derives .selected straight from hologramStore's
//   'selectedSet' (same pattern as inspectedKey), so this stays selection-free.
export function makeCardModel(deps: {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  formatCount(n: number): string;
  formatDate(d: string): string;
  compactDate(d: string): string;
  fileSrc(file: string, w?: number): string;
  smokeCapture: boolean;
  currentView(): string;
  imgAspect(): Record<string, string>;
  tileThumbW(): number;
  cardThumbW(): number;
  listThumbW(): number;
}) {
  const { t, formatCount, formatDate, compactDate, fileSrc, smokeCapture, currentView, imgAspect, tileThumbW, cardThumbW, listThumbW } = deps;
  return function cardModel(g: HologramPostGroup, i: number): Record<string, any> {
    const p = g.rep;
    const view = currentView();
    const aspectCache = imgAspect();
    // Engagement: nonzero only (zeros are noise). Formatted here; the island
    // owns the outline TEXT glyphs (♡ ⇄ 🗨 🔖).
    const stats = {
      likes: p.likes > 0 ? formatCount(p.likes) : null,
      reposts: p.reposts > 0 ? formatCount(p.reposts) : null,
      replies: p.replies > 0 ? formatCount(p.replies) : null,
      bookmarks: p.bookmarks > 0 ? formatCount(p.bookmarks) : null,
    };
    // Both dates: post date bare (primary) + capture date with a 📷 mark
    // (secondary). Deduped when they land on the same day.
    const dateStr = p.date ? t('postedOn', [formatDate(p.date)]) : '';
    const capturedStr = p.capturedAt ? t('captured', [formatDate(p.capturedAt)]) : '';
    const postCompact = p.date ? compactDate(p.date) : '';
    const capCompact = p.capturedAt ? compactDate(p.capturedAt) : '';
    const footDates = {
      post: postCompact ? { label: postCompact, title: dateStr || '' } : null,
      cap: capCompact && capCompact !== postCompact ? { label: capCompact, title: capturedStr || '' } : null,
    };
    const userName = p.displayName || p.screenName || p.title || '';
    const handle = p.screenName ? `@${p.screenName}` : '';
    // Library images carry the filename as BOTH title and text — drop the
    // duplicate body when they match the user line.
    const textRaw = p.text || p.title || '';
    const text = textRaw === userName ? '' : textRaw;
    const imgFile = densityImage(p, view); // tile: artwork→capture; card/list: capture→artwork
    // GIFs stay full-size in card/list so they keep animating (thumbnailer
    // flattens GIF to a static JPEG); tile already used a thumb, so unchanged.
    const imgW = view === 'tile' ? tileThumbW() : /\.gif$/i.test(imgFile || '') ? 0 : view === 'list' ? listThumbW() : cardThumbW();
    // Reserve the card image's height up front (card masonry) so columns pack
    // right the first time — pixel size from the index, learned cache fallback.
    const aspRatio = view !== 'card' ? '' : p.shotW > 0 && p.shotH > 0 ? p.shotW + '/' + p.shotH : p.captureId && aspectCache[p.captureId] ? aspectCache[p.captureId] : '';
    // Post-type + media flags (grid view only; CSS hides them in compact list).
    const flags: string[] = [];
    if (p.isThread) flags.push(t('qfThread'));
    if (p.isReply) flags.push(t('qfReply'));
    if (p.isQuote) flags.push(t('qfQuote'));
    // 'image' is the default media type for the vast majority of cards — an
    // always-on "画像" label is pure noise there (#110: mark exceptions only).
    const mediaLabel = p.mediaType === 'video' ? t('qfVideo') : p.mediaType === 'gif' ? t('qfGif') : '';
    // ▶ badge over the thumb: only when the leading media item's downloaded
    // TRANSPORT is a video (type 'video'/'gif' — an mp4-backed X animated_gif
    // / Mastodon gifv). A real .gif file has no per-item type (still-image
    // transport, #119 St1) and already reads as animated once loaded — no badge.
    const leadMedia = mediaItemsOf(p)[0];
    const videoBadge = !!leadMedia && (leadMedia.type === 'video' || leadMedia.type === 'gif');
    const postKey = postIdKey(p);
    // Multi-image stack: the 2nd/3rd images ride the back sheets (real
    // thumbnails — motion-study canvas 2026-07-05). Downscaled like the front
    // image (GIFs too: a static flattened thumb is right for a back sheet).
    const stackW = view === 'tile' ? tileThumbW() : view === 'list' ? listThumbW() : cardThumbW();
    const stackSrcs = g.files.length > 1 ? g.files.slice(1, 3).map((f) => fileSrc(f, stackW)) : [];
    return {
      index: i,
      url: p.url || '',
      postKey,
      noUrl: !p.url,
      hasThumb: !!(imgFile || p.video),
      imgSrc: imgFile ? fileSrc(imgFile, imgW) : '',
      videoBadge,
      captureId: p.captureId || '',
      aspRatio,
      eager: !!smokeCapture,
      nImg: g.files.length,
      stackSrcs,
      userName,
      likesOv: p.likes != null ? formatCount(p.likes) : null,
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
