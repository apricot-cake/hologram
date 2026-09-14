// クエリエンジン＝Hologram の絞り込みにおける論理条件木の核（改訂③）。viewer.js
// から1:1で抽出した、viewer 分解（最終形B）における最初の「純粋ロジック→
// サービス」切り出し。実体は本物の ES モジュール（named exports）で、
// 利用側（viewer.ts / query-chips.ts / sidebar.ts / tabs.ts）から相対パスで
// 直接 import される。DOM には一切触れない。ランタイムの結合（コレクション／
// 検索の一致器）は makePostPredOf(deps) を通して注入されるので、このファイルは
// 単体で動かせる（scripts/test-query-unit.cts が dynamic import() で読み込む）。

// --- 条件木の仕組み。木は常にルートグループ（既定で op は 'and'）。葉は
// {kind:'cond', type, value, …}、グループは children と任意の neg を持つ。
// 2つのクエリビルダー（posts / posters）の両方で共有する。 ---
/** @returns {HologramQueryGroup} */
export function emptyTree() {
  return { kind: 'group', op: 'and', neg: false, children: [] } as HologramQueryGroup;
}
export function treeLeaves(n: HologramQueryNode | null | undefined, out?: HologramQueryLeaf[]): HologramQueryLeaf[] {
  out = out || [];
  if (!n) return out;
  if (n.kind === 'cond') out.push(n);
  else (n.children || []).forEach((c) => treeLeaves(c, out));
  return out;
}
export function opposite(op: string): 'and' | 'or' {
  return op === 'and' ? 'or' : 'and';
}
export const cloneTree = (tree: HologramQueryNode) => JSON.parse(JSON.stringify(tree, (k, v) => (k[0] === '_' ? undefined : v)));
// 移行専用: 古い永続化ファセット状態（f + typeOps）から木を再構築する。
export function facetTreeFrom(f: ReadonlyArray<{ type: string; [k: string]: any }>, ops?: Record<string, string> | null): HologramQueryGroup {
  const root = emptyTree();
  const NO_OP = new Set(['date', 'engagement']);
  const byType = new Map<string, { type: string; [k: string]: any }[]>();
  for (const x of f) {
    let list = byType.get(x.type);
    if (!list) {
      list = [];
      byType.set(x.type, list);
    }
    list.push(x);
  }
  for (const [type, list] of byType) {
    const leaves: HologramQueryLeaf[] = list.map((x) => Object.assign({ kind: 'cond' as const }, x));
    if (NO_OP.has(type)) {
      root.children.push(...leaves);
      continue;
    }
    const op = (ops || {})[type] || 'or';
    root.children.push({ kind: 'group', op: op === 'and' ? 'and' : 'or', neg: op === 'not', children: leaves } as HologramQueryGroup);
  }
  return root;
}
// クエリ木を1件のアイテムに対して再帰的に評価する。view 側が渡す葉の述語
// ファクトリ（predOf）を使う。両ビルダー（post + poster）で共有する。
export function evalNode(n: HologramQueryNode, item: unknown, predOf: (f: HologramQueryLeaf) => (item: any) => boolean): boolean {
  if (n.kind === 'cond') {
    const r = predOf(n)(item);
    return n.neg ? !r : r;
  }
  const r = n.op === 'or' ? n.children.some((c) => evalNode(c, item, predOf)) : n.children.every((c) => evalNode(c, item, predOf));
  return n.neg ? !r : r;
}

