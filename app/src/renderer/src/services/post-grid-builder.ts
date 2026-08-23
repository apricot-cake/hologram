// ポストグリッドの描画＋データパイプラインのビルダー＝旧 viewer.ts のモノリス
// から抽出。これは allPosts の所有権移転にあたる: 正本となる投稿キャッシュ
// （allPosts/_postsById）、投稿読み込みパイプライン、グループ化描画パイプライン
// （renderPosts）、画像ごとのアスペクト比キャッシュ＋カードモデルの配線、
// フォルダ／カードの右クリックメニュー、削除フローがすべてここへ移る。
// viewer.ts が引き続き持つもの（density／view の状態、インスペクタ、選択、
// タブ、ポスタービュー、起動オーケストレーション）は deps として注入される＝
// query-builder.ts などが確立したのと同じ ctx パターン。viewGroups/allPosts/
// manualGroups/ungrouped は getter としてのみ公開する（利用側が本当に再代入
// する場合のみ狭い setter も＝例: groupSelected()）＝モジュール内部の `let`
// は ESM の export 経由で外から再代入できないため。
import { notify } from './ui.ts';
import { open as confirmOpen } from './confirm.ts';
import { open as menuOpen } from './menu.ts';
import { formatCount, formatDate, compactDate, monthLabel } from './format.ts';
import { dateFieldForSort, buildSections } from './date-sections.ts';
import { densityImage, dragFilesOf, postIdKey, makeGroupRecords, makeCardModel, percentileFn, stampPost } from './records.ts';
import { pinItemsOfGroups } from './pin-items.ts';
// #236: main プロセス側のゲート（lib-open-gate.ts）が使うのと同じ純粋な
// 許可リスト判定＝レンダラーでも安全（Electron／better-sqlite3 不使用）なので、
// 右クリックメニューは IPC の往復無しで「開く」／「フォルダで表示」を
// ラベルできる。完全なゲート（拡張子＋マジックバイト）はクリック時に main
// 側で改めて走る。
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

// #47: グリッド自身の表示用の月セクション（date-sections.ts は純粋なまま保つ＝
// Intl も i18n も使わない。だからロケール依存のラベルは、`t()` と monthLabel の
// 両方をすでに持っているここで組み立てる）。現在のソートに日付軸が無ければ
// null。`groups` はフラットなポストグリッドの配列（viewGroups）＝hologramStore
// の 'postGroups' に push されるのと同じもので、セクションの startIndex は
// それに直接添字アクセスする（グリッドのホストも選択／ナビの計算も、この
// 1つの配列を共有している）。
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

// viewer.ts が引き続き持つコールバック／状態＝query-builder.ts/qf-pop-builder.ts
// の ctx オブジェクトと同じやり方で注入される。
export interface PostGridBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  smokeCapture: boolean;
  fileSrc(file: string, w?: number): string;
  shape(): DisplayShape;
  gridThumbW(): number;
  listThumbW(): number;
  sortValue(): string;
  postShadow(): { type: string; value?: string }[];
  getFilteredPosts(): HologramPost[];
  buildUsers(): HologramUserAgg[];
  // #23 St1: 生の posterKey をその名前マージグループのプライマリへ畳み込む＝
  // グループ化されていなければ恒等写像。buildUsers() の行はプライマリでキー
  // 付けされている。
  resolve(key: string): string;
  snapshotState(): unknown;
  syncTitleAndPersist(): void;
  renderPosters(keepLimit?: boolean): void;
  onPostsLoaded(profiles: Array<Record<string, any>>): void;
  showDetail(g: HologramPostGroup, opts?: { focusTags?: boolean }): void;
  jumpToPoster(post: HologramPost): void;
  addImageTab(g: HologramPostGroup): void;
  // 選択テキストの行（#167）。カードグリッドは同じクリックですでにメニューを
  // 持っていた唯一の画面なので、2つ目を開くのではなくその行をこれに継ぎ足す。
  // services/selection-menu.ts がその行と挙動の両方を持つ。
  selectionMenu: {
    items(): HologramMenuItem[];
    pick(text: string, item: HologramMenuItem): boolean;
  };
}

