// Tab-state service — tab title derivation (filterLabel / tabTitleOf), the
// per-tab browser-style back/forward history state machine (makeNavHistory),
// and the tabs.json (de)serialization pair (serializeTabs / sanitizeSavedTabs),
// extracted 1:1 from viewer.js as the sixth "pure logic → service" slice of the
// viewer decomposition (最終形B). Plain IIFE on window (like query.js /
// records.js / users.js); loaded BEFORE viewer.js; touches no DOM. Runtime
// couplings are injected — reassigned viewer lets (appBooted) come in as getter
// functions and later-declared consts (PF_NAME / CF) as deferred arrows — so
// this file loads under Node (scripts/test-tabstate-unit.js). CommonJS-exported
// like records.js.
(function () {
  'use strict';

  function genTabId() {
    return 'tab_' + Math.random().toString(36).slice(2, 10);
  }

  // deps contract:
  //   MSG — resolved i18n message map (static after boot)
  //   engTypeLabels — engagement-type label map (viewer keeps the const: the
  //                   filter popover shares it for its type <select>)
  //   platformName(v) — PF_NAME lookup with raw-value fallback
  //   formatShortDate(dateStr) / formatCount(n) — viewer formatting helpers
  //   collectionName(id) — resolves a collection id to its display name
  //                        (null/undefined when unknown → caller falls back)
  function makeTabLabels(deps) {
    const { MSG, engTypeLabels, platformName, formatShortDate, formatCount, collectionName } = deps;

    // Returns the human-readable label for a single active filter. Shared by
    // the query-chip renderer and the tab title generator.
    function filterLabel(f) {
      switch (f.type) {
        case 'kind':
          return f.value === 'post' ? MSG.kindPost : MSG.kindImage;
        case 'platform':
          return f.value === '__none' ? MSG.qfPlatformNone : platformName(f.value);
        case 'postType':
          return f.value === 'post' ? MSG.qfPost : f.value === 'reply' ? MSG.qfReply : f.value === 'quote' ? MSG.qfQuote : MSG.qfThread;
        case 'date': {
          const typeName = f.dateField === 'capturedAt' ? MSG.qfDateCaptured : MSG.qfDatePost;
          const fromStr = f.from ? formatShortDate(f.from) : '';
          const toStr = f.to ? formatShortDate(f.to) : '';
          return `${typeName}: ${fromStr}〜${toStr}`;
        }
        case 'engagement':
          return `${engTypeLabels[f.engType] || f.engType} ${f.op === 'lte' ? '≤' : '≥'} ${formatCount(f.min)}`;
        case 'tag':
          return f.value;
        case 'hashtag':
          return `#${f.value}`;
        case 'collection':
          return collectionName(f.value) || f.value;
        case 'clip':
          return MSG.clipTitle;
        case 'media':
          return f.value === 'image' ? MSG.qfImage : f.value === 'video' ? MSG.qfVideo : MSG.qfGif;
        case 'instance':
          return f.value;
        case 'user':
          return f.label || f.value;
        case 'text':
          return f.value;
        default:
          return f.value || f.type;
      }
    }

    // Derives a tab title from a snapshot state. Pure function (no DOM reads).
    // All active labels joined with ・ in priority order so every tab is unique.
    function tabTitleOf(state, ctx) {
      const filters = (state && state.f) || [];
      const search = (state && state.search) || '';
      const multi = !!(state && state.multi);
      const allCount = ctx && ctx.allCount != null ? ctx.allCount : 0;

      if (!filters.length && !search && !multi) {
        return { text: MSG.filterAll + '(' + formatCount(allCount) + ')', iconType: 'all' };
      }

      const parts: string[] = [];
      let primaryIconType: string | null = null;
      const add = (label, iconType) => {
        parts.push(label);
        if (!primaryIconType) primaryIconType = iconType;
      };

      const byType: Record<string, any[]> = {};
      filters.forEach((f) => {
        (byType[f.type] = byType[f.type] || []).push(f);
      });

      // Search terms are 'text' leaves now (in state.f), shown first with the magnifier glyph.
      if (byType.text)
        byType.text.forEach((f) => {
          const v = String(f.value || '');
          add('”' + (v.length > 12 ? v.slice(0, 12) + '…' : v) + '”', 'search');
        });
      if (byType.tag) byType.tag.forEach((f) => add(filterLabel(f), 'tag'));
      if (byType.hashtag) byType.hashtag.forEach((f) => add(filterLabel(f), 'hashtag'));
      if (byType.user) byType.user.forEach((f) => add(filterLabel(f), 'user'));
      filters.filter((f) => f.type === 'platform' || f.type === 'instance').forEach((f) => add(filterLabel(f), f.type));
      filters.filter((f) => f.type === 'postType' || f.type === 'media').forEach((f) => add(filterLabel(f), f.type));
      if (multi && !byType.media) add(MSG.qfMultiImage, 'media');
      if (byType.date) byType.date.forEach((f) => add(filterLabel(f), 'date'));
      if (byType.engagement) byType.engagement.forEach((f) => add(filterLabel(f), 'engagement'));
      if (byType.kind) byType.kind.forEach((f) => add(filterLabel(f), 'kind'));
      filters.filter((f) => f.type === 'clip' || f.type === 'collection').forEach((f) => add(filterLabel(f), f.type));

      return { text: parts.join('・'), iconType: primaryIconType || 'all' };
    }

    // Poster query-chip / row label. folder name + date dimension are
    // poster-specific; platform / instance / tag reuse the shared filterLabel.
    // deps.posterFolderName resolves a poster-folder id → name (or null) from
    // the viewer-owned pfStore, mirroring collectionName above.
    function posterFilterLabel(f) {
      if (f.type === 'folder') {
        const name = deps.posterFolderName(f.value);
        return name != null ? name : f.value;
      }
      if (f.type === 'date') {
        const dimName = f.dateField === 'lastCapture' ? MSG.posterDateLastCapture : f.dateField === 'authorCreatedAt' ? MSG.posterDateCreated : MSG.posterDateLastPost;
        const fromStr = f.from ? formatShortDate(f.from) : '';
        const toStr = f.to ? formatShortDate(f.to) : '';
        return `${dimName}: ${fromStr}〜${toStr}`;
      }
      return filterLabel(f);
    }

    return { filterLabel, tabTitleOf, posterFilterLabel };
  }

  // Per-tab view-history for browser-style back/forward. Holds JSON snapshots;
  // idx points at the current entry. Linear: navigating back then making a
  // fresh change drops the forward entries. In-memory per session (rides on the
  // tab object across switches via adopt/saveInto; not written to disk).
  //
  // deps contract:
  //   cap — history depth cap
  //   enabled() — history gate (viewer's appBooted: no entries until initTabs
  //               has applied the saved view — avoids a spurious empty entry
  //               from the early prefs render)
  //   snapshot() — current view state object (seeds a fresh history on adopt)
  //   apply(state) — restores a view state (its restoring guard stops the re-push)
  //   onChange() — fired after every hist/idx mutation (viewer syncs the nav buttons)
  function makeNavHistory(deps) {
    const { cap, enabled, snapshot, apply, onChange } = deps;
    let hist: string[] = [];
    let idx = -1;

    // Record a fresh view. No-op when the state equals the current entry, so
    // background refreshes / re-renders of the same query don't pile up.
    function push(snap) {
      if (!enabled()) return;
      const s = JSON.stringify(snap);
      if (idx >= 0 && hist[idx] === s) return;
      if (idx < hist.length - 1) hist = hist.slice(0, idx + 1); // drop forward branch
      hist.push(s);
      if (hist.length > cap) hist = hist.slice(hist.length - cap);
      idx = hist.length - 1;
      onChange();
    }
    // Returns true when it actually navigated (the caller persists on true).
    function go(i) {
      if (i < 0 || i >= hist.length || i === idx) return false;
      idx = i;
      apply(JSON.parse(hist[idx]));
      onChange();
      return true;
    }
    const back = () => go(idx - 1);
    const forward = () => go(idx + 1);
    // Adopt (or seed) a tab's history when it becomes active.
    function adopt(t) {
      if (t && Array.isArray(t._navHist) && t._navHist.length) {
        hist = t._navHist;
        idx = typeof t._navIdx === 'number' ? Math.max(0, Math.min(t._navIdx, hist.length - 1)) : hist.length - 1;
      } else {
        hist = [JSON.stringify(snapshot())];
        idx = 0;
      }
      onChange();
    }
    // Carry the live history with the tab object across switches.
    function saveInto(t) {
      t._navHist = hist;
      t._navIdx = idx;
    }
    return { push, back, forward, adopt, saveInto, canBack: () => idx > 0, canForward: () => idx < hist.length - 1 };
  }

  // tabs.json payload. scrollTop rides along so the view restores across
  // RESTART, not just tab switches (main.js writes the payload verbatim — no
  // whitelist). The old renderLimit field is gone with the windowed path: the
  // virtualized grid restores any depth from scrollTop alone (stale saved
  // fields are ignored). Image tabs persist type+img instead of filter state
  // (undefined fields drop out of the JSON, so filter tabs keep their old
  // shape on disk).
  function serializeTabs(tabs, activeTabId) {
    return { activeTabId, tabs: tabs.map((t) => ({ id: t.id, pinned: t.pinned, title: t.title, state: t.state, scrollTop: t._scrollTop, type: t.type, img: t.img })) };
  }

  // Restore-side sanitizer for a persisted tabs.json payload. Returns null when
  // nothing usable was saved (the caller seeds a fresh single tab). Image tabs:
  // sanitize the persisted shape (unknown/older files just yield a filter tab;
  // an image tab with bad recs shows the missing state).
  function sanitizeSavedTabs(saved, genId) {
    if (!saved || !Array.isArray(saved.tabs) || saved.tabs.length === 0) return null;
    const tabs = saved.tabs.map((t) => ({
      id: t.id || genId(),
      pinned: !!t.pinned,
      title: t.title || null,
      state: t.state || null,
      type: t.type === 'image' ? 'image' : undefined,
      img: t.type === 'image' && t.img && Array.isArray(t.img.recs) ? { recs: t.img.recs.filter((x) => typeof x === 'string'), idx: typeof t.img.idx === 'number' ? t.img.idx : 0 } : undefined,
      _scrollTop: typeof t.scrollTop === 'number' ? t.scrollTop : 0,
    }));
    const sid = saved.activeTabId;
    return { tabs, activeTabId: sid && tabs.find((t) => t.id === sid) ? sid : tabs[0].id };
  }

  const api = { genTabId, makeTabLabels, makeNavHistory, serializeTabs, sanitizeSavedTabs };
  if (typeof window !== 'undefined') window.corpusTabState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
