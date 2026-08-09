// 共有のファセットクエリビルダー（改訂④）――
// viewer.js のインラインな createQueryBuilder（イベント側の半分）から抽出。
// view（posts／posters）ごとに1インスタンス。木の状態、変更用ヘルパー、
// フラットな葉のシャドウを持つ。自分自身の view は持たない: 画面上の
// チップはフィルタバーのコンポーネント（FilterChips）で、それは
// orchestrator の activeFilters() が、このモジュールが ctx.storeKey の下で
// hologramStore へ映す木から導出する。viewer.js は今も変更まわりの
// オーケストレーション（ctx.onChange）を持つ――移ったのは木のドメイン
// 自体だけ。
//
// このモジュールはかつてバーの描画も行っていた: チップの view-model を
// 組み立て、コンテナ id ごとにキャッシュし、コンポーネントの
// click/contextmenu アクションを dispatch() 経由で送り返していた。その
// 経路全体は query-chips コンポーネント（#154 P2③）と共に死んだ――それが
// 書き込み続けていたコンテナは `hidden` の div だった――そして #230 で、
// それだけが読んでいた ctx フィールド（container、barEl、labelOf、
// glyphOf、t、getSearchVal、onClearSearch、openLeafEditor、
// editableLeafTypes、isEditingLeaf、textInTree）と共に削除された。
//
// ctx: { storeKey?, predOf, onChange, singleValueTypes?, noDupTypes?,
//        multiValueTypes?, standaloneTypes?, onLeafMutated? }
import { emptyTree, hasLeafValue, hasSameLeaf, removeCondsMatching as removeCondsMatchingQ, buildShadow, canonicalizeFacet, facetViewOf, facetAdd, cleanupTree, sameLeaf, detachNode, treeParentMap, evalNode } from './query.ts';
import { store } from './store.ts';

// ファイル冒頭のコメントに記した ctx 契約のローカルな形
// （createQueryBuilder の ctx: any は緩いままにしている――レンダラー
// プロジェクトからは HologramQueryLeaf/HologramQueryGroup が見えないため
// ――ので、これはこのモジュール自身の本体のためだけに型付けしている）。
interface QbCtx {
  // このビルダーが2つのクエリ木のどちらを持つか。（素の文字列ではなく）
  // ユニオン型にしていることが、下の syncShadow が計算されたキーを通して
  // 書き込めるようにしている。
  storeKey?: 'postQueryTree' | 'posterQueryTree';
  predOf: (f: HologramQueryLeaf) => (item: any) => boolean;
  onChange: () => void;
  singleValueTypes?: string[];
  noDupTypes?: string[];
  multiValueTypes?: string[];
  standaloneTypes?: string[];
  onLeafMutated?: (node: HologramQueryLeaf) => void;
}

