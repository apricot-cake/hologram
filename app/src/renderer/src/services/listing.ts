import { isSortAscending, sortOption } from './sort-direction.ts';
// 一覧の処理の流れの service＝3つの閲覧モードすべてについて「何が見えて、どの順に並ぶか」を
// 決める。getFilteredPosts（投稿グリッド＝内容のゲート → クエリの木 → sticky の併合 →
// 並び替え）、namedPosters/filteredPosters（投稿者グリッド）、フォルダの導出（動的な保存した
// 検索の照合、1回の走査ごとのレコードのキャッシュ、表紙のサムネイル、件数、条件のチップ、
// filteredFolders）。viewer decomposition（最終形 B）の7番目の「純粋なロジック → service」の
// 切り出しとして viewer.js から1対1で取り出した。本物の ES モジュール（名前付きの export）で、
// viewer.ts / sidebar.ts が直接 import する。DOM には触れない。実行時の結び付きは
// makeListing(deps) 経由で注入する＝再代入される viewer の let は getter として、結線の地点より
// 後で宣言する const は遅延させたアロー関数として入る。だからこのファイルは単体で動かせる
// （scripts/test-listing-unit.cts が動的な import() で読み込む）。

// deps の取り決め（注記が無ければすべて関数）:
//   allPosts() / postsById()＝ライブラリと、その captureId の対応表（getter＝viewer が両方を再代入する）
//   mediaFilesOf(p) / densityImage(p) / percentileFn(list)＝records.ts のもの
//   evalNode(n, item, predOf) / treeLeaves(n)＝query.ts のもの
//   postPredOf(f)＝投稿側の葉の述語（query.ts の makePostPredOf の産物）
//   currentTree()＝今のタブの真偽値のクエリの木（根の群）
//   stickyRecs＝書き換えの結果、絞り込みに当たらなくなっても見えたままにする captureId の Set
//   sortValue()＝投稿の並び順の Select の今の値
//   shuffleSeed()＝今のタブのシャッフルの種（'random' の並び順だけが読む）
//   searchQuery()＝検索ボックスの語（hologramStore に載っている）
//   buildUsers()＝投稿者の集約（users.ts の産物）
//   posterQBEval(u) / posterQBTree()＝投稿者のクエリビルダー（遅延させる＝後で宣言する const）
//   posterSort() / folderSort()＝モードごとの並び順のキー（getter＝再代入される let）
//   allFolders()＝CF().allFolders()。フォルダの読み込み前は []
//   filterLabel(f)＝葉の丸いラベル（tab-state.ts の makeTabLabels の産物）
import { shuffleRank } from './shuffle.ts';
import { matchingIds } from './search-results.ts';