export function makePostGridBuilder(deps: PostGridBuilderDeps) {
  const CF = () => folders; // shared folder module

  // 削除確認のスキップ設定＝以前は viewer.ts から dep として注入されていたが、
  // 今はこの唯一の読み手（下の requestDeleteGroup）がここで持つ。設定
  // コンポーネント（Danger.tsx）は古い共有ブリッジを経由するのではなく、直接の
  // 生きた束縛を求めているため。
  let skipDeleteConfirm = false;
  function getSkipDeleteConfirm() {
    return skipDeleteConfirm;
  }
  function setSkipDeleteConfirm(v: boolean) {
    skipDeleteConfirm = v;
    hologramIpc.setPref('skipDeleteConfirm', v);
  }
  // 保存済みの設定を復元するときは、それをそのまま永続化し直すべきではない
  // （grid-density-builder.ts の restorePrefs を鏡写しにしている。あちらも
  // 自分の状態に直接代入する）。
  function restoreSkipDeleteConfirm(v: boolean) {
    skipDeleteConfirm = v;
  }

  // --- 正本となる投稿キャッシュ（allPosts の所有権） -------------------------
  let allPosts: HologramPost[] = [];
  let _allPostsGeneration = 0; // allPosts を置き換えるたびに上げる。サイドバーのキャッシュを無効化する
  // その場での編集（タグの追加／削除、単体削除）は配列を置き換えずに allPosts
  // のレコードを変更するので、世代カウンタは自動では進まない。これはサイドバーの
  // タグ／投稿者／インスタンスのキャッシュと buildUsers を制御するので、変更する
  // 側は必ずこれを呼ぶ必要がある＝そうしないと、renderPosts がグリッドと
  // フライアウトを再描画しても、新しく追加されたタグはサイドバーの行に決して
  // 届かない（削除された投稿者／インスタンスも居残ったままになる）。
  // この同じゲートは、allPosts.length を hologramStore（post-empty-state の
  // セレクタの入力）へも反映し、購読可能な posts-data サービス
  // （services/posts-data.ts）とも同期する＝allPosts へのあらゆる変更
  // （置き換えでも、その場の編集でも）が、あちこちに散った push ではなく
  // 1箇所から届く。
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

  // --- 投稿の読み込み ---
  // keepLimit: バックグラウンドの再読み込み（fs-watch、一括削除）は、入場
  // アニメーションを再生したりスクロールの窓をリセットしたりせずにライブラリを
  // 読み直す。stampPost（ソート用タイムスタンプ＋post-key の前計算）は
  // records.ts にある。
  // captureId でキー付けされた正本のキャッシュ。レンダラーは全件を持ち、
  // main は差分だけを送る（listPostsDelta）＝取得1回ごとの更新でも、
  // 約9千件のレコード全体を IPC で再シリアライズしなくてよくなった。allPosts
  // はこのマップから作り直す。順序は無関係＝getFilteredPosts() が常に
  // ソートし直すため。
  let _postsById = new Map<string, HologramPost>();
  let _haveBaseline = false; // 完全なスナップショットを持つまでは false（リロード時にもリセットされる＝新しいモジュール状態）
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
      // 最初の本物のスナップショットが届いた瞬間にストアへ反映する＝
      // empty/EmptyState.tsx（services/library-status.ts 経由）が「まだ読み込み中」
      // と「確認済みで空」を見分けるのに使う唯一の合図（#682）。posts と posters
      // はこのキャッシュを共有するので、1つのフラグで両方のグリッドをカバーする。
      store.setState({ libraryLoaded: true });
      allPosts = [..._postsById.values()];
      markPostsMutated();
      deps.onPostsLoaded((res && res.profiles) || []);
      stickyRecs.clear(); // 画面のリフレッシュ（リロード）では、変更で生き残った項目を掃除する
      if (store.getState().browseMode === 'posters') deps.renderPosters(keepLimit);
      else renderPosts(keepLimit);
      reconcileFolders();
      // 開いている image view は services/image-tab.ts の posts-data.ts 購読を
      // 通してライブに再導出される＝このフックはオーケストレーション側の副作用
      // のために残っている。
    } finally {
      _loadPostsInFlight = false;
      if (_loadPostsPending) {
        _loadPostsPending = false;
        loadPosts(true); // 実行中に取りこぼしたバックグラウンド再読み込み＝もう一度だけやり直す
      }
    }
  }
  function reconcileFolders() {
    if (!CF()) return;
    CF().reconcile(new Set(allPosts.map((p) => p.captureId)));
  }
  // 全消去: 差分キャッシュを、消去したばかりのライブラリと同期させておく。
  // 呼び出し側は直後に markPostsMutated()/renderPosts() を相変わらず呼ぶ
  // （順序は変えていない）＝これはその2つがさもなければ触るであろう生の
  // キャッシュをリセットするだけ。
  function resetAll() {
    _postsById = new Map();
    allPosts = [];
  }

  // --- グルーピングの状態（main 経由で永続化: manual-groups.json / ungrouped.json） ---
  let manualGroups: string[][] = []; // [[captureId,…],…] ＝利用者が組んだグループ（自動より優先）
  let ungrouped = new Set<string>(); // 自動グルーピングから外された post key
  const stickyRecs = new Set<string>(); // 変更でフィルタに一致しなくなった後も表示し続ける captureId
  // groupRecords（records.ts）は生きた manualGroups/ungrouped の閉包で
  // ここで作り直される＝ポスタービュー（viewer.ts、まだ抽出されていない）は、
  // 返された参照を通して自分のグルーピング（posterWorkGroups）にもこの同じ
  // インスタンスを再利用する。
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
  // 決して再代入されない（.add/.delete/.clear されるだけ）＝構築時に一度渡した
  // 単一の参照は、それを保持し続ける呼び出し元（listing.ts）にとって生きたまま。
  function getStickyRecs() {
    return stickyRecs;
  }

  let viewGroups: HologramPostGroup[] = []; // 現在の描画結果: [{ key, records, rep, files }]
  let visibleLikesPercentiles = new Map<HologramPost, number>(); // 現在の絞り込み結果内の SNS 内人気度
  function getViewGroups() {
    return viewGroups;
  }

  // 描画の再利用ガード: 再利用されたグループは、純粋な追加読み込みやその場の
  // 変更のときに再フィルタ／再グループをスキップする。lastRenderedState は
  // viewer.ts の syncTitleAndPersist()（setLastRenderedState 経由）が書き込む
  // ＝まだ抽出されていない一群（タブタイトル／永続化／履歴）が更新しなければ
  // ならない、このガードの唯一の断片。
  let lastRenderedState: any = null;
  let _lastRenderGen = -1; // 直近の完全なグリッド構築時の _allPostsGeneration（高速なカード追加のガード）
  let _lastViewGroups: HologramPostGroup[] | null = null; // 直近の完全な構築によるグループ。純粋な追加読み込みで再利用する（再フィルタ／再グループ無し）
  let _lastStickySize = 0; // その構築時の stickyRecs.size ＝グループ再利用の署名の一部
  let _lastSections: HologramDateSection[] | null = null; // #47 その同じ構築による月セクション＝_lastViewGroups と足並みを揃えて再利用する
  function setLastRenderedState(sig: string) {
    lastRenderedState = sig;
  }

  // 削除／不一致化は有効なフィルタに一致しなくなることがある。変更の間、
  // 画面から引き剥がすのではなく現在の集合を粘着表示のままにしておく。
  function keepCurrentVisible() {
    viewGroups.forEach((g) =>
      g.records.forEach((r) => {
        if (r.captureId) stickyRecs.add(r.captureId);
      }),
    );
  }

  // 画像ごとのアスペクト比キャッシュ（captureId -> "W/H"）。画像の読み込み時に
  // 学習し永続化する。（遅延読み込みされる）画像が読み込まれる前にカードが
  // 正しい高さを確保できるようにする＝masonry が初回から正しく詰まる＝
  // 落ち着き・ガタつきが無く、先読みも不要。
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
  // 画像の高さを何も確保していないカード（索引に shotW/H が無く、キャッシュ
  // 済みのアスペクト比も無い＝稀＝動画の poster／読めないヘッダ）は、読み込み時に
  // 実際のアスペクト比を報告する。キャッシュは次の描画でその高さを確保する。
  function onCardAspect(cap: string, ar: string) {
    if (imgAspect[cap] !== ar) {
      imgAspect[cap] = ar;
      persistAspect();
    }
  }

  // 1つのグループを、プレーンで完全に整形済みのカードモデルへ解決する: 画像の
  // src、整形済みの件数／日付、選択、アスペクト比＝マークアップがプリミティブと
  // して必要とするものすべて。グリッドコンポーネントは共有の PostCard
  // コンポーネント（hologramPostGridSource 経由の生きた React セル）でこれを
  // 描画する。選択状態は注入しない＝グリッドコンポーネントの Cell が
  // hologramStore の 'selectedSet' から .selected を導出する。
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
    // 件数のソートは、現在選んだ項目だけをカードに乗せる。反応数フィルタだけが
    // 主題にした場合は、従来どおり非ゼロの反応数を併記する。capture の日付も関連する
    // ソートやフィルタがあるときだけモデルに乗る。以前は
    // グリッドコンテナに付く2つのクラスで、CSS がマークアップを隠していた＝
    // どのカードも誰にも見えない件数を常に運んでいた。
    sortMetric: () => deps.sortValue(),
    likesPercentile: (p) => visibleLikesPercentiles.get(p) ?? null,
    showEngagement: () => deps.postShadow().some((f: { type: string }) => f.type === 'engagement'),
    showCaptured: () => deps.sortValue() === 'captured-desc' || deps.postShadow().some((f: { type: string; dateField?: string }) => f.type === 'date' && f.dateField === 'capturedAt'),
  });
  // modelOf/keyOf/onAspect は描画のたびに意味のある形で identity が変わることは
  // ない（変わるのは items/layout だけで、それらは source 自身が
  // hologramStore から導出する）＝renderPosts() のたびに作り直して push する
  // のではなく、一度だけ設定する。
  hologramPostGridSource.configure({
    modelOf: (g, i) => cardModel(g, i),
    keyOf: (g) => postIdKey(g.rep),
    onAspect: onCardAspect,
  });

  // inPlace（旧 keepLimit＝それが保っていた renderLimit はウィンドウ処理を行う
  // レガシー経路と一緒に消えた）: true = その場の変更による再描画＝可能なら
  // グループ化済みの集合を再利用し、粘着した生き残りを保ち、入場アニメーション
  // 無しで、タブタイトル／永続化の同期をスキップする。
  function renderPosts(inPlace?: boolean) {
    // view の署名（filter/sort/search/view）＝この描画を通して安定しているので、
    // 一度だけ計算して sticky-drop とグループ再利用の判定に使い回す。
    const stateSig = JSON.stringify(deps.snapshotState());
    // 本物のフィルタ／検索／ソートの変更は、粘着した生き残りを落とす（それらは
    // その場の変更を生き延びるだけで、利用者主導の view 変更は生き延びない）。
    if (!inPlace && stickyRecs.size && lastRenderedState !== null && stateSig !== lastRenderedState) {
      stickyRecs.clear();
    }
    // フィルタ済みレコードをグループ化する（投稿 URL による自動＋手動グループ）＝
    // 各グループは1枚のカードとして描画される。multiOnly は今では「画像が
    // 2つ以上あるグループ」を意味する。
    // その場の再描画では前回の構築結果のグループを再利用する: 集合を変えようが
    // ない変更のために約9千件を再フィルタ＋再グループするのは無駄な作業
    // だった。安全なのは view の署名・データの世代・粘着集合のすべてが
    // 変わっていないときだけ＝これが getFilteredPosts/groupRecords への唯一の
    // 入力（手動グルーピングは markPostsMutated 経由で世代を進める）。1つでも
    // 食い違えば新規構築へフォールバックする。
    const canReuseGroups = inPlace && _lastViewGroups !== null && lastRenderedState !== null && stateSig === lastRenderedState && _allPostsGeneration === _lastRenderGen && stickyRecs.size === _lastStickySize;
    let sections: HologramDateSection[] | null;
    if (canReuseGroups) {
      viewGroups = _lastViewGroups as HologramPostGroup[];
      sections = _lastSections; // 同じ構築結果 → 同じバケット。歩き直す必要は無い
    } else {
      const filteredPosts = deps.getFilteredPosts();
      if (deps.sortValue() === 'likes-pct') {
        const percentile = percentileFn(filteredPosts);
        visibleLikesPercentiles = new Map(filteredPosts.map((p) => [p, percentile(p)]));
      } else {
        visibleLikesPercentiles = new Map();
      }
      viewGroups = groupRecords(filteredPosts);
      if (store.getState().multiOnly) viewGroups = viewGroups.filter((g) => g.files.length > 1 || g.records.some((r) => stickyRecs.has(r.captureId)));
      sections = buildDateSections(viewGroups, deps.sortValue(), deps.t);
    }

    if (viewGroups.length === 0) {
      // 'postGroups'=null を push する（空配列ではなく＝services/grid.ts の
      // computeModel 参照）ことで、グリッドコンポーネントのセルを同期的に
      // アンマウントする（hologramStore.set の notify ループは同期的で、
      // コンポーネントの subscriber は flushSync でアンマウントし、自分の
      // ホスト div を取り除く＝古い render(null) 呼び出しが与えていたのと同じ
      // 保証）。EmptyState コンポーネントはこの同じキー＋'allPostsCount'＋
      // 'searchQuery' から自分で 'firstRun'/'filtered' を導出する＝push が
      // 1つ減る。
      // 両方のキーを1回の notify パスで（下の対になった push を参照＝#871）。
      store.setState({ postGroups: null, postSections: null }); // #47: 行が無ければ月セクションも無い
      // ここで他にすることは無い。グリッドのホストは null の push で自分自身を
      // アンマウントし、空状態は id で探した要素を手で表示・非表示していた
      // 以前とは違い、同じストアのキーから何か言うべきことがあるかを判断する
      // （empty/EmptyState.tsx）。
      if (!inPlace) deps.syncTitleAndPersist(); // 結果0件の状態でもタイトル／永続化は同期する
      return;
    }

    // グリッド本体――完全に React が所有する（hologramPostGridSource 経由の
    // グリッドコンポーネント）: 両レイアウトについて masonic のウィンドウ処理と
    // 生きたセル描画を行う。このモジュールが持つのはデータパイプライン（上の
    // viewGroups）だけで、コンテナについては他に何も持たない: レイアウト
    // （shape/columnWidth/rowGutter/itemHeightEstimate/…）は push しない＝
    // source が表示軸と hologramStore の 'gridSize'/'listThumb' からそれを
    // 導出する。modelOf/keyOf/onAspect は上で一度だけ設定済み。同じ配列参照を
    // push する（その場の再利用）ことは、ストアの identity ガードにより no-op
    // になる＝旧来の「itemsKey が変わらなければ進まない」挙動と一致する。
    // 両方のキーを1回の notify パスで（#871）。sections は viewGroups への
    // 添字なので、別々に push すると、すべての subscriber に途中状態が見える＝
    // 新しいアイテムが前回の構築結果のセクション範囲と照らし合わされ、それが
    // masonic の位置キャッシュを壊しグリッドをクラッシュさせていた原因。
    store.setState({ postGroups: viewGroups, postSections: sections }); // #47 — ソートに日付軸が無いときは sections は null
    _lastRenderGen = _allPostsGeneration; // この構築結果の世代を記録する
    _lastViewGroups = viewGroups;
    _lastSections = sections;
    _lastStickySize = stickyRecs.size; // その場のグループ再利用のためのスナップショット
    if (!inPlace) deps.syncTitleAndPersist(); // タブタイトル＋永続化を同期させる
  }

  // フォルダピッカーのフライアウト（行き先）＝React が所有するガラスメニュー
  // （menu.ts）。項目とアクションは viewer が持つ。フォルダ行は所属をトグルして
  // 「閉じる」（旧 foldMenu もトグルのたびに隠れていた＝それを踏襲）。カード
  // メニューと一括「フォルダへ追加」ボタンから開く。
  function foldMenuItems(g: HologramPostGroup) {
    const list = CF() ? CF().staticFolders() : []; // 行き先のみ＝保存済み検索は投稿を持たない
    const rep = g.rep.captureId;
    // 入れ子のフォルダはパスでラベル付けされる（#41）: ここ、木から離れた
    // 場所では、「Materials」という名前のサブフォルダが2つあると名前だけでは
    // 見分けがつかない。チェックマークが答えるのは「これはこのフォルダに
    // 入っているか」であって、「その下のどこかに入っているか」では決してない
    // ＝投稿はサブツリーではなく1つのフォルダへ入れる。
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
      // コレクションフィルタが表示中の集合を変えうるときだけ再描画する
      if (deps.postShadow().some((f: { type: string }) => f.type === 'folder')) renderPosts(true);
    }
  }
  // `at` はカードメニューのフォルダ行ではカーソル位置、選択バーのそれではクリック
  // されたボタン＝HologramMenuAnchor を参照。そのまま素通しする。計算はしない。
  function showFoldMenu(g: HologramPostGroup, at: HologramMenuAnchor) {
    if (!CF()) return;
    menuOpen({ items: foldMenuItems(g), ...at }, (item) => onFoldMenuPick(g, item));
  }

  // --- カードの右クリックメニュー: カードごとの操作をラベル付きで並べた目次。
  // ホバーは即応ボタン（ℹ 情報 / 🏷 タグ）を持ち続け、それ以外（開く、
  // フォルダ、投稿者、削除）はここに置く。
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
  // カードの右クリックメニュー＝React が所有するガラスメニュー（menu.ts）。
  // 項目とアクションは viewer が持つ。'folder' は同じ位置に（別の）フォルダ
  // ピッカーを開く＝ブリッジの遷移ガードが、それを閉じるのではなく開いた
  // ままにする。
  function cardMenuItems(g: HologramPostGroup, selText = '') {
    // SNS の投稿はポスタービューに投稿者を持つ（buildUsers は url を持たない
    // 移行データを飛ばす）。
    // #23 St1: userKey(g.rep) は投稿自身の生のキー。resolve() はマージ済み
    // グループのプライマリの下にあってもそれを見つける。
    const canPoster = !!(g.rep.url && deps.buildUsers().some((u) => u.key === deps.resolve(userKey(g.rep))));
    const srcUrl = (g.records.flatMap((r) => (Array.isArray(r.media) ? r.media : [])).find((m: { url?: string }) => m && m.url) || {}).url || '';
    const items: any[] = [];
    // 右クリックが選択の内側に着地したときはテキスト行が先頭に来る＝その操作は
    // テキストへ向けられたもので、それが Chromium の使う順序。選択が無ければ
    // メニューは常にあったものとバイト単位で同じ（#167）。
    if (selText) items.push(...deps.selectionMenu.items(), { sep: true });
    if (g.rep.url) items.push({ label: deps.t('tipOpen'), act: 'open', icon: CM_IC.open });
    items.push({ label: deps.t('ctxOpenNewTab'), act: 'newtab', icon: CM_IC.newtab });
    items.push({ label: deps.t('ctxPin'), act: 'pin', icon: CM_IC.pin });
    items.push({ label: deps.t('tipFolder'), act: 'folder', icon: CM_IC.folder });
    items.push({ label: deps.t('tipInfo'), act: 'info', icon: CM_IC.info });
    // 「タグを編集」は、ホバーの 🏷（とそれが開いていたポップオーバー）が
    // P2⑦ で無くなって以来、カードからタグ付けへ入る経路＝タグ欄にキャレットを
    // 置いた状態でインスペクタを開く。
    items.push({ label: deps.t('ctxEditTags'), act: 'tags', icon: CM_IC.tag });
    if (canPoster) items.push({ label: deps.t('ctxViewPoster'), act: 'poster', icon: CM_IC.poster });
    // カードが今まさに表示しているファイル（density に従って capture か artwork）。
    const cardFile = densityImage(g.rep) || g.rep.image || '';
    // #236: 収蔵ファイル（assetClass:'file'）には上の cardFile が無い（この種の
    // 行では image/video がどちらも null）＝代わりに自身のファイルを表示／
    // 開くべき対象にする。両方同時になることは決して無い: buildLocalRecord は
    // 同じレコードで image と file を両方埋めることはない。
    const collectedFile = g.rep.assetClass === 'file' ? g.rep.file || '' : '';
    if (srcUrl || cardFile || collectedFile) items.push({ sep: true });
    if (srcUrl) {
      items.push({ label: deps.t('detailSauce'), act: 'sauce', icon: CM_IC.sauce });
      items.push({ label: deps.t('detailAscii'), act: 'ascii', icon: CM_IC.sauce });
    }
    // 常にカードが表示しているその1枚の画像だけ＝クリップボードは1枚のビットマップ
    // しか持てないし、複数画像グループ全体を運ぶ経路はドラッグアウト（#132）。
    const storedFile = cardFile || collectedFile;
    if (cardFile) items.push({ label: deps.t('ctxCopyImage'), act: 'copyImage', icon: CM_IC.copy });
    if (storedFile) items.push({ label: deps.t('ctxCopyPath'), act: 'copyPath', icon: CM_IC.copy });
    if (storedFile) items.push({ label: deps.t('ctxShowInFolder'), act: 'reveal', icon: CM_IC.reveal });
    // #236 §3: このラベルは許可リストの拡張子だけを見る半分をあらかじめ見せて
    // いるので、ボタンが main の実際の挙動より多くを約束することは無い
    // （拡張子＋マジックバイトの完全なチェックは、クリック時に
    // lib-open-gate.ts でもう一度走る。そこで食い違えば、ラベルが約束しな
    // かったものを開くことは決してなく、黙ってフォルダ表示にフォールバック
    // するだけ）。
    if (collectedFile) items.push({ label: extensionAllowed(collectedFile) ? deps.t('ctxOpenFile') : deps.t('ctxOpenFileInFolder'), act: 'openFile', icon: CM_IC.reveal });
    items.push({ sep: true });
    items.push({ label: deps.t('tipDelete'), act: 'delete', icon: CM_IC.del, danger: true });
    return { items, srcUrl };
  }
  function onCardMenuPick(g: HologramPostGroup, x: number, y: number, srcUrl: string, item: HologramMenuItem, selText = '') {
    if (deps.selectionMenu.pick(selText, item)) return; // 継ぎ足されたテキスト行（#167）
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
    } // フォルダピッカーを開く（ブリッジがそれを開いたままにする）
    else if (act === 'info') deps.showDetail(g);
    else if (act === 'tags') deps.showDetail(g, { focusTags: true });
    else if (act === 'poster') deps.jumpToPoster(g.rep);
    else if (act === 'sauce') hologramIpc.openExternal('https://saucenao.com/search.php?url=' + encodeURIComponent(srcUrl));
    else if (act === 'ascii') hologramIpc.openExternal('https://ascii2d.net/search/url/' + encodeURIComponent(srcUrl));
    else if (act === 'reveal') {
      const file = densityImage(g.rep) || g.rep.image || (g.rep.assetClass === 'file' ? g.rep.file : '');
      if (file && hologramIpc.showInFolder) hologramIpc.showInFolder(file);
    } else if (act === 'copyPath') {
      const file = densityImage(g.rep) || g.rep.image || (g.rep.assetClass === 'file' ? g.rep.file : '');
      if (file) void hologramIpc.copyFilePath(file).then((ok) => notify(deps.t(ok ? 'pathCopied' : 'pathCopyFailed')));
    } else if (act === 'openFile') {
      // #236: ラベルはすでに拡張子だけの半分を見せていた。main はこの瞬間に
      // 許可リスト全体（＋マジックバイト）を再チェックして、それに応じて
      // 開くかフォルダ表示するかを決める＝lib-open-gate.ts 参照。
      if (g.rep.file) hologramIpc.openPostFile(g.rep.file);
    } else if (act === 'copyImage') copyGroupImage(g);
    else if (act === 'delete') requestDeleteGroup(g);
  }

  // カードの画像をクリップボードへコピーする＝右クリックメニューと、単一選択
  // 上での Ctrl+C（#132）。ファイルの選び方は 'reveal' とまったく同じ:
  // 今の density が実際に表示しているもの。
  async function copyGroupImage(g: HologramPostGroup) {
    const file = densityImage(g.rep) || g.rep.image;
    if (!file) return;
    // false = main がそれをデコードできず（svg、一部の tiff）、クリップボードを
    // そのままにした＝ここで沈黙すると、そこに何があったにせよ「コピーされた」
    // と読めてしまう。
    notify(deps.t((await hologramIpc.copyImage(file)) ? 'imageCopied' : 'imageCopyFailed'));
  }

  // カードを別のアプリへドラッグアウトする（#132）。ブラウザ自身のドラッグは
  // キャンセルしなければならない＝そのままだと asset:// のサムネイル URL を
  // 運んでしまうので、代わりに main が原本ファイルの OS ドラッグを始められる
  // ようにする。登録は orchestrator.ts の #postGrid dragstart デリゲート、
  // 他のカードジェスチャーと同じ。
  function handleCardDragStart(g: HologramPostGroup, e: DragEvent) {
    const t = e.target;
    // テキストやカードの media 以外の部分は、ブラウザ自身のドラッグのままにする。
    if (!(t instanceof Element) || !t.closest('[data-slot="post-card-media"]')) return;
    e.preventDefault();
    // どのファイルが出ていくかは records.ts の規則（純粋関数＝test-records-unit
    // 参照）。選択は読むだけ＝ドラッグはライブラリを見つけたときのまま残す。
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
      skipLabel: deps.t('confirmSkip'), // 「今後表示しない」
      onOk: async ({ skip }) => {
        if (skip) setSkipDeleteConfirm(true);
        await executeDeleteGroup(g);
      },
    });
  }

  // ライブラリ全体を破壊するには、OK ボタンを有効にするためにキーワード
  // （t('deleteKeyword')）を入力する必要がある＝うっかりクリックしただけでは
  // 何も消せない。確認モーダルは React が所有する（confirm.ts／confirm
  // コンポーネント）＝これはキーワードによるゲートと、onOk としての消去を
  // 添えてそれを開くだけ。以前は古い共有ブリッジ経由で呼ばれていたが、React の
  // Danger セクションは今では下の confirmClearAll の生きた束縛を直接 import
  // する。
  function confirmClearAll() {
    confirmOpen({
      message: deps.t('confirmClear'),
      description: deps.t('confirmClearDesc'),
      okLabel: deps.t('confirmOk'),
      cancelLabel: deps.t('confirmCancel'),
      keywordPlaceholder: deps.t('confirmKeywordPh'),
      keywordRequired: deps.t('deleteKeyword'), // これが入力されるまで OK は無効のまま
      onOk: async () => {
        // 全データを消去する（保存フォルダ内のすべての画像＋サイドカーを削除する）。
        const res = await clearAll();
        // 設定が壊れているとき main は消去を拒否する＝ライブラリを画面に残し、
        // 再起動を促す（initSaveFolderRedundancy が起動時に修復する）。
        if (res && res.blocked) {
          notify(deps.t('clearBlocked'));
          return;
        }
        resetAll(); // 差分キャッシュを消去後の状態と同期させておく
        markPostsMutated(); // 消去で取り残された古いタグ／投稿者／インスタンスのファセットを落とす
        renderPosts();
        notify(deps.t('cleared'));
      },
    });
  }

  // グループの全レコードを削除する（UI ではグループが1つの投稿そのもの）。
  // ここではもうインスペクタのことを考える必要は無い（#633）: 以前は検査中の
  // 投稿がそのレコードの中にあるとき、この関数自身がパネルを解除していた。
  // それはレコードが消えうる他のあらゆる経路（フローティングバーの一括削除、
  // 全消去、インポートの置き換え）を、対象を取り残したまま自由にしていた。
  // 代わりに inspector-builder.ts が posts-data.ts の消失を監視する＝それら
  // すべてに対する1つの答えで、下の markPostsMutated() を通して届く。
  async function executeDeleteGroup(g: HologramPostGroup) {
    for (const r of g.records) {
      try {
        await deletePost(r.image || r.video || r.file); // #236: r.file は取り込み画像の IPC 識別子
      } catch {
        /* このまま続ける */
      }
      _postsById.delete(r.captureId); // 差分キャッシュから楽観的に取り除く
    }
    allPosts = [..._postsById.values()]; // 一度だけ作り直す（O(N)。O(records×N) の findIndex+splice ではない）。順序は無関係＝getFilteredPosts が再ソートする
    markPostsMutated(); // 削除された投稿者／インスタンスはサイドバーから落とさなければならない
    renderPosts(true);
    reconcileFolders(); // 削除された captureId を即座にフォルダから一掃する
    trashRefresh(); // ナビのゴミ箱バッジは、たった今そこへ着地したものを数える（#268）
    notify(deps.t('deleted'));
  }

  return {
    // ゴミ箱グリッド（#268）が同じカードを描けるように渡す＝削除された投稿が、
    // かつてその投稿だったものとして認識できるように。
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

// loadPosts/confirmClearAll/getSkipDeleteConfirm/setSkipDeleteConfirm は起動時に
// 一度だけ結び付けられる（viewer.ts、postGrid を構築した直後）＝設定
// コンポーネント（Danger.tsx/Data.tsx）が共有ブリッジを迂回せず直接それらへ
// 届くように。
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
