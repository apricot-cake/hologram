// Poster-view grid/filter/inspector/folder builder — extracted from viewer.ts as the
// viewer.ts decomposition's V6 slice (see memory corpus-react-purity-execution-map,
// Wave20/V6 "投稿者ビュー・グリッド・フィルタ・インスペクター・フォルダ"). Mirrors
// post-grid-builder.ts (V5): the poster grid's cell model + render pipeline, the
// poster-folder CRUD (the poster-view named-folder store), the poster inspector
// (recent works + tag/folder editing), and the poster context menu all move here.
// Density/tile-size slider state (posterView/posterTileSize/posterCardSize,
// posterSizeState/posterGridMetrics/refreshPosterSlider) stays in viewer.ts — V10
// (Wave24) unifies it with the post-grid density slider into one shared module.
// postQB/posterQB instance construction (V1) and the qf-pop/filter-popover bridge
// wiring (V4) also stay call-site-owned in viewer.ts; this module only takes their
// already-built instances' methods as deferred-arrow deps (posterQB is constructed
// AFTER this builder — it needs pfStore/posterFolderById from here — so every
// posterQB reference below is wrapped, the same "wrapper only runs at call time"
// pattern used throughout this decomposition).
import { treeLeaves, userKey } from './query.ts';
import { formatCount, localeDate } from './format.ts';
import { open as inspectorOpen, refresh as inspectorRefresh } from './inspector.ts';
import { open as tagPopOpen, refresh as tagPopRefresh, close as tagPopClose, get as tagPopGet } from './tag-pop.ts';
import { open as lightboxOpen } from './lightbox.ts';
import { open as menuOpen } from './menu.ts';
import { captureFile } from './records.ts';
import { setPosterTags } from './tags.ts';
import { corpusPosterGridSource } from './grid.ts';
import * as folders from './folders.ts';
import { set as storeSet } from './store.ts';

export interface PosterGridBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  PF_NAME: Record<string, string>;
  fileSrc(file: string, w?: number): string;
  showToast(msg: unknown): void;
  pushUndo(kind: string, records: any[]): void;
  showKindMenu(tag: string, x: number, y: number, onChange: () => void): void;
  buildGroupGalleryItems(g: CorpusPostGroup): any[];
  posterTagsOf(key: string): string[];
  posterFilterVocab(): string[];
  inspectorTagPickerData(tags: string[], recordsForSource: any[], kind: string): any;
  filteredPosters(): CorpusUserAgg[];
  buildUsers(): CorpusUserAgg[];
  getAllPosts(): CorpusPost[];
  groupRecords(posts: CorpusPost[]): CorpusPostGroup[];
  // posterQB (query-builder.ts's makePosterQueryBuilder instance) is constructed
  // AFTER this builder (it needs folderById/pfStore from here) — every method is a
  // deferred arrow at the viewer.ts call site.
  posterQBGetTree(): CorpusQueryGroup;
  posterQBResetTree(): void;
  posterQBRender(): void;
  posterQBRemoveByLeaf(type: string, value: string): void;
  posterQBRemoveCondsMatching(pred: (c: CorpusQueryLeaf) => boolean): boolean;
  posterQBSyncShadow(): void;
  postQBResetTree(): void;
  addFilter(filter: { type: string; [k: string]: any }): void;
  setSearchBoxValue(v: string): void;
  setBrowseMode(mode: string, opts?: { silent?: boolean }): void;
  closeDetail(): void;
  setInspectedKey(key: string | null): void;
  // Density state (posterView) and the tile-size slider (refreshPosterSlider) stay
  // viewer.ts-owned (V10/Wave24 territory) — renderPosters still needs to read/drive
  // them, same as the old code did before this extraction.
  posterView(): string;
  refreshPosterSlider(): void;
  syncBrowseBar(): void;
  // Fresh poster render → tabs-builder records a 'posters' entry on the per-tab
  // history + persists (#144) — the poster-mode mirror of the post grid's
  // syncTitleAndPersist dep. Not called on keepLimit (in-place) refreshes.
  onPosterRendered(): void;
}

// Fallback-avatar tint (#107): a stable hue per poster so avatar-less cards stay
// distinguishable at a glance, the way GitHub / Google fallback avatars do. Hue only —
// .poster-mono owns saturation and lightness, so light and dark each keep their own tonal
// range from one number. FNV-1a over the poster key (the identity the card is keyed by,
// unlike a display name it cannot change under us), so a poster's letter+color pairing is
// the same on every render and every restart.
function monoHue(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 360;
}

