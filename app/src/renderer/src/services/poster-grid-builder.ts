// Poster-view grid/filter/inspector/folder builder — extracted from the old
// viewer.ts monolith. Mirrors post-grid-builder.ts: the poster grid's cell model
// + render pipeline, the poster-folder CRUD (the poster-view named-folder
// store), the poster inspector (recent works + tag/folder editing), and the
// poster context menu all move here.
// The size-axis state (posterSizeState/posterGridMetrics) lives in
// grid-density-builder.ts alongside the post grid's; the display axes themselves
// (posterLayout / posterShowInfo, #630) live in services/display.ts.
// postQB/posterQB instance construction and the qf-pop/filter-popover bridge
// wiring also stay call-site-owned in viewer.ts; this module only takes their
// already-built instances' methods as deferred-arrow deps (posterQB is constructed
// AFTER this builder — it needs pfStore/posterFolderById from here — so every
// posterQB reference below is wrapped, the same "wrapper only runs at call time"
// pattern used throughout this decomposition).
import { treeLeaves, userKey } from './query.ts';
import { hologramIpc } from './ipc.ts';
import { posterProfileUrl } from './profile-url.ts';
import { formatCount, localeDate } from './format.ts';
import { open as inspectorOpen, refresh as inspectorRefresh } from './inspector.ts';
import { setOpen as panelSetOpen } from './inspector-panel.ts';
import { open as lightboxOpen } from './lightbox.ts';
import { open as menuOpen } from './menu.ts';
import { promptName } from '../prompt/Prompt.tsx';
import { captureFile } from './records.ts';
import { setPosterTags } from './tags.ts';
import { hologramPosterGridSource } from './grid.ts';
import * as folders from './folders.ts';
import { set as storeSet } from './store.ts';
import type { UndoChange } from './undo.ts';
import type { NotifyAction } from './ui.ts';

export interface PosterGridBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  PF_NAME: Record<string, string>;
  fileSrc(file: string, w?: number): string;
  showToast(msg: unknown, action?: NotifyAction | null): void;
  pushUndo(changes: readonly UndoChange[]): (() => void) | null;
  undoAction(undoFn: (() => void) | null): NotifyAction | null;
  showKindMenu(tag: string, x: number, y: number, onChange: () => void): void;
  buildGroupGalleryItems(g: HologramPostGroup): any[];
  posterTagsOf(key: string): string[];
  posterFilterVocab(): string[];
  inspectorTagPickerData(tags: string[], recordsForSource: any[], kind: string): any;
  filteredPosters(): HologramUserAgg[];
  buildUsers(): HologramUserAgg[];
  getAllPosts(): HologramPost[];
  groupRecords(posts: HologramPost[]): HologramPostGroup[];
  // posterQB (query-builder.ts's makePosterQueryBuilder instance) is constructed
  // AFTER this builder (it needs folderById/pfStore from here) — every method is a
  // deferred arrow at the viewer.ts call site.
  posterQBGetTree(): HologramQueryGroup;
  posterQBResetTree(): void;
  posterQBRemoveByLeaf(type: string, value: string): void;
  posterQBRemoveCondsMatching(pred: (c: HologramQueryLeaf) => boolean): boolean;
  posterQBSyncShadow(): void;
  postQBResetTree(): void;
  addFilter(filter: { type: string; [k: string]: any }): void;
  setSearchBoxValue(v: string): void;
  setBrowseMode(mode: string, opts?: { silent?: boolean }): void;
  closeDetail(): void;
  setInspectedKey(key: string | null): void;
  // Fresh poster render → tabs-builder records a 'posters' entry on the per-tab
  // history + persists (#144) — the poster-mode mirror of the post grid's
  // syncTitleAndPersist dep. Not called on keepLimit (in-place) refreshes.
  onPosterRendered(): void;
}

