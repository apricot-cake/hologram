import { refreshInspector, requestDetailOptions, type DetailOptions } from './inspector-controller.ts';
import { matchingPreviousName, previousNames } from './poster-names.ts';
import type { Translate } from './translation.ts';
import { userKey } from './query.ts';
import { hologramIpc } from './ipc.ts';
import { posterProfileUrl } from './profile-url.ts';
import { formatCount, localeDate } from './format.ts';
import { setOpen as panelSetOpen } from './inspector-panel.ts';
import { open as menuOpen } from './menu.ts';
import { monoHue } from './records.ts';
import { setPosterTags } from './tags.ts';
import { hologramPosterGridSource } from './grid.ts';
import { store } from './store.ts';
import { posterSortValue } from './poster-sort-value.ts';
import { posterAvatarThumbnailWidth } from './asset-src.ts';
import type { UndoChange } from './undo.ts';

export interface PosterGridBuilderDeps {
  t: Translate;
  PF_NAME: Record<string, string>;
  fileSrc(file: string, w?: number): string;
  pushUndo(changes: readonly UndoChange[]): (() => void) | null;
  showTagGroupMenu(tag: string, x: number, y: number, onChange: () => void, entityId?: number | null): void;
  openImageEntry(g: HologramPostGroup): void;
  showPostDetail(g: HologramPostGroup): void;
  posterTagsOf(key: string): string[];
  // #810: 投稿者フィルタが提示する実体の語彙＝名前ごとではなく tags テーブルの
  // 行ごとに1エントリ。
  posterFilterVocab(): HologramTagEntry[];
  inspectorTagPickerData(tags: string[], recordsForSource: any[], kind: string): any;
  filteredPosters(): HologramUserAgg[];
  buildUsers(): HologramUserAgg[];
  getAllPosts(): HologramPost[];
  groupRecords(posts: HologramPost[]): HologramPostGroup[];
  posterQBGetTree(): HologramQueryGroup;
  posterQBResetTree(): void;
  posterQBRemoveByLeaf(type: string, value: string): void;
  posterQBRemoveCondsMatching(pred: (c: HologramQueryLeaf) => boolean): boolean;
  posterQBSyncShadow(): void;
  postQBResetTree(): void;
  addFilter(filter: { type: string; [k: string]: any }): void;
  setSearchBoxValue(v: string): void;
  setBrowseMode(mode: string, opts?: { silent?: boolean }): void;
  // ポスターの再描画が新しく終わるたびに → tabs-builder がタブごとの履歴に
  // 'posters' エントリを記録し永続化する（#144）＝post グリッドの
  // syncTitleAndPersist dep のポスターモード版。keepLimit（その場での）
  // 更新では呼ばれない。
  onPosterRendered(): void;
  onPosterInspected(): void;
}

