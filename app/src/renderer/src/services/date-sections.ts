// ポストグリッド向けの月セクションのグルーピング（#47）――すでにソート済みの
// 配列に対する純粋なバケット分け。post-grid-builder.ts から、marquee.ts/
// zoom-anchor.ts がそれぞれの React ホストから切り出されているのと同じ
// やり方で分離した: これは DOM にも masonic のポジショナーにも触れず、
// ただの数値に対して動くので、ただの配列でユニットテストできる
// （scripts/date-sections.test.ts）。
//
// 範囲は Issue で確認済み（2026-07-11 のコメント）: セクションの見出しが
// 現れるのは日付ベースの2つのソート（投稿日／capture 日）だけで、その
// ソートがすでに並べる基準にしているフィールドでキー付けする――別途の軸
// トグルは無い。engagement／ランダム／名前のソートは決してセクション化
// しない。
//
// 「日付不明」のバケット（ms <= 0――日付が無いことを示す stampPost の
// 番兵）は、ソートの向きに関わらず常に末尾のセクションに着地する。
// date-asc についてはこれが、元のソート自体への意図的な変更（listing.ts
// 参照）――日付不明のレコードをそこで末尾へ押しやることが、このモジュール
// の仕事を単純な連続グルーピングのままにしている: これは入力がすでに
// 最終的な表示順になっていると信頼し、ソートし直したり端を特別扱いしたり
// することは決してしない。

/** ソートがどの前計算済みタイムスタンプフィールドでバケット分けするか。
 * そのソートに日付軸が無ければ null（engagement／ランダム／名前――
 * セクション分け無し）。 */
export type DateSectionField = 'dateMs' | 'capturedMs' | null;

export function dateFieldForSort(sort: string): DateSectionField {
  if (sort === 'date-desc' || sort === 'date-asc') return 'dateMs';
  if (sort === 'captured-desc') return 'capturedMs';
  return null;
}

// 同じ暦月を共有する項目の連続した1区間（または末尾の「日付不明」区間）。
// `ms` はそのバケットを代表するタイムスタンプ（最初の項目のもの）――
// 呼び出し側がそれをロケールのラベルへ整形する。このモジュールは
// Intl/i18n を持たないままにしているので、Node（scripts/*.test.ts）でも
// ブラウザでも同じように動く。
export interface DateSection {
  /** 本物の月なら 'YYYY-M'（ローカルの暦）、番兵のバケットなら 'unknown'。 */
  key: string;
  /** バケットを代表する ms――'unknown' なら 0。 */
  ms: number;
  /** 渡された元のフラットな `items` 配列の中での、このバケットの最初の項目の index。 */
  startIndex: number;
  count: number;
}

const monthKeyOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}`;
};

/**
 * ソート済みの配列を連続した月のバケットへグループ化する。`msOf` は1項目
 * からバケット分け用のタイムスタンプを読む（すでに records.ts の
 * stampPost によって刻まれている――このモジュール自体は日付を一切計算
 * しない）。区間は月のキーが実際に変わったときにしか切れないので、順序の
 * 狂った入力は、同じ月のバケットを1つに統合するのではなく、黙って余分な
 * （連続していない）バケットを生む――意図的にそうしている。ここで
 * ソートし直すと、呼び出し側のバグを表に出す代わりに隠してしまうため。
 */
export function buildSections<T>(items: readonly T[], msOf: (item: T) => number): DateSection[] {
  const out: DateSection[] = [];
  let cur: DateSection | null = null;
  for (let i = 0; i < items.length; i++) {
    const ms = msOf(items[i]);
    const known = ms > 0;
    const key = known ? monthKeyOf(ms) : 'unknown';
    if (!cur || cur.key !== key) {
      cur = { key, ms: known ? ms : 0, startIndex: i, count: 0 };
      out.push(cur);
    }
    cur.count++;
  }
  return out;
}