// --- 木の変更ドメイン（9番目の抽出切り出し）。純粋な木の外科手術で両方の
// ビルダーインスタンス（posts / posters）が共有する: どの関数も木（またはノード）
// を引数に取り、DOM には一切触れない。ドラッグ＆ドロップ／描画／メニューの配線は
// viewer.ts（createQueryBuilder）側に残り、そこがこれらをインスタンスごとの木に
// 結び付ける。 ---
/** 子 → 親 のマップ。1回の手術パスごとに作り直す。 */
export function treeParentMap(tree: HologramQueryGroup): Map<HologramQueryNode, HologramQueryGroup> {
  const m = new Map<HologramQueryNode, HologramQueryGroup>();
  (function rec(n: HologramQueryNode) {
    if (n.kind !== 'group') return;
    (n.children || []).forEach((c) => {
      m.set(c, n);
      rec(c);
    });
  })(tree);
  return m;
}
export function nodeContains(a: HologramQueryNode | null | undefined, b: HologramQueryNode | null | undefined): boolean {
  if (a === b) return true;
  if (!a || a.kind !== 'group') return false;
  return (a.children || []).some((c) => nodeContains(c, b));
}
export function detachNode(node: HologramQueryNode, pmap: Map<HologramQueryNode, HologramQueryGroup>): void {
  const par = pmap.get(node);
  if (!par) return;
  const i = par.children.indexOf(node);
  if (i >= 0) par.children.splice(i, 1);
}
// 自動整理: 空のグループを落とし、ルート以外の単一メンバーのグループは
// 折り畳み、グループの否定を残ったメンバーに畳み込む（「グループがメンバー
// 1つまで減ったら括弧は消える」）。
export function cleanupTree(tree: HologramQueryGroup): void {
  (function rec(node: HologramQueryNode) {
    if (node.kind !== 'group') return;
    const out: HologramQueryNode[] = [];
    for (const c of node.children) {
      rec(c);
      if (c.kind === 'group') {
        if (!c.children.length) continue; // drop empty
        if (c.children.length === 1) {
          const only = c.children[0];
          if (c.neg) only.neg = !only.neg;
          out.push(only);
          continue;
        } // 単一メンバーを折り畳む
      }
      out.push(c);
    }
    node.children = out;
  })(tree);
}
export function hasLeafValue(tree: HologramQueryGroup, type: string, value: unknown): boolean {
  return treeLeaves(tree).some((c) => c.type === type && c.value === value);
}
// pred に一致する cond の葉を木のどこからでも削除する（+ 整理）。実際に何か
// 削除されたかを返す（呼び出し側はこれを見て再描画するかを決める）。
export function removeCondsMatching(tree: HologramQueryGroup, pred: (c: HologramQueryLeaf) => boolean): boolean {
  const before = treeLeaves(tree).length;
  (function rec(node: HologramQueryNode) {
    if (node.kind !== 'group') return;
    node.children = node.children.filter((c) => !(c.kind === 'cond' && pred(c)));
    node.children.forEach(rec);
  })(tree);
  cleanupTree(tree);
  return treeLeaves(tree).length !== before; // 変わったか?
}
// シャドウフィルタの同一性判定: date は type だけで一致とみなす（date 条件は
// 常に1つ）、engagement は engType で、それ以外は value で判定する。
export function sameLeaf(c: HologramQueryLeaf, f: { type: string; [k: string]: any }): boolean {
  if (c.type !== f.type) return false;
  if (f.type === 'date') return true; // date 条件は常に1つ
  if (f.type === 'engagement') return c.engType === f.engType;
  // #162: dimension の葉は軸（width/height/long/bytes）で一意＝value では
  // ない。同じ軸の葉が2つ共存することはない（エディタは置き換える）。
  if (f.type === 'dimension') return c.axis === f.axis;
  if (f.type === 'tag' && c.tagId != null && f.tagId != null) return c.tagId === f.tagId;
  return c.value === f.value;
}
/** 木がすでに `f` と sameLeaf 判定で同一の葉を持っているか？（addFilter の重複防止用）。 */
export function hasSameLeaf(tree: HologramQueryGroup, f: { type: string; [k: string]: any }): boolean {
  return treeLeaves(tree).some((c) => sameLeaf(c, f));
}
// フラットな（重複除去済みの）葉のシャドウ＝サイドバーのハイライト／行の
// バッジ／タブのタイトルが使うもの。date/engagement は（木専用フィールドを
// 除いて）そのまま通す。それ以外の type は type+value で重複除去する。
export function buildShadow(tree: HologramQueryGroup): Array<{ type: string; [k: string]: any }> {
  const seen = new Set<string>();
  const out: Array<{ type: string; [k: string]: any }> = [];
  for (const c of treeLeaves(tree)) {
    if (c.type === 'date' || c.type === 'engagement' || c.type === 'dimension') {
      const f: Record<string, any> = Object.assign({}, c);
      delete f.kind;
      delete f.neg;
      out.push(f as { type: string; [k: string]: any });
      continue;
    }
    // #774: タグの葉の同一性は、tagId を持つならその tagId＝上の sameLeaf が
    // これを優先するのと同じ理由。これが無いと、同名の2つのタグ実体が1つの
    // シャドウ項目に潰れてしまい、2つ目のファセット行を二度とオフにできなく
    // なる。
    const k = c.type + ' ' + (c.type === 'tag' && c.tagId != null ? '#' + c.tagId : c.value);
    if (seen.has(k)) continue;
    seen.add(k);
    const f: { type: string; [k: string]: any } = { type: c.type, value: c.value };
    if (c.label) f.label = c.label;
    if (c.type === 'tag' && c.tagId != null) f.tagId = c.tagId;
    out.push(f);
  }
  return out;
}
// ドラッグ＆ドロップを木に適用する: 'pair' は target と drag を新しいグループ
// （周囲のグループと逆の演算子を持つ）でくるむ、'inside' は drag を target
// グループのメンバーとして加える、'root' は最上位へ移す。ドロップが却下される
// とき（自分自身へ、または自分の子孫へ）は false を返す（木は変更しない）。
export function dropNode(tree: HologramQueryGroup, drag: HologramQueryNode | null | undefined, target: HologramQueryNode | null | undefined, mode: 'pair' | 'inside' | 'root'): boolean {
  if (!target || !drag || target === drag || nodeContains(drag, target)) return false;
  const pmap = treeParentMap(tree);
  detachNode(drag, pmap); // まず今の親から切り離す
  if (mode === 'pair') {
    const par = pmap.get(target) || tree;
    const g: HologramQueryGroup = { kind: 'group', op: opposite(par.op), neg: false, children: [target, drag] };
    const i = par.children.indexOf(target);
    if (i >= 0) par.children[i] = g;
    else par.children.push(g);
  } else if (mode === 'inside') {
    target.children.push(drag);
  } else {
    tree.children.push(drag);
  }
  cleanupTree(tree);
  return true;
}
// 現在の式全体を1つのグループでくるむ（押すたびにさらに深く入れ子になる）。
// 新しいルートを返す（呼び出し側がその木を再代入する）。くるむものが無ければ
// null。単一条件のくるみは整理で潰れる（グループ化する意味が無いため）。
export function wrapAllInGroup(tree: HologramQueryGroup): HologramQueryGroup | null {
  if (!tree.children.length) return null;
  const g = { kind: 'group', op: tree.op, neg: false, children: tree.children } as HologramQueryGroup;
  const root = { kind: 'group', op: 'and', neg: false, children: [g] } as HologramQueryGroup;
  cleanupTree(root);
  return root;
}

