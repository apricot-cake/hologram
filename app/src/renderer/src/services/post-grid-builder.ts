// Post-grid rendering + data-pipeline builder — extracted from the old viewer.ts
// monolith. This is the allPosts ownership transfer: the authoritative post
// cache (allPosts/_postsById), the load-posts pipeline, the grouped-render
// pipeline (renderPosts), the per-image aspect-ratio cache + card-model wiring,
// the fold/card context menus, and the delete flow all move here. Everything
// still owned by viewer.ts (density/view state, the inspector, selection, tabs,
// poster view, boot orchestration) is injected as deps — the same ctx pattern
// established by query-builder.ts et al. viewGroups/allPosts/manualGroups/
// ungrouped are exposed only as getters (plus narrow setters where a consumer
// genuinely reassigns, e.g. groupSelected()) — a module-internal `let` can't be
// reassigned from outside via ESM exports.
import { notify } from './ui.ts';
import { open as confirmOpen } from './confirm.ts';
import { open as menuOpen } from './menu.ts';
import { formatCount, formatDate, compactDate, monthLabel } from './format.ts';
import { dateFieldForSort, buildSections } from './date-sections.ts';
import { densityImage, dragFilesOf, postIdKey, makeGroupRecords, makeCardModel, stampPost } from './records.ts';
import { pinItemsOfGroups } from './pin-items.ts';
// #236: the same pure allowlist judgment the main-process gate uses
// (lib-open-gate.ts) — renderer-safe (no Electron/better-sqlite3), so the
// context menu can label "開く"/"フォルダで表示" without a round trip. The
// FULL gate (extension + magic bytes) still runs main-side at click time.
import { extensionAllowed } from '../../../../../native-host/open-allowlist.mts';
import type { DisplayShape } from './display.ts';
import { hologramPostGridSource } from './grid.ts';
import { listPostsDelta, deletePost, clearAll } from './posts.ts';
import { refresh as trashRefresh } from './trash-view.ts';
import { hologramIpc } from './ipc.ts';
import { sync as syncPostsData } from './posts-data.ts';
import { store } from './store.ts';
import { userKey } from './query.ts';
import * as folders from './folders.ts';
import * as selection from './selection.ts';

// #47: month sections for the grid's own display (date-sections.ts stays pure —
// no Intl, no i18n — so the locale label is composed here, the one place that
// already has both `t()` and monthLabel). Null when the current sort has no
// date axis. `groups` is the FLAT post-grid array (viewGroups) — the same one
// pushed to hologramStore's 'postGroups', so a section's startIndex indexes it
// directly (both the grid host and selection/nav math share that one array).
function buildDateSections(groups: HologramPostGroup[], sort: string, t: (key: string, subs?: ReadonlyArray<string | number | null | undefined>) => string): HologramDateSection[] | null {
  const field = dateFieldForSort(sort);
  if (!field) return null;
  const raw = buildSections(groups, (g) => g.rep[field === 'dateMs' ? '_dateMs' : '_capturedMs'] || 0);
  return raw.map((s) => ({
    key: s.key,
    ms: s.ms,
    startIndex: s.startIndex,
    count: s.count,
    label: t('dateSectionHeader', [s.key === 'unknown' ? t('dateSectionUnknown') : monthLabel(s.ms), s.count]),
  }));
}

// Callbacks/state still owned by viewer.ts — injected the same way
// query-builder.ts/qf-pop-builder.ts's ctx objects are.
export interface PostGridBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  smokeCapture: boolean;
  fileSrc(file: string, w?: number): string;
  shape(): DisplayShape;
  multiOnly(): boolean;
  gridThumbW(): number;
  listThumbW(): number;
  sortValue(): string;
  postShadow(): { type: string; value?: string }[];
  getFilteredPosts(): HologramPost[];
  buildUsers(): HologramUserAgg[];
  // #23 St1: folds a raw posterKey onto its name-merge group's primary —
  // identity when ungrouped. buildUsers() rows are keyed by primary.
  resolve(key: string): string;
  snapshotState(): unknown;
  syncTitleAndPersist(): void;
  getBrowseMode(): string;
  renderPosters(keepLimit?: boolean): void;
  onPostsLoaded(): void;
  showDetail(g: HologramPostGroup, opts?: { focusTags?: boolean }): void;
  jumpToPoster(post: HologramPost): void;
  addImageTab(g: HologramPostGroup): void;
  // Selected-text rows (#167). The card grid is the one surface that already had
  // a menu on the same click, so the rows are spliced into it rather than opening
  // a second one; services/selection-menu.ts owns both the rows and what they do.
  selectionMenu: {
    items(): HologramMenuItem[];
    pick(text: string, item: HologramMenuItem): boolean;
  };
}

