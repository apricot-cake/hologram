// Value-flyout (qf-pop) row-model + pick-routing builder — extracted from
// viewer.ts as the viewer.ts decomposition's V4 slice (see memory
// corpus-react-purity-execution-map, Wave18/V4 "フィルタフライアウト・日付/エンゲージ
// ポップオーバー"). The glass popup itself (open/close/get/subscribe) already
// lives in qf-pop.ts (Wave4) — this module is the view-specific glue that used
// to live inline in viewer.ts: which category is open, building its row model
// (via facets.ts's qfValues, unchanged bespoke logic) and routing a pick to the
// right query-builder mutation. postQB/posterQB/pfStore/buildUsers are all
// still owned by viewer.ts and declared well after this wave's old call site,
// so they're injected as deps — same ctx pattern as query-builder.ts/
// kind-menu-builder.ts/search-box-builder.ts.
import * as folders from './folders.ts';
import { open as qfPopOpen, close as qfPopClose, get as qfPopGet } from './qf-pop.ts';

export interface QfPopDeps {
  qfValues(cat: string): CorpusQfPopItem[];
  kindLabel(kind: string): string;
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  pfStore: CorpusPersistedFolderStore;
  postShadow(): { type: string; value?: string }[];
  posterQHasValue(type: string, value: string): boolean;
  posterAddFilter(filter: { type: string; value: string }): void;
  posterRemoveByLeaf(type: string, value: string): void;
  addFilter(filter: { type: string; [k: string]: any }): void;
  removeFilter(index: number): void;
  buildUsers(): CorpusUserAgg[];
  storeSet(key: string, value: unknown): void;
  updateSidebarState(): void;
  renderPosterFilterRows(): void;
  renderPosters(): void;
}