// --- ファセットドメイン（改訂④のファセットチップ）。
// UI が組み立てるのは常にファセット CNF の木だけ: ルートグループ(and) の
// children が、type ごとのグループ（1つの type の正の値が2つ以上）、単独の
// 正の葉、否定された葉（「除外」クラスタ＝ルートが AND なので「これらのどれで
// もない」を意味する）。任意の木は永続化された改訂③の状態のために引き続き
// 評価可能（evalNode 自体は変えていない）＝バーはそれらを読み取り専用として
// 描画するだけ。
// opts: { multiValueTypes: string[], standaloneTypes: string[] } ＝view 側が
// 持つ type スキーマ（posts と posters で異なる）。predOf 同様に注入される。 ---
/** クラスタ内の既定演算子: 複数値を取る属性は既定で絞り込む（「すべて」）。
 *  単一値の属性は「いずれか」だけが充足可能な読みになる。 */
export function facetDefaultOp(type: string, opts: HologramFacetOpts): 'and' | 'or' {
  return (opts.multiValueTypes || []).includes(type) ? 'and' : 'or';
}
// 厳密なファセット解析。null＝ファセット形でない（OR ルート／本物の入れ子／
// 否定・空・型混在のグループ／同じ type の入れ物が2つ）→ バーは読み取り専用の
// 要約にフォールバックする。意味は保存しつつ、意図した修復を1つだけ行う:
// 同じ type の単独・単一値の葉が2つ以上あれば 'or' として読む（それらの
// ルート-AND は改訂③の「2プラットフォームで常に false になる」罠だった）。
export function facetViewOf(tree: HologramQueryGroup, opts: HologramFacetOpts): HologramFacetView | null {
  if (!tree || tree.kind !== 'group' || tree.op !== 'and' || tree.neg) return null;
  const standalone = new Set<string>(opts.standaloneTypes || []);
  const multi = new Set<string>(opts.multiValueTypes || []);
  const clusters = new Map<string, HologramFacetCluster>(); // type → cluster（挿入順＝表示順）
  const singles: HologramQueryLeaf[] = [];
  const excl: HologramQueryLeaf[] = [];
  for (const c of tree.children) {
    if (c.kind === 'cond') {
      if (c.neg) {
        excl.push(c);
        continue;
      }
      if (standalone.has(c.type)) {
        singles.push(c);
        continue;
      }
      const cl = clusters.get(c.type);
      if (cl) {
        if (cl.grouped) return null; // グループ＋同じ type の孤立した葉 = cluster∧leaf であってクラスタではない
        cl.leaves.push(c);
        cl.op = multi.has(c.type) ? 'and' : 'or'; // 単独の葉はルートの AND で結合される（単一値の場合は修復済み）
      } else clusters.set(c.type, { type: c.type, op: facetDefaultOp(c.type, opts), leaves: [c], grouped: false });
      continue;
    }
    if (c.kind !== 'group' || c.neg || !c.children.length) return null;
    const first = c.children[0];
    const t = first.kind === 'cond' ? first.type : null;
    if (!t || standalone.has(t) || clusters.has(t)) return null;
    for (const l of c.children) if (l.kind !== 'cond' || l.neg || l.type !== t) return null;
    clusters.set(t, { type: t, op: multi.has(t) ? c.op : 'or', leaves: c.children.slice() as HologramQueryLeaf[], grouped: true });
  }
  return { clusters: Array.from(clusters.values()), singles, excl };
}
// ファセット形の木を正準形に破壊的に再構築する: 値が2つ以上あるクラスタは
// すべて本物のグループになる（「すべて」／「いずれか」のトグルには書き込み先の
// ノードが要る）。順序はクラスタ→単独の葉→除外された葉。木がファセット形
// だった（今は正準形になった）場合は true、そうでなければ木は変更せず false。
export function canonicalizeFacet(tree: HologramQueryGroup, opts: HologramFacetOpts): boolean {
  const v = facetViewOf(tree, opts);
  if (!v) return false;
  const out: HologramQueryNode[] = [];
  for (const cl of v.clusters) out.push(cl.leaves.length === 1 ? cl.leaves[0] : ({ kind: 'group', op: cl.op, neg: false, children: cl.leaves } as HologramQueryGroup));
  out.push(...v.singles, ...v.excl);
  tree.children = out;
  return true;
}
// 正の葉をその type のクラスタへ挿入する: 既存のグループに参加させるか、
// 既存の単独の葉と新顔を新しいグループ（既定の op）でくるむか、最上位に置く
// （standalone な type は常にこれ）。単一値の置き換えと重複チェックは呼び出し側
// が行う。ファセット形の木に対してのみ呼ぶこと。
export function facetAdd(tree: HologramQueryGroup, node: HologramQueryLeaf, opts: HologramFacetOpts): HologramQueryLeaf {
  if (!(opts.standaloneTypes || []).includes(node.type)) {
    for (let i = 0; i < tree.children.length; i++) {
      const c = tree.children[i];
      if (c.kind === 'group' && !c.neg && c.children.length && c.children[0].kind === 'cond' && c.children[0].type === node.type) {
        c.children.push(node);
        return node;
      }
      if (c.kind === 'cond' && !c.neg && c.type === node.type) {
        tree.children[i] = { kind: 'group', op: facetDefaultOp(node.type, opts), neg: false, children: [c, node] };
        return node;
      }
    }
  }
  tree.children.push(node);
  return node;
}
// 「すべて」／「いずれか」のトグル: クラスタの演算子を設定する。値が2つ以上の
// クラスタは正準形の木では本物のグループになっている。そのグループが無ければ
// false。
export function facetSetOp(tree: HologramQueryGroup, type: string, op: string): boolean {
  for (const c of tree.children) {
    if (c.kind === 'group' && !c.neg && c.children.length && c.children[0].kind === 'cond' && c.children[0].type === type) {
      c.op = op === 'and' ? 'and' : 'or';
      return true;
    }
  }
  return false;
}
// 葉をそのクラスタと「除外」クラスタの間で移動する: 切り離し、neg を反転し、
// 再挿入する（否定→最上位、正→facetAdd を通して戻す）。すでに正の値として
// 存在するものが戻ってきた場合は冗長として捨てる。
export function facetSetNeg(tree: HologramQueryGroup, node: HologramQueryLeaf, neg: boolean, opts: HologramFacetOpts): boolean {
  if (!!node.neg === !!neg) return false;
  detachNode(node, treeParentMap(tree));
  cleanupTree(tree);
  node.neg = !!neg;
  if (neg) {
    tree.children.push(node);
    return true;
  }
  const dup = treeLeaves(tree).some((c) => !c.neg && c.type === node.type && c.value === node.value);
  if (!dup) facetAdd(tree, node, opts);
  return true;
}