// Fallback-avatar tint (#107): a stable hue per poster so avatar-less cards stay
// distinguishable at a glance, the way GitHub / Google fallback avatars do. Hue only —
// the cell picks saturation and lightness, so light and dark each keep their own tonal
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
  let posterList: HologramUserAgg[] = [];
  function getPosterList() {
    return posterList;
  }
  let posterWorkGroups: any[] = []; // recent works shown in the poster inspector

  // --- Named poster folders (poster view) — { id, name, items:[posterKey] } ---
  // Reuses the shared folder-list store (folders.ts createPersistedFolderStore) so the
  // CRUD/id-minting/toggle/persist/load logic isn't reimplemented; only the
  // view-specific toast/re-render live here.
  const pfStore = folders.hologramPosterFolderStore();
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
    const undoFn = deps.pushUndo([{ kind: 'poster-folder-items', target: id, added: res.op === 'added' ? res.keys : [], removed: res.op === 'removed' ? res.keys : [] }]);
    deps.showToast(deps.t(res.op === 'removed' ? 'posterFolderRemoved' : 'posterFolderAdded', [f?.name ?? '']), deps.undoAction(undoFn));
    refreshPosterFolderViews();
    return res.op === 'added';
  }
  // What a poster-folder membership change has to touch besides the store — shared
  // with the undo path so a reverted membership updates the same surfaces.
  function refreshPosterFolderViews() {
    prunePosterTagFilters();
    if (treeLeaves(deps.posterQBGetTree()).some((c) => c.type === 'folder')) renderPosters(); // membership change may add/remove from the filtered grid
  }

  // Drop tag conditions from the poster query once no poster carries that tag any more
  // (the poster was deleted, or the tag edited off it) — otherwise the chip stays on the
  // bar filtering everything out. Named renderPosterFilterRows while the poster facet
  // column existed and this was its re-render hook; the column is gone (P3 #6) and the
  // prune is all that was ever left of it.
  function prunePosterTagFilters() {
    const present = new Set(deps.posterFilterVocab());
    if (deps.posterQBRemoveCondsMatching((c) => c.type === 'tag' && !present.has(c.value))) deps.posterQBSyncShadow();
  }

  // Poster query reset — the filter bar's リセット imports this live binding directly.
  function resetPosterFilters() {
    deps.posterQBResetTree();
    deps.setSearchBoxValue('');
    renderPosters();
  }

  function renderPosters(keepLimit?: boolean) {
    prunePosterTagFilters();
    posterList = deps.filteredPosters();
    // 件数とリセットはツールバーのフィルタバーが 'posterGroups'/'posterQueryTree'/
    // 'searchQuery' から自己派生する（下の hologramStore.set('posterGroups', …) を購読）。
    // Display: nothing here decides how a cell is drawn. The shape rides the masonic
    // model (services/grid.ts derives it from the poster display keys) and each cell
    // lays itself out from it — no density class on any container (#630).
    if (posterList.length === 0) {
      // allUsersCount feeds the EmptyState component's self-derived 'posterFirstRun'
      // vs 'filtered' choice (mirrors the post grid's allPostsCount). Only
      // computed here (buildUsers() is the generation-cached poster roll-up — the
      // OLD code only ever called it in this branch too, so this preserves the
      // same laziness, not a new cost).
      storeSet('allUsersCount', deps.buildUsers().length);
      storeSet('posterGroups', posterList); // [] — React renders an empty grid (no cards)
      if (!keepLimit) deps.onPosterRendered(); // 0件 state also records/persists (mirrors the post grid)
      return;
    }
    storeSet('posterGroups', posterList);
    if (!keepLimit) deps.onPosterRendered(); // per-tab history record + persist (#144 — posters entries ride the same stack)
  }

  // React owns the poster cells (virtualized — hologramPosterGridSource) and every
  // gesture on one (orchestrator.ts's configureActions); this module keeps posterList
  // and the count badge. The inspected
  // highlight is NOT part of this model — the component derives its own ring from
  // hologramStore's 'inspectedKey' (useSyncExternalStore), keyed off the raw
  // item's `.key`. modelOf/keyOf never change identity
  // meaningfully between renders, so they're configured ONCE (mirrors the post
  // source's cardModel hoist) instead of rebuilt every renderPosters().
  hologramPosterGridSource.configure({
    modelOf: (u: HologramUserAgg, i: number) => {
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
    keyOf: (u: HologramUserAgg, i: number) => (u && u.key != null ? 'p:' + u.key : i),
  });

  // Jump from a poster to its posts: posts mode + a single user filter for it.
  // We want ONLY this poster's posts, so drop every post filter carried over from
  // the prior posts view (tags/date/media/search/engagement) — not just a previous
  // user filter — otherwise unrelated leftover filters AND-narrow the result and
  // hide posts the user expects to see.
  function openPosterPosts(u: HologramUserAgg) {
    if (!u) return;
    deps.postQBResetTree();
    // (Same as resetAllFilters: the date / engagement inputs this blanked belonged to
    // the facet column, which is gone — P3 #6.)
    deps.setSearchBoxValue('');
    deps.setBrowseMode('posts');
    // The drill-in lands as a fresh 'posts' entry on the tab history (#144) — going
    // back to the poster grid is nav-back now (the old posterReturn bounce is gone).
    deps.addFilter({ type: 'user', value: u.key, label: u.displayName || u.screenName || u.key });
  }

  // Jump from a post to its poster (双方向ナビ: posts → posters): switch to the poster
  // view and open that poster's inspector. Only SNS posts have a poster in buildUsers()
  // (url-less Eagle migrations don't), so callers guard on existence before offering it.
  function jumpToPoster(p: HologramPost) {
    if (!p || !p.url) return;
    const u = deps.buildUsers().find((x) => x.key === userKey(p));
    if (!u) return;
    deps.setBrowseMode('posters'); // clears any stale detail, then we open the poster's
    showPosterDetail(u);
  }

  // --- Poster inspector tags (P2⑦: editing is the panel's own inline field) ---
  // Source of truth is posterTags[key] (NOT a post record),
  // persisted to poster-tags.json. Posters carry no source (pixiv/SNS) tags.
  function refreshPosterTagFields(key: string) {
    const tags = deps.posterTagsOf(key);
    // Picker data travels with the tags — see the same note in inspector-builder.ts.
    inspectorRefresh({ tags, ...deps.inspectorTagPickerData(tags, [], 'poster') });
  }
  function refreshPosterFolderFields(key: string) {
    inspectorRefresh({ folders: pfStore.all().map((f) => ({ id: f.id, name: f.name, on: posterFolderHas(f.id, key) })) });
  }
  // Tag-field labels — mirrors inspector-builder.ts's own tagLabels() (same strings,
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
      removeTag: deps.t('tagRemove'),
    };
  }
  // Apply a tag mutation to a poster, persist, and refresh the panel's tag fields.
  // Records the change on the shared undo stack (type 'poster-tags') so Ctrl+Z
  // works the same as for posts.
  function applyPosterTagChange(key: string, mutate: (prev: string[]) => string[] | null | undefined) {
    if (!key) return;
    const prev = deps.posterTagsOf(key);
    const next = mutate(prev.slice());
    if (!next) return;
    const changed = next.length !== prev.length || next.some((t, i) => t !== prev[i]);
    if (!changed) return;
    deps.pushUndo([{ kind: 'poster-tags', target: key, added: next.filter((tag) => !prev.includes(tag)), removed: prev.filter((tag) => !next.includes(tag)) }]);
    setPosterTags(key, next.length ? next : null);
    refreshPosterTagFields(key);
  }
  // opts.focusTags: see showDetail in inspector-builder.ts — the poster context
  // menu's タグを編集, replacing the poster card's own 🏷 button (P2⑦). Opening a
  // closed panel is that route's doing, and only that route's; see the note there.
  function showPosterDetail(u: HologramUserAgg, opts?: { focusTags?: boolean }) {
    if (!u) return;
    if (opts && opts.focusTags) panelSetOpen(true);
    const pfName = u.platform ? deps.PF_NAME[u.platform] || u.platform : '';
    const avatarSrc = u.avatarFile ? deps.fileSrc(u.avatarFile) : null;
    const name = u.displayName || (u.screenName ? '@' + u.screenName : '(unknown)');
    // Recent works: group this poster's posts (newest first) and preview the lead
    // image of each. Click → open that work in the gallery (over the inspector).
    posterWorkGroups = deps
      .groupRecords(deps.getAllPosts().filter((p: HologramPost) => userKey(p) === u.key))
      .sort((a: HologramPostGroup, b: HologramPostGroup) => String(b.rep.date || '').localeCompare(String(a.rep.date || '')))
      .slice(0, 6);
    const works = posterWorkGroups
      .map((g) => {
        const f = (g.files && g.files[0]) || captureFile(g.rep);
        return f ? { thumbSrc: deps.fileSrc(f, 200), onClick: () => lightboxOpen(deps.buildGroupGalleryItems(g)[0]) } : null;
      })
      .filter(Boolean);
    const tags = deps.posterTagsOf(u.key);
    const profileUrl = posterProfileUrl({ platform: u.platform, screenName: u.screenName, instance: u.instance });
    inspectorOpen({
      kind: 'poster',
      focusTags: !!(opts && opts.focusTags),
      avatarSrc,
      name,
      screenNameLabel: u.screenName ? '@' + u.screenName : '',
      platformLabel: pfName,
      postsLabel: formatCount(u.count),
      followersLabel: u.followers != null ? formatCount(u.followers) : '',
      joinedLabel: localeDate(u.authorCreatedAt),
      works,
      tags,
      // Inline tag editing (P2⑦) — same shape as the post inspector.
      ...deps.inspectorTagPickerData(tags, [], 'poster'),
      tagLabels: tagLabels(),
      onTagAdd: (tag: string) => applyPosterTagChange(u.key, (prev) => (prev.includes(tag) ? prev : [...prev, tag])),
      onTagRemove: (tag: string) => applyPosterTagChange(u.key, (prev) => prev.filter((t) => t !== tag)),
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
        openProfile: deps.t('detailOpenProfile'),
        tags: deps.t('ivPosterTags'),
        tagsEmpty: deps.t('tagsEmpty'),
        editTags: deps.t('tipEditTags'),
      },
      onClose: deps.closeDetail,
      onPosterPosts: () => openPosterPosts(u),
      onOpenProfile: profileUrl ? () => hologramIpc.openExternal(profileUrl) : null,
      onFolderToggle: (id: string) => {
        togglePosterFolderMember(id, u.key);
        refreshPosterFolderFields(u.key);
      },
      onFolderCreate: () => {
        promptName(deps.t('posterFolderRenamePrompt'), '', (name) => {
          const nf = createPosterFolder(name);
          if (nf) {
            togglePosterFolderMember(nf.id, u.key);
            showPosterDetail(u);
          }
        });
      },
      onTagContextMenu: (tag: string, x: number, y: number) => {
        deps.showKindMenu(tag, x, y, () => refreshPosterTagFields(u.key));
      },
    });
    // No poke at the panel's own `hidden` here (it used to force the element visible):
    // the shell derives that from state, so the write both fought React and contradicted
    // #243 — a poster card click would reveal a panel the user had closed, and leave it
    // revealed until the next render happened to disagree. Post cards never did this.
    deps.setInspectedKey('poster:' + u.key); // post + poster cards clear/set their ring reactively (hologramStore subscribe)
  }

  // Poster context menu (right-click a poster card): jump to その投稿者の投稿 + assign to
  // poster-folders (toggle, stays open). React-owned glass popup via
  // menu.ts; viewer owns the items + actions here.
  function posterMenuItems(u: HologramUserAgg) {
    const items = [{ label: deps.t('posterViewPosts'), act: 'posts' }, { label: deps.t('ctxEditTags'), act: 'tags' }, { sep: true }] as HologramMenuItem[];
    for (const f of pfStore.all()) {
      items.push({ label: f.name, act: 'folder', fid: f.id, checked: posterFolderHas(f.id, u.key) });
    }
    items.push({ label: deps.t('posterMenuNewFolder'), act: 'newfolder', manage: true });
    return items;
  }
  function onPosterMenuPick(u: HologramUserAgg, item: HologramMenuItem) {
    if (item.act === 'posts') {
      openPosterPosts(u);
      return;
    } // close
    if (item.act === 'tags') {
      showPosterDetail(u, { focusTags: true });
      return;
    } // close
    if (item.act === 'newfolder') {
      promptName(deps.t('posterFolderRenamePrompt'), '', (name) => {
        const nf = createPosterFolder(name);
        if (nf) togglePosterFolderMember(nf.id, u.key);
      });
      return; // close
    }
    if (item.act === 'folder') {
      togglePosterFolderMember(item.fid, u.key);
      return posterMenuItems(u); // keep open to assign more
    }
  }
  function showPosterMenu(u: HologramUserAgg, x: number, y: number) {
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
    refreshPosterFolderViews,
    prunePosterTagFilters,
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
