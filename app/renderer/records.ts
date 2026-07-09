// Record service — record-shape helpers (media/screenshot/artwork/density image),
// normalization (postKeyOf / stampPost), grouping (groupRecords) and the per-platform
// likes percentile, extracted 1:1 from viewer.js as the second "pure logic → service"
// slice of the viewer decomposition (最終形B), plus (P4 "IPC→service" domain-grouping
// follow-up) the manual-groups.json / ungrouped.json load/persist pairs for the two
// stores makeGroupRecords already consumes. Plain IIFE on window (like query.js /
// store.js); loaded BEFORE viewer.js; touches no DOM. Runtime couplings (manual
// groups / ungrouped opt-outs — live viewer state) are INJECTED via
// makeGroupRecords(deps), so this file loads under Node too (scripts/test-records-unit.js);
// the load/persist pair below reads window.corpusIpc directly instead, since only the
// browser ever calls them, never the Node unit test. Also exported via CommonJS so the
// main process can share postKeyOf (the duplicate-save detection planned in BACKLOG
// needs the same URL→key normalization on both sides).
(function () {
  'use strict';

  // Per-density image source. A post may carry both a capture (screenshot) and
  // real media/artwork; the density decides which leads:
  //   tile / card → artwork preferred (the actual image leads — a clean grid),
  //                 capture as fallback (posts whose original didn't download)
  //   list        → capture preferred (the post as it looked in its compact row)
  // NOTE: lib-index's cardImageFile() MUST mirror the card branch so the masonry
  // height reservation (shotW/shotH) sizes the same image the card shows.
  const SS_EXT = /\.jpe?g$/i;
  // p.media entries are a loose JSON shape (same pragmatics as CorpusPost itself).
  type CorpusMediaItem = { file?: string; alt?: string; [k: string]: any };
  const mediaFilesOf = (p: CorpusPost): string[] => (Array.isArray(p.media) ? (p.media as CorpusMediaItem[]).filter((m) => m && m.file).map((m) => m.file as string) : []);
  // p.image is a screenshot unless it's a dragged/migrated artwork or a non-JPEG original.
  const isScreenshot = (p: CorpusPost): boolean => !!p.image && SS_EXT.test(p.image) && p.source !== 'drag' && p.source !== 'eagle-migration';
  const captureFile = (p: CorpusPost): string => (isScreenshot(p) ? p.image : '');
  const artworkFile = (p: CorpusPost): string => {
    const m = mediaFilesOf(p);
    if (m.length) return m[0];
    return p.image && !isScreenshot(p) ? p.image : '';
  };
  function densityImage(p: CorpusPost, density: string): string {
    const cap = captureFile(p),
      art = artworkFile(p);
    return density === 'list' ? cap || art : art || cap;
  }

  // --- Grouping (ported from image-view) --------------------------------------
  // Auto: records sharing the same post URL (multi-image drags, re-captures of
  // one post) collapse into one card. Manual groups (manual-groups.json) win
  // over auto. ungrouped.json opts individual post keys out.
  const postIdKey = (p: CorpusPost): string => p.captureId || (p.url || '') + '|' + (p.capturedAt || '');
  // Same URL patterns as metadata.js parsePostUrl (renderer-side copy). null = don't group.
  function postKeyOf(url: string | null | undefined): string | null {
    if (!url) return null;
    let u: any;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    const host = u.hostname,
      pa = u.pathname;
    let m: any;
    if (host === 'bsky.app' && (m = pa.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)/))) return 'bluesky:' + m[1] + '/' + m[2];
    if ((host === 'x.com' || host === 'twitter.com') && (m = pa.match(/\/status\/(\d+)/))) return 'x:' + m[1];
    if ((m = pa.match(/^\/@[^/]+\/(\d[\w-]*)\/?$/))) return 'mastodon:' + host + ':' + m[1];
    if ((m = pa.match(/^\/notes\/([^/?#]+)/))) return 'misskey:' + host + ':' + m[1];
    if ((host === 'www.pixiv.net' || host === 'pixiv.net') && (m = pa.match(/^(?:\/[a-z]{2})?\/artworks\/(\d+)/))) return 'pixiv:' + m[1];
    return null;
  }
  // The "artwork pages" of one record: original media, else the dragged/migrated image.
  const groupFilesOf = (p: CorpusPost): string[] => {
    const m = mediaFilesOf(p);
    if (m.length) return m;
    const a = artworkFile(p);
    return a ? [a] : [];
  };

  // Image-tab (type:'image') record resolution. The tab persists { img:{ recs:[captureId…],
  // idx } }; recs resolve against the live library on every activation via the injected byId
  // lookup, so deletions degrade to a "missing" empty state instead of a broken image. Same
  // rep pick as groupRecords (capture first, then any record with text). Pure — byId is
  // injected (so this loads under Node too).
  function imageTabGroup(t: CorpusTab, byId: (id: string) => CorpusPost | undefined): CorpusPostGroup | null {
    const ids: string[] = t.img && Array.isArray(t.img.recs) ? t.img.recs : [];
    const records = ids.map((id) => byId(id)).filter(Boolean) as CorpusPost[];
    if (!records.length) return null;
    const rep = records.find(isScreenshot) || records.find((r) => r.text) || records[0];
    return { key: 'imgtab:' + t.id, records, rep, files: records.flatMap(groupFilesOf) };
  }
  // Image-tab title: the rep's title/text trimmed to ≤24 chars, else its author, else the
  // caller-supplied 無題 fallback (i18n-owned by the caller).
  function imageTabTitleOf(g: CorpusPostGroup, fallback: string): string {
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
  function makeGroupRecords(deps: { manualGroups(): string[][]; ungrouped(): Set<string> }) {
    return function groupRecords(list: CorpusPost[]): CorpusPostGroup[] {
      const manualGroups = deps.manualGroups();
      const ungrouped = deps.ungrouped();
      // url-derived group key, precomputed once per record by stampPost (_postKey);
      // fall back to a live parse for any record that somehow predates the stamp.
      const pk = (p: CorpusPost) => (p._postKey !== undefined ? p._postKey : postKeyOf(p.url));
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
      const pidOf = (p: CorpusPost) => {
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
      const order: CorpusPostGroup[] = [];
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
      for (const g of order) {
        g.records.sort((a, b) => String(a.captureId || '').localeCompare(String(b.captureId || '')));
        // Card rep: prefer the click-capture (screenshot+full meta), then any record
        // with text, then the earliest — drags often carry no text/stats.
        g.rep = g.records.find(isScreenshot) || g.records.find((r) => r.text) || g.records[0];
        g.files = g.records.flatMap(groupFilesOf);
      }
      return order;
    };
  }

  // Likes percentile within each platform — ranks "did well for its SNS" so X's
  // raw counts don't dominate. Returns a fn p→[0,1]. (Ported from image-view.)
  function percentileFn(list: CorpusPost[]): (p: CorpusPost) => number {
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
  // The URL scheme (psimg://) stays viewer-owned: fileSrc is injected so the
  // protocol knowledge isn't duplicated here.
  const isVideoFile = (f: string | null | undefined) => /\.(mp4|webm|mov|m4v)$/i.test(f || '');
  // deps: fileSrc(file) — renderer media URL builder (viewer.js).
  function makeGallery(deps: { fileSrc(file: string): string }) {
    const { fileSrc } = deps;
    // Gallery items for a post: the screenshot first, then each original image.
    function buildGalleryItems(p: CorpusPost): { src: string; alt: string; video: boolean }[] {
      const items: { src: string; alt: string; video: boolean }[] = [];
      if (p.image) items.push({ src: fileSrc(p.image), alt: '', video: false });
      if (p.video) items.push({ src: fileSrc(p.video), alt: '', video: true });
      if (Array.isArray(p.media)) {
        for (const m of p.media as CorpusMediaItem[]) {
          if (m && m.file) items.push({ src: fileSrc(m.file), alt: m.alt || '', video: isVideoFile(m.file) });
        }
      }
      return items;
    }
    // Gallery for a whole group: every record's items in captureId order, deduped by src.
    function buildGroupGalleryItems(g: CorpusPostGroup): { src: string; alt: string; video: boolean }[] {
      if (g.records.length === 1) return buildGalleryItems(g.rep);
      const seen = new Set<string>();
      const items: { src: string; alt: string; video: boolean }[] = [];
      for (const r of g.records) {
        for (const it of buildGalleryItems(r)) {
          if (seen.has(it.src)) continue;
          seen.add(it.src);
          items.push(it);
        }
      }
      return items;
    }
    return { buildGalleryItems, buildGroupGalleryItems };
  }

  // --- Card view model (per-card presentation derivation) ---------------------
  // The model PostCard.tsx renders (grid modelOf). Pure field-mapping over a
  // group + the live view density; every runtime coupling (current density,
  // learned-aspect cache, selection set, clip flag, thumb widths, i18n messages,
  // psimg URLs) is INJECTED so this stays DOM-free and Node-testable. The subtle
  // rules that used to live inside renderPosts are locked here: engagement
  // zero-suppression, both-date same-day dedup, body-text dedup vs the author
  // line, GIF full-size (no thumb) in card/list, card-masonry height reservation
  // (shotW/H → learned cache), and the multi-image back-stack sheets.
  //   deps.currentView() / imgAspect() are getters (viewer reassigns the lets);
  //   isClipped/fileSrc keep folder + psimg knowledge viewer-owned. Selection is
  //   NOT here — the grid island derives .selected straight from corpusStore's
  //   'selectedSet' (same pattern as inspectedKey), so this stays selection-free.
  function makeCardModel(deps: Parameters<CorpusRecordsApi['makeCardModel']>[0]) {
    const { MSG, PF_NAME, formatCount, formatDate, compactDate, fileSrc, isClipped, smokeCapture, currentView, imgAspect, tileThumbW, cardThumbW, listThumbW } = deps;
    return function cardModel(g: CorpusPostGroup, i: number): Record<string, any> {
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
      const dateStr = p.date ? MSG.postedOn(formatDate(p.date)) : '';
      const capturedStr = p.capturedAt ? MSG.captured(formatDate(p.capturedAt)) : '';
      const postCompact = p.date ? compactDate(p.date) : '';
      const capCompact = p.capturedAt ? compactDate(p.capturedAt) : '';
      const footDates = {
        post: postCompact ? { label: postCompact, title: dateStr || '' } : null,
        cap: capCompact && capCompact !== postCompact ? { label: capCompact, title: capturedStr || '' } : null,
      };
      const pfName = p.platform ? PF_NAME[p.platform] || p.platform : '';
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
      if (p.isThread) flags.push(MSG.qfThread);
      if (p.isReply) flags.push(MSG.qfReply);
      if (p.isQuote) flags.push(MSG.qfQuote);
      const mediaLabel = p.mediaType === 'image' ? MSG.qfImage : p.mediaType === 'video' ? MSG.qfVideo : p.mediaType === 'gif' ? MSG.qfGif : '';
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
        clipped: isClipped(p.captureId),
        hasThumb: !!(imgFile || p.video),
        imgSrc: imgFile ? fileSrc(imgFile, imgW) : '',
        captureId: p.captureId || '',
        aspRatio,
        eager: !!smokeCapture,
        platform: p.platform || '',
        pfName,
        nImg: g.files.length,
        stackSrcs,
        userName,
        likesOv: p.likes != null ? MSG.likes(p.likes) : null,
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
  function stampPost(p: CorpusPost): CorpusPost {
    p._dateMs = p.date ? +new Date(p.date) : 0;
    p._capturedMs = p.capturedAt ? +new Date(p.capturedAt) : 0;
    p._postKey = postKeyOf(p.url); // url-derived group key; groupRecords would re-parse it 3x/record otherwise
    p._quotedKey = postKeyOf(p.quotedUrl); // quoted-post key — the text-search URL probe matches it per keystroke
    return p;
  }

  // manual-groups.json / ungrouped.json load/persist (P4 "IPC→service" domain-
  // grouping slice — the raw corpusIpc calls move here from viewer.js, next to
  // makeGroupRecords/makeGallery which already consume these two stores as
  // injected deps). Only called from the browser (viewer.js); never invoked by
  // the Node unit test, so window.corpusIpc's absence under Node is harmless.
  async function loadManualGroups() {
    try {
      const r = await window.corpusIpc.getManualGroups();
      return (r && r.groups) || [];
    } catch {
      return [];
    }
  }
  async function persistManualGroups(groups: string[][]) {
    try {
      await window.corpusIpc.setManualGroups(groups);
    } catch {
      /* best-effort */
    }
  }
  async function loadUngrouped() {
    try {
      const r = await window.corpusIpc.getUngrouped();
      return new Set<string>((r && r.keys) || []);
    } catch {
      return new Set<string>();
    }
  }
  async function persistUngrouped(keys: Set<string> | string[]) {
    try {
      await window.corpusIpc.setUngrouped([...keys]);
    } catch {
      /* best-effort */
    }
  }

  const api: CorpusRecordsApi = {
    mediaFilesOf,
    isScreenshot,
    captureFile,
    artworkFile,
    densityImage,
    postIdKey,
    postKeyOf,
    groupFilesOf,
    imageTabGroup,
    imageTabTitleOf,
    makeGroupRecords,
    makeGallery,
    makeCardModel,
    percentileFn,
    stampPost,
    loadManualGroups,
    persistManualGroups,
    loadUngrouped,
    persistUngrouped,
  };
  if (typeof window !== 'undefined') window.corpusRecords = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
