// タグの共起の service＝関連タグの候補の計算を、viewer.js から4番目の「純粋なロジック →
// service」の切り出し（最終形 B）として取り出したもの。charCandidatesFor（作品 → キャラの
// 強い段）、relatedTagCandidates（一般の弱い段）、worksCooccurringWith（同名キャラの判定が
// 履歴を問い合わせるためのもの）。本物の ES モジュール（名前付きの export）で、viewer.ts が
// 直接 import する。DOM には触れない。実行時の結び付きは makeCooc(deps) 経由で注入するので、
// このファイルは Node でも読み込める（scripts/test-cooc-unit.cts）。

// deps の取り決め（すべて関数）:
//   allPosts()＝ライブラリ全体（getter＝viewer が再代入する）
//   tagKindOfName(tag)＝名前から引く用語集上の種別（'work'/'character'/null）。
//
// #810 で種別のストアはタグのエンティティをキーにするようになり、引き当ても2つに分かれた
// （tags.ts のヘッダ）。このファイルは意図してその名前の空間の側を取る。ここが計算するものの
// 両端は名前だから＝呼び出し側が渡すのはタグの欄で今選ばれているタグ（利用者が打った
// 文字列。ピッカーには渡せるエンティティが無い）で、返す候補はどれも、同じ欄へ打ち込むための
// 文字列。投稿に書き込まれたタグは、どのみち名前から1つのエンティティへ解決される
// （lib-db-write.ts の tagResolver）。だからこのファイルが実際に持つ問いは「X という名前の
// タグは作品か」であり、エンティティごとに尋ねても、1つの候補が同じ内容の2つに割れるだけ。
export function makeCooc(deps: { allPosts(): HologramPost[]; tagKindOfName(tag: string): string | null | undefined }) {
  const { allPosts, tagKindOfName: tagKindOf } = deps;

  // #774 は、投稿が「持っている」ものを2つの読み方に分けた。このファイルはその両方を使う:
  //
  //   effTags(p)＝effective な名前（生のタグに、tag_parents の辺が含意する祖先をすべて
  //     足したもの。lib-db-query.ts が計算する）。「この投稿はタグ X の下に属するか」への
  //     正しい答えはこちら。クエリ時の適用が定義し直しているのは、まさにその問いだから＝
  //     子のタグだけが付いた投稿も、親の下に属する。
  //   rawTags(p)＝利用者が実際に打ったもの。「次にどのタグを出すべきか」への正しい答えは
  //     こちら。祖先を候補に出す価値は無いから＝子を持つ投稿は既に親も持っているので、
  //     足しても何も絞り込めない。
  //
  // この分かれ方があるから、下の relatedTagCandidates は完全に生のまま使い、種別に絞った
  // 2つの問い合わせは所属の判定で effective を読む。effective の配列が無いレコード
  // （タグの書き込みに失敗して落ちたもの＝services/posts.ts の applyTagWrite を参照）は
  // 生の方を使う。#774 より前は、このファイル全体がそれを使っていた。
  const rawTags = (p: HologramPost): string[] => (Array.isArray(p.tags) ? p.tags : []);
  const effTags = (p: HologramPost): string[] => (Array.isArray(p.effectiveTags) ? p.effectiveTags : rawTags(p));

  // タグの共起。作品 → その作品タグのどれかと同じ投稿に居合わせたキャラを、多い順に返す。
  // 決定的で説明できる（件数がそのまま確信の度合い）。難しい推測2つ（どのタグどうしが
  // 関係するか、どちらが親か）は種別が既に決めているので、残るのは「どのキャラがどの作品に
  // 属するか」だけで、これは精度が高い（1人のキャラが共起する作品はおおよそ1つ）。
  function charCandidatesFor(workTags: string[] | null | undefined): Array<[string, number]> {
    if (!workTags || !workTags.length) return [];
    const works = new Set(workTags);
    const counts = new Map<string, number>();
    for (const p of allPosts()) {
      // 所属の判定は effective を読む（#774）。親の作品のキャラを尋ねる時は、その子の
      // 作品しか持たない投稿にも届かなければならない。キャラ自体は生の一覧から取る＝
      // 候補は打ち込むためのもので、含意された祖先はそれに当たらない。
      if (!effTags(p).some((t) => works.has(t))) continue;
      for (const t of rawTags(p)) if (tagKindOf(t) === 'character') counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }

  // 同名キャラ（別作品）の検出。このキャラがライブラリの他の場所で共起した作品タグを返す
  // （今のグループは除くので、たった今足したタグが自分自身を履歴として数えることはない）。
  function worksCooccurringWith(charTag: string, excludeIds?: Set<string> | null): Set<string> {
    const works = new Set<string>();
    for (const p of allPosts()) {
      if (excludeIds && excludeIds.has(p.captureId)) continue;
      // どちらの側も effective を読む（#774）＝候補の2つの段と違い、こちらの結果は出すため
      // のタグの一覧ではなく、同名の判定が突き合わせる所属の集合だ。だから含意された親の
      // 作品も本物の履歴で、それを外すと、同名キャラを「まだ見ていない」と報告してしまう。
      const tags = effTags(p);
      if (!tags.includes(charTag)) continue;
      for (const t of tags) if (tagKindOf(t) === 'work') works.add(t);
    }
    return works;
  }

  // タグ全体を対象にした一般の共起＝弱い候補の段（強い方は charCandidatesFor で、あちらは
  // 種別が何と何が関係するかを固定している）。選ばれていないタグ Y ごとに、最も多くの投稿を
  // 共有している選択中のタグ X を求める。その件数が minCount に届いた対だけを採る（薄い
  // うちは出さない＝共有する投稿が1〜2件では偶然でありうる）ので、蓄えの薄いライブラリでは
  // 黙ったままになる。返すのは [{tag, withTag, count}] を件数の降順（同点は ja のロケールで
  // 決める）に並べ、limit で頭打ちにしたもの。withTag と count は「X と N 件の投稿で一緒に
  // 使われている」というツールチップの元になるので、どの候補も説明できるままでいられる。
  // opts.exclude は、決して候補に出さない追加のタグ（例えば強い段が既に出しているもの）。
  function relatedTagCandidates(selectedTags: ReadonlyArray<string> | null | undefined, opts?: { minCount?: number; limit?: number; exclude?: Set<string> | null }): Array<{ tag: string; withTag: string | null; count: number }> {
    const sel = new Set((selectedTags || []).filter(Boolean));
    if (!sel.size) return [];
    const o = opts || {};
    const minCount = o.minCount != null ? o.minCount : 3;
    const limit = o.limit != null ? o.limit : 8;
    const exclude = o.exclude || null;
    const pair = new Map<string, Map<string, number>>(); // 候補 Y → Map(選択中の X → 共有している投稿の件数)
    for (const p of allPosts()) {
      // 両側とも意図して生のまま使う（#774）。この段の約束は「この2つは N 回一緒に打たれ、
      // その件数がそのまま確信の度合いだ」。effective の集合で対にすると、選択中のタグ自身の
      // 祖先が候補の先頭に並ぶが、そのどれも足したところで何も起きない。
      const tags = rawTags(p);
      if (tags.length < 2) continue;
      const present = tags.filter((t) => sel.has(t));
      if (!present.length) continue;
      for (const t of tags) {
        if (sel.has(t) || (exclude && exclude.has(t))) continue;
        let m = pair.get(t);
        if (!m) pair.set(t, (m = new Map()));
        for (const x of present) m.set(x, (m.get(x) || 0) + 1);
      }
    }
    const out: Array<{ tag: string; withTag: string | null; count: number }> = [];
    for (const [tag, m] of pair) {
      let withTag: string | null = null;
      let count = 0;
      for (const [x, n] of m)
        if (n > count) {
          count = n;
          withTag = x;
        }
      if (count >= minCount) out.push({ tag, withTag, count });
    }
    out.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja'));
    return out.slice(0, limit);
  }

  return { charCandidatesFor, worksCooccurringWith, relatedTagCandidates };
}