// --- 純粋な post ヘルパー（下の述語群と viewer.ts が使う）。 ---
// 日付フィルタはローカルの日単位で比較する: from = ローカルの深夜0時、
// to = 次のローカルの深夜0時（含まない）。これで単日の範囲がその日全体を
// カバーする。
export function localDayRange(from?: string | null, to?: string | null): { from: Date | null; to: Date | null } {
  return {
    from: from ? new Date(from + 'T00:00:00') : null,
    to: to
      ? (() => {
          const d = new Date(to + 'T00:00:00');
          d.setDate(d.getDate() + 1);
          return d;
        })()
      : null,
  };
}
export const hostOf = (url: string | null | undefined): string => {
  try {
    return new URL(url as string).hostname;
  } catch {
    return '';
  }
};
// 投稿者ごとの安定したキー: プラットフォームのユーザー id を優先し、無ければ
// 代わりにハンドルを使う。対応サイト外から保存したレコード（#253 のドメイン行候補）は、
// キーにできる固定のプラットフォーム名前空間を持たない
// ＝代わりに URL のホストでキーを閉じることで、異なるサイトにいる同名の投稿者が
// 1人の投稿者に衝突するのを防ぐ（#760: かつては2つの 'null:@alice' が見分け
// つかなかった）。ブックマーク自体はこの分岐の identity 側には決して到達しない
// （userId/screenName を持たない＝users.ts の buildUsers 自身の identity ゲートが
// ポスターグリッドから完全に締め出す）が、将来 identity 情報を持つプラットフォーム
// レスのレコード（#239）は到達しうる。
export const userKey = (p: HologramPost): string => {
  const id = p.userId || '@' + (p.screenName || '');
  if (!p.platform) return 'web:' + hostOf(p.url) + ':' + id;
  return p.platform + ':' + id;
};
// 'post' と 'image' は出典 URL の有無で分ける。URL だけのブックマークは新規に
// 作らないため、独立した種別を持たない。
export const kindOf = (p: HologramPost): 'post' | 'image' => (p.url ? 'post' : 'image');
// #365: このレコードが視覚的な media を何か持っているか＝自身の image、video
// フィールド、または media[] のエントリのいずれか。あえて `p.mediaType == null`
// ではなく生のフィールドから判定している＝その null は曖昧（media は宣言されて
// いたのに type の解決に失敗した場合、例えば壊れた X の mediaDetails エントリ、
// でも起こる）ので、「この投稿にはサムネイルとして出せるものが何も無い」の
// 代わりにはできない。これが false になる投稿こそ、#365 がサムネイルの代わりに
// 本文テキストのカード面を与える「テキストのみ」のケースそのもの。
export const hasVisualMedia = (p: HologramPost): boolean => !!p.image || !!p.video || (Array.isArray(p.media) && p.media.some((m: any) => m && m.file));
// フリーテキストのクエリが一致対象にするテキストらしいフィールドすべて。
// media[].alt（#288）: 保存済みの ALT テキスト＝X の `ext_alt_text`／Bluesky の
// `alt`。保存時に
// すでに取得済み。pixiv には ALT の概念が無い（そちらでは media[].alt は常に
// null）ので、このプラットフォームでは何もしない。これが現状唯一の生きた
// フリーテキスト検索経路＝SQLite の posts_fts 索引（lib-db-schema.ts）はまだ
// 検索 UX に配線されていない（lib-db-query.ts の searchPostsFts はテスト／
// ベンチ以外に呼び出し元が無い。#29 がいずれの利用者になる予定）ので、そちらに
// alt を追加してもその段階が実装されるまでは利用者が見つけられるものは変わらない。
// p.seriesTitle（#188）: pixiv のシリーズ名＝「シリーズ名で検索」がそのシリーズの
// 保存済み作品すべてを見つけられるようにする。それ以外（シリーズ無し、または
// pixiv 以外の投稿）では null。ここにある他のフィールドと同じ、欠損を許容する
// 決まりに従う。
// p.quotedPost/p.replyToPost（#180）: quote／repost 先や返信先の投稿自身が持つ
// サイドカーのサブレコード＝そのテキストや投稿者への
// 検索ヒットは親の投稿を表に出す。サブレコード自体は独立して一覧に載らないため
// （#180 への 2026-07-27 の設計コメント: 「単体では検索にヒットしない…引用先の
// 本文は親の検索テキスト束へ連結する」）。どちらも無い投稿（大多数）では
// null＝ここにある他のフィールドと同じ、欠損を許容する決まりに従う。
// p.poll（#179）: アンケートの選択肢ラベル＝保存済みのアンケートを、何を尋ねたか
// で見つけられるようにする。投稿者自身が書いた語句で、投稿テキストと同じ扱い。
// アンケートの無い投稿では null＝残りと同じ、欠損を許容する決まりに従う。
// p.linkCard（#181）: リンク共有投稿の OGP プレビューカード＝その title と
// description は投稿自身の言葉と同じ検索テキストの束に連結される（#181 の
// 「なぜ」: 「専用構文は増やさない」）。リンクを共有していない投稿では null。
// カード自身の URL は別扱い＝下の 'text' 葉の URL 照合が扱う（quotedUrl 自身の
// 扱いと同じ）。
export function textHaystackOf(p: HologramPost): string[] {
  return [p.text, p.title, p.eagleName, p.screenName, p.displayName, p.seriesTitle]
    .concat(p.tags || [])
    .concat(p.hashtags || [])
    .concat((p.media || []).map((m: any) => m?.alt))
    .concat([p.quotedPost, p.replyToPost].flatMap((q: any) => (q ? [q.text, q.displayName, q.screenName].concat((q.media || []).map((m: any) => m?.alt)) : [])))
    .concat(((p.poll as any)?.choices || []).map((c: any) => c?.text))
    .concat(p.linkCard ? [(p.linkCard as any).title, (p.linkCard as any).description] : [])
    .map((x) => (x == null ? '' : String(x)));
}