export function createQueryBuilder(ctx: QbCtx) {
  let tree = emptyTree();
  let shadow: any[] = []; // 最後に計算したフラットな（重複除去済みの）葉のシャドウ
  const singleValueTypes = ctx.singleValueTypes || [];
  const noDupTypes = ctx.noDupTypes || [];
  // ファセットのスキーマ: どの type が「すべて」／「いずれか」の選択を伴う
  // 2つ以上の値を持てるか（複数値の属性）、どれが単独のチップのままかを
  // 決める。それ以外の type はすべて、無言の「いずれか」としてクラスタに
  // なる――スキーマが演算子の問いに答えるので、UI が尋ねる必要は無い。
  const facetOpts = { multiValueTypes: ctx.multiValueTypes || [], standaloneTypes: ctx.standaloneTypes || [] };

  // --- 木の変更ドメインは query.ts にある（上で import、9番目の抽出切り出し）。
  // 下の束縛はこのインスタンスの木を閉じ込めている。
  const qHasValue = (type: string, value: unknown) => hasLeafValue(tree, type, value);
  // #774: タグの葉版。ファセット行は1つの tags テーブル行を表すので、その
  // 実体を持つ葉によって点灯する――sameLeaf は両側が id を知っていれば
  // それを比較し、どちらかが知らないときだけ名前へフォールバックする。
  const qHasTag = (tagId: number | null | undefined, value: string) => hasSameLeaf(tree, { type: 'tag', value, tagId });
  const removeCondsMatching = (pred: (c: HologramQueryLeaf) => boolean) => removeCondsMatchingQ(tree, pred);
  // 下の `.shadow()` が公開する、フラットな（重複除去済みの）葉のシャドウを
  // 作り直す。木を ctx.storeKey の下で hologramStore へも映す。毎回新しい
  // ディープクローンで（木は下の query.ts の呼び出しでその場変更される
  // ので、同じ参照を push してもストアの identity-equality ガードを
  // 決して通らない――selectedSet のスライスと同じ問題、同じ修正）。これが
  // 「木が変わった」ことに対する唯一のゲート（addFilter/removeFilter/
  // removeNode/removeBy* に加え setTree/resetTree まで、あらゆる変更経路が
  // syncShadow を呼ぶ）なので、ここでの1回の push がそれらすべてをカバー
  // する。
  const syncShadow = () => {
    shadow = buildShadow(tree);
    if (ctx.storeKey) store.setState({ [ctx.storeKey]: JSON.parse(JSON.stringify(tree)) });
  };
  // 木のどの変更の後にも行う唯一の正準リフレッシュ: シャドウを作り直し
  // （それがストアへ木を push する）、それから view に再描画させる――
  // ストアへの push こそが FilterChips に再計算させるもの。
  const refresh = () => {
    syncShadow();
    ctx.onChange();
  };

  // サイドバーの入り口は条件をその属性クラスタへ加える（改訂④）: 新顔は
  // 自分の type のグループに加わるか、既存の単独の葉と対になる（構造は
  // 導出されるもの――利用者が自分でそれを組み立てることは決してない）。
  // ファセット形でない木（永続化された改訂③の入れ子）では代わりに最上位
  // （AND）に着地する。
  function addFilter(filter: { type: string; [k: string]: any }): HologramQueryLeaf | null {
    // 単一値の type（単一選択）: 新しいものは、木のどこにあっても既存のものを置き換える。
    if (singleValueTypes.includes(filter.type)) removeCondsMatching((c) => c.type === filter.type);
    // 完全な重複を（木のどこであれ）防ぐ。ただし multi 型は除く。
    // 同一性は sameLeaf のもので、単純な type+value ではない: tagId を
    // 持つタグの葉は実体そのものなので、同名の2つのタグのうち2つ目は
    // 重複ではない（#774）。
    else if (!noDupTypes.includes(filter.type) && hasSameLeaf(tree, filter)) return null;
    const node = Object.assign({ kind: 'cond' as const }, filter);
    if (facetViewOf(tree, facetOpts)) facetAdd(tree, node, facetOpts);
    else tree.children.push(node);
    cleanupTree(tree);
    refresh();
    return node; // 新しい葉に結び付ける呼び出し元（例: 編集中のテキストの葉）がこれを必要とする
  }
  // `index` にあるシャドウフィルタに一致する条件を削除する（値の選択
  // ルーターがシャドウへ findIndex する）。チップの削除は removeNode /
  // removeByType をノード自体で呼ぶ。
  function removeFilter(index: number) {
    const f = shadow[index];
    if (!f) return;
    removeCondsMatching((c) => sameLeaf(c, f));
    refresh();
  }
  function removeNode(node: HologramQueryLeaf) {
    if (ctx.onLeafMutated) ctx.onLeafMutated(node); // view に整合を取らせる（例: 編集中のテキストの葉の結び付けを外す）
    detachNode(node, treeParentMap(tree));
    cleanupTree(tree);
    refresh();
  }

  return {
    getTree: () => tree,
    // 木を置き換える（クローン＋単一メンバーグループの自己修復＋シャドウの
    // 再計算）。ファセット互換な永続化済みの木は、ここで正準形に正規化
    // される――render()（描画のたびにそれを再主張していた）が無くなった
    // 今、唯一の正規化ポイント。他のあらゆる変更経路は形を保つ: facetAdd は
    // 本物のグループノードを構築し、detach/cleanup はそれらを縮めるだけ。
    setTree: (t: HologramQueryGroup | null | undefined) => {
      tree = t ? JSON.parse(JSON.stringify(t)) : emptyTree();
      cleanupTree(tree);
      canonicalizeFacet(tree, facetOpts);
      syncShadow();
    },
    resetTree: () => {
      tree = emptyTree();
      // どの木の変更もフラットなシャドウを再同期しなければならない
      // （refresh() が記録している不変条件）。resetTree はそれをスキップ
      // していた唯一のミューテータで、次の変更まで、シャドウとその利用側
      // （.shadow() の読み手→サイドバー行のバッジ）を古いままにしていた。
      // post 側の呼び出し元は、後続の afterQueryChange()→refresh() に
      // よって隠されていた。poster のリセット（renderPosters、refresh
      // 無し）は、「リセット」の後も点灯したままの行バッジとしてそれを
      // 露呈させた。
      syncShadow();
    },
    addFilter,
    removeFilter,
    removeNode,
    removeByLeaf: (type: string, value: unknown) => {
      if (removeCondsMatching((c) => c.type === type && c.value === value)) refresh();
    },
    removeByType: (type: string) => {
      if (removeCondsMatching((c) => c.type === type)) refresh();
    },
    removeCondsMatching,
    qHasValue,
    qHasTag,
    refresh,
    syncShadow,
    eval: (item: unknown) => evalNode(tree, item, ctx.predOf),
    hasQuery: () => tree.children.length > 0,
    shadow: () => shadow,
  };
}
