// ポスタービューのグリッド／フィルタ／インスペクタ／フォルダのビルダー＝
// 旧 viewer.ts のモノリスから抽出。post-grid-builder.ts を鏡写しにしている:
// ポスターグリッドのセルモデル＋描画パイプライン、ポスターフォルダの CRUD
// （ポスタービューの名前付きフォルダストア）、ポスターインスペクタ（最近の
// 作品＋タグ／フォルダ編集）、ポスターの右クリックメニューがすべてここへ移る。
// サイズ軸の状態（posterSizeState/posterGridMetrics）は post グリッドのそれと
// 並んで grid-density-builder.ts にあり、表示軸自体（posterLayout /
// posterShowInfo、#630）は services/display.ts にある。
// postQB/posterQB のインスタンス構築と qf-pop／フィルタポップオーバーの
// ブリッジ配線も引き続き viewer.ts の呼び出し元が持つ。このモジュールが
// 取るのは、それらすでに構築済みのインスタンスのメソッドを遅延アローの
// deps としたものだけ（posterQB はこのビルダーより後に構築される――ここから
// pfStore/posterFolderById を必要とするため――ので、下のあらゆる posterQB
// への参照はラップされている。この分解全体で使っている「ラッパーは呼び出し
// 時にしか実行されない」というパターン）。
import { treeLeaves, userKey } from './query.ts';
import { hologramIpc } from './ipc.ts';
import { posterProfileUrl } from './profile-url.ts';
import { formatCount, localeDate } from './format.ts';
import { open as inspectorOpen, refresh as inspectorRefresh } from './inspector.ts';
import { setOpen as panelSetOpen } from './inspector-panel.ts';
import { open as lightboxOpen } from './lightbox.ts';
import { open as menuOpen } from './menu.ts';
import { open as webSearchContextOpen } from '../websearch/context-panel.ts';
import { promptName } from '../prompt/Prompt.tsx';
import { captureFile, monoHue } from './records.ts';
import { setPosterTags } from './tags.ts';
import { hologramPosterGridSource } from './grid.ts';
import * as folders from './folders.ts';
import * as aliases from './aliases.ts';
import { open as confirmOpen } from './confirm.ts';
import { open as aliasPickerOpen } from '../services/alias-picker.ts';
import { store } from './store.ts';
import type { UndoChange } from './undo.ts';
import type { NotifyAction } from './ui.ts';

export interface PosterGridBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  PF_NAME: Record<string, string>;
  fileSrc(file: string, w?: number): string;
  showToast(msg: unknown, action?: NotifyAction | null): void;
  pushUndo(changes: readonly UndoChange[]): (() => void) | null;
  undoAction(undoFn: (() => void) | null): NotifyAction | null;
  showKindMenu(tag: string, x: number, y: number, onChange: () => void, entityId?: number | null): void;
  buildGroupGalleryItems(g: HologramPostGroup): any[];
  posterTagsOf(key: string): string[];
  // #810: 投稿者フィルタが提示する実体の語彙＝名前ごとではなく tags テーブルの
  // 行ごとに1エントリ。
  posterFilterVocab(): HologramTagEntry[];
  inspectorTagPickerData(tags: string[], recordsForSource: any[], kind: string): any;
  filteredPosters(): HologramUserAgg[];
  buildUsers(): HologramUserAgg[];
  getAllPosts(): HologramPost[];
  groupRecords(posts: HologramPost[]): HologramPostGroup[];
  // posterQB（query-builder.ts の makePosterQueryBuilder インスタンス）は
  // このビルダーより後に構築される（ここから folderById/pfStore を必要と
  // するため）＝どのメソッドも viewer.ts の呼び出し元での遅延アロー。
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
  markPostsMutated(): void;
  namedPosters(): HologramUserAgg[];
  // ポスターの再描画が新しく終わるたびに → tabs-builder がタブごとの履歴に
  // 'posters' エントリを記録し永続化する（#144）＝post グリッドの
  // syncTitleAndPersist dep のポスターモード版。keepLimit（その場での）
  // 更新では呼ばれない。
  onPosterRendered(): void;
}