// --- 廃止された葉タイプ名に対する、保存済み葉スキーマの自己修復 --------------
// 廃止された葉タイプの改名を記録する唯一の場所。sanitizeSavedTabs は読み込み時に
// 永続化された木＋シャドウ（state.tree / state.f）をすべて normalizeTree /
// normalizeLeaf に通すので、古い tabs.json は次の書き込みで自己修復する＝
// 一括書き換えスクリプトも、恒久的な述語のエイリアスを抱える必要も無い。これは
// 一度きりの移行用の足場ではなく常設の仕組み: 葉の `type` を改名するたびに、
// 今後もここへ行を追加する。未知の type はそのまま通り、述語は安全側に開く
// （既定 → () => true）ので、チップはそれでも自分の type を表示し続ける。
const LEAF_TYPE_RENAMES: Record<string, string> = { collection: 'folder' };
export function normalizeLeaf<T extends { type?: unknown }>(leaf: T): T {
  if (leaf && typeof (leaf as any).type === 'string') {
    const to = LEAF_TYPE_RENAMES[(leaf as any).type];
    if (to) (leaf as any).type = to;
  }
  return leaf;
}
// クエリ木のすべての葉を破壊的に再帰正規化する。グループは children を持ち、
// それ以外は葉として扱う。
export function normalizeTree(node: any): any {
  if (!node || typeof node !== 'object') return node;
  if (node.kind === 'group' && Array.isArray(node.children)) {
    node.children = node.children.filter((child: any) => !(child?.kind === 'cond' && child.type === 'instance'));
    node.children.forEach(normalizeTree);
    cleanupTree(node);
  } else normalizeLeaf(node);
  return node;
}