export function makePosterGridBuilder(deps: PosterGridBuilderDeps) {
  let posterList: HologramUserAgg[] = [];
  function getPosterList() {
    return posterList;
  }
  let posterWorkGroups: any[] = []; // ポスターインスペクタに表示する最近の作品

  // どの投稿者ももうそのタグを持たなくなったら（投稿者が削除された、または
  // タグを編集で外された）、ポスタークエリからタグ条件を落とす＝そうしないと、
  // チップがバーに残ったまま全部を除外してしまう。ポスターのファセット列が
  // あったころは renderPosterFilterRows という名前で、これがその再描画フック
  // だった。その列は無くなり（P3 #6）、この掃除だけが唯一残った部分。
  function prunePosterTagFilters() {
    // #810: 自分の実体を知っている葉は、実体の語彙に照らしてチェックする＝
    // 名前が他の投稿者に残っているタグでも、実体自体が無くなっていれば
    // チップを生かし続けてはいけない。id を持たない葉は名前によるチェックへ
    // フォールバックする。述語自身が使うのと同じ2段構えの照合。
    const vocab = deps.posterFilterVocab();
    const ids = new Set(vocab.map((e) => e.id).filter((id): id is number => id != null));
    const names = new Set(vocab.map((e) => e.name));
    if (deps.posterQBRemoveCondsMatching((c) => c.type === 'tag' && (c.tagId != null ? !ids.has(c.tagId) : !names.has(c.value)))) deps.posterQBSyncShadow();
  }

  // ポスタークエリのリセット＝絞り込みバーの「リセット」がこの生きた束縛を
  // 直接 import する。
  function resetPosterFilters() {
    deps.posterQBResetTree();
    deps.setSearchBoxValue('');
    renderPosters();
  }

  function renderPosters(keepLimit?: boolean) {
    prunePosterTagFilters();
    posterList = deps.filteredPosters();
    // 件数とリセットは、ツールバーの絞り込みバーが 'posterGroups'/
    // 'posterQueryTree'/'searchQuery' から自己導出する（下の
    // hologramStore.set('posterGroups', …) を購読している）。
    // 表示: ここではセルがどう描かれるかは何も決めない。形は masonic の
    // モデルに乗り（services/grid.ts がポスターの表示キーからそれを導出
    // する）、各セルはそこから自分でレイアウトする＝どのコンテナにも density
    // クラスは無い（#630）。
    if (posterList.length === 0) {
      // allUsersCount は EmptyState コンポーネントが自己導出する
      // 'posterFirstRun' と 'filtered' の判定に使う（post グリッドの
      // allPostsCount を鏡写しにしている）。ここでだけ計算する
      // （buildUsers() は世代でキャッシュされるポスター集計＝旧コードも
      // この分岐でしか呼んでいなかったので、これは同じ遅延評価を保つだけで
      // 新たなコストではない）。
      store.setState({ allUsersCount: deps.buildUsers().length });
      store.setState({ posterGroups: posterList }); // [] ＝React が空のグリッド（カード無し）を描画する
      if (!keepLimit) deps.onPosterRendered(); // 結果0件の状態でも記録・永続化する（post グリッドを鏡写しにしている）
      return;
    }
    store.setState({ posterGroups: posterList });
    if (!keepLimit) deps.onPosterRendered(); // タブごとの履歴記録＋永続化（#144＝posters のエントリも同じスタックに乗る）
  }

  // React がポスターのセル（仮想化＝hologramPosterGridSource）とその上の
  // すべてのジェスチャー（orchestrator.ts の configureActions）を持つ。
  // このモジュールが持つのは posterList と件数バッジ。検査中のハイライトは
  // このモデルの一部ではない＝コンポーネントは hologramStore の
  // 'inspectedKey'（useSyncExternalStore）から、生のアイテムの `.key` を
  // キーにして自分のリングを導出する。modelOf/keyOf は描画のたびに意味の
  // ある形で identity が変わることはないので、（post 側の source が
  // cardModel を巻き上げているのと同様に）renderPosters() のたびに作り直す
  // のではなく一度だけ設定する。
  hologramPosterGridSource.configure({
    modelOf: (u: HologramUserAgg, i: number, columnWidth?: number) => {
      const hasName = !!u.displayName;
      const s = (u.displayName || u.screenName || '').trim();
      return {
        index: i,
        avatarSrc: u.avatarFile ? deps.fileSrc(u.avatarFile, posterAvatarThumbnailWidth(columnWidth ?? store.getState().posterGridSize)) : null,
        monogram: u.avatarFile ? null : s ? s[0].toUpperCase() : '?',
        monoHue: u.avatarFile ? null : monoHue(u.key || s),
        name: hasName ? u.displayName : u.screenName ? '@' + u.screenName : '(unknown)',
        handle: hasName && u.screenName ? u.screenName : null,
        previousName: matchingPreviousName(u, store.getState().searchQuery),
        platform: u.platform || null,
        pfName: u.platform ? deps.PF_NAME[u.platform] || u.platform : null,
        sortValue: posterSortValue(u, store.getState().sortPoster, deps.posterQBGetTree()),
      };
    },
    keyOf: (u: HologramUserAgg, i: number) => (u && u.key != null ? 'p:' + u.key : i),
  });

  // ポスターからその投稿へ移る: posts モード＋この投稿者だけの単一 user
  // フィルタ。この投稿者の投稿「だけ」が欲しいので、前の user フィルタだけで
  // なく、直前の posts ビューから引き継いだ投稿フィルタ（タグ／日付／
  // media／検索）を全部落とす＝そうしないと、無関係な残り
  // フィルタが AND で絞り込んでしまい、利用者が見えるはずと思っている投稿を
  // 隠してしまう。
  function openPosterPosts(u: HologramUserAgg) {
    if (!u) return;
    deps.postQBResetTree();
    // （resetAllFilters と同じ: ここで空にする日付 の入力欄は、
    // すでに無くなったファセット列に属していたもの＝P3 #6。）
    deps.setSearchBoxValue('');
    deps.setBrowseMode('posts');
    // 絞り込みはタブ履歴（#144）の新しい 'posts' エントリとして着地する＝
    // ポスターグリッドへ戻るのは今ではナビの「戻る」（旧 posterReturn の
    // バウンスは無くなった）。
    deps.addFilter({ type: 'user', value: u.key, label: u.displayName || u.screenName || u.key });
  }

  // 投稿者インスペクタの作品はライブラリの投稿を開く操作。投稿者ビューを背面に
  // 残したまま画像だけを重ねると、左ナビゲーションが「投稿者」のままになり、
  // 現在地と操作結果が食い違う。先に投稿モードへ移し、その投稿の画像ビューを開く。
  function openPosterWork(g: HologramPostGroup) {
    deps.setBrowseMode('posts');
    deps.openImageEntry(g);
  }

  // 投稿からその投稿者へ移る（双方向ナビ: posts → posters）: ポスタービューへ
  // 切り替えてその投稿者のインスペクタを開く。SNS の投稿だけが buildUsers()
  // に投稿者を持つ（url を持たない Eagle 移行データは持たない）ので、
  // 呼び出し元はこれを提示する前に存在をガードする。
  function jumpToPoster(p: HologramPost) {
    if (!p || !p.url) return;
    const u = deps.buildUsers().find((x) => x.key === userKey(p));
    if (!u) return;
    // 画像ビューは browseMode より前面に出る。モードだけ変えても中央には画像が残り、
    // 右ペインだけ投稿者へ変わってしまうため、画像ビューも一緒に手放す。
    deps.setBrowseMode('posters'); // 古い詳細をクリアしてから、この投稿者のものを開く
    // setBrowseMode が次の描画で posters の履歴項目を push する。それより前に
    // showPosterDetail が現在の image 項目を replace しないよう、この1回だけ同期を遅らせる。
    showPosterDetail(u, { deferHistorySync: true });
  }

  // --- ポスターインスペクタのタグ（P2⑦: 編集はパネル自身のインラインフィールドで行う） ---
  // 正本は posterTags[key]（投稿レコードではない）で、poster-tags.json へ
  // 永続化する。投稿者はソース（pixiv/SNS）タグを一切持たない。
  function refreshPosterTagFields(key: string) {
    if (key) refreshInspector();
  }
  function tagLabels() {
    return {
      tagsLabel: deps.t('ivPosterTags'),
      newTagPlaceholder: deps.t('tagNewName'),
      addBtn: deps.t('tagAddBtn'),
      noTags: deps.t('editNoTags'),
      noMatch: deps.t('tagPalNoMatch'),
      noVocab: deps.t('tagNoTags'),
      removeTag: deps.t('tagRemove'),
    };
  }
  // ポスターにタグの変更を適用し、永続化し、パネルのタグフィールドを更新する。
  // 共有の undo スタック（type 'poster-tags'）に変更を記録するので、Ctrl+Z が
  // 投稿と同じように働く。
  async function applyPosterTagChange(key: string, mutate: (prev: string[]) => string[] | null | undefined) {
    if (!key) return;
    const prev = deps.posterTagsOf(key);
    const next = mutate(prev.slice());
    if (!next) return;
    const changed = next.length !== prev.length || next.some((t, i) => t !== prev[i]);
    if (!changed) return;
    deps.pushUndo([{ kind: 'poster-tags', target: key, added: next.filter((tag) => !prev.includes(tag)), removed: prev.filter((tag) => !next.includes(tag)) }]);
    await setPosterTags(key, next.length ? next : null);
    refreshPosterTagFields(key);
  }
  // opts.focusTags: inspector-builder.ts の showDetail 参照＝ポスターの
  // 右クリックメニューの「タグを編集」で、ポスターカード自身の 🏷 ボタン
  // （P2⑦）の後継。閉じたパネルを開くのはその経路の仕事であって、その経路
  // だけの仕事＝そちらの注記を参照。
  function showPosterDetail(u: HologramUserAgg, opts?: { focusTags?: boolean; deferHistorySync?: boolean }) {
    if (!u) return;
    if (opts && opts.focusTags) panelSetOpen(true);
    store.setState({ selectedPosterKey: u.key });
    requestDetailOptions(opts);
    hologramPosterGridSource.reveal('p:' + u.key);
    if (!opts?.deferHistorySync) deps.onPosterInspected();
  }

  function buildPosterModel(u: HologramUserAgg, opts: DetailOptions = {}): Omit<HologramInspectorModel, 'openId'> {
    const pfName = u.platform ? deps.PF_NAME[u.platform] || u.platform : '';
    const avatarSrc = u.avatarFile ? deps.fileSrc(u.avatarFile, 64) : null;
    const bannerSrc = u.bannerFile ? deps.fileSrc(u.bannerFile) : null;
    const name = u.displayName || (u.screenName ? '@' + u.screenName : '(unknown)');
    // 最近の作品: この投稿者の投稿をグループ化し（新しい順）、それぞれの
    // 先頭画像をプレビューする。クリック → その作品をギャラリーで開く
    // （インスペクタの上に）。
    posterWorkGroups = deps
      .groupRecords(deps.getAllPosts().filter((p: HologramPost) => userKey(p) === u.key))
      .sort((a: HologramPostGroup, b: HologramPostGroup) => String(b.rep.date || '').localeCompare(String(a.rep.date || '')))
      .slice(0, 6);
    const works = posterWorkGroups.map((g) => {
      const f = (g.files && g.files[0]) || '';
      const text = g.rep.text || g.rep.title || deps.t('detailNoText');
      return {
        key: g.rep.captureId,
        thumbSrc: f ? deps.fileSrc(f, 200) : null,
        text,
        onClick: () => {
          if (f) openPosterWork(g);
          else {
            openPosterPosts(u);
            deps.showPostDetail(g);
          }
        },
      };
    });
    const tags = deps.posterTagsOf(u.key);
    const profileUrl = posterProfileUrl({ platform: u.platform, screenName: u.screenName });
    return {
      kind: 'poster',
      previousNames: previousNames(u),
      focusTags: !!(opts && opts.focusTags),
      avatarSrc,
      bannerSrc,
      name,
      screenNameLabel: u.screenName ? '@' + u.screenName : '',
      profileUrlLabel: profileUrl || '',
      platformLabel: pfName,
      postsLabel: formatCount(u.count),
      followersLabel: u.followers != null ? formatCount(u.followers) : '',
      followingLabel: u.following != null ? formatCount(u.following) : '',
      bioLabel: u.bio || '',
      joinedLabel: localeDate(u.authorCreatedAt),
      works,
      tags,
      // インラインタグ編集（P2⑦）＝post のインスペクタと同じ形。
      ...deps.inspectorTagPickerData(tags, [], 'poster'),
      tagLabels: tagLabels(),
      onTagAdd: (tag: string) => applyPosterTagChange(u.key, (prev) => (prev.includes(tag) ? prev : [...prev, tag])),
      onTagRemove: (tag: string) => applyPosterTagChange(u.key, (prev) => prev.filter((t) => t !== tag)),
      labels: {
        user: deps.t('detailUser'),
        platform: deps.t('detailPlatform'),
        posts: deps.t('detailPosts'),
        followers: deps.t('detailFollowers'),
        following: deps.t('detailFollowing'),
        bio: deps.t('detailBio'),
        joined: deps.t('detailJoined'),
        openProfile: deps.t('detailOpenProfile'),
        tags: deps.t('ivPosterTags'),
        tagsEmpty: deps.t('tagsEmpty'),
        editTags: deps.t('tipEditTags'),
      },
      onOpenProfile: profileUrl ? () => hologramIpc.openExternal(profileUrl) : null,
      onTagContextMenu: (tag: string, x: number, y: number) => {
        deps.showTagGroupMenu(tag, x, y, () => refreshPosterTagFields(u.key));
      },
    };
  }

  // 履歴から選択を戻す。詳細は選択状態に追従する。
  function restorePosterSelection(key: string | null) {
    const u = deps.buildUsers().find((item) => item.key === key);
    store.setState({ selectedPosterKey: u?.key ?? null });
    if (u) hologramPosterGridSource.reveal('p:' + u.key);
  }

  // ポスターの右クリックメニュー: 投稿一覧への移動とタグの編集。
  // menu.ts 経由の React が所有するガラスポップアップ。項目とアクションは
  // ここで viewer が持つ。
  function posterMenuItems() {
    const items = [
      { label: deps.t('posterViewPosts'), act: 'posts' },
      { label: deps.t('ctxEditTags'), act: 'tags' },
    ] as HologramMenuItem[];
    return items;
  }
  function onPosterMenuPick(u: HologramUserAgg, item: HologramMenuItem) {
    if (item.act === 'posts') {
      openPosterPosts(u);
      return;
    } // 閉じる
    if (item.act === 'tags') {
      showPosterDetail(u, { focusTags: true });
      return;
    } // 閉じる
  }
  function showPosterMenu(u: HologramUserAgg, x: number, y: number) {
    menuOpen({ items: posterMenuItems(), x, y }, (item) => onPosterMenuPick(u, item));
  }

  return {
    getPosterList,
    prunePosterTagFilters,
    resetPosterFilters,
    renderPosters,
    openPosterPosts,
    jumpToPoster,
    refreshPosterTagFields,
    applyPosterTagChange,
    showPosterDetail,
    buildPosterModel,
    restorePosterSelection,
    showPosterMenu,
  };
}