export function makePostGridBuilder(deps: PostGridBuilderDeps) {
  const CF = () => folders; // shared folder module

  // Delete-confirmation skip pref — was injected from viewer.ts as a dep; now
  // owned here since this module is the only reader (requestDeleteGroup below)
  // and the settings component (Danger.tsx) wants a direct live binding instead of
  // going through the old shared bridge.
  let skipDeleteConfirm = false;
  function getSkipDeleteConfirm() {
    return skipDeleteConfirm;
  }
  function setSkipDeleteConfirm(v: boolean) {
    skipDeleteConfirm = v;
    hologramIpc.setPref('skipDeleteConfirm', v);
  }
  // Restoring a saved pref shouldn't re-persist it right back (mirrors
  // grid-density-builder.ts's restorePrefs, which assigns its own state directly).
  function restoreSkipDeleteConfirm(v: boolean) {
    skipDeleteConfirm = v;
  }

  // --- Authoritative post cache (allPosts ownership) ------------------------
  let allPosts: HologramPost[] = [];
  let _allPostsGeneration = 0; // bumped on every allPosts replacement; invalidates sidebar caches
  // In-place edits (tag add/remove, single delete) mutate allPosts records without
  // replacing the array, so the generation counter won't advance on its own. It gates
  // the sidebar tag/author/instance caches and buildUsers, so mutators must call this —
  // otherwise a newly-added tag never reaches the sidebar rows (and a removed author /
  // instance lingers) even though renderPosts redraws the grid and flyouts.
  // The SAME choke point also mirrors allPosts.length into hologramStore (the
  // post-empty-state selector's input) and syncs the subscribable posts-data
  // service (services/posts-data.ts) — every allPosts mutation (replace OR
  // in-place edit) is reachable from ONE place instead of scattered pushes.
  function markPostsMutated() {
    _allPostsGeneration++;
    store.setState({ allPostsCount: allPosts.length });
    syncPostsData(allPosts);
  }
  function getAllPosts() {
    return allPosts;
  }
  function getPostsById() {
    return _postsById;
  }
  function getPostById(id: string) {
    return _postsById.get(id);
  }
  function getGeneration() {
    return _allPostsGeneration;
  }

  // --- Load posts ---
  // keepLimit: background refreshes (fs-watch, bulk delete) re-read the library
  // without replaying the entrance animation or resetting the scroll window.
  // stampPost (sort-timestamp + post-key precompute) lives in records.ts.
  // Authoritative cache keyed by captureId. The renderer holds the full set and
  // main ships only deltas (listPostsDelta) — a post-capture refresh no longer
  // re-serializes all ~9k records over IPC. allPosts is rebuilt from this map;
  // its order is irrelevant since getFilteredPosts() always re-sorts.
  let _postsById = new Map<string, HologramPost>();
  let _haveBaseline = false; // false until we hold a full snapshot (also reset on reload = fresh module state)
  let _loadPostsInFlight = false;
  let _loadPostsPending = false;
  async function loadPosts(keepLimit?: boolean) {
    if (_loadPostsInFlight) {
      _loadPostsPending = true;
      return;
    }
    _loadPostsInFlight = true;
    try {
      const res = await listPostsDelta(_haveBaseline);
      if (!res || res.full) {
        _postsById = new Map();
        for (const p of (res && res.posts) || []) _postsById.set(p.captureId, stampPost(p));
      } else {
        for (const id of res.removed || []) _postsById.delete(id);
        for (const p of res.added || []) _postsById.set(p.captureId, stampPost(p));
      }
      _haveBaseline = true;
      // Mirrored into the store the moment the first real snapshot lands —
      // the single signal empty/EmptyState.tsx (via services/library-status.ts)
      // uses to tell 'still loading' apart from 'confirmed empty' (#682). posts
      // and posters share this cache, so one flag covers both grids.
      store.setState({ libraryLoaded: true });
      allPosts = [..._postsById.values()];
      markPostsMutated();
      stickyRecs.clear(); // on a screen refresh (reload), clean out the mutation-survivor entries
      if (deps.getBrowseMode() === 'posters') deps.renderPosters(keepLimit);
      else renderPosts(keepLimit);
      reconcileFolders();
      // The open image view re-derives live via services/image-tab.ts's
      // posts-data.ts subscription — the hook stays for orchestration-side effects.
      deps.onPostsLoaded();
    } finally {
      _loadPostsInFlight = false;
      if (_loadPostsPending) {
        _loadPostsPending = false;
        loadPosts(true); // background reload missed during in-flight — re-run once
      }
    }
  }
  function reconcileFolders() {
    if (!CF()) return;
    CF().reconcile(new Set(allPosts.map((p) => p.captureId)));
  }
  // Clear-all wipe: keep the delta cache in sync with the just-erased library.
  // Caller still calls markPostsMutated()/renderPosts() right after (unchanged
  // sequencing) — this only resets the raw cache the two would otherwise touch.
  function resetAll() {
    _postsById = new Map();
    allPosts = [];
  }

  // --- Grouping state (persisted via main: manual-groups.json / ungrouped.json) ---
  let manualGroups: string[][] = []; // [[captureId,…],…] — user-built groups (win over auto)
  let ungrouped = new Set<string>(); // post keys opted out of auto-grouping
  const stickyRecs = new Set<string>(); // captureIds kept visible after a mutation un-matches the filter
  // groupRecords (records.ts) is rebuilt here with the live manualGroups/ungrouped
  // closures — the poster view (viewer.ts, not yet extracted) reuses this SAME
  // instance for its own grouping (posterWorkGroups), via the returned reference.
  const groupRecords = makeGroupRecords({ manualGroups: () => manualGroups, ungrouped: () => ungrouped });
  function getManualGroups() {
    return manualGroups;
  }
  function setManualGroups(arr: string[][]) {
    manualGroups = arr;
  }
  function getUngrouped() {
    return ungrouped;
  }
  function setUngrouped(s: Set<string>) {
    ungrouped = s;
  }
  // Never reassigned (only .add/.delete/.clear'd) — a single reference handed out
  // once at construction stays live for callers that hold onto it (listing.ts).
  function getStickyRecs() {
    return stickyRecs;
  }

  let viewGroups: HologramPostGroup[] = []; // current render result: [{ key, records, rep, files }]
  function getViewGroups() {
    return viewGroups;
  }

  // Render-reuse guard: reused groups skip re-filter/re-group on a pure load-more
  // or in-place mutation. lastRenderedState is written by viewer.ts's
  // syncTitleAndPersist() (via setLastRenderedState) — it's the one piece of this
  // guard a not-yet-extracted cluster (tab title/persist/history) must update.
  let lastRenderedState: any = null;
  let _lastRenderGen = -1; // _allPostsGeneration at the last FULL grid build (fast card-grow guard)
  let _lastViewGroups: HologramPostGroup[] | null = null; // groups from the last FULL build, reused on a pure load-more (no re-filter/group)
  let _lastStickySize = 0; // stickyRecs.size at that build — part of the group-reuse signature
  let _lastSections: HologramDateSection[] | null = null; // #47 month sections from that same build — reused in lockstep with _lastViewGroups
  function setLastRenderedState(sig: string) {
    lastRenderedState = sig;
  }

  // Removal (delete/un-match) can un-match an active filter; keep the current set
  // sticky-visible through the mutation instead of yanking it off-screen.
  function keepCurrentVisible() {
    viewGroups.forEach((g) =>
      g.records.forEach((r) => {
        if (r.captureId) stickyRecs.add(r.captureId);
      }),
    );
  }

  // Per-image aspect ratio cache (captureId -> "W/H"), learned on image load and
  // persisted. Lets a card reserve the right height BEFORE its (lazy) image loads,
  // so masonry packs correctly the first time = no settle/jitter and no eager load.
  let imgAspect: Record<string, string> = {};
  try {
    imgAspect = JSON.parse(localStorage.getItem('hologram.imgAspect') || '{}') || {};
  } catch (_e) {}
  let _aspectT: any = null;
  function persistAspect() {
    clearTimeout(_aspectT);
    _aspectT = setTimeout(() => {
      try {
        localStorage.setItem('hologram.imgAspect', JSON.stringify(imgAspect));
      } catch (_e) {}
    }, 1000);
  }
  // Cards whose image has NO reserved height (no shotW/H in the index, no cached
  // aspect — rare: video poster / unreadable header) report their real aspect on
  // load; the cache reserves the height on the NEXT render.
  function onCardAspect(cap: string, ar: string) {
    if (imgAspect[cap] !== ar) {
      imgAspect[cap] = ar;
      persistAspect();
    }
  }

  // Resolve ONE group into a plain, fully-formatted card model: image src,
  // formatted counts/dates, selection, aspect — everything the markup
  // needs as primitives. The grid component renders it with the shared PostCard
  // component (live React cells via hologramPostGridSource). Selection is NOT
  // injected — the grid component's Cell derives .selected from hologramStore's
  // 'selectedSet'.
  const cardModel = makeCardModel({
    t: deps.t,
    formatCount,
    formatDate,
    compactDate,
    fileSrc: deps.fileSrc,
    smokeCapture: deps.smokeCapture,
    shape: () => deps.shape(),
    imgAspect: () => imgAspect,
    gridThumbW: deps.gridThumbW,
    listThumbW: deps.listThumbW,
    // Engagement counts and the capture date are library noise at rest, so they only
    // ride the model while a sort or a filter has made them the point. This used to be
    // a pair of classes on the grid container that CSS hid the markup with — every card
    // carried counts nobody could see.
    showEngagement: () => ['likes-desc', 'reposts-desc', 'replies-desc', 'likes-pct'].includes(deps.sortValue()) || deps.postShadow().some((f: { type: string }) => f.type === 'engagement'),
    showCaptured: () => deps.sortValue() === 'captured-desc' || deps.postShadow().some((f: { type: string; dateField?: string }) => f.type === 'date' && f.dateField === 'capturedAt'),
  });
  // modelOf/keyOf/onAspect never change identity meaningfully between
  // renders (only items/layout do, and those are hologramStore-derived by the
  // source itself) — configure once instead of rebuilding + pushing every renderPosts().
  hologramPostGridSource.configure({
    modelOf: (g, i) => cardModel(g, i),
    keyOf: (g) => postIdKey(g.rep),
    onAspect: onCardAspect,
  });

  // inPlace (was keepLimit — the renderLimit it kept is gone with the windowed
  // legacy path): true = in-place mutation re-render — reuse the grouped set
  // when possible, keep sticky survivors, no entrance animation, and skip the
  // tab-title/persist sync.
  function renderPosts(inPlace?: boolean) {
    // View signature (filter/sort/search/view) — stable across this render, so
    // compute once and reuse for the sticky-drop and group-reuse checks.
    const stateSig = JSON.stringify(deps.snapshotState());
    // A genuine filter/search/sort change drops the sticky survivors (they only
    // outlive in-place mutations, not user-driven view changes).
    if (!inPlace && stickyRecs.size && lastRenderedState !== null && stateSig !== lastRenderedState) {
      stickyRecs.clear();
    }
    // Group the filtered records (auto by post URL + manual groups); each group
    // renders as ONE card. multiOnly now means "groups with more than one image".
    // Reuse the previous build's groups on an in-place re-render: re-filtering +
    // re-grouping ~9k records for a mutation that can't change the set was wasted
    // work. Safe only when the view signature, the data generation, AND the
    // sticky set are all unchanged — the only inputs to getFilteredPosts/
    // groupRecords (manual grouping bumps the generation via markPostsMutated).
    // Any mismatch falls through to a fresh build.
    const canReuseGroups = inPlace && _lastViewGroups !== null && lastRenderedState !== null && stateSig === lastRenderedState && _allPostsGeneration === _lastRenderGen && stickyRecs.size === _lastStickySize;
    let sections: HologramDateSection[] | null;
    if (canReuseGroups) {
      viewGroups = _lastViewGroups as HologramPostGroup[];
      sections = _lastSections; // same build → same buckets, no need to re-walk it
    } else {
      viewGroups = groupRecords(deps.getFilteredPosts());
      if (deps.multiOnly()) viewGroups = viewGroups.filter((g) => g.files.length > 1 || g.records.some((r) => stickyRecs.has(r.captureId)));
      sections = buildDateSections(viewGroups, deps.sortValue(), deps.t);
    }

    if (viewGroups.length === 0) {
      // pushing 'postGroups'=null (not just an empty array — see services/grid.ts's
      // computeModel) unmounts the grid component's cells SYNCHRONOUSLY (hologramStore.set's
      // notify loop is synchronous, and the component's subscriber flushSync's the unmount,
      // removing its own host div — same guarantee the old pushed render(null) call gave).
      // The EmptyState component derives 'firstRun'/'filtered' itself from this same key +
      // 'allPostsCount' + 'searchQuery' — one less push.
      // ONE notify pass for both keys — see the paired push below (#871).
      store.setState({ postGroups: null, postSections: null }); // #47: no rows, no month sections either
      // Nothing else to do here. The grid host unmounts itself on the null push, and
      // the empty state decides from the SAME store keys whether it has something to
      // say (empty/EmptyState.tsx) — both used to be shown and hidden from this
      // function by hand, against elements it found by id.
      if (!inPlace) deps.syncTitleAndPersist(); // the zero-result state syncs the title/persistence too
      return;
    }

    // THE GRID — fully React-owned (grid component via hologramPostGridSource):
    // masonic windowing + live cell rendering for both layouts. This module keeps the
    // data pipeline (viewGroups above) and nothing else about the container: layout
    // (shape/columnWidth/rowGutter/itemHeightEstimate/…) is not pushed — the source
    // derives it from the display axes and hologramStore's 'gridSize'/'listThumb' —
    // and modelOf/keyOf/onAspect were configured once, above. Pushing the SAME array
    // reference (in-place reuse) is a no-op via the store's identity guard,
    // matching the old itemsKey-doesn't-bump behavior.
    // Both keys in ONE notify pass (#871). The sections index INTO viewGroups, so
    // pushing them separately gives every subscriber a torn intermediate state —
    // new items measured against the previous build's section ranges, which is
    // what corrupted masonic's position cache and crashed the grid.
    store.setState({ postGroups: viewGroups, postSections: sections }); // #47 — sections is null when the sort has no date axis
    _lastRenderGen = _allPostsGeneration; // mark the generation of this build
    _lastViewGroups = viewGroups;
    _lastSections = sections;
    _lastStickySize = stickyRecs.size; // snapshot for in-place group reuse
    if (!inPlace) deps.syncTitleAndPersist(); // keep the tab title + persistence in sync
  }

  // Folder picker flyout (destinations) — React-owned glass menu (menu.ts);
  // viewer owns the items + actions. A folder row toggles membership and CLOSES (the old
  // foldMenu hid after each toggle — preserved). Opened from the card menu and the bulk
  // "Add to folder" button.
  function foldMenuItems(g: HologramPostGroup) {
    const list = CF() ? CF().staticFolders() : []; // destinations only — a saved search holds no posts
    const rep = g.rep.captureId;
    // Nested folders are labelled by their path (#41): out here, away from the tree,
    // two subfolders called "Materials" are indistinguishable by name. The checkmark
    // answers "is it in THIS folder", never "somewhere below it" — you drop a post
    // into one folder, not into a subtree.
    const items = list.map((f) => ({ label: CF().pathOf(f.id), act: 'fold', fid: f.id, checked: CF().has(f.id, rep) })) as HologramMenuItem[];
    return items;
  }
  function onFoldMenuPick(g: HologramPostGroup, item: HologramMenuItem) {
    if (!CF()) return;
    if (item.act === 'fold') {
      keepCurrentVisible();
      CF().toggleIn(
        item.fid,
        g.records.map((r2) => r2.captureId),
        g.rep.captureId,
      );
      // re-render only if a collection filter could change the visible set
      if (deps.postShadow().some((f: { type: string }) => f.type === 'folder')) renderPosts(true);
    }
  }
  // `at` is the cursor for the card menu's folder row and the clicked button for the
  // selection bar's — see HologramMenuAnchor. Passed straight through; no arithmetic.
  function showFoldMenu(g: HologramPostGroup, at: HologramMenuAnchor) {
    if (!CF()) return;
    menuOpen({ items: foldMenuItems(g), ...at }, (item) => onFoldMenuPick(g, item));
  }

  // --- Card context menu: the labeled table of contents of per-card actions.
  // Hover keeps the rapid-fire buttons (ℹ info / 🏷 tag);
  // everything else (open, folder, poster, delete) lives here.
  const CM_IC = {
    open: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="7.6" x2="12" y2="7.7"/></svg>',
    del: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    sauce: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    poster: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    newtab: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/><path d="M12 12.5v4M10 14.5h4"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>',
    reveal: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M9 13.5h6"/><path d="m12.8 11 2.5 2.5-2.5 2.5"/></svg>',
    tag: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  };
  // Card context menu — React-owned glass menu (menu.ts); viewer owns
  // items + actions. 'folder' opens the folder picker (a DIFFERENT menu) at the same
  // spot; the bridge's transition guard keeps that open instead of closing it.
  function cardMenuItems(g: HologramPostGroup, selText = '') {
    // SNS posts have a poster in the poster view (buildUsers skips url-less migrations).
    // #23 St1: userKey(g.rep) is the post's own raw key; resolve() finds it under
    // a merged group's primary too.
    const canPoster = !!(g.rep.url && deps.buildUsers().some((u) => u.key === deps.resolve(userKey(g.rep))));
    const srcUrl = (g.records.flatMap((r) => (Array.isArray(r.media) ? r.media : [])).find((m: { url?: string }) => m && m.url) || {}).url || '';
    const items: any[] = [];
    // Text rows lead when the right-click landed inside a selection — the gesture
    // was aimed at the text, and that is the order Chromium uses. Without a
    // selection the menu is byte-for-byte the one it has always been (#167).
    if (selText) items.push(...deps.selectionMenu.items(), { sep: true });
    if (g.rep.url) items.push({ label: deps.t('tipOpen'), act: 'open', icon: CM_IC.open });
    items.push({ label: deps.t('ctxOpenNewTab'), act: 'newtab', icon: CM_IC.newtab });
    items.push({ label: deps.t('ctxPin'), act: 'pin', icon: CM_IC.pin });
    items.push({ label: deps.t('tipFolder'), act: 'folder', icon: CM_IC.folder });
    items.push({ label: deps.t('tipInfo'), act: 'info', icon: CM_IC.info });
    // "Edit tags" is the card's route into tagging since the hover 🏷 (and the popover it
    // opened) went away in P2⑦ — it opens the inspector with the caret in the tag field.
    items.push({ label: deps.t('ctxEditTags'), act: 'tags', icon: CM_IC.tag });
    if (canPoster) items.push({ label: deps.t('ctxViewPoster'), act: 'poster', icon: CM_IC.poster });
    // The file the card is showing right now (capture or artwork per density).
    const cardFile = densityImage(g.rep) || g.rep.image || '';
    // #236: a collected item (assetClass:'file') has no cardFile above (image/
    // video are both null on those rows) — its own file is the thing to reveal
    // or open instead. Never both at once: buildLocalRecord never fills image
    // and file on the same record.
    const collectedFile = g.rep.assetClass === 'file' ? g.rep.file || '' : '';
    if (srcUrl || cardFile || collectedFile) items.push({ sep: true });
    if (srcUrl) {
      items.push({ label: deps.t('detailSauce'), act: 'sauce', icon: CM_IC.sauce });
      items.push({ label: deps.t('detailAscii'), act: 'ascii', icon: CM_IC.sauce });
    }
    // Only ever the ONE image the card is showing — the clipboard holds a single
    // bitmap, and dragging out is the path for a whole multi-image group (#132).
    if (cardFile) items.push({ label: deps.t('ctxCopyImage'), act: 'copyImage', icon: CM_IC.copy });
    if (cardFile) items.push({ label: deps.t('ctxShowInFolder'), act: 'reveal', icon: CM_IC.reveal });
    // #236 §3: the label previews the allowlist's extension-only half so the
    // button never promises more than main will actually do (the FULL check —
    // extension + magic bytes — runs again at click time in lib-open-gate.ts;
    // a mismatch there just silently reveals-in-folder instead of opening,
    // never opens something the label said wouldn't).
    if (collectedFile) items.push({ label: extensionAllowed(collectedFile) ? deps.t('ctxOpenFile') : deps.t('ctxOpenFileInFolder'), act: 'openFile', icon: CM_IC.reveal });
    items.push({ sep: true });
    items.push({ label: deps.t('tipDelete'), act: 'delete', icon: CM_IC.del, danger: true });
    return { items, srcUrl };
  }
  function onCardMenuPick(g: HologramPostGroup, x: number, y: number, srcUrl: string, item: HologramMenuItem, selText = '') {
    if (deps.selectionMenu.pick(selText, item)) return; // a spliced-in text row (#167)
    const act = item.act;
    if (act === 'open') {
      if (g.rep.url) hologramIpc.openExternal(g.rep.url);
    } else if (act === 'newtab') {
      deps.addImageTab(g); // background, browser-like
    } else if (act === 'pin') {
      // #79 導線①「複数選択対応」: dragFilesOf と同じ規則 — 右クリックした
      // カードが現在の選択に含まれていれば選択全体を、そうでなければこの
      // カード単体を送る。
      const selected = selection.selectedGroups(viewGroups, postIdKey);
      const grabbed = selected.some((s) => s.key === g.key);
      const pins = pinItemsOfGroups(grabbed && selected.length > 1 ? selected : [g]);
      if (pins.length) hologramIpc.pinSend(pins);
    } else if (act === 'folder') {
      showFoldMenu(g, { x, y });
      return;
    } // opens the folder picker (bridge keeps it open)
    else if (act === 'info') deps.showDetail(g);
    else if (act === 'tags') deps.showDetail(g, { focusTags: true });
    else if (act === 'poster') deps.jumpToPoster(g.rep);
    else if (act === 'sauce') hologramIpc.openExternal('https://saucenao.com/search.php?url=' + encodeURIComponent(srcUrl));
    else if (act === 'ascii') hologramIpc.openExternal('https://ascii2d.net/search/url/' + encodeURIComponent(srcUrl));
    else if (act === 'reveal') {
      const file = densityImage(g.rep) || g.rep.image;
      if (file && hologramIpc.showInFolder) hologramIpc.showInFolder(file);
    } else if (act === 'openFile') {
      // #236: the label already previewed the extension-only half; main
      // re-checks the full allowlist (+ magic bytes) at THIS moment and opens
      // or reveals-in-folder accordingly — see lib-open-gate.ts.
      if (g.rep.file) hologramIpc.openPostFile(g.rep.file);
    } else if (act === 'copyImage') copyGroupImage(g);
    else if (act === 'delete') requestDeleteGroup(g);
  }

  // Copy the card's image to the clipboard — context menu, and Ctrl+C on a single
  // selection (#132). The file is picked exactly like 'reveal' picks it: whatever
  // this density is actually showing.
  async function copyGroupImage(g: HologramPostGroup) {
    const file = densityImage(g.rep) || g.rep.image;
    if (!file) return;
    // false = main couldn't decode it (svg, some tiff) and left the clipboard
    // alone; staying silent would read as "copied" over whatever was there.
    notify(deps.t((await hologramIpc.copyImage(file)) ? 'imageCopied' : 'imageCopyFailed'));
  }

  // Drag cards out to another app (#132). The browser's own drag must be cancelled
  // — it would carry the asset:// thumbnail URL — so main can start an OS drag of
  // the ORIGINAL files instead. Registration is the #postGrid dragstart delegate in
  // orchestrator.ts, like every other card gesture.
  function handleCardDragStart(g: HologramPostGroup, e: DragEvent) {
    const t = e.target;
    // Text and any other non-media part of a card keep the browser's own drag.
    if (!(t instanceof Element) || !t.closest('[data-slot="post-card-media"]')) return;
    e.preventDefault();
    // Which files leave is records.ts's rule (pure — see test-records-unit). The
    // selection is only READ: a drag leaves the library exactly as it found it.
    const files = dragFilesOf(g, selection.selectedGroups(viewGroups, postIdKey));
    if (files.length) hologramIpc.dragOut(files);
  }
  function showCardMenu(g: HologramPostGroup, x: number, y: number, selText = '') {
    const { items, srcUrl } = cardMenuItems(g, selText);
    menuOpen({ items, x, y }, (item) => onCardMenuPick(g, x, y, srcUrl, item, selText));
  }

  function requestDeleteGroup(g: HologramPostGroup) {
    if (getSkipDeleteConfirm()) {
      executeDeleteGroup(g);
      return;
    }
    confirmOpen({
      message: g.records.length > 1 ? deps.t('confirmDeleteGroup', [g.records.length]) : deps.t('confirmDeletePost'),
      okLabel: deps.t('confirmOk'),
      cancelLabel: deps.t('confirmCancel'),
      skipLabel: deps.t('confirmSkip'), // "don't confirm next time"
      onOk: async ({ skip }) => {
        if (skip) setSkipDeleteConfirm(true);
        await executeDeleteGroup(g);
      },
    });
  }

  // Destroying the whole library requires typing the keyword (t('deleteKeyword')) to
  // enable the OK button — a stray click can't wipe everything. The confirm modal is
  // React-owned (confirm.ts / the confirm component); this just opens it with the keyword
  // gate + the wipe as its onOk. Was reached through the old shared bridge — the React
  // Danger section now imports the confirmClearAll live binding below directly.
  function confirmClearAll() {
    confirmOpen({
      message: deps.t('confirmClear'),
      description: deps.t('confirmClearDesc'),
      okLabel: deps.t('confirmOk'),
      cancelLabel: deps.t('confirmCancel'),
      keywordPlaceholder: deps.t('confirmKeywordPh'),
      keywordRequired: deps.t('deleteKeyword'), // OK stays disabled until this is typed
      onOk: async () => {
        // Clear all data (deletes every image + sidecar in the save folder).
        const res = await clearAll();
        // Main refuses the wipe if config is degraded — keep the library on screen and
        // tell the user to restart (initSaveFolderRedundancy repairs on launch).
        if (res && res.blocked) {
          notify(deps.t('clearBlocked'));
          return;
        }
        resetAll(); // keep the delta cache in sync with the wipe
        markPostsMutated(); // drop stale tag/author/instance facets left over from the wipe
        renderPosts();
        notify(deps.t('cleared'));
      },
    });
  }

  // Delete every record of the group (a group IS one post in the UI).
  // Nothing here has to think about the inspector any more (#633): it used to dismiss the
  // panel itself when the inspected post was among the records, which left every OTHER way
  // a record can vanish (the floating bar's bulk delete, the wipe, an import replace) free to
  // strand it. inspector-builder.ts watches posts-data.ts for disappearance instead — one
  // answer for all of them, reached through the markPostsMutated() below.
  async function executeDeleteGroup(g: HologramPostGroup) {
    for (const r of g.records) {
      try {
        await deletePost(r.image || r.video || r.file); // #236: r.file is a collected item's IPC identifier
      } catch {
        /* keep going */
      }
      _postsById.delete(r.captureId); // optimistic removal from the delta cache
    }
    allPosts = [..._postsById.values()]; // rebuild once (O(N), not O(records×N) findIndex+splice); order is irrelevant — getFilteredPosts re-sorts
    markPostsMutated(); // a deleted author/instance must drop out of the sidebar
    renderPosts(true);
    reconcileFolders(); // immediately sweep the deleted captureId out of folders
    trashRefresh(); // the nav's Trash badge counts what just landed there (#268)
    notify(deps.t('deleted'));
  }

  return {
    // Handed out so the Trash grid (#268) can draw the SAME card, so a deleted post
    // is recognizable as the post it was.
    cardModel,
    loadPosts,
    renderPosts,
    getAllPosts,
    getPostsById,
    getPostById,
    getGeneration,
    getViewGroups,
    markPostsMutated,
    reconcileFolders,
    resetAll,
    keepCurrentVisible,
    getManualGroups,
    setManualGroups,
    getUngrouped,
    setUngrouped,
    getStickyRecs,
    setLastRenderedState,
    groupRecords,
    showFoldMenu,
    showCardMenu,
    handleCardDragStart,
    copyGroupImage,
    requestDeleteGroup,
    confirmClearAll,
    getSkipDeleteConfirm,
    setSkipDeleteConfirm,
    restoreSkipDeleteConfirm,
  };
}

// loadPosts/confirmClearAll/getSkipDeleteConfirm/setSkipDeleteConfirm are bound
// once at boot (viewer.ts, right after constructing postGrid) so the settings
// component (Danger.tsx/Data.tsx) can reach them directly — no shared-bridge
// detour.
export let loadPosts: ((keepLimit?: boolean) => Promise<void>) | null = null;
export function bindLoadPosts(fn: (keepLimit?: boolean) => Promise<void>): void {
  loadPosts = fn;
}
export let confirmClearAll: (() => void) | null = null;
export function bindConfirmClearAll(fn: () => void): void {
  confirmClearAll = fn;
}
export let getSkipDeleteConfirm: (() => boolean) | null = null;
export function bindGetSkipDeleteConfirm(fn: () => boolean): void {
  getSkipDeleteConfirm = fn;
}
export let setSkipDeleteConfirm: ((v: boolean) => void) | null = null;
export function bindSetSkipDeleteConfirm(fn: (v: boolean) => void): void {
  setSkipDeleteConfirm = fn;
}