export function makePosterGridBuilder(deps: PosterGridBuilderDeps) {
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  const prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const GRID_ANIM_MS = 950; // mirrors post-grid-builder.ts's constant (kept in lockstep with that file's own copy — see its Wave19 note on the shared literal)

  let posterList: CorpusUserAgg[] = [];
  function getPosterList() {
    return posterList;
  }
  let posterWorkGroups: any[] = []; // recent works shown in the poster inspector
  let _posterAnimT: any = null;

  // --- Named poster folders (poster view) — { id, name, items:[posterKey] } ---
  // Reuses the shared folder-list store (folders.ts createPersistedFolderStore) so the
  // CRUD/id-minting/toggle/persist/load logic isn't reimplemented; only the
  // view-specific toast/re-render live here.
  const pfStore = folders.corpusPosterFolderStore();
  const posterFolderById = pfStore.byId;
  const posterFolderHas = pfStore.has;
  function createPosterFolder(name: string | null) {
    return pfStore.create(name);
  }
  function deletePosterFolder(id: string) {
    pfStore.remove(id);
    deps.posterQBRemoveByLeaf('folder', id); // drop the filter leaf if its folder is gone
  }
  function togglePosterFolderMember(id: string, key: string) {
    const res = pfStore.toggleIn(id, key);
    if (!res) return false;
    const f = posterFolderById(id);
    deps.showToast(deps.t(res === 'removed' ? 'posterFolderRemoved' : 'posterFolderAdded', [f?.name ?? '']));
    renderPosterFilterRows(); // folder badge count changed
    if (treeLeaves(deps.posterQBGetTree()).some((c) => c.type === 'folder')) renderPosters(); // membership change may add/remove from the filtered grid
    return res === 'added';
  }

  // The poster-mode filter-row model (#posterFilterRows: row labels, per-row active-leaf
  // badge counts, 作品/キャラ/タグ/サーバー progressive-disclosure visibility, which flyout
  // row wears .qf-open) is self-derived by renderer/sidebar.ts's
  // corpusPosterSidebarSource (P4-B slice⑰) — no viewer-side build+push.
  // Poster sidebar filter rows: prune tag selections that no longer have a backing value
  // (poster removed/edited). The rows are React-owned; this is the ONE remaining side
  // effect (the shadow prune) — badges/disclosure/openCat all self-derive from the store.
  function renderPosterFilterRows() {
    const present = new Set(deps.posterFilterVocab());
    if (deps.posterQBRemoveCondsMatching((c) => c.type === 'tag' && !present.has(c.value))) deps.posterQBSyncShadow();
  }

  // Poster query reset — the activebar island's #posterResetBtn calls this directly by
  // importing the resetPosterFilters live binding from viewer.ts (P4-B slice⑱).
  function resetPosterFilters() {
    deps.posterQBResetTree();
    deps.setSearchBoxValue('');
    renderPosters();
  }

  function renderPosters(keepLimit?: boolean) {
    const grid = byId('posterGrid');
    const empty = byId('emptyState');
    renderPosterFilterRows();
    deps.posterQBRender(); // draw the query bar (pills / groups) for the poster tree
    posterList = deps.filteredPosters();
    // 投稿者モードはクエリバー（postCount の常設先）を隠すので、件数はポスターコントロール
    // 側の #posterCount に出す（バー右端の件数と役割分担）。#posterCount + poster reset/empty
    // frame は activebar 島が 'posterGroups'/'posterQueryTree'/'searchQuery' から自己派生
    // する（P4-B slice⑱・下の corpusStore.set('posterGroups', …) を購読）。
    deps.syncBrowseBar(); // keep the ライブラリ/投稿者 toggle's glass thumb measured
    // Density: the classes style the CELLS (descendant selectors); the column
    // layout itself lives in the masonic model (pushPosterModel).
    grid.classList.toggle('tile-view', deps.posterView() === 'tile');
    grid.classList.toggle('list-view', deps.posterView() === 'list');
    // (The #posterDensityToggle glass thumb is positioned by the toolbar island, not here.)
    // Size slider: card + tile (auto-fill grids) have a size axis; list (full-width
    // stack) doesn't. The track maps to column counts so every step reflows.
    deps.refreshPosterSlider();
    if (posterList.length === 0) {
      empty.style.display = 'block';
      // allUsersCount feeds the EmptyState island's self-derived 'posterFirstRun'
      // vs 'filtered' choice (P4-B slice⑫ — mirrors slice⑩'s allPostsCount). Only
      // computed here (buildUsers() is the generation-cached poster roll-up — the
      // OLD code only ever called it in this branch too, so this preserves the
      // same laziness, not a new cost).
      storeSet('allUsersCount', deps.buildUsers().length);
      storeSet('posterGroups', posterList); // [] — React renders an empty grid (no cards)
      if (!keepLimit) deps.onPosterRendered(); // 0件 state also records/persists (mirrors the post grid)
      return;
    }
    empty.style.display = 'none';
    grid.classList.toggle('anim-in', !keepLimit && !prefersReducedMotion());
    storeSet('posterGroups', posterList);
    // With windowing, cells keep MOUNTING while the user scrolls — drop the
    // entrance class once the initial animation has played, or every late
    // cell would replay it mid-scroll (same wiring as the post grid).
    clearTimeout(_posterAnimT);
    if (grid.classList.contains('anim-in')) _posterAnimT = setTimeout(() => grid.classList.remove('anim-in'), GRID_ANIM_MS);
    if (!keepLimit) deps.onPosterRendered(); // per-tab history record + persist (#144 — posters entries ride the same stack)
  }

  // React owns the poster cells (virtualized — corpusPosterGridSource,
  // P4-B slice⑫); viewer.js keeps posterList, the count badge, the density
  // classes, and #posterGrid's click/contextmenu delegation. The inspected
  // highlight is NOT part of this model — the island derives its own ring from
  // corpusStore's 'inspectedKey' (useSyncExternalStore), keyed off the raw
  // item's `.key`. modelOf/keyOf/tagTitle never change identity
  // meaningfully between renders, so they're configured ONCE (mirrors the post
  // source's cardModel/cardLabels hoist) instead of rebuilt every renderPosters().
  corpusPosterGridSource.configure({
    modelOf: (u: CorpusUserAgg, i: number) => {
      const hasName = !!u.displayName;
      const s = (u.displayName || u.screenName || '').trim();
      return {
        index: i,
        avatarSrc: u.avatarFile ? deps.fileSrc(u.avatarFile) : null,
        monogram: u.avatarFile ? null : s ? s[0].toUpperCase() : '?',
        monoHue: u.avatarFile ? null : monoHue(u.key || s),
        name: hasName ? u.displayName : u.screenName ? '@' + u.screenName : '(unknown)',
        handle: hasName && u.screenName ? u.screenName : null,
        platform: u.platform || null,
        pfName: u.platform ? deps.PF_NAME[u.platform] || u.platform : null,
        countLabel: deps.t('posterPosts', [formatCount(u.count)]),
      };
    },
    keyOf: (u: CorpusUserAgg, i: number) => (u && u.key != null ? 'p:' + u.key : i),
    tagTitle: deps.t('tipTagEdit'),
  });

  // Jump from a poster to its posts: posts mode + a single user filter for it.
  // We want ONLY this poster's posts, so drop every post filter carried over from
  // the prior posts view (tags/date/media/search/engagement) — not just a previous
  // user filter — otherwise unrelated leftover filters AND-narrow the result and
  // hide posts the user expects to see.
  function openPosterPosts(u: CorpusUserAgg) {
    if (!u) return;
    deps.postQBResetTree();
    const set = (id: string, v: string) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.value = v;
    };
    deps.setSearchBoxValue('');
    set('sbDateFrom', '');
    set('sbDateTo', '');
    set('sbEngMin', '');
    deps.setBrowseMode('posts');
    // The drill-in lands as a fresh 'posts' entry on the tab history (#144) — going
    // back to the poster grid is nav-back now (the old posterReturn bounce is gone).
    deps.addFilter({ type: 'user', value: u.key, label: u.displayName || u.screenName || u.key });
  }

  // Jump from a post to its poster (双方向ナビ: posts → posters): switch to the poster
  // view and open that poster's inspector. Only SNS posts have a poster in buildUsers()
  // (url-less Eagle migrations don't), so callers guard on existence before offering it.
  function jumpToPoster(p: CorpusPost) {
    if (!p || !p.url) return;
    const u = deps.buildUsers().find((x) => x.key === userKey(p));
    if (!u) return;
    deps.setBrowseMode('posters'); // clears any stale detail, then we open the poster's
    showPosterDetail(u);
  }

  // --- Poster inspector tags (Issue #22: editing lives in tag-pop now, not the
  // inspector) --- Source of truth is posterTags[key] (NOT a post record),
  // persisted to poster-tags.json. Posters carry no source (pixiv/SNS) tags.
  function refreshPosterTagFields(key: string) {
    inspectorRefresh({ tags: deps.posterTagsOf(key) });
  }
  function refreshPosterFolderFields(key: string) {
    inspectorRefresh({ folders: pfStore.all().map((f) => ({ id: f.id, name: f.name, on: posterFolderHas(f.id, key) })) });
  }
  // Tag-pop labels — mirrors inspector-builder.ts's own tagLabels() (same strings,
  // duplicated rather than shared: two 7-line closures, not worth a module for).
  function tagLabels() {
    return {
      tagsLabel: deps.t('ivPosterTags'),
      newTagPlaceholder: deps.t('tagNewName'),
      addBtn: deps.t('tagAddBtn'),
      noTags: deps.t('editNoTags'),
      noMatch: deps.t('tagPalNoMatch'),
      noVocab: deps.t('tagNoTags'),
      adoptSource: deps.t('editAdoptSource'),
    };
  }
  // Apply a tag mutation to a poster, persist, and refresh whichever tag surfaces
  // are showing it: the inspector's read-only row, and — if tag-pop is open for
  // this SAME poster (tagPopGet().forKey match, same singleton-bridge reasoning as
  // inspector-builder.ts's refreshTagViews) — that pop's own model. Records the
  // change on the shared undo stack (type 'poster-tags') so Ctrl+Z works the same
  // as for posts.
  function applyPosterTagChange(key: string, mutate: (prev: string[]) => string[] | null | undefined) {
    if (!key) return;
    const prev = deps.posterTagsOf(key);
    const next = mutate(prev.slice());
    if (!next) return;
    const changed = next.length !== prev.length || next.some((t, i) => t !== prev[i]);
    if (!changed) return;
    deps.pushUndo('poster-tags', [{ key, prevTags: prev.slice(), newTags: next.slice() }]);
    setPosterTags(key, next.length ? next : null);
    refreshPosterTagFields(key);
    if (tagPopGet()?.forKey === 'poster:' + key) {
      const tags = deps.posterTagsOf(key);
      tagPopRefresh({ tags, ...deps.inspectorTagPickerData(tags, [], 'poster') });
    }
  }
  // Guarded by forKey (not called unconditionally) — same "stale close" guard as
  // inspector-builder.ts's dismissTagPopFor: openTagPopForGroup (post) may have
  // already superseded this pop via the same singleton bridge.
  function dismissTagPopForPoster(forKey: string) {
    if (tagPopGet()?.forKey !== forKey) return;
    tagPopClose();
    if (byId('postDetail').hidden) deps.setInspectedKey(null);
  }
  // Tag picker pop (Issue #22) opened straight from a poster card's 🏷 — mirrors
  // inspector-builder.ts's openTagPopForGroup, keyed by 'poster:'+key (matching
  // setInspectedKey's own format below) instead of a post group's key.
  function openTagPopForPoster(u: CorpusUserAgg, anchorRect: CorpusAnchorRect) {
    if (!u) return;
    const forKey = 'poster:' + u.key;
    if (tagPopGet()?.forKey === forKey) {
      dismissTagPopForPoster(forKey); // re-click the same poster's 🏷 → close (ℹ button's toggle shape)
      return;
    }
    deps.setInspectedKey(forKey);
    const tags = deps.posterTagsOf(u.key);
    tagPopOpen({
      anchorRect,
      mode: 'single',
      forKey,
      tags,
      ...deps.inspectorTagPickerData(tags, [], 'poster'),
      tagLabels: tagLabels(),
      onTagAdd: (tag: string) => applyPosterTagChange(u.key, (prev) => (prev.includes(tag) ? prev : [...prev, tag])),
      onTagRemove: (tag: string) => applyPosterTagChange(u.key, (prev) => prev.filter((t) => t !== tag)),
      onTagToggle: (tag: string) => applyPosterTagChange(u.key, (prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag])),
      onTagContextMenu: (tag: string, x: number, y: number) => {
        deps.showKindMenu(tag, x, y, () => refreshPosterTagFields(u.key));
      },
      onDismiss: () => dismissTagPopForPoster(forKey),
    });
  }

  function showPosterDetail(u: CorpusUserAgg) {
    if (!u) return;
    const pfName = u.platform ? deps.PF_NAME[u.platform] || u.platform : '';
    const avatarSrc = u.avatarFile ? deps.fileSrc(u.avatarFile) : null;
    const name = u.displayName || (u.screenName ? '@' + u.screenName : '(unknown)');
    // Recent works: group this poster's posts (newest first) and preview the lead
    // image of each. Click → open that work in the gallery (over the inspector).
    posterWorkGroups = deps
      .groupRecords(deps.getAllPosts().filter((p: CorpusPost) => userKey(p) === u.key))
      .sort((a: CorpusPostGroup, b: CorpusPostGroup) => String(b.rep.date || '').localeCompare(String(a.rep.date || '')))
      .slice(0, 6);
    const works = posterWorkGroups
      .map((g) => {
        const f = (g.files && g.files[0]) || captureFile(g.rep);
        return f ? { thumbSrc: deps.fileSrc(f, 200), onClick: () => lightboxOpen(deps.buildGroupGalleryItems(g), 0) } : null;
      })
      .filter(Boolean);
    const tags = deps.posterTagsOf(u.key);
    inspectorOpen({
      kind: 'poster',
      avatarSrc,
      name,
      screenNameLabel: u.screenName ? '@' + u.screenName : '',
      platformLabel: pfName,
      postsLabel: formatCount(u.count),
      followersLabel: u.followers != null ? formatCount(u.followers) : '',
      joinedLabel: localeDate(u.authorCreatedAt),
      works,
      tags,
      folders: pfStore.all().map((f) => ({ id: f.id, name: f.name, on: posterFolderHas(f.id, u.key) })),
      labels: {
        user: deps.t('detailUser'),
        platform: deps.t('detailPlatform'),
        posts: deps.t('detailPosts'),
        followers: deps.t('detailFollowers'),
        joined: deps.t('detailJoined'),
        posterFolders: deps.t('ivPosterFolders'),
        newFolderPlaceholder: deps.t('posterFolderNewPlaceholder'),
        posterViewPosts: deps.t('posterViewPosts'),
        tags: deps.t('ivPosterTags'),
        tagsEmpty: deps.t('tagsEmpty'),
        editTags: deps.t('tipEditTags'),
      },
      onClose: deps.closeDetail,
      onPosterPosts: () => openPosterPosts(u),
      onFolderToggle: (id: string) => {
        togglePosterFolderMember(id, u.key);
        refreshPosterFolderFields(u.key);
      },
      onFolderCreate: () => {
        const name = window.prompt(deps.t('posterFolderRenamePrompt'), '');
        if (name && name.trim()) {
          const nf = createPosterFolder(name);
          if (nf) {
            togglePosterFolderMember(nf.id, u.key);
            showPosterDetail(u);
          }
        }
      },
      onTagContextMenu: (tag: string, x: number, y: number) => {
        deps.showKindMenu(tag, x, y, () => refreshPosterTagFields(u.key));
      },
      onEditTags: (anchorRect: CorpusAnchorRect) => openTagPopForPoster(u, anchorRect),
    });
    byId('postDetail').hidden = false;
    deps.setInspectedKey('poster:' + u.key); // post + poster cards clear/set their ring reactively (corpusStore subscribe)
  }

  // Poster context menu (right-click a poster card): jump to その投稿者の投稿 + assign to
  // poster-folders (toggle, stays open). React-owned glass popup via
  // menu.ts; viewer owns the items + actions here.
  function posterMenuItems(u: CorpusUserAgg) {
    const items = [{ label: deps.t('posterViewPosts'), act: 'posts' }, { sep: true }] as CorpusMenuItem[];
    for (const f of pfStore.all()) {
      items.push({ label: f.name, act: 'folder', fid: f.id, checked: posterFolderHas(f.id, u.key) });
    }
    items.push({ label: deps.t('posterMenuNewFolder'), act: 'newfolder', manage: true });
    return items;
  }
  function onPosterMenuPick(u: CorpusUserAgg, item: CorpusMenuItem) {
    if (item.act === 'posts') {
      openPosterPosts(u);
      return;
    } // close
    if (item.act === 'newfolder') {
      const name = window.prompt(deps.t('posterFolderRenamePrompt'), '');
      if (name && name.trim()) {
        const nf = createPosterFolder(name);
        if (nf) togglePosterFolderMember(nf.id, u.key);
      }
      return; // close
    }
    if (item.act === 'folder') {
      togglePosterFolderMember(item.fid, u.key);
      return posterMenuItems(u); // keep open to assign more
    }
  }
  function showPosterMenu(u: CorpusUserAgg, x: number, y: number) {
    menuOpen({ items: posterMenuItems(u), x, y }, (item) => onPosterMenuPick(u, item));
  }

  return {
    getPosterList,
    pfStore,
    posterFolderById,
    posterFolderHas,
    createPosterFolder,
    deletePosterFolder,
    togglePosterFolderMember,
    renderPosterFilterRows,
    resetPosterFilters,
    renderPosters,
    openPosterPosts,
    jumpToPoster,
    refreshPosterTagFields,
    refreshPosterFolderFields,
    applyPosterTagChange,
    showPosterDetail,
    openTagPopForPoster,
    showPosterMenu,
  };
}
