// Shared renderer state — the one place both the React components and the
// imperative service layer (orchestrator.ts and the *-builder.ts modules) read
// and write the state they have in common.
//
// A Zustand vanilla store (#1054). It was a hand-written key-addressed
// `Record<string, any>` before, built when viewer.js (vanilla) and React had to
// share one source of truth during the migration. That premise is gone — viewer.js
// was retired with #156 — but the SPLIT is not: half the writers here are plain
// modules, not components, so the state genuinely has to live outside React. That
// is what zustand/vanilla is for: `store.getState()` / `store.setState()` /
// `store.subscribe()` off the module, `useStore(store, selector)` inside it.
//
// What the hand-written version cost, and what the type below buys back:
//   - keys were free-form strings across 30 files. A typo read as `undefined`
//     and a component simply rendered its fallback, forever.
//   - every read restated the type AND the default —
//     `storeGet('gridSize') || 280` appeared in three files with the same magic
//     number. Initial values live here now, once, so a read is just `.gridSize`.
//   - `setMany` existed because two `set` calls fire two notify passes and a
//     subscriber to both keys saw a torn state between them (#871 — 'postGroups'
//     with the PREVIOUS build's 'postSections'). setState takes a partial and
//     notifies once, so that hazard is gone by construction rather than by
//     remembering to reach for the batching call.
//
// subscribeWithSelector is what keeps the per-key subscriptions the imperative
// layer relies on: `store.subscribe(s => s.postGroups, cb)` fires only when that
// slice actually changes, so a write that lands the same value costs the
// subscribers nothing.
import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';

/** What the content area is showing. normalizeBrowseMode (orchestrator.ts) is the gate. */
export type HologramBrowseMode = 'posts' | 'posters' | 'timeline' | 'trash';
/** The density axis shared by the post grid and the poster grid. */
export type HologramDensityLayout = 'grid' | 'list';

/** The image view's identity — the tab it belongs to, its records, and where in them we are. */
export interface HologramActiveImageTab {
  id: string;
  recs: string[];
  idx: number;
}

export interface HologramStoreState {
  // --- What is being browsed -------------------------------------------------
  browseMode: HologramBrowseMode;
  /** null = the image view is not up; the grid owns the content column. */
  activeImageTab: HologramActiveImageTab | null;
  /** The inspected card's key, or null for "nothing inspected". */
  inspectedKey: string | null;
  selectedSet: ReadonlySet<string>;
  searchQuery: string;

  // --- Tabs and navigation ---------------------------------------------------
  tabs: HologramTab[];
  activeTabId: string | null;
  navCanBack: boolean;
  navCanForward: boolean;

  // --- The active query ------------------------------------------------------
  // undefined until the query builder has published a tree at least once.
  postQueryTree: HologramQueryGroup | undefined;
  posterQueryTree: HologramQueryGroup | undefined;
  multiOnly: boolean;
  sortPost: string;
  sortPoster: string;
  /** Empty string = no shuffle in effect; a seed is minted when the sort turns 'random'. */
  shuffleSeed: string;

  // --- Built view models -----------------------------------------------------
  // postGroups distinguishes undefined from null ON PURPOSE and
  // services/library-status.ts is the reader that cares: undefined means
  // renderPosts() has never run (still loading — LibraryLoading covers it), null
  // means it ran and produced nothing (confirmed empty — EmptyState covers it).
  // Collapsing the two would show "your library is empty" during a load.
  postGroups: HologramPostGroup[] | null | undefined;
  /** #47: month section ranges INTO postGroups; null when the sort has no date axis. */
  postSections: HologramDateSection[] | null;
  /** No null sentinel here — always an array once renderPosters() has run at all. */
  posterGroups: HologramUserAgg[] | undefined;
  trashGroups: HologramPostGroup[] | null;

  // --- Display axes (mirrored from prefs at boot, then user-driven) -----------
  layout: HologramDensityLayout;
  squareThumbs: boolean;
  showInfo: boolean;
  showAvatar: boolean;
  gridSize: number;
  listThumb: number;
  posterLayout: HologramDensityLayout;
  posterShowInfo: boolean;
  posterGridSize: number;

  // --- Library status --------------------------------------------------------
  libraryLoaded: boolean;
  libraryMissing: boolean;
  libraryMissingPath: string | null;
  /** #71: has the extension ever talked to the native host? Seeded once at boot. */
  extensionContacted: boolean;
  allPostsCount: number;
  allUsersCount: number;
}

// The defaults the read sites used to carry inline. Two of them are load-bearing
// numbers rather than empty values: 280 (post card width) and 88 (list row
// thumbnail) were repeated at every reader, so a change had to find all of them.
const INITIAL: HologramStoreState = {
  browseMode: 'posts',
  activeImageTab: null,
  inspectedKey: null,
  selectedSet: new Set<string>(),
  searchQuery: '',

  tabs: [],
  activeTabId: null,
  navCanBack: false,
  navCanForward: false,

  postQueryTree: undefined,
  posterQueryTree: undefined,
  multiOnly: false,
  sortPost: 'date-desc',
  sortPoster: 'count',
  shuffleSeed: '',

  postGroups: undefined,
  postSections: null,
  posterGroups: undefined,
  trashGroups: null,

  layout: 'grid',
  squareThumbs: false,
  showInfo: true,
  showAvatar: true,
  gridSize: 280,
  listThumb: 88,
  posterLayout: 'grid',
  posterShowInfo: true,
  posterGridSize: 200,

  libraryLoaded: false,
  libraryMissing: false,
  libraryMissingPath: null,
  extensionContacted: false,
  allPostsCount: 0,
  allUsersCount: 0,
};

export const store = createStore<HologramStoreState>()(subscribeWithSelector(() => INITIAL));

/**
 * Subscribe to one key. The thin wrapper exists because the imperative layer
 * subscribes by NAME (often looping over a list of keys), which reads worse as a
 * selector at every call site.
 */
export function subscribeKey<K extends keyof HologramStoreState>(key: K, cb: () => void): HologramUnsubscribe {
  return store.subscribe((s) => s[key], cb);
}

/**
 * Subscribe to several keys with one callback — **fires at most once per write**,
 * however many of the keys that write moved. The imperative modules that rebuild a
 * whole view model out of a dozen inputs (services/grid.ts, services/tabs.ts) are
 * the callers.
 *
 * ONE subscription over a tuple of the keys, not one per key: n separate
 * subscriptions would call the callback n times for a write that touches n of them,
 * which is #871 again from the other side — the reader would rebuild the model once
 * per key and hand out the intermediate results. (Caught by store-batch.test.ts
 * while #1054 was being written, with exactly the doubled counts it asserts.)
 */
export function subscribeKeys(keys: readonly (keyof HologramStoreState)[], cb: () => void): HologramUnsubscribe {
  return store.subscribe((s) => keys.map((k) => s[k]), cb, { equalityFn: shallow });
}
