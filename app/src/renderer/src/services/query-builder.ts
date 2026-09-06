// クエリビルダーのインスタンス配線＝postQB/posterQB の構築を、旧 viewer.ts
// のモノリスから抽出したもの。
// createQueryBuilder 自体（共有エンジン: 木の状態、変更用ヘルパー、葉の
// シャドウ）はすでに query-chips.ts にある――このモジュールは、以前は
// viewer.ts にインラインであった view 固有の接着剤: post/poster の述語
// 構築（query.ts の makePostPredOf/makePosterPredOf、今では本物になった
// folders.ts/search.ts/records.ts の各モジュールへ配線されている）と、
// createQueryBuilder(ctx) の2つの呼び出し場所。viewer.ts が引き続き持つ
// もの（タグ id の検索、描画コールバック）は deps として注入される――
// createQueryBuilder 自身が使うのと同じ ctx パターン。
//
// これはかつて葉のグリフ表（qcGlyph）も持っていた: 引退した query-chips
// コンポーネントがチップごとに描いていたインライン SVG 文字列。今の生きた
// チップ（filterbar/FilterChips）は filterbar の CatIcon を通して lucide
// のアイコンを使うので、その表は #230 で描画経路と一緒に消えた。
import { createQueryBuilder } from './query-chips.ts';
import { makePostPredOf, makePosterPredOf, hostOf } from './query.ts';
import { compile as searchCompile } from './search.ts';
import { postKeyOf } from './records.ts';
import * as folders from './folders.ts';
import { membersOf as aliasMembersOf } from './aliases.ts';
import { store } from './store.ts';

// ファセット type のスキーマ（改訂④）――view ごとの、「すべて」／「いずれか」
// が使える複数値の type と、単独の（決してクラスタにならない）type。
// 再設計されたフィルタバー（orchestrator の activeFilters / filterCategories
// のモードロジック）が、ここで facetViewOf を組み立てるのに使うのと同じ
// スキーマを読めるよう export している――再宣言してずれることのないように。
export const POST_FACET_OPTS = { multiValueTypes: ['tag', 'hashtag', 'folder'], standaloneTypes: ['date', 'engagement', 'text', 'dimension'] };
export const POSTER_FACET_OPTS = { multiValueTypes: ['tag'], standaloneTypes: ['date', 'followers'] };

// viewer.ts が引き続き持つコールバック／状態（描画、タブ復元）＝
// createQueryBuilder 自身の ctx と同じやり方で注入される。
export interface PostQueryBuilderDeps {
  onChange: () => void;
  onLeafMutated: (n: HologramQueryLeaf) => void;
  tagIdOf?: (name: string) => number | undefined;
}