// --- post 側の葉述語ファクトリ: 葉の条件 → (post)=>bool。 ---
// deps はエンジンが自前で持ってはいけないランタイムの結合を運ぶ:
//   isInFolder(id, captureId) ＝folders.ts の状態
//   searchCompile(q) → matcher(string)=>bool、または部分一致にフォールバックする
//     null
//   tagIdOf(name) → タグ名に対する DB のタグ id（#5 の 2026-07-18 のコメント＝
//     タグは ID 実体で、名前しか持たない保存済みの葉は、DB 移行後の最初の評価時
//     （下）に遅延解決してその id をキャッシュする）
export function makePostPredOf(deps: {
  /** `only` = 葉の「このフォルダのみ」フラグ。無ければフォルダはそのサブツリー全体を表す（#41）。 */
  isInFolder(id: string, captureId: string, only?: boolean): boolean;
  searchCompile?(q: string): ((hay: string) => boolean) | null;
  postKeyOf?(url: string | null | undefined): string | null;
  tagIdOf?(name: string): number | undefined;
}): (f: HologramQueryLeaf) => (p: HologramPost) => boolean {
  return function postPredOf(f) {
    switch (f.type) {
      // 'post' = SNS の投稿（リンクを持つ）／'image' = 取得した画像（リンク無し）。
      case 'kind':
        return (p) => kindOf(p) === f.value;
      case 'platform':
        return (p) => (f.value === '__none' ? !p.platform : p.platform === f.value);
      case 'user':
        return (p) => userKey(p) === f.value;
      case 'postType':
        return (p) => (f.value === 'post' ? !p.isReply && !p.isQuote && !p.isThread : f.value === 'reply' ? !!p.isReply : f.value === 'quote' ? !!p.isQuote : !!p.isThread);
      // '__none' = media が一切無い（#365 のテキストのみの行）＝上下にある
      // platform/tag 自身の '__none' の葉と同じ番兵の形。mediaType だけからは
      // 判定できない（hasVisualMedia の doc コメント参照）。
      case 'media':
        return (p) => (f.value === '__none' ? !hasVisualMedia(p) : p.mediaType === f.value);
      // タグの葉は、可能なら tagId で一致判定する＝改名は posts[].tags（表示名）を
      // 変えるが id は決して変えないので、id に固定した葉は改名を生き延びる
      // （#5 の 2026-07-18 のコメント）。DB 移行前に保存された葉は `value`
      // （名前）しか持たない＝tabs.json への個別の移行パスを要求する代わりに、
      // 最初の評価時にここで tagId を解決してキャッシュする（下の 'text' 葉の
      // _compiled メモと同じ考え方）。id が解決できない（deps.tagIdOf が無い、
      // またはその名前がもう存在しない）ときは名前一致にフォールバックする＝
      // 古い、あるいはすでに削除されたタグでも致命的な失敗にはしない。
      case 'tag': {
        // 「タグ無し」: タグではない唯一のタグの葉。固定すべき id も一致させる
        // べき名前も持たない＝tagIdOf を通して解決すると、文字通り '__none' と
        // いう名前のタグを探すことにフォールバックしてしまう＝だからこれを最初に
        // 答える。上の platform の '__none' と同じ番兵の形。
        if (f.value === '__none') return (p) => !(p.tags || []).length;
        if (f.tagId == null && deps.tagIdOf) f.tagId = deps.tagIdOf(f.value);
        return (p) => (f.tagId != null ? (p.tagIds || []).includes(f.tagId) : (p.tags || []).includes(f.value));
      }
      case 'hashtag':
        return (p) => (p.hashtags || []).includes(f.value);
      // フォルダの葉はそのフォルダ「かつ」その下に入れ子になったものすべてを
      // 意味する。`only` はそれをフォルダ自身の投稿だけに絞る（#41）。既定では
      // このフラグは無いので、入れ子ができる前に書かれた木はすべて、何も子を
      // 持たなかった当時の意味のままになる。
      case 'folder':
        return (p) => deps.isInFolder(f.value, p.captureId, f.only);
      case 'date': {
        const field = f.dateField === 'capturedAt' ? 'capturedAt' : 'date';
        const { from, to } = localDayRange(f.from, f.to); // ローカル日の境界（localDayRange 参照）
        return (p) => {
          const value = p[field];
          if (!value) return false;
          const d = new Date(value);
          return (!from || d >= from) && (!to || d < to);
        };
      }
      case 'engagement': {
        if (!(f.min > 0)) return () => true;
        const field = f.engType as 'likes' | 'reposts' | 'replies' | 'bookmarks' | 'views';
        return (p) => (f.op === 'lte' ? (p[field] || 0) <= f.min : (p[field] || 0) >= f.min);
      }
      // #162: dimension／ファイルサイズのファセット。axis が読むのは #162 の
      // 設計コメントが導入したレコードごとの集約値（mediaMaxW/H/Bytes＝media[]
      // の最大値、media[] が無ければカード画像にフォールバック）。'long' は
      // 幅・高さの大きい方（縦長の 2000×3000 は横長の 3000×2000 と同じく
      // 「長辺≥2000」を満たす）。0／欠損（一度も測っていない、または測っても
      // サイズが取れない＝media[] の寸法を持たない動画）は設計自身の判断:
      // 欠損データは正・否定のどちらの dimension 条件も満たさない
      // （欠損＝条件不成立）。
      case 'dimension': {
        if (!(f.value > 0)) return () => true;
        return (p) => {
          const v = f.axis === 'width' ? p.mediaMaxW || 0 : f.axis === 'height' ? p.mediaMaxH || 0 : f.axis === 'long' ? Math.max(p.mediaMaxW || 0, p.mediaMaxH || 0) : p.mediaMaxBytes || 0;
          if (!(v > 0)) return false;
          return f.op === 'lte' ? v <= f.value : v >= f.value;
        };
      }
      case 'text': {
        const q = (f.value || '').trim();
        if (!q) return () => true;
        const key = q;
        if (f._compiledKey !== key || !f._compiled) {
          f._compiledKey = key;
          // URL 照合: url/quotedUrl/linkCard.url は URL らしいクエリ（'.' か '/'
          // を含む）に対してのみ一致判定し、常にただの部分文字列として扱う＝
          // あいまい一致にはしない。短いラテン文字の語句を長い URL に対して
          // 部分列マッチさせると、ほとんど何にでも当たってしまうため。完全な
          // URL を貼り付けた場合はさらに正規化した post key（deps.postKeyOf）
          // でも一致判定するので、x.com⇄twitter.com やトラッキングパラメータ違いの
          // 保存済み投稿にもちゃんと当たる。linkCard.url は単純な部分文字列
          // チェックだけを受ける（#181 の「なぜ」: 「記事URLで検索→それを共有した
          // 投稿が出る」）＝これは対応プラットフォーム自身の投稿ではなく任意の
          // 外部ページを指すので、postKeyOf の SNS 固有の正規化には正規化すべき
          // ものが無い。
          const lq = q.toLowerCase();
          const urlish = /[./]/.test(q);
          const qKey = urlish && deps.postKeyOf ? deps.postKeyOf(q) : null;
          const urlHit: ((p: HologramPost) => boolean) | null = !urlish
            ? null
            : (p: HologramPost) => (qKey != null && (p._postKey === qKey || p._quotedKey === qKey)) || (p.url || '').toLowerCase().includes(lq) || (p.quotedUrl || '').toLowerCase().includes(lq) || ((p.linkCard as any)?.url || '').toLowerCase().includes(lq);
          const m = deps.searchCompile ? deps.searchCompile(q) : null;
          if (m) {
            f._compiled = (p: HologramPost) => m(textHaystackOf(p).join(' ')) || (urlHit != null && urlHit(p));
          } else {
            f._compiled = (p: HologramPost) => textHaystackOf(p).some((s) => s.toLowerCase().includes(lq)) || (urlHit != null && urlHit(p));
          }
        }
        return f._compiled;
      }
      default:
        return () => true;
    }
  };
}

