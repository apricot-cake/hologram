// Tab-state service — tab title derivation (filterLabel / tabTitleOf), the
// per-tab browser-style back/forward history state machine (makeNavHistory),
// the tabs.json (de)serialization pair (serializeTabs / sanitizeSavedTabs), and
// the tabs.json load/persist calls (loadTabs / persistTabs), extracted 1:1 from
// viewer.js as the sixth "pure logic → service" slice of the viewer
// decomposition (最終形B) plus the P4 "IPC→service" domain-grouping follow-up.
// A real ES module (named exports) imported directly by viewer.ts; touches no
// DOM. Runtime couplings are injected — reassigned viewer lets (appBooted) come
// in as getter functions and later-declared consts (PF_NAME / CF) as deferred
// arrows — so this file loads under Node (scripts/test-tabstate-unit.cts drives
// it via dynamic import): loadTabs/persistTabs call hologramIpc (renderer/ipc.ts),
// which touches window.hologram lazily inside its arrow functions — the import
// itself is side-effect free, so it stays harmless under Node.
import { hologramIpc } from './ipc.ts';
import { normalizeLeaf, normalizeTree } from './query.ts';

export function genTabId() {
  return 'tab_' + Math.random().toString(36).slice(2, 10);
}

// deps contract:
//   t(key,subs?) — i18n message lookup (getMessage)
//   engTypeLabels — engagement-type label map (viewer keeps the const: the
//                   filter popover shares it for its type <select>)
//   platformName(v) — PF_NAME lookup with raw-value fallback
//   formatShortDate(dateStr) / formatCount(n) — viewer formatting helpers
//   folderName(id) — resolves a folder id to its display name
//                        (null/undefined when unknown → caller falls back)
export function makeTabLabels(deps: {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  engTypeLabels: { [k: string]: string };
  platformName(v: string): string;
  formatShortDate(dateStr: string): string;
  formatCount(n: number | null | undefined): string;
  folderName(id: string): string | null | undefined;
  posterFolderName(id: string): string | null | undefined;
}) {
  const { t, engTypeLabels, platformName, formatShortDate, formatCount, folderName } = deps;

  // Returns the human-readable label for a single active filter. Shared by
  // the query-chip renderer and the tab title generator.
  function filterLabel(f: { type: string; [k: string]: any }): string {
    switch (f.type) {
      case 'kind':
        return f.value === 'post' ? t('kindPost') : t('kindImage');
      case 'platform':
        return f.value === '__none' ? t('qfPlatformNone') : platformName(f.value);
      case 'postType':
        return f.value === 'post' ? t('qfPost') : f.value === 'reply' ? t('qfReply') : f.value === 'quote' ? t('qfQuote') : t('qfThread');
      case 'date': {
        const typeName = f.dateField === 'capturedAt' ? t('qfDateCaptured') : t('qfDatePost');
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
      case 'folder':
        return folderName(f.value) || f.value;
      case 'clip':
        return t('clipTitle');
      case 'media':
        return f.value === 'image' ? t('qfImage') : f.value === 'video' ? t('qfVideo') : t('qfGif');
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
  function tabTitleOf(state: HologramTabSnapshot | null | undefined, ctx: { allCount?: number | null } | null | undefined): { text: string; iconType: string } {
    const filters = (state && state.f) || [];
    const search = (state && state.search) || '';
    const multi = !!(state && state.multi);
    const allCount = ctx && ctx.allCount != null ? ctx.allCount : 0;

    if (!filters.length && !search && !multi) {
      return { text: t('filterAll') + '(' + formatCount(allCount) + ')', iconType: 'all' };
    }

    const parts: string[] = [];
    let primaryIconType: string | null = null;
    const add = (label: string, iconType: string) => {
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
    if (multi && !byType.media) add(t('qfMultiImage'), 'media');
    if (byType.date) byType.date.forEach((f) => add(filterLabel(f), 'date'));
    if (byType.engagement) byType.engagement.forEach((f) => add(filterLabel(f), 'engagement'));
    if (byType.kind) byType.kind.forEach((f) => add(filterLabel(f), 'kind'));
    filters.filter((f) => f.type === 'clip' || f.type === 'folder').forEach((f) => add(filterLabel(f), f.type));

    return { text: parts.join('・'), iconType: primaryIconType || 'all' };
  }

  // Poster query-chip / row label. folder name + date dimension are
  // poster-specific; platform / instance / tag reuse the shared filterLabel.
  // deps.posterFolderName resolves a poster-folder id → name (or null) from
  // the viewer-owned pfStore, mirroring folderName above.
  function posterFilterLabel(f: { type: string; [k: string]: any }): string {
    if (f.type === 'folder') {
      const name = deps.posterFolderName(f.value);
      return name != null ? name : f.value;
    }
    if (f.type === 'date') {
      const dimName = f.dateField === 'lastCapture' ? t('posterDateLastCapture') : f.dateField === 'authorCreatedAt' ? t('posterDateCreated') : t('posterDateLastPost');
      const fromStr = f.from ? formatShortDate(f.from) : '';
      const toStr = f.to ? formatShortDate(f.to) : '';
      return `${dimName}: ${fromStr}〜${toStr}`;
    }
    return filterLabel(f);
  }

  return { filterLabel, tabTitleOf, posterFilterLabel };
}

// Derives an entry's pseudo-URL (label + identity key — see HologramNavEntry.u).
// Grid kinds carry no query string for now (state is the truth; the history
// page #145 derives display labels from state via tabTitleOf) — only the image
// kind needs an identity in u ("reopening the same image doesn't stack").
export function navEntryUrl(kind: HologramNavEntry['kind'], state: any): string {
  if (kind === 'image') return '/image/' + ((state && Array.isArray(state.recs) && state.recs[0]) || '');
  return kind === 'posters' ? '/posters' : '/posts';
}

// Per-tab view-history for browser-style back/forward (#144: entries are
// tagged-union HologramNavEntry JSON — posts / posters / image all ride the same
// stack). idx points at the current entry. Linear: navigating back then making
// a fresh change drops the forward entries. The stack rides on the tab object
// across switches via adopt/saveInto and persists to tabs.json (未決5).
//
// deps contract:
//   cap — history depth cap
//   enabled() — history gate (viewer's appBooted: no entries until initTabs
//               has applied the saved view — avoids a spurious empty entry
//               from the early prefs render)
//   snapshot() — current view entry (seeds a fresh history on adopt)
//   apply(entry) — restores a view entry (its restoring guard stops the re-push)
//   onChange() — fired after every hist/idx mutation (viewer syncs the nav buttons)
export function makeNavHistory(deps: { cap: number; enabled(): boolean; snapshot(): HologramNavEntry; apply(e: HologramNavEntry): void; onChange(): void }) {
  const { cap, enabled, snapshot, apply, onChange } = deps;
  let hist: string[] = [];
  let idx = -1;
  // Coalescing state for record(): while the caller keeps handing the same
  // non-null key (one live-typing burst, one open facet editor), follow-up
  // records REPLACE the entry the first record pushed — "1 セッション 1 エントリ"
  // (確定未決2). Any navigation / adopt resets it, so post-nav edits push fresh.
  let lastKey: unknown = null;

  // Record a fresh view. No-op when the state equals the current entry, so
  // background refreshes / re-renders of the same query don't pile up.
  function push(e: HologramNavEntry) {
    if (!enabled()) return;
    lastKey = null;
    const s = JSON.stringify(e);
    if (idx >= 0 && hist[idx] === s) return;
    if (idx < hist.length - 1) hist = hist.slice(0, idx + 1); // drop forward branch
    hist.push(s);
    if (hist.length > cap) hist = hist.slice(hist.length - cap);
    idx = hist.length - 1;
    onChange();
  }
  // Rewrite the current entry in place (live typing / gallery paging / sort —
  // the 確定 replace list). When the rewrite makes it a duplicate of the
  // previous entry (e.g. a typing session backspaced to where it started),
  // drop it instead of keeping two identical neighbours.
  function replace(e: HologramNavEntry) {
    if (!enabled()) return;
    if (idx < 0) {
      push(e);
      return;
    }
    const s = JSON.stringify(e);
    if (hist[idx] === s) return;
    if (idx > 0 && hist[idx - 1] === s) {
      hist.splice(idx, 1);
      idx--;
      lastKey = null; // the burst's entry vanished — the next coalesced record must push fresh
    } else {
      hist[idx] = s;
    }
    onChange();
  }
  // push/replace router: a repeated non-null coalesce key collapses the burst
  // into the entry its first record pushed.
  function record(e: HologramNavEntry, coalesceKey?: unknown) {
    if (coalesceKey != null && coalesceKey === lastKey) {
      replace(e);
      return;
    }
    push(e);
    lastKey = coalesceKey ?? null;
  }
  // Returns true when it actually navigated (the caller persists on true).
  function go(i: number): boolean {
    if (i < 0 || i >= hist.length || i === idx) return false;
    idx = i;
    lastKey = null;
    apply(JSON.parse(hist[idx]));
    onChange();
    return true;
  }
  const back = () => go(idx - 1);
  const forward = () => go(idx + 1);
  // Current entry (parsed copy) — null before the first record/adopt.
  function current(): HologramNavEntry | null {
    return idx >= 0 ? JSON.parse(hist[idx]) : null;
  }
  // Re-apply the current entry (tab switch: the adopted stack knows the view).
  function applyCurrent() {
    if (idx >= 0) apply(JSON.parse(hist[idx]));
  }
  // Adopt (or seed) a tab's history when it becomes active.
  function adopt(t: HologramTab | null | undefined) {
    lastKey = null;
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
  function saveInto(t: HologramTab) {
    t._navHist = hist;
    t._navIdx = idx;
  }
  return { push, replace, record, back, forward, current, applyCurrent, adopt, saveInto, canBack: () => idx > 0, canForward: () => idx < hist.length - 1 };
}

// tabs.json payload. scrollTop rides along so the view restores across
// RESTART, not just tab switches (main.js writes the payload verbatim — no
// whitelist). The old renderLimit field is gone with the windowed path: the
// virtualized grid restores any depth from scrollTop alone (stale saved
// fields are ignored). The per-tab back/forward stack persists as parsed
// entry objects under `nav` (#144 未決5 — NAV_CAP is the only size bound;
// Chrome carries tab history across restarts the same way).
export function serializeTabs(tabs: HologramTab[], activeTabId: string | null): { activeTabId: string | null; tabs: Array<{ [k: string]: any }> } {
  return {
    activeTabId,
    tabs: tabs.map((t) => ({
      id: t.id,
      pinned: t.pinned,
      title: t.title,
      autoTitle: t._autoTitle || undefined, // image-view stamped title (cleared on grid entries)
      state: t.state,
      scrollTop: t._scrollTop,
      nav: Array.isArray(t._navHist) && t._navHist.length ? { hist: t._navHist.map((s) => JSON.parse(s)), idx: t._navIdx } : undefined,
    })),
  };
}

// Normalize a persisted tab state's leaf-type names to the current schema (see
// query.ts normalizeLeaf). Both the query tree (state.tree — what applyState
// restores from) and the title shadow (state.f) are run through it, in place.
function normalizeSavedState(state: any): any {
  if (state && typeof state === 'object') {
    if (state.tree) normalizeTree(state.tree);
    if (Array.isArray(state.f)) state.f.forEach(normalizeLeaf);
  }
  return state || null;
}

// Validate one persisted nav entry — returns the re-serialized string or null
// (bad rows are dropped; idx is clamped by the caller). kind-specific state
// checks keep a hand-edited / truncated tabs.json from seeding a broken stack.
function sanitizeNavEntry(e: any): string | null {
  if (!e || typeof e !== 'object') return null;
  const kind = e.kind === 'posters' || e.kind === 'image' ? e.kind : e.kind === 'posts' ? 'posts' : null;
  if (!kind) return null;
  let state = e.state;
  if (kind === 'image') {
    const recs = state && Array.isArray(state.recs) ? state.recs.filter((x: any) => typeof x === 'string') : [];
    if (!recs.length) return null;
    state = { recs, idx: typeof state.idx === 'number' ? Math.max(0, Math.min(state.idx, recs.length - 1)) : 0 };
  } else {
    if (!state || typeof state !== 'object') return null;
    if (kind === 'posts') state = normalizeSavedState(state);
    else if (state.tree) normalizeTree(state.tree);
  }
  return JSON.stringify({ u: navEntryUrl(kind, state), kind, state });
}

// Restore-side sanitizer for a persisted tabs.json payload. Returns null when
// nothing usable was saved (the caller seeds a fresh single tab). The nav
// stack is validated row-by-row (bad rows dropped, idx clamped); a pre-#144
// image tab ({type:'image', img}) self-heals into a one-entry image history —
// the unified shape (one-off migration, droppable before release).
export function sanitizeSavedTabs(saved: unknown, genId: () => string): { tabs: HologramTab[]; activeTabId: string } | null {
  // `saved` is raw tabs.json JSON (unknown/older shape on disk) — narrow to a
  // loose shape once here, matching the HologramPost "open JSON" convention,
  // rather than threading `unknown` through every field access below.
  const data = saved as { tabs?: any[]; activeTabId?: string } | null | undefined;
  if (!data || !Array.isArray(data.tabs) || data.tabs.length === 0) return null;
  const tabs: HologramTab[] = data.tabs.map((t) => {
    let navHist: string[] | undefined;
    let navIdx: number | undefined;
    if (t.nav && Array.isArray(t.nav.hist)) {
      const raw: any[] = t.nav.hist;
      const kept = raw.map((e, i) => ({ s: sanitizeNavEntry(e), i })).filter((x) => x.s != null);
      if (kept.length) {
        navHist = kept.map((x) => x.s as string);
        const savedIdx = typeof t.nav.idx === 'number' ? t.nav.idx : raw.length - 1;
        // Point at the kept row nearest the saved current row (dropped rows shift it).
        let mapped = kept.filter((x) => x.i <= savedIdx).length - 1;
        if (mapped < 0) mapped = 0;
        navIdx = Math.min(mapped, navHist.length - 1);
      }
    } else if (t.type === 'image' && t.img && Array.isArray(t.img.recs)) {
      const s = sanitizeNavEntry({ kind: 'image', state: { recs: t.img.recs, idx: t.img.idx } });
      if (s) {
        navHist = [s];
        navIdx = 0;
      }
    }
    return {
      id: t.id || genId(),
      pinned: !!t.pinned,
      title: t.title || null,
      _autoTitle: !!t.autoTitle || (t.type === 'image' && !!navHist),
      // Self-heal retired leaf-type names in the persisted query tree + its title
      // shadow (e.g. #42 'collection'→'folder'). applyState prefers state.tree, so
      // both are normalized; the next tab-switch write persists the healed shape.
      state: normalizeSavedState(t.state),
      _scrollTop: typeof t.scrollTop === 'number' ? t.scrollTop : 0,
      _navHist: navHist,
      _navIdx: navIdx,
    };
  });
  const sid = data.activeTabId;
  return { tabs, activeTabId: sid && tabs.find((t) => t.id === sid) ? sid : tabs[0].id };
}

// tabs.json load/persist (P4 "IPC→service" domain-grouping slice — the raw
// hologramIpc.getTabs/setTabs calls move here from viewer.js, next to the
// (de)serialization pair they wrap). Only called from the browser (viewer.js);
// never invoked by the Node unit test.
export async function loadTabs() {
  try {
    return await hologramIpc.getTabs();
  } catch {
    return null;
  }
}
export async function persistTabs(tabs: HologramTab[], activeTabId: string | null) {
  try {
    await hologramIpc.setTabs(serializeTabs(tabs, activeTabId));
  } catch {
    /* best-effort */
  }
}