export interface ListingDeps {
  allPosts(): HologramPost[];
  postsById(): Map<string, HologramPost>;
  mediaFilesOf(p: HologramPost): string[];
  densityImage(p: HologramPost): string;
  percentileFn(list: HologramPost[]): (p: HologramPost) => number | null;
  evalNode(n: HologramQueryNode, item: unknown, predOf: (f: HologramQueryLeaf) => (item: any) => boolean): boolean;
  treeLeaves(n: HologramQueryNode | null | undefined, out?: HologramQueryLeaf[]): HologramQueryLeaf[];
  postPredOf(f: HologramQueryLeaf): (p: HologramPost) => boolean;
  currentTree(): HologramQueryGroup;
  activeFolderId(): string | null;
  stickyRecs: Set<string>;
  sortValue(): string;
  shuffleSeed(): string;
  searchQuery(): string;
  buildUsers(): HologramUserAgg[];
  posterQBEval(u: HologramUserAgg): boolean;
  posterQBTree(): HologramQueryGroup;
  posterSort(): string;
  folderSort(): string;
  allFolders(): HologramFolder[];
  filterLabel(f: { type: string; [k: string]: any }): string;
}
export function makeListing(deps: ListingDeps) {
  const { allPosts, postsById, mediaFilesOf, densityImage, percentileFn, evalNode, treeLeaves, postPredOf, currentTree, activeFolderId, stickyRecs, sortValue, shuffleSeed, searchQuery, buildUsers, posterQBEval, posterQBTree, posterSort, folderSort, allFolders } = deps;

  // 投稿グリッドと動的なフォルダが共有する内容のゲート。見せるものを持つレコード
  // （画像／メディア／本文／タイトル）だけが一覧に入る。
  const hasContent = (p: HologramPost) => !!(p.image || mediaFilesOf(p).length || p.text || p.title);

  function getFilteredPosts() {
    // 統合したビュー。どの項目（SNS の投稿とライブラリの画像）も対象に入る。外れるのは
    // 内容（画像も本文も）を持たないレコードだけ。SNS の投稿だけ／画像だけへ絞るのは
    // 「種別」の絞り込み（kind）でやる。
    let posts = allPosts().filter(hasContent);
    const sort = sortValue();
    // サイドバーの静的フォルダは現在地であり、フィルタのクエリには混ぜない。表示範囲だけは
    // 既存の folder 葉と同じ部分木の意味を使うので、フォルダを開いたときの件数は従来どおり。
    const folderId = activeFolderId();
    if (folderId) posts = posts.filter(postPredOf({ kind: 'cond', type: 'folder', value: folderId } as HologramQueryLeaf));
    // 検索ボックスの語は今やクエリの木の中の 'text' の葉＝下の evalNode が、他のどの条件とも
    // 並べて評価する（テキストの絞り込みだけの別の段は無い）。

    // ---- クエリビルダーの評価。真偽値の条件の木 ----
    // queryTree は葉の条件の上に群（AND/OR。否定を付けられる）を重ねた木で、その場で
    // ドラッグして組むビルダーが直接組み立てる（改訂3）。evalNode がそれを再帰的に歩く。
    const queryRoot = currentTree(); // 真偽値のクエリの木（根の群）
    if (queryRoot.children.length) posts = posts.filter((p) => evalNode(queryRoot, p, postPredOf));

    // sticky なレコード。直前の書き換えで絞り込みに当たらなくなった項目も、見えたままにする
    // （次に絞り込みが変わるか、データが更新されると消える）。
    if (stickyRecs.size) {
      const have = new Set(posts.map((p) => p.captureId));
      for (const p of allPosts()) if (stickyRecs.has(p.captureId) && !have.has(p.captureId)) posts.push(p);
    }

    // 並び替え。あらかじめキャッシュした数値の時刻（_dateMs/_capturedMs）を使い、比較関数の
    // 呼び出しごとの new Date() を避ける（9千件の投稿では、1回の並び替えで約12万回の確保に
    // なっていた）。
    const ascending = isSortAscending(sort);
    const direction = ascending ? -1 : 1;
    switch (sortOption(sort)) {
      case 'date-desc':
        posts.sort((a, b) => {
          if (!a._dateMs) return b._dateMs ? 1 : 0;
          if (!b._dateMs) return -1;
          return direction * (b._dateMs - a._dateMs);
        });
        break;
      case 'likes-desc':
        posts.sort((a, b) => direction * ((b.likes || 0) - (a.likes || 0)));
        break;
      case 'local-views-desc':
        posts.sort((a, b) => direction * ((b.localViewCount || 0) - (a.localViewCount || 0)) || (b._capturedMs || 0) - (a._capturedMs || 0));
        break;
      case 'captured-desc':
        posts.sort((a, b) => {
          if (!a._capturedMs) return b._capturedMs ? 1 : 0;
          if (!b._capturedMs) return -1;
          return direction * (b._capturedMs - a._capturedMs);
        });
        break;
      case 'likes-pct': {
        const pct = percentileFn(posts);
        posts.sort((a, b) => {
          const ap = pct(a);
          const bp = pct(b);
          if (ap === null) return bp === null ? 0 : 1;
          if (bp === null) return -1;
          return direction * (bp - ap);
        });
        break;
      }
      case 'random': {
        // その場で混ぜるのではなく、種から決める。キーは hash(種 | レコード) なので、
        // 並び替え直しや復元をまたいでも順序が残り、入力の順序にも左右されない（#118）。
        // レコードのキーは records.ts の postIdKey を写したもの＝records.ts は IPC に
        // 手を伸ばすが、このモジュールは純粋なままにしておきたいので、ここに直接書いてある。
        const seed = shuffleSeed();
        const rank = new Map(posts.map((p) => [p, shuffleRank(seed, p.captureId || (p.url || '') + '|' + (p.capturedAt || ''))]));
        posts.sort((a, b) => (rank.get(a) as number) - (rank.get(b) as number));
        break;
      }
    }

    return posts;
  }

  // 名前のある投稿者だけ＝身元の無い（'(unknown)'）バケットはグリッドに入れない。
  function namedPostersImpl() {
    return buildUsers().filter((u) => u.displayName || u.screenName);
  }
  function filteredPosters() {
    const q = searchQuery().trim();
    let list = namedPostersImpl();
    // 真偽値のクエリの木（platform / tag / folder / date）。
    const root = posterQBTree();
    if (root.children.length) list = list.filter((u) => posterQBEval(u));
    // 検索は木の外に置いたまま（投稿側と同じやり方）。
    if (q) {
      const ids = matchingIds(
        'posters',
        q,
        list.map((u) => ({ id: u.key, title: u.displayName || '', screenName: u.screenName || '' })),
      );
      list = list.filter((u) => ids.has(u.key));
    }
    const nameOf = (u: HologramUserAgg) => (u.displayName || u.screenName || '').toLowerCase();
    list = list.slice();
    // 並び順は 'count' | 'name' | 'followers-pct' | 'date-desc' | 'date-asc'。日付の軸（dim）はクエリの date の
    // 葉から取る（範囲の軸と並び替えの軸が一致する）。無ければ最終投稿日（latest）を使う。
    const pSort = sortOption(posterSort());
    const ascending = isSortAscending(posterSort());
    const direction = ascending ? -1 : 1;
    if (pSort === 'date-desc' || pSort === 'date-asc') {
      const dl = treeLeaves(root).find((c) => c.type === 'date');
      // 投稿者における dateField の実際の値域（query.ts の makePosterPredOf）＝
      // dl.dateField 自体は開いた葉の欄（'any'）なので、ここでその既知の値に名前を付ける
      // だけ。
      const field: 'latest' | 'lastCapture' | 'authorCreatedAt' = (dl && dl.dateField) || 'latest';
      const asc = ascending;
      list.sort((a, b) => {
        const av = a[field] || '',
          bv = b[field] || '';
        if (!av && !bv) return b.count - a.count;
        if (!av) return 1;
        if (!bv) return -1;
        const c = av.localeCompare(bv); // ISO の文字列は辞書順で比較できる
        return (asc ? c : -c) || b.count - a.count;
      });
    } else if (pSort === 'followers-pct') {
      list.sort((a, b) => {
        if (a.followerPercentile == null && b.followerPercentile == null) return nameOf(a).localeCompare(nameOf(b));
        if (a.followerPercentile == null) return 1;
        if (b.followerPercentile == null) return -1;
        return direction * (b.followerPercentile - a.followerPercentile) || nameOf(a).localeCompare(nameOf(b));
      });
    } else if (pSort === 'name') {
      list.sort((a, b) => (ascending ? 1 : -1) * nameOf(a).localeCompare(nameOf(b)) || b.count - a.count);
    } else {
      list.sort((a, b) => direction * (b.count - a.count) || nameOf(a).localeCompare(nameOf(b))); // 'count'（既定）
    }
    return list;
  }

  let _folderRecCache: Map<string, any> | null = null;
  function resetFolderCache() {
    _folderRecCache = new Map();
  }
  function folderRecords(coll: HologramFolder): HologramPost[] {
    if (_folderRecCache && _folderRecCache.has(coll.id)) return _folderRecCache.get(coll.id);
    let recs: HologramPost[];
    recs = [];
    for (const cid of coll.items || []) {
      const r = postsById().get(cid);
      if (r) recs.push(r);
    }
    if (_folderRecCache) _folderRecCache.set(coll.id, recs);
    return recs;
  }
  function folderThumbsFrom(recs: HologramPost[]) {
    const files: string[] = [];
    for (const rec of recs) {
      const f = densityImage(rec);
      if (f) files.push(f);
      if (files.length >= 4) break;
    }
    return files;
  }
  function folderItemCount(coll: HologramFolder) {
    return folderRecords(coll).length;
  }
  function filteredFolders() {
    const q = searchQuery().trim();
    let list = allFolders().slice();
    if (q) {
      const ids = matchingIds(
        'folders',
        q,
        list.map((c) => ({ id: c.id, title: c.name })),
      );
      list = list.filter((c) => ids.has(c.id));
    }
    const cSort = folderSort();
    if (cSort === 'recent') list.sort((a, b) => (b.created || 0) - (a.created || 0) || (a.name || '').localeCompare(b.name || ''));
    else if (cSort === 'count') list.sort((a, b) => folderItemCount(b) - folderItemCount(a) || (a.name || '').localeCompare(b.name || ''));
    else list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return list;
  }

  // インスタンスごとの namedPosters の閉包は、下のモジュールレベルの namedPosters の
  // live binding にも結び付けてある（bindNamedPosters）。だから、この閉包に手が届かない
  // sidebar.ts も、ずれていく2つ目の複製ではなく、結び付けられた同じインスタンスを読む。
  return { getFilteredPosts, namedPosters: namedPostersImpl, filteredPosters, resetFolderCache, folderRecords, folderThumbsFrom, folderItemCount, filteredFolders };
}

// namedPosters は起動時に一度だけ bindNamedPosters 経由で結び付ける（viewer.ts の、自身の
// makeListing() の呼び出しの直後）＝投稿者のサイドバーの source は、投稿者インスタンスの
// 開閉のために namedPosters() を必要とする。この live binding のおかげで、別のモジュール
// （sidebar.ts）が2つ目の実装ではなく、既に結び付けられた同じ閉包を読める。素の書き換え
// 可能なオブジェクトを export するのではなく `let` と setter にしてあるのは、ES モジュールの
// 名前付き export を再代入できるのは、そのモジュール自身だけだから＝bindNamedPosters が
// 走れば、import した側の束縛はその場で更新される。
export let namedPosters: (() => HologramUserAgg[]) | null = null;
export function bindNamedPosters(fn: () => HologramUserAgg[]): void {
  namedPosters = fn;
}