export function makePosterPredOf(deps: { posterTagEntriesOf(key: string): HologramTagEntry[] }): (f: HologramQueryLeaf) => (u: HologramUserAgg) => boolean {
  return function posterPredOf(f) {
    switch (f.type) {
      case 'platform':
        return (u) => u.platform === f.value;
      case 'followers':
        return (u) => u.platform === f.platform && u.followers != null && (f.op === 'lte' ? u.followers <= f.min : u.followers >= f.min);
      case 'tag':
        return (u) => {
          const entries = deps.posterTagEntriesOf(u.key);
          return f.tagId != null ? entries.some((e) => e.id === f.tagId) : entries.some((e) => e.name === f.value);
        };
      case 'date': {
        // あえて keyof HologramUserAgg より狭くしている（#23 St1 が追加した
        // members/platforms は string[] で、new Date() には渡せない）:
        // date の葉が指すのはこの3つの文字列値フィールドのどれか1つだけ。
        const field = (f.dateField || 'latest') as 'latest' | 'lastCapture' | 'authorCreatedAt';
        const { from, to } = localDayRange(f.from, f.to); // ローカル日の境界（localDayRange 参照）
        return (u) => {
          const v = u[field];
          if (!v) return false;
          const d = new Date(v);
          return (!from || d >= from) && (!to || d < to);
        };
      }
      default:
        return () => true;
    }
  };
}