export function makePosterGridBuilder(deps: PosterGridBuilderDeps) {
  let posterList: HologramUserAgg[] = [];
  function getPosterList() {
    return posterList;
  }
  let posterWorkGroups: any[] = []; // ポスターインスペクタに表示する最近の作品

  // --- 名前付きポスターフォルダ（ポスタービュー）— { id, name, items:[posterKey] } ---
  // 共有のフォルダ一覧ストア（folders.ts の createPersistedFolderStore）を
  // 再利用する。CRUD／id 発行／トグル／永続化／読み込みのロジックを再実装
  // せずに済むように＝view 固有のトースト／再描画だけがここにある。
  const pfStore = folders.hologramPosterFolderStore();
  const posterFolderById = pfStore.byId;
  const posterFolderHas = pfStore.has;
  // #23 St1: その投稿者の alias グループが束ねるすべての posterKey にわたる
  // 和集合として読む（設計: 「poster-folders も同型」＝poster-tags の和集合
  // 読み取りと）＝この投稿者が1行になる前の、その後マージされた副次キーの
  // 下に記録されたフォルダのトグルも、なお数える。上の素の posterFolderHas は
  // 書き込み用に残す（togglePosterFolderMember は渡された文字通りのキーを
  // 常にトグルする。ここでのどの呼び出し元でもそれは常に u.key／プライマリ）。
  function posterFolderHasResolved(id: string, key: string) {
    return aliases.membersOf(key).some((k) => posterFolderHas(id, k));
  }
  function createPosterFolder(name: string | null) {
    return pfStore.create(name);
  }
  function deletePosterFolder(id: string) {
    pfStore.remove(id);
    deps.posterQBRemoveByLeaf('folder', id); // フォルダが無くなったら、そのフィルタの葉も落とす
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
  // ポスターフォルダの所属変更が、ストア以外に触れる必要があるもの＝undo の
  // 経路と共有し、元に戻された所属変更が同じ画面を更新するようにする。
  function refreshPosterFolderViews() {
    prunePosterTagFilters();
    if (treeLeaves(deps.posterQBGetTree()).some((c) => c.type === 'folder')) renderPosters(); // 所属変更はフィルタ済みグリッドへの追加・削除を伴いうる
  }

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

  // ポスターからその投稿へ移る: posts モード＋この投稿者だけの単一 user
  // フィルタ。この投稿者の投稿「だけ」が欲しいので、前の user フィルタだけで
  // なく、直前の posts ビューから引き継いだ投稿フィルタ（タグ／日付／
  // media／検索／engagement）を全部落とす＝そうしないと、無関係な残り
  // フィルタが AND で絞り込んでしまい、利用者が見えるはずと思っている投稿を
  // 隠してしまう。
  function openPosterPosts(u: HologramUserAgg) {
    if (!u) return;
    deps.postQBResetTree();
    // （resetAllFilters と同じ: ここで空にする日付／engagement の入力欄は、
    // すでに無くなったファセット列に属していたもの＝P3 #6。）
    deps.setSearchBoxValue('');
    deps.setBrowseMode('posts');
    // 絞り込みはタブ履歴（#144）の新しい 'posts' エントリとして着地する＝
    // ポスターグリッドへ戻るのは今ではナビの「戻る」（旧 posterReturn の
    // バウンスは無くなった）。
    deps.addFilter({ type: 'user', value: u.key, label: u.displayName || u.screenName || u.key });
  }

  // 投稿からその投稿者へ移る（双方向ナビ: posts → posters）: ポスタービューへ
  // 切り替えてその投稿者のインスペクタを開く。SNS の投稿だけが buildUsers()
  // に投稿者を持つ（url を持たない Eagle 移行データは持たない）ので、
  // 呼び出し元はこれを提示する前に存在をガードする。
  function jumpToPoster(p: HologramPost) {
    if (!p || !p.url) return;
    // #23 St1: userKey(p) は投稿自身の生のキー。buildUsers() の行はグループの
    // プライマリでキー付けされているので、マージ済み投稿者の行を見つけるのは
    // resolve()。
    const u = deps.buildUsers().find((x) => x.key === aliases.resolve(userKey(p)));
    if (!u) return;
    deps.setBrowseMode('posters'); // 古い詳細をクリアしてから、この投稿者のものを開く
    showPosterDetail(u);
  }

  // --- ポスターインスペクタのタグ（P2⑦: 編集はパネル自身のインラインフィールドで行う） ---
  // 正本は posterTags[key]（投稿レコードではない）で、poster-tags.json へ
  // 永続化する。投稿者はソース（pixiv/SNS）タグを一切持たない。
  function refreshPosterTagFields(key: string) {
    const tags = deps.posterTagsOf(key);
    // ピッカーのデータはタグと一緒に運ぶ＝inspector-builder.ts の同じ注記を参照。
    inspectorRefresh({ tags, ...deps.inspectorTagPickerData(tags, [], 'poster') });
  }
  function refreshPosterFolderFields(key: string) {
    inspectorRefresh({ folders: pfStore.all().map((f) => ({ id: f.id, name: f.name, on: posterFolderHasResolved(f.id, key) })) });
  }
  // タグ欄のラベル＝inspector-builder.ts 自身の tagLabels() を鏡写しにしている
  // （同じ文字列を共有せずに複製している: 7行の閉包が2つ、モジュールに
  // するほどでもない）。
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
  // ポスターにタグの変更を適用し、永続化し、パネルのタグフィールドを更新する。
  // 共有の undo スタック（type 'poster-tags'）に変更を記録するので、Ctrl+Z が
  // 投稿と同じように働く。
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
  // opts.focusTags: inspector-builder.ts の showDetail 参照＝ポスターの
  // 右クリックメニューの「タグを編集」で、ポスターカード自身の 🏷 ボタン
  // （P2⑦）の後継。閉じたパネルを開くのはその経路の仕事であって、その経路
  // だけの仕事＝そちらの注記を参照。
  function showPosterDetail(u: HologramUserAgg, opts?: { focusTags?: boolean }) {
    if (!u) return;
    if (opts && opts.focusTags) panelSetOpen(true);
    const pfName = u.platform ? deps.PF_NAME[u.platform] || u.platform : '';
    const avatarSrc = u.avatarFile ? deps.fileSrc(u.avatarFile) : null;
    const name = u.displayName || (u.screenName ? '@' + u.screenName : '(unknown)');
    // 最近の作品: この投稿者の投稿をグループ化し（新しい順）、それぞれの
    // 先頭画像をプレビューする。クリック → その作品をギャラリーで開く
    // （インスペクタの上に）。
    // #23 St1: 単純な === u.key ではなく membersOf(u.key)＝マージ済み
    // 投稿者の作品は、そのグループが束ねるすべての posterKey にまたがる
    // （設計の受け入れ基準: 「そのユーザーで絞ると両SNSの投稿が出る」）。
    const memberKeys = new Set(aliases.membersOf(u.key));
    posterWorkGroups = deps
      .groupRecords(deps.getAllPosts().filter((p: HologramPost) => memberKeys.has(userKey(p))))
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
      // インラインタグ編集（P2⑦）＝post のインスペクタと同じ形。
      ...deps.inspectorTagPickerData(tags, [], 'poster'),
      tagLabels: tagLabels(),
      onTagAdd: (tag: string) => applyPosterTagChange(u.key, (prev) => (prev.includes(tag) ? prev : [...prev, tag])),
      onTagRemove: (tag: string) => applyPosterTagChange(u.key, (prev) => prev.filter((t) => t !== tag)),
      folders: pfStore.all().map((f) => ({ id: f.id, name: f.name, on: posterFolderHasResolved(f.id, u.key) })),
      // #23 St1: 「同一人物」のセクション＝この投稿者のグループが束ねる他の
      // すべての posterKey（グループが無ければ空）、それぞれ取り外せる。
      // 「統合」は、すでにグループがあるかどうかに関わらずマージピッカーを
      // 開く。
      sameAuthor: sameAuthorSection(u),
      onSameAuthorMerge: () => openAliasPicker(u),
      onSameAuthorUnlink: (key: string) => unlinkAlias(key),
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
        sameAuthor: deps.t('ivSamePerson'),
        sameAuthorMerge: deps.t('samePersonMerge'),
        sameAuthorUnlink: deps.t('samePersonUnlink'),
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
    // ここではパネル自身の `hidden` を突ついていない（以前は要素を強制的に
    // 可視にしていた）: シェルはそれを状態から導出するので、その書き込みは
    // React と競合し、かつ #243 とも矛盾していた――ポスターカードのクリックが、
    // 利用者が閉じたパネルを暴き、次の描画がたまたま食い違うまでそれを
    // 暴いたままにしていた。post のカードは決してこれをしなかった。
    store.setState({ inspectedKey: 'poster:' + u.key }); // post／poster のカードは（hologramStore の subscribe で）自分のリングをリアクティブにクリア／設定する
  }

  // ポスターの右クリックメニュー（ポスターカードを右クリック）: その投稿者の
  // 投稿へ移動＋ポスターフォルダへの割り当て（トグル、開いたまま）。
  // menu.ts 経由の React が所有するガラスポップアップ。項目とアクションは
  // ここで viewer が持つ。
  function posterMenuItems(u: HologramUserAgg) {
    const items = [{ label: deps.t('posterViewPosts'), act: 'posts' }, { label: deps.t('ctxEditTags'), act: 'tags' }, { label: deps.t('websearchToolbarLabel'), act: 'websearch' }, { sep: true }] as HologramMenuItem[];
    for (const f of pfStore.all()) {
      items.push({ label: f.name, act: 'folder', fid: f.id, checked: posterFolderHasResolved(f.id, u.key) });
    }
    items.push({ label: deps.t('posterMenuNewFolder'), act: 'newfolder', manage: true });
    // #23 St1: 「同一人物にする」は常に提示する。「同一人物から外す」は今この
    // 投稿者がグループ化されているときだけ（設計: カードメニューの
    // マージ／解除の対）。
    items.push({ sep: true }, { label: deps.t('ctxSamePerson'), act: 'samePerson' });
    if (aliases.groupOf(u.key)) items.push({ label: deps.t('ctxSamePersonUnlink'), act: 'samePersonUnlink' });
    return items;
  }
  function onPosterMenuPick(u: HologramUserAgg, item: HologramMenuItem, x: number, y: number) {
    if (item.act === 'posts') {
      openPosterPosts(u);
      return;
    } // 閉じる
    if (item.act === 'tags') {
      showPosterDetail(u, { focusTags: true });
      return;
    } // 閉じる
    if (item.act === 'websearch') {
      // #207: この投稿者専用の「ウェブで探す」パネルへの入り口＝この投稿者
      // 用の 'user' の葉だけを持つ使い捨ての木（上の openPosterPosts が
      // 自分の単一投稿者フィルタに使うのと同じ葉の形）。
      webSearchContextOpen({ kind: 'group', op: 'and', neg: false, children: [{ kind: 'cond', type: 'user', value: u.key, label: u.displayName || u.screenName || u.key }] }, x, y);
      return;
    } // 閉じる
    if (item.act === 'newfolder') {
      promptName(deps.t('posterFolderRenamePrompt'), '', (name) => {
        const nf = createPosterFolder(name);
        if (nf) togglePosterFolderMember(nf.id, u.key);
      });
      return; // 閉じる
    }
    if (item.act === 'folder') {
      togglePosterFolderMember(item.fid, u.key);
      return posterMenuItems(u); // さらに割り当てられるよう開いたままにする
    }
    if (item.act === 'samePerson') {
      openAliasPicker(u);
      return;
    } // 閉じる
    if (item.act === 'samePersonUnlink') {
      unlinkAlias(u.key);
      return;
    } // 閉じる
  }
  function showPosterMenu(u: HologramUserAgg, x: number, y: number) {
    menuOpen({ items: posterMenuItems(u), x, y }, (item) => onPosterMenuPick(u, item, x, y));
  }

  // --- 名前マージ（#23 St1） --------------------------------------------------
  //
  // インスペクタの「同一人物」セクション向けの、メンバーごとの表示情報。
  // マージされた非プライマリのメンバーは、もう自分の HologramUserAgg 行を
  // 持たない（users.ts の畳み込みがそれをプライマリのものへ吸収した）＝
  // 代わりに、その生のキーを持つ最初の投稿からラベル／platform を読む。
  // users.ts 自身の pass 1 が使うのと同じ「最初の空でない値」という考え方。
  // グループがせいぜい数人しか持たないメンバーについて、必要になったときだけ
  // 実行する（フレームごとに走るホットパスではない）。
  function memberDisplay(u: HologramUserAgg, key: string): { label: string; platformLabel: string } {
    if (key === u.key) return { label: u.displayName || (u.screenName ? '@' + u.screenName : key), platformLabel: u.platform ? deps.PF_NAME[u.platform] || u.platform : '' };
    const p = deps.getAllPosts().find((post: HologramPost) => userKey(post) === key);
    return { label: p ? p.displayName || (p.screenName ? '@' + p.screenName : key) : key, platformLabel: p && p.platform ? deps.PF_NAME[p.platform] || p.platform : '' };
  }
  function sameAuthorSection(u: HologramUserAgg) {
    return aliases
      .membersOf(u.key)
      .filter((key) => key !== u.key)
      .map((key) => ({ key, ...memberDisplay(u, key) }));
  }

  // 完全な前後のグループスナップショットによる undo――マージ／解除が共有
  // スタックの、対象ごとの値の差分という形に収まらない理由は undo.ts の
  // UndoChange のコメントを参照。`keys` はその操作が触れるすべての
  // posterKey（UI で名指しされた1つか2つのキーだけでなく、両側の所属全員）
  // ＝すでに複数メンバーのグループを持つ投稿者をマージするなら、その
  // グループ全体の undo/redo を一緒に運ばなければならない。さもないと undo
  // は名指しされたその1キーだけを切り離し、そのグループメイトをマージ後の
  // グループに黙って取り残してしまう。
  function pushAliasUndo(keys: string[], before: aliases.PosterAliasGroup[]) {
    const after = aliases.snapshotFor(keys);
    return deps.pushUndo([{ kind: 'poster-alias', target: 'poster-alias:' + keys[0], added: [JSON.stringify({ keys, groups: after })], removed: [JSON.stringify({ keys, groups: before })] }]);
  }

  // グリッドを再描画し、インスペクタが影響を受けた投稿者を表示中なら、その
  // 投稿者の（変わったかもしれない）解決済みの行に照らして更新する。この
  // モジュール自身のマージ／解除と、undo/redo の適用側のコールバック
  // （orchestrator.ts が undo-builder.ts の onPosterAliasChanged をこれに
  // 配線する）の両方で共有する。
  function refreshAfterAliasChange() {
    renderPosters(true);
    const key = store.getState().inspectedKey;
    if (typeof key !== 'string' || key.indexOf('poster:') !== 0) return;
    const resolved = aliases.resolve(key.slice('poster:'.length));
    const u = deps.buildUsers().find((x) => x.key === resolved);
    if (u) showPosterDetail(u);
    else store.setState({ inspectedKey: null }); // このキーが指していた投稿がすべて無くなった＝inspector-builder.ts の inspectedSubjectExists の解除を鏡写しにしている（あちらの購読は投稿データだけを見ていて alias 構造は見ないので、これはこれで独自のガード）
  }

  // 手動マージ（#23 St1 の UI）: 確認（「投稿データは変わらない」）の後、u の
  // グループ全体と otherKey のグループ全体を統合し、プライマリは今この時点で
  // より多くの投稿を持つ側に既定する（2026-07-11 の設計。後で
  // aliases.setPrimary を通してインスペクタから変更できる＝この段階では
  // あえてその UI は無い: 既定値がよくあるケースをカバーし、#23 のチェック
  // リストが「確認強化」を段階③に取っておいているため）。
  function mergeAliasWith(u: HologramUserAgg, otherKey: string) {
    const other = deps.buildUsers().find((x) => x.key === otherKey);
    const otherLabel = other ? other.displayName || (other.screenName ? '@' + other.screenName : otherKey) : otherKey;
    const selfLabel = u.displayName || (u.screenName ? '@' + u.screenName : u.key);
    confirmOpen({
      message: deps.t('samePersonConfirm', [selfLabel, otherLabel]),
      okLabel: deps.t('samePersonMerge'),
      cancelLabel: deps.t('confirmCancel'),
      okDestructive: false,
      onOk: () => {
        const keys = [...new Set([...aliases.membersOf(u.key), ...aliases.membersOf(otherKey)])];
        const before = aliases.snapshotFor(keys);
        const primary = other && other.count > u.count ? otherKey : u.key;
        if (!aliases.merge(u.key, otherKey, { primary })) return;
        deps.markPostsMutated();
        const undoFn = pushAliasUndo(keys, before);
        deps.showToast(deps.t('samePersonMerged'), deps.undoAction(undoFn));
        refreshAfterAliasChange();
      },
    });
  }

  // 「同一人物にする」（インスペクタのボタン＋カードメニュー）: 名前付きの
  // 投稿者を全員検索し（buildUsers はすでに url を持たない／(unknown) の
  // 投稿者を除外している。deps.namedPosters はさらに名前無しのバケットを
  // 落とす＝#23 の設計が求める構造的なガード）、u 自身の現在のグループを
  // 除いて、選んだ相手をそこへマージする。
  function openAliasPicker(u: HologramUserAgg) {
    const excluded = new Set(aliases.membersOf(u.key));
    const candidates = deps
      .namedPosters()
      .filter((x) => !excluded.has(x.key))
      .map((x) => ({ key: x.key, label: x.displayName || (x.screenName ? '@' + x.screenName : x.key), sub: x.screenName ? '@' + x.screenName : x.platform ? deps.PF_NAME[x.platform] || x.platform : '' }));
    aliasPickerOpen({
      title: deps.t('samePersonPickerTitle'),
      placeholder: deps.t('samePersonPickerPh'),
      emptyLabel: deps.t('samePersonPickerEmpty'),
      candidates,
      onPick: (key: string) => mergeAliasWith(u, key),
    });
  }

  // memberKey を「その」グループから取り除く。インスペクタのメンバーごとの
  // × は他のメンバーのキーを渡す。カードメニューの「同一人物から外す」は
  // 検査中の投稿者自身のキー（u.key）を渡す＝どちらもここを通して呼ぶ。
  // refreshAfterAliasChange() が今検査中のキー自体を読むので、呼び出し元の
  // `u` をここまで通す必要は一切ない。
  function unlinkAlias(memberKey: string) {
    const keys = aliases.membersOf(memberKey);
    if (keys.length < 2) return; // not actually grouped
    const before = aliases.snapshotFor(keys);
    if (!aliases.unlink(memberKey)) return;
    deps.markPostsMutated();
    const undoFn = pushAliasUndo(keys, before);
    deps.showToast(deps.t('samePersonUnlinked'), deps.undoAction(undoFn));
    refreshAfterAliasChange();
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
    refreshAfterAliasChange,
  };
}