export function makeQfPop(deps: QfPopDeps) {
  // 同じ行をもう一度押したら閉じる（トグル）
  let qfCat: string | null = null;
  let qfAnchor: HTMLElement | null = null;
  // Bumped only on a FRESH open (showQfPopAt), NOT on the re-render after a pick. The
  // island keys its root on this, so a value pick re-renders in place (preserving the
  // selected tag group + find text) while opening a different row remounts fresh.
  let qfSession = 0;

  function hideQfPop() {
    qfPopClose();
  }

  // The island may close itself (outside-click / Escape) without going through
  // hideQfPop() — this handler keeps the anchor highlight + bookkeeping in sync with
  // whoever closed it. React owns the subscribe() registration (StoreSubscriptions,
  // App.tsx), importing this function's live binding from viewer.ts directly; this
  // stays the guard + action logic (viewer keeps the orchestration, React owns the
  // wiring) — same "cut out and rewire" as the tab bar.
  function handleQfPopChange() {
    if (!qfPopGet()) {
      qfCat = null;
      qfAnchor = null;
      // Both columns own .qf-open through corpusStore's 'qfCat' now (renderer/sidebar.ts
      // derives openCat from it), so clearing the highlight is a store write, not an
      // imperative classList sweep or a model re-push.
      deps.storeSet('qfCat', null);
    }
  }

  // Push the current category's row model to the qf-pop bridge. Called on every open
  // AND after every pick (the bridge bumps openId each call, which keys the island's
  // root and remounts its find-input local state — matching the old rebuild-on-every-
  // change behavior, incl. the reset+refocus of the find box after a pick).
  function renderQfPop() {
    if (!qfCat) return;
    const cat = qfCat; // capture: hideQfPop() (called from onManage) clears qfCat
    const rawItems = deps.qfValues(cat);
    // 種別 dot (用語帳): a tag carrying it.kind ('work'/'character') wears the shared
    // category dot, so resolve its (possibly custom) label here — the island only draws.
    const items = rawItems.map((it) => (it.kind ? { ...it, dotTitle: deps.kindLabel(it.kind) } : it));
    // 長いリスト（タグ/作者など）はその場で絞り込める入力を付ける。Find box only for
    // genuinely long, open-ended lists (tags/authors). The platform list is short +
    // fixed (5 PFs + their instances), so no find box.
    const valueCount = items.filter((it) => it.ghead == null).length;
    const showFind = !['platform', 'poster-platform'].includes(cat) && valueCount > 8;
    // The フォルダ flyouts (library 'folder' + poster 'poster-folder') carry a
    // 「フォルダを管理」 footer that opens the shared folder-manager modal — the create/
    // rename/delete home now that folders live in a flyout, not a sidebar list.
    const showManage = cat === 'poster-folder' || cat === 'folder';
    qfPopOpen({
      anchorRect: (qfAnchor as HTMLElement).getBoundingClientRect(),
      sessionId: qfSession,
      items,
      showFind,
      allGroupLabel: deps.t('qfAllTags'),
      findPlaceholder: deps.t('qfFindPh'),
      searchModeTitle: deps.t('searchModeTitle'),
      exactLabel: deps.t('searchExact'),
      fuzzyLabel: deps.t('searchFuzzy'),
      exactHint: deps.t('searchHintExact'),
      fuzzyHint: deps.t('searchHintLoose'),
      footerLabel: showManage ? deps.t('ctxManage') : null,
      onManage: showManage
        ? () => {
            hideQfPop();
            if (cat === 'poster-folder') {
              // Poster folder store — refresh the poster sidebar/grid on change.
              folders.openManager({
                store: deps.pfStore,
                onChange: () => {
                  deps.renderPosterFilterRows();
                  deps.renderPosters();
                },
              });
            } else {
              // Library folder store (default) — its onChange runs the shared refresh below.
              folders.openManager();
            }
          }
        : null,
      onPick: (it: CorpusQfPopItem) => onQfPick(cat, it),
    });
  }

  // Route a value pick to the right business action, then refresh (the flyout stays
  // open so several values can be picked in a row).
  function onQfPick(cat: string, it: CorpusQfPopItem) {
    const v = it.v;
    // Poster flyouts toggle a top-level leaf in the poster query tree. 作品/キャラ/タグ
    // all map to one tag leaf type (種別 only scopes which the row offers).
    if (cat === 'poster-tag' || cat === 'poster-work' || cat === 'poster-character') {
      if (deps.posterQHasValue('tag', v)) deps.posterRemoveByLeaf('tag', v);
      else deps.posterAddFilter({ type: 'tag', value: v });
      renderQfPop();
      return;
    }
    if (cat === 'poster-platform') {
      if (deps.posterQHasValue('platform', v)) deps.posterRemoveByLeaf('platform', v);
      else deps.posterAddFilter({ type: 'platform', value: v });
      renderQfPop();
      return;
    }
    if (cat === 'poster-instance') {
      if (deps.posterQHasValue('instance', v)) deps.posterRemoveByLeaf('instance', v);
      else deps.posterAddFilter({ type: 'instance', value: v });
      renderQfPop();
      return;
    }
    if (cat === 'poster-folder') {
      // folder is single-valued (singleValueTypes): addFilter replaces any existing folder leaf.
      if (deps.posterQHasValue('folder', v)) deps.posterRemoveByLeaf('folder', v);
      else deps.posterAddFilter({ type: 'folder', value: v });
      renderQfPop();
      return;
    }
    const vtype = it.type || cat; // sub-rows (instances) override the type
    const i = deps.postShadow().findIndex((f) => f.type === vtype && f.value === v);
    if (i >= 0) {
      deps.removeFilter(i);
    } else if (vtype === 'tag' || vtype === 'hashtag') {
      deps.addFilter({ type: vtype, value: v });
    } else if (vtype === 'user') {
      const u = deps.buildUsers().find((x) => x.key === v);
      deps.addFilter({ type: 'user', value: v, label: u ? u.displayName || u.screenName : v });
    } else {
      deps.addFilter({ type: vtype, value: v });
    }
    deps.updateSidebarState();
    renderQfPop();
  }

  // 行の横にフライアウトを開く（同じアンカー再クリックで閉じる）
  function showQfPopAt(cat: string, anchorEl: HTMLElement) {
    // Re-clicking the open row toggles it closed (cat, not node identity — robust to the
    // island re-rendering the row on a badge change).
    if (qfPopGet() && qfCat === cat) {
      hideQfPop();
      return;
    }
    // .qf-open is derived from corpusStore's 'qfCat' on BOTH columns now (React owns each
    // container's className, so an imperative classList.add would be clobbered on the next
    // render; renderer/sidebar.ts's openCat picks post- vs poster-side by the cat's
    // 'poster-' prefix). A cat is post- or poster-side; the matching column lights its
    // row, the other clears — both re-derive from the single store write below.
    qfCat = cat;
    qfAnchor = anchorEl;
    qfSession++; // fresh open → island remounts (resets group/find); picks keep it
    deps.storeSet('qfCat', qfCat);
    renderQfPop();
  }

  return { showQfPopAt, hideQfPop, handleQfPopChange };
}
