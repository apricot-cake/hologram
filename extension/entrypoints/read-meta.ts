import WebAutoExtractor from '@marbec/web-auto-extractor';
import { decodeHTMLAttribute } from 'entities/decode';
import { chooseWebMeta } from '../utils/extractor/web-meta.ts';
import type { PageMetaExtractedMessage } from '../utils/messages.ts';
import type { WaeBucket } from '@marbec/web-auto-extractor';
import type { WebMetaResult } from '../utils/extractor/web-meta.ts';

// #239: タブ自身の DOM から schema.org（JSON-LD/microdata/RDFa）・OGP・
// Dublin Core・Highwire のメタデータを読み取って報告する。マニフェストには宣
// 言していない＝background.ts の右クリック画像保存が
// chrome.scripting.executeScript({files:['read-meta.js']}) でファイル名を指
// 定して注入する。この名前は指定した名前そのもの（tests/integration/ext-consistency.extension-bundle.test.ts
// がこの対応を保証する）。
//
// `files:` を使い `func:` は使わない（#759 のシリアライズの罠＝`func` はこの
// モジュールのスコープへのクロージャを持たずに評価されるため、chooseWebMeta
// と WebAutoExtractor の import の両方が落ちてしまう）。代わりに通常のバンド
// ル済みスクリプトとして動くため、読み取り結果は旧 #195 の OGP 専用
// extractOgp() がかつてそうしていたような executeScript() の戻り値には乗せ
// られない＝代わりに chrome.runtime.sendMessage 経由で報告する。これは
// 画像保存が使うのと同じ content-script → background の経路だ。
// 呼び出し元は sender.tab.id で応答を自分の要求に対応付ける。
// `<meta>` 側の半分は、ライブラリ自身がシリアライズ済み HTML を読んだ結果で
// はなく DOM から取っている（#894）。
//
// なぜか。ライブラリは属性値をソースに現れたとおり、そのまま返す＝`&amp;` は
// `&amp;` のまま、`&mdash;` は `&mdash;` のまま返ってくる（2.2.1 で確認済
// み）。テキストならこれは見た目の瑕疵で済むが、URL では無音の破損になる。
// Qiita の og:image は約20個のクエリパラメータを持つ署名付き imgix URL で、
// すべての区切り文字が `&amp;` として届くため、CDN 側には `amp;w`、
// `amp;fm` … `amp;s` という名のパラメータが渡ってしまう＝署名がそもそも存在
// せず imgix は 403 を返し、ダウンロードできないメディアを含む投稿は保存全
// 体が失敗するため、保存はどこにも理由が記録され
// ないまま失われていた。og:image にクエリ文字列が一切ないページ（YouTube・
// GitHub）は影響を受けなかったため、Qiita 固有の問題に見えていた。
//
// このスクリプトはページの中で動くため、ブラウザは既にこれらの属性をパース
// 済みだ＝`.content` は、HTML エンティティデコードのリファレンス実装によって
// デコードされた値そのもの。自前のデコードは行わず、再パースもしない。ライ
// ブラリには、それにしかできない仕事（JSON-LD／microdata／RDFa）だけを任
// せ、その2形式から返ってくる値は以下でデコードする（#902）。
//
// 形は chooseWebMeta が既に受け取っている形（lowerMetaMap）に合わせてい
// る＝ページ自身の綴りをキーにし、値は配列、`<head>` のみ、加えて
// `<title>` のテキストを `title` キーで持つ＝ライブラリが同じフォールバック
// に使うのと同じキー。
function metatagsFromDom(doc: Document): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const push = (name: string | null, value: string | null) => {
    if (!name || !value) return;
    (out[name] ||= []).push(value);
  };
  for (const el of Array.from(doc.head?.querySelectorAll('meta') || [])) {
    // ライブラリが認識するのと同じ4つの命名属性。ライブラリは要素自身の属性
    // 順で最初に来たものを選ぶが、ここでは代わりに固定の優先順位を使う。両者
    // が違う結果になるのは、2つを同時に持つタグの場合だけ。
    push(el.getAttribute('name') || el.getAttribute('property') || el.getAttribute('itemprop') || el.getAttribute('http-equiv'), el.content);
  }
  push('title', doc.title);
  return out;
}

