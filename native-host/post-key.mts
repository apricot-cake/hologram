// 正規の投稿 URL から同一性のキーへの正規化。「この2本の URL は同じ投稿か」を判断する
// 層すべてで共有する:
//   - レンダラーのまとめ方（app/src/renderer/src/services/records.ts がここから postKeyOf を
//     再 export する＝同じ投稿のレコードが1枚のカードに畳まれる）
//   - ブリッジの保存済み投稿の索引（タイムラインの「保存済み」の印が、パーマリンクが
//     既にライブラリに在るかをこれに尋ねる、#54。そこで違う計算のキーを使えば、アプリが
//     別々にまとめている投稿で印が点いたり、まとめている投稿を取りこぼしたりする）
//
// 拡張機能は意図して正規化しない。パーマリンクを取り出して生の URL のまま渡すので、
// URL からキーへの規則の実装はちょうど1つになる（#54 の設計）。metadata.ts の
// parsePostUrl は別の関心事のまま残る。あちらは投稿を取得するために URL をプラット
// フォームと id と API のエンドポイントに分解するのであって、同一性のキーにはしない。
//
// native-host/ で最初の .mts。ここの他がまだすべて .cts だった頃のものだ。レンダラーが
// ES import するのに TypeScript は `module.exports` への代入から export を読まないので、
// ESM でなければならなかった。#1052 で、それはこのファイル1つの例外ではなくディレクトリ
// 全体の形になった。tsconfig.json を参照。

// URL が投稿のパーマリンクとして認識できないとき（解析できない、あるいはプロフィール・
// 検索・ホームのページ）は null を返す。null は「一致しない」ではなく、常に
// 「まとめるな」を意味する。
export function postKeyOf(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname;
  const pa = u.pathname;
  let m: RegExpMatchArray | null;
  if (host === 'bsky.app' && (m = pa.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)/))) return 'bluesky:' + m[1] + '/' + m[2];
  if ((host === 'x.com' || host === 'twitter.com') && (m = pa.match(/\/status\/(\d+)/))) return 'x:' + m[1];
  if ((host === 'www.pixiv.net' || host === 'pixiv.net') && (m = pa.match(/^(?:\/[a-z]{2})?\/artworks\/(\d+)/))) return 'pixiv:' + m[1];
  return null;
}
