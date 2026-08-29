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
import { includesNormalized } from './search.ts';

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
  const { allPosts, postsById, mediaFilesOf, densityImage, percentileFn, evalNode, treeLeaves, postPredOf, currentTree, activeFolderId, stickyRecs, sortValue, shuffleSeed, searchQuery, buildUsers, posterQBEval, posterQBTree, posterSort, folderSort, allFolders, filterLabel } = deps;

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
    switch (sort) {
      case 'date-desc':
        posts.sort((a, b) => (b._dateMs || 0) - (a._dateMs || 0));
        break;
      case 'date-asc':
        // 日付が不明なレコード（番兵の 0＝stampPost）は、向きに関わらずここでは末尾へ
        // 並ぶ（#47 の月セクションの見出しは、素の数値としての 0 が着く場所ではなく、
        // 末尾の「日付不明」のセクション1つにまとめる。-desc では元から末尾だったが、
        // -asc では 0 が昇順で最小になるので、それに合わせるためこの Infinity への
        // 置き換えが必要だった）。
        posts.sort((a, b) => (a._dateMs || Number.POSITIVE_INFINITY) - (b._dateMs || Number.POSITIVE_INFINITY));
        break;
      case 'likes-desc':
        posts.sort((a, b) => (b.likes || 0) - (a.likes || 0));
        break;
      case 'reposts-desc':
        posts.sort((a, b) => (b.reposts || 0) - (a.reposts || 0));
        break;
      case 'replies-desc':
        posts.sort((a, b) => (b.replies || 0) - (a.replies || 0));
        break;
      case 'local-views-desc':
        posts.sort((a, b) => (b.localViewCount || 0) - (a.localViewCount || 0) || (b._capturedMs || 0) - (a._capturedMs || 0));
        break;
      case 'captured-desc':
        posts.sort((a, b) => (b._capturedMs || 0) - (a._capturedMs || 0));
        break;
      case 'likes-pct': {
        const pct = percentileFn(posts);
        posts.sort((a, b) => {
          const ap = pct(a);
          const bp = pct(b);
          if (ap === null) return bp === null ? 0 : 1;
          if (bp === null) return -1;
          return bp - ap;
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
    // 真偽値のクエリの木（platform / instance / tag / folder / date）。
    const root = posterQBTree();
    if (root.children.length) list = list.filter((u) => posterQBEval(u));
    // 検索は木の外に置いたまま（投稿側と同じやり方）。
    if (q) list = list.filter((u) => includesNormalized(u.displayName, q) || includesNormalized(u.screenName, q));
    const nameOf = (u: HologramUserAgg) => (u.displayName || u.screenName || '').toLowerCase();
    list = list.slice();
    // 並び順は 'count' | 'name' | 'date-desc' | 'date-asc'。日付の軸（dim）はクエリの date の
    // 葉から取る（範囲の軸と並び替えの軸が一致する）。無ければ最終投稿日（latest）を使う。
    const pSort = posterSort();
    if (pSort === 'date-desc' || pSort === 'date-asc') {
      const dl = treeLeaves(root).find((c) => c.type === 'date');
      // 投稿者における dateField の実際の値域（query.ts の makePosterPredOf）＝
      // dl.dateField 自体は開いた葉の欄（'any'）なので、ここでその既知の値に名前を付ける
      // だけ。
      const field: 'latest' | 'lastCapture' | 'authorCreatedAt' = (dl && dl.dateField) || 'latest';
      const asc = pSort === 'date-asc';
      list.sort((a, b) => {
        const av = a[field] || '',
          bv = b[field] || '';
        if (!av && !bv) return b.count - a.count;
        if (!av) return 1;
        if (!bv) return -1;
        const c = av.localeCompare(bv); // ISO の文字列は辞書順で比較できる
        return (asc ? c : -c) || b.count - a.count;
      });
    } else if (pSort === 'name') {
      list.sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || b.count - a.count);
    } else {
      list.sort((a, b) => b.count - a.count || nameOf(a).localeCompare(nameOf(b))); // 'count'（既定）
    }
    return list;
  }

  // フォルダの表紙と件数の裏付けになるレコード。静的なら、明示された項目（今も存在する
  // ものだけ）。動的なら、保存した検索（tree と q）に今のライブラリを当てて一致した投稿
  // （＝開くたびに必ず最新）。renderFolders の走査ごとに覚えておく（resetFolderCache）ので、
  // 並び替えとカードの対応付けが、それぞれ allPosts を走査し直すことはない。
  let _folderRecCache: Map<string, any> | null = null;
  function resetFolderCache() {
    _folderRecCache = new Map();
  }
  function dynamicMatches(coll: HologramFolder): HologramPost[] {
    // 保存した検索は丸ごと条件の木の中にある＝自由文の語も、木の隣の欄ではなく、その中の
    // 'text' の葉。
    const tree = coll.tree && Array.isArray(coll.tree.children) ? coll.tree : null;
    const out: HologramPost[] = [];
    for (const p of allPosts()) {
      if (!hasContent(p)) continue; // getFilteredPosts の内容のゲートを写したもの
      if (tree && tree.children.length && !evalNode(tree, p, postPredOf)) continue;
      out.push(p);
    }
    return out;
  }
  function folderRecords(coll: HologramFolder): HologramPost[] {
    if (_folderRecCache && _folderRecCache.has(coll.id)) return _folderRecCache.get(coll.id);
    let recs: HologramPost[];
    if (coll.kind === 'dynamic') recs = dynamicMatches(coll);
    else {
      recs = [];
      for (const cid of coll.items || []) {
        const r = postsById().get(cid);
        if (r) recs.push(r);
      }
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
  // 動的なフォルダの保存された木を要約する、小さな条件のチップ。上限あり。純粋に案内の
  // ためのもの（モックにあった任意の条件チップ）。
  function folderCondLabels(coll: HologramFolder) {
    const chips: string[] = [];
    try {
      for (const leaf of treeLeaves(coll.tree)) {
        chips.push(filterLabel(leaf));
        if (chips.length >= 4) break;
      }
    } catch {
      /* 壊れた木は無視する */
    }
    return chips; // React はこのラベルから .folder-cond のチップを描く
  }
  function filteredFolders() {
    const q = searchQuery().trim();
    let list = allFolders().slice();
    if (q) list = list.filter((c) => includesNormalized(c.name, q));
    const cSort = folderSort();
    if (cSort === 'recent') list.sort((a, b) => (b.created || 0) - (a.created || 0) || (a.name || '').localeCompare(b.name || ''));
    else if (cSort === 'count') list.sort((a, b) => folderItemCount(b) - folderItemCount(a) || (a.name || '').localeCompare(b.name || ''));
    else list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return list;
  }

  // インスタンスごとの namedPosters の閉包は、下のモジュールレベルの namedPosters の
  // live binding にも結び付けてある（bindNamedPosters）。だから、この閉包に手が届かない
  // sidebar.ts も、ずれていく2つ目の複製ではなく、結び付けられた同じインスタンスを読む。
  return { getFilteredPosts, namedPosters: namedPostersImpl, filteredPosters, dynamicMatches, resetFolderCache, folderRecords, folderThumbsFrom, folderItemCount, folderCondLabels, filteredFolders };
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