// post 側のビルダーインスタンス。predOf も返す――viewer.ts の listing.ts の
// 配線（getFilteredPosts）が同じ述語関数を必要とするため。
export function makePostQueryBuilder(deps: PostQueryBuilderDeps) {
  const basePredOf = makePostPredOf({
    isInFolder: (id, cap, only) => folders.hasDeep(id, cap, only),
    searchCompile: (q) => searchCompile(q),
    postKeyOf,
    tagIdOf: deps.tagIdOf,
    // #23 St1: 保存済みの 'user' の葉は、posterKey の完全一致ではなく名前
    // マージグループの所属で一致判定する――これが呼び出しのたびに引き直す
    // 検索であって、葉レベルのコンパイル時メモではない理由は query.ts の
    // 'user' のケースを参照。
    membersOf: (key) => aliasMembersOf(key),
  });
  // #253「サイト」ファセット――facets.ts の未対応ドメイン行が加える2つの
  // 葉の形（qfValues の 'platform' ケース参照）は、query.ts のファクトリの
  // 「内側」ではなく「上」でここに組み立てられている: 今回のファイル分割は
  // #180 を query.ts/extension/ から遠ざけていて、この配線層こそが
  // post/poster の述語構築がすでに住んでいる場所（上のモジュールコメント
  // 参照）。
  //   - 'domain': プラットフォームを持たない投稿で、（www. を取り除いた）
  //     ホストが一致するもの。
  //   - 'platform'/'__none': プラットフォームを持たないがドメインは持つ
  //     投稿が '__none' に落ちる代わりに自分の 'domain' の葉を得るように
  //     なった今、「プラットフォーム無し」から「出自が一切無い」（解決
  //     できるホストも無い）へ狭められた。
  const stripWww = (h: string) => h.replace(/^www\./, '');
  const predOf = (f: HologramQueryLeaf): ((p: HologramPost) => boolean) => {
    if (f.type === 'domain') return (p: HologramPost) => !p.platform && stripWww(hostOf(p.url)) === f.value;
    if (f.type === 'platform' && f.value === '__none') return (p: HologramPost) => !p.platform && !hostOf(p.url);
    return basePredOf(f);
  };
  const qb = createQueryBuilder({
    storeKey: 'postQueryTree',
    predOf,
    onChange: deps.onChange,
    onLeafMutated: deps.onLeafMutated,
    singleValueTypes: ['date', 'kind'],
    // #162: 'dimension' は engagement/text と同じ理由でここに加わる――
    // addFilter の完全重複ガードは `value` だけでキー付けしていて、それは
    // 軸をまたいで誤発火しうる（軸の違う2つの葉が偶然同じ数値を共有する
    // ことがある）。dimension エディタの apply() は代わりに自分で同じ軸の
    // 葉を置き換える（軸ごとの removeCondsMatching）。
    noDupTypes: ['engagement', 'text', 'dimension'],
    // ファセットのスキーマ（改訂④）: タグ／ハッシュタグ／コレクションは
    // 投稿ごとの複数値（「すべて」「いずれか」のどちらも意味を持ち、既定は
    // 「すべて」）。日付／engagement／text は単独のチップのまま。それ以外
    // （platform/user/instance/kind/media/postType）はすべて、無言の
    // 「いずれか」としてクラスタになる。
    multiValueTypes: POST_FACET_OPTS.multiValueTypes,
    standaloneTypes: POST_FACET_OPTS.standaloneTypes,
  });
  // どんな変更よりも前に初期値（emptyTree()）を確立しておく。これにより
  // 将来の読み手が undefined を見ることは無い――setTree はタブ復元時にしか
  // 走らず、それは真新しいタブの最初の描画より前には起きないことがある。
  store.setState({ postQueryTree: JSON.parse(JSON.stringify(qb.getTree())) });
  return { qb, predOf };
}

export interface PosterQueryBuilderDeps {
  onChange: () => void;
  posterTagEntriesOf: (key: string) => HologramTagEntry[];
}

// poster 側のビルダーインスタンス: 同じビルダー（createQueryBuilder）を、
// 投稿ではなく poster（user）オブジェクトに対して評価する。一時的（poster
// にはタブもナビ履歴も無い）。onChange → renderPosters。
export function makePosterQueryBuilder(deps: PosterQueryBuilderDeps) {
  const predOf = makePosterPredOf({
    posterTagEntriesOf: deps.posterTagEntriesOf,
  });
  const qb = createQueryBuilder({
    storeKey: 'posterQueryTree',
    predOf,
    onChange: deps.onChange,
    singleValueTypes: ['date'], // 単一選択: 1つ選ぶと既存のものを置き換える
    noDupTypes: ['followers'],
    // ポスターのファセットスキーマ: ポスターは多くのタグを集約する
    // （「すべて」「いずれか」のどちらも意味を持つ）。日付は単独のチップの
    // まま。
    multiValueTypes: POSTER_FACET_OPTS.multiValueTypes,
    standaloneTypes: POSTER_FACET_OPTS.standaloneTypes,
  });
  // どんな変更よりも前に初期値（emptyTree()）を確立しておく――poster には
  // タブも setTree の復元経路も無いので、最初のフィルタ操作までこれが
  // 唯一の値の供給元になる。
  store.setState({ posterQueryTree: JSON.parse(JSON.stringify(qb.getTree())) });
  return { qb };
}