// #902、同じ欠陥のもう半分＝microdata と RDFa はライブラリがシリアライズ済
// み HTML を自分で読んだ結果から組み立てるため、`Tom &amp; Jerry &mdash;
// 記事名` は参照がそのまま残った状態で chooseWebMeta に届く。上の `<meta>`
// のトリックはここでは効かない＝これらの値は `itemprop` 要素のテキストや、
// body 全体に散らばる `content`/`href` 属性から来るのであって、デコード済み
// DOM プロパティを読める一握りのタグから来るのではないからだ。
//
// なぜ依存を追加するのか。`entities` は htmlparser2/cheerio/parse5 が使う
// デコーダで、エコシステムの標準的な答えだ。テーブルが網羅的で（URL に致命
// 的な5個だけでなく `&mdash;` `&nbsp;` なども含む）、答えを得るのに HTML を
// 再パースする必要もない。自身は依存を持たず、ツリーのどこかから借りてくる
// 推移的な依存ではなく extension/ の直接の依存として、バージョンを固定して
// いる。コストは 2026-08-07 に実測: read-meta.js は 17.5KB →
// 56.0KB、そのほぼ全てが名前付き参照のテーブル分。このバンドルはディスクか
// ら読んでブックマーク保存のたびに1回注入するだけで、ネットワークもページ
// ごとのコストも発生しない。
//
// なぜ属性用のモードなのか。`decodeHTMLAttribute` が `decodeHTML` と違うの
// はただ1点＝レガシーなセミコロンなしの参照（`&amp` の後に英数字か `=` が続
// くもの）をデコードせずそのまま残すことだ。テキスト用のモードだとクエリ文
// 字列 `?a=1&ampersand=2` を `?a=1&ersand=2` に書き換えてしまう＝#894 の破
// 損が向きを変えて再発する形で、しかも microdata は author.url にこの値を渡
// す。実際のページが書く形（`&amp;`、`&mdash;`、`&#39;`、`&#x2014;`）はどれ
// もセミコロンで終端されていて、両モードで同じようにデコードされる。
//
// JSON-LD には適用しない: このバケットは `<script>` 要素の生テキストから来
// ていて参照を一切含まないため、デコードすると著者が実際に書いたリテラルの
// `&amp;` を壊してしまう（この issue 自身の受け入れ条件でもある）。キーもそ
// のまま残す＝これらは chooseWebMeta が固定の綴りと照合する `@type`／プロパ
// ティ名だからだ。
function decodeDeep(value: unknown): unknown {
  if (typeof value === 'string') return decodeHTMLAttribute(value);
  if (Array.isArray(value)) return value.map(decodeDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, decodeDeep(v)]));
  return value;
}

function decodeBucket(bucket: WaeBucket | undefined): WaeBucket {
  return decodeDeep(bucket || {}) as WaeBucket;
}

export default defineUnlistedScript(() => {
  const fallback: WebMetaResult = { title: null, description: null, author: null, published: null, siteName: null, image: null, url: location.href, metaSource: {} };
  let result: WebMetaResult;
  try {
    // #195 の extractOgp と同じ絶対化の挙動＝<a>/<link> 要素自身の .href プ
    // ロパティは常に解決済みの絶対 URL であって、生の（相対の可能性がある）
    // 属性テキストではない。
    const canonical = (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href || null;
    const parsed = new WebAutoExtractor().parse(document.documentElement.outerHTML);
    result = chooseWebMeta({ ...parsed, metatags: metatagsFromDom(document), microdata: decodeBucket(parsed.microdata), rdfa: decodeBucket(parsed.rdfa) }, { pageUrl: location.href, canonicalHref: canonical, baseURI: document.baseURI });
  } catch {
    // 正常なメタデータなしと区別し、選択した画像の保存結果にも失敗を伝える。
    result = { ...fallback, acquisitionError: 'invalidResponse' };
  }
  chrome.runtime.sendMessage({ type: 'pageMetaExtracted', result } satisfies PageMetaExtractedMessage);
});
