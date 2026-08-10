// タグ・ハッシュタグの名前に対する、保存時のグリフの正規化（#197）。Unicode NFKC が全角と
// 半角、互換の異体をまとめ、加えて前後の余計な空白を落とす。それだけだ。大文字小文字と
// カタカナ・ひらがなは意図して手を付けない（表示と、ユーザー自身が選んだ綴りをそのまま
// 保つ。それらをまとめるのが別種の、望まれない正規化である理由は issue を参照）。
//
// renderer/src/services/search.ts の `normalize` を使い回せない理由。あちらはさらに、
// 問い合わせ時のあいまい一致のために小文字化とカタカナ・ひらがなの変換もする（#193 の
// 領分＝別の問題に対する、別の重い答え）。ここに当てれば "VTuber" と "ネコ"/"ねこ" が
// 同じ保存済みタグに潰れる。issue はそれを明確に除外している。
//
// #193 でも直らない理由。問い合わせ時の正規化は検索がタグに届くのを助けるだけで、同じ
// タグの2つのグリフがそもそもライブラリの別々の項目として存在することを止めない。
// ファセットのチップの一覧とその件数は、あいまい一致を通さず、保存された文字列そのもの
// から作られる。だから入ってくる時点でデータ自体を正規化しない限り、語彙は割れ続け、
// 件数は砕け続ける。2つの正規化は別の問題を解いていて、どちらも他方の代わりにならない。
//
// Electron から切り離してある（import が一切ない）ので、native-host の CJS ランタイム
// （require 経由。post-record.mts の兄弟と同じ）からも、アプリの Electron メインプロセス
// （ESM）からも、レンダラーの Vite バンドル（ブラウザ。node の組み込みモジュールは無い）
// からも読み込める＝post-record.mts と post-key.mts が既に果たしているのと同じ、境界を
// またぐ役割だ。

// タグ名を1つ正規化する。文字列でないもの（および、正規化した後に空か空白だけになる
// 文字列）は '' になる＝呼び出し側がそれを取り除く。ここの他のタグ配列の正規化がどれも
// 既に文字列でないものを落としているのと揃えてある。
export function normalizeTagName(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '';
  let t = raw;
  try {
    t = t.normalize('NFKC');
  } catch {
    // String.prototype.normalize の無い環境（今日の対象には1つも無いが、search.ts の
    // normalize も同じ退避を持っている）では、例外を投げずに元のテキストを保つ＝空白を
    // 落としただけのタグの方が、保存まるごとを失うよりましだ。
  }
  return t.trim();
}

// タグ・ハッシュタグの配列を正規化する。文字列だけに絞り、normalizeTagName を当て、
// 空になった項目を落とし、重複を取り除く（最初に出たものが勝つ）＝バイト単位で厳密な
// 語彙・件数の画面が、投稿のタグ一覧について既に前提にしていることをそのまま写している。
export function normalizeTagNames(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = normalizeTagName(v);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
