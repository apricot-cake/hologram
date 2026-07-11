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
import { open as menuOpen } from './menu.ts';
import { captureFile } from './records.ts';
import { setPosterTags } from './tags.ts';
import { corpusPosterGridSource } from './grid.ts';
import * as folders from './folders.ts';
import { set as storeSet } from './store.ts';

export interface PosterGridBuilderDeps {
  MSG: { [k: string]: any };
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
  // posterReturn (the poster whose posts a query reset should bounce back to) is a
  // viewer.ts `let` read by setBrowseMode/resetAllFilters' bounce check (neither
  // moved here) — openPosterPosts only ever WRITES it, via this setter.
  setPosterReturn(key: string | null): void;
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
    deps.showToast((res === 'removed' ? deps.MSG.posterFolderRemoved : deps.MSG.posterFolderAdded)(f?.name ?? ''));
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

  // Poster query reset — the activebar island's #posterResetBtn calls this directly via
  // window.corpusViewer.resetPosterFilters (P4-B slice⑱).
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
  }

  // React owns the poster cells (virtualized — corpusPosterGridSource,
  // P4-B slice⑫); viewer.js keeps posterList, the count badge, the density
  // classes, and #posterGrid's click/contextmenu delegation. The inspected
  // highlight is NOT part of this model — the island derives its own ring from
  // corpusStore's 'inspectedKey' (useSyncExternalStore), keyed off the raw
  // item's `.key`. modelOf/keyOf/tagTitle/infoTitle never change identity
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
        name: hasName ? u.displayName : u.screenName ? '@' + u.screenName : '(unknown)',
        handle: hasName && u.screenName ? u.screenName : null,
        platform: u.platform || null,
        pfName: u.platform ? deps.PF_NAME[u.platform] || u.platform : null,
        countLabel: deps.MSG.posterPosts(formatCount(u.count)),
      };
    },
    keyOf: (u: CorpusUserAgg, i: number) => (u && u.key != null ? 'p:' + u.key : i),
    tagTitle: deps.MSG.tipTagEdit,
    infoTitle: deps.MSG.tipInfo,
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
    deps.addFilter({ type: 'user', value: u.key, label: u.displayName || u.screenName || u.key });
    deps.setPosterReturn(u.key); // set LAST (setBrowseMode clears it): reset returns to posters while this user filter is active
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

  // --- Poster inspector inline tag editor ---
  // Mirrors the post inspector's tag editor, but the source of truth is posterTags[key]
  // (NOT a post record), persisted to poster-tags.json. Posters carry no source (pixiv/
  // SNS) tags, so the picker is fed recordsForSource:[]. The UI shows whenever the
  // poster inspector is open (no tagging-edit gate — there is no poster tagging mode).
  function refreshPosterTagFields(key: string) {
    inspectorRefresh({ tags: deps.posterTagsOf(key), ...deps.inspectorTagPickerData(deps.posterTagsOf(key), [], 'poster') });
  }
  function refreshPosterFolderFields(key: string) {
    inspectorRefresh({ folders: pfStore.all().map((f) => ({ id: f.id, name: f.name, on: posterFolderHas(f.id, key) })) });
  }
  // Apply a tag mutation to a poster, persist, and refresh the inspector tag fields
  // (input keeps focus and the picker keeps its scroll — same openId, no remount).
  // Records the change on the shared undo stack (type 'poster-tags') so Ctrl+Z works
  // the same as for posts.
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
  }

  function showPosterDetail(u: CorpusUserAgg, opts?: { focusTag?: boolean }) {
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
        return f ? { thumbSrc: deps.fileSrc(f, 200), onClick: () => window.corpusLightbox.open(deps.buildGroupGalleryItems(g), 0) } : null;
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
      ...deps.inspectorTagPickerData(tags, [], 'poster'),
      folders: pfStore.all().map((f) => ({ id: f.id, name: f.name, on: posterFolderHas(f.id, u.key) })),
      autoFocusTag: !!(opts && opts.focusTag),
      labels: {
        user: deps.MSG.detailUser,
        platform: deps.MSG.detailPlatform,
        posts: deps.MSG.detailPosts,
        followers: deps.MSG.detailFollowers,
        joined: deps.MSG.detailJoined,
        posterFolders: deps.MSG.ivPosterFolders,
        newFolderPlaceholder: deps.MSG.posterFolderNewPlaceholder,
        posterViewPosts: deps.MSG.posterViewPosts,
      },
      tagLabels: {
        tagsLabel: deps.MSG.ivPosterTags,
        newTagPlaceholder: deps.MSG.tagNewName,
        addBtn: deps.MSG.tagAddBtn,
        noTags: deps.MSG.editNoTags,
        noMatch: deps.MSG.tagPalNoMatch,
        noVocab: deps.MSG.tagNoTags,
        adoptSource: deps.MSG.editAdoptSource,
      },
      onClose: deps.closeDetail,
      onPosterPosts: () => openPosterPosts(u),
      onFolderToggle: (id: string) => {
        togglePosterFolderMember(id, u.key);
        refreshPosterFolderFields(u.key);
      },
      onFolderCreate: () => {
        const name = window.prompt(deps.MSG.posterFolderRenamePrompt, '');
        if (name && name.trim()) {
          const nf = createPosterFolder(name);
          if (nf) {
            togglePosterFolderMember(nf.id, u.key);
            showPosterDetail(u);
          }
        }
      },
      onTagAdd: (tag: string) => applyPosterTagChange(u.key, (prev) => (prev.includes(tag) ? prev : [...prev, tag])),
      onTagRemove: (tag: string) => applyPosterTagChange(u.key, (prev) => prev.filter((t) => t !== tag)),
      onTagToggle: (tag: string) => applyPosterTagChange(u.key, (prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag])),
      onTagContextMenu: (tag: string, x: number, y: number) => {
        deps.showKindMenu(tag, x, y, () => refreshPosterTagFields(u.key));
      },
    });
    byId('postDetail').hidden = false;
    deps.setInspectedKey('poster:' + u.key); // post + poster cards clear/set their ring reactively (corpusStore subscribe)
  }

  // Poster context menu (right-click a poster card): jump to その投稿者の投稿 + assign to
  // poster-folders (toggle, stays open). React-owned glass popup via
  // menu.ts; viewer owns the items + actions here.
  function posterMenuItems(u: CorpusUserAgg) {
    const items = [{ label: deps.MSG.posterViewPosts, act: 'posts' }, { sep: true }] as CorpusMenuItem[];
    for (const f of pfStore.all()) {
      items.push({ label: f.name, act: 'folder', fid: f.id, checked: posterFolderHas(f.id, u.key) });
    }
    items.push({ label: deps.MSG.posterMenuNewFolder, act: 'newfolder', manage: true });
    return items;
  }
  function onPosterMenuPick(u: CorpusUserAgg, item: CorpusMenuItem) {
    if (item.act === 'posts') {
      openPosterPosts(u);
      return;
    } // close
    if (item.act === 'newfolder') {
      const name = window.prompt(deps.MSG.posterFolderRenamePrompt, '');
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
    showPosterMenu,
  };
}
