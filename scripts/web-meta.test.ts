// 一般ページのメタデータ抽出（#239）の、通信に出ない単体テスト。対象は2つ。外部パーサの
// 出力から欄ごとに値を選ぶ純粋な判断関数（chooseWebMeta）と、その選択をブックマーク保存が
// 送る PostRecord の形へ組み立てる方（buildWebMeta）。
//
// ここのフィクスチャは @marbec/web-auto-extractor の parse() の出力を模して手で書いた
// オブジェクトで、実 HTML を実パーサに通したものではない。extension/ はリポジトリルートの
// npm ワークスペースではない（ルートの package.json の `workspaces` を参照）ので、ルート
// 直下のこのスイートからは extension/ 側の node_modules を解決できず、パッケージを直接
// import できない。web-meta.ts 自身もパーサを import しない（import するのは出力の型だけ）
// ＝この分け方が在る理由はまさにそれ（あのファイルの冒頭コメントを参照）。下の形は
// 2026-08-03 に実パッケージ（2.2.1）と突き合わせて確かめた（やり方は設計の記録＝#239 の
// 2026-08-03 のコメントを参照）。metatags / jsonld / microdata / rdfa はそれぞれページ自身の
// 綴りと @type をキーに持ち、itemprop の繰り返しはすでに配列へ畳まれ、壊れた JSON-LD の
// ブロックは `jsonld` に単に現れない（例外は投げられない）。
//
// 実パーサを、実際にビルドしたエントリポイントのバンドル越しに動かすのは
// scripts/read-meta-bundle.test.ts の方。スイートが2つ在る理由はあのファイルの冒頭を参照。

import { describe, expect, test } from 'vitest';
import { buildWebMeta, chooseWebMeta } from '../extension/utils/extractor/web-meta.ts';

function parsed(overrides: Record<string, unknown> = {}) {
  return { metatags: {}, jsonld: {}, microdata: {}, rdfa: {}, headings: [], errors: [], ...overrides };
}

const CTX = { pageUrl: 'https://example.com/articles/hello-world', canonicalHref: null, baseURI: 'https://example.com/articles/hello-world' };

describe('chooseWebMeta: OGP のみ（#195 からの退行なし）', () => {
  test('og:* が揃っている＝schema.org 層を経ずに OGP がそのまま採られる', () => {
    const p = parsed({
      metatags: {
        title: ['Fallback Title (should not be used)'],
        'og:title': ['Hello World, an OGP Article'],
        'og:description': ["A short description of the article, for the record's text field."],
        'og:image': ['https://cdn.example.com/images/hello.jpg'],
        'og:site_name': ['Example Times'],
      },
    });
    const meta = chooseWebMeta(p, { ...CTX, canonicalHref: 'https://example.com/articles/hello-world' });
    expect(meta.title).toBe('Hello World, an OGP Article');
    expect(meta.description).toBe("A short description of the article, for the record's text field.");
    expect(meta.image).toBe('https://cdn.example.com/images/hello.jpg');
    expect(meta.siteName).toBe('Example Times');
    expect(meta.url).toBe('https://example.com/articles/hello-world');
    expect(meta.author).toBe(null);
    expect(meta.published).toBe(null);
    expect(meta.metaSource).toEqual({ title: 'ogp', description: 'ogp', siteName: 'ogp', url: 'canonical' });
  });

  test('OGP も schema.org も無い＝<title> とホスト名に落ちる', () => {
    const p = parsed({ metatags: { title: ['A Plain Page With No OGP At All'] } });
    const meta = chooseWebMeta(p, { pageUrl: 'https://plain.example/some/path', canonicalHref: null, baseURI: 'https://plain.example/some/path' });
    expect(meta.title).toBe('A Plain Page With No OGP At All');
    expect(meta.description).toBe(null);
    expect(meta.image).toBe(null);
    expect(meta.siteName).toBe('plain.example');
    expect(meta.url).toBe('https://plain.example/some/path');
    expect(meta.metaSource).toEqual({ title: 'title', siteName: 'host', url: 'tab' });
  });

  test('og:image がサイトルート相対＝ページの URL に対して絶対化する', () => {
    const p = parsed({ metatags: { 'og:image': ['/static/thumb.png'] } });
    const meta = chooseWebMeta(p, { pageUrl: 'https://relative.example/articles/current', canonicalHref: null, baseURI: 'https://relative.example/articles/current' });
    expect(meta.image).toBe('https://relative.example/static/thumb.png');
  });

  test('og:image がプロトコル相対＝ホストは URL 自身のもの・スキームだけページに合わせる', () => {
    const p = parsed({ metatags: { 'og:image': ['//cdn.example.com/thumb.png'] } });
    expect(chooseWebMeta(p, { pageUrl: 'https://proto.example/page', canonicalHref: null, baseURI: 'https://proto.example/page' }).image).toBe('https://cdn.example.com/thumb.png');
    expect(chooseWebMeta(p, { pageUrl: 'http://proto.example/page', canonicalHref: null, baseURI: 'http://proto.example/page' }).image).toBe('http://cdn.example.com/thumb.png');
  });
});

describe('chooseWebMeta: canonical の出所検証（設計コメント5・2026-08-03）', () => {
  test('canonical が同一オリジン＝採る', () => {
    const meta = chooseWebMeta(parsed(), { pageUrl: 'https://example.com/list?x=1', canonicalHref: 'https://example.com/articles/hello', baseURI: 'https://example.com/list?x=1' });
    expect(meta.url).toBe('https://example.com/articles/hello');
    expect(meta.metaSource.url).toBe('canonical');
  });

  test('canonical が別オリジン＝タブの URL に落ちる', () => {
    const meta = chooseWebMeta(parsed(), { pageUrl: 'https://example.com/page', canonicalHref: 'https://cdn.example.net/syndicated/page', baseURI: 'https://example.com/page' });
    expect(meta.url).toBe('https://example.com/page');
    expect(meta.metaSource.url).toBe('tab');
  });

  test('canonical が無い＝タブの URL', () => {
    const meta = chooseWebMeta(parsed(), CTX);
    expect(meta.url).toBe('https://example.com/articles/hello-world');
    expect(meta.metaSource.url).toBe('tab');
  });
});

describe('chooseWebMeta: JSON-LD ノードの選別（誤マッチ防止・設計コメント4/5）', () => {
  test('複数ノードのうち mainEntityOfPage が現在ページと一致するノードが選ばれる', () => {
    const p = parsed({
      jsonld: {
        Article: [
          { '@type': 'Article', headline: 'A Different Article', mainEntityOfPage: 'https://example.com/other-page' },
          { '@type': 'Article', headline: 'The Current Article', mainEntityOfPage: 'https://example.com/articles/hello-world' },
        ],
      },
    });
    expect(chooseWebMeta(p, CTX).title).toBe('The Current Article');
  });

  test('url/mainEntityOfPage を持たないノード＝クレーム無し扱いで採用される（単純なブログの典型形）', () => {
    const p = parsed({ jsonld: { BlogPosting: [{ '@type': 'BlogPosting', headline: 'No URL Claim At All' }] } });
    expect(chooseWebMeta(p, CTX).title).toBe('No URL Claim At All');
  });

  test('壊れた JSON-LD ブロックが1つあっても他のブロック・他の規格からの読み取りが成立する（パーサが errors へ落とし jsonld には含めない前提）', () => {
    const p = parsed({
      jsonld: { NewsArticle: [{ '@type': 'NewsArticle', headline: 'The Surviving Block' }] },
      errors: [{ message: 'Could not parse JSON-LD', format: 'jsonld', source: '{ broken' }],
      metatags: { 'og:description': ['still read from OGP'] },
    });
    const meta = chooseWebMeta(p, CTX);
    expect(meta.title).toBe('The Surviving Block');
    expect(meta.description).toBe('still read from OGP');
  });

  test('型優先順＝Article 系 > CreativeWork > VideoObject/ImageObject（Article 系があればそちらを採る）', () => {
    const p = parsed({
      jsonld: {
        ImageObject: [{ '@type': 'ImageObject', name: 'Just A Photo' }],
        Article: [{ '@type': 'Article', headline: 'The Article Wins' }],
      },
    });
    expect(chooseWebMeta(p, CTX).title).toBe('The Article Wins');
  });
});

describe('chooseWebMeta: 規格間フォールバック（YouTube 型＝JSON-LD に無くても microdata にあれば拾う）', () => {
  test('JSON-LD の VideoObject に author が無く、microdata の VideoObject にはある＝著者は microdata から', () => {
    const p = parsed({
      jsonld: { VideoObject: [{ '@type': 'VideoObject', name: 'A Video', uploadDate: '2025-07-04T00:00:00Z' }] },
      microdata: { VideoObject: [{ '@type': 'VideoObject', author: { '@type': 'Person', name: 'Channel Owner', url: 'https://example.com/channel/xyz?utm=1' } }] },
    });
    const meta = chooseWebMeta(p, CTX);
    // title と published は JSON-LD のノードから来る（あちらが持っているため）。
    // author だけが microdata のノードへ落ちる。
    expect(meta.title).toBe('A Video');
    expect(meta.published).toBe('2025-07-04T00:00:00Z');
    expect(meta.metaSource.title).toBe('jsonld');
    expect(meta.metaSource.published).toBe('jsonld');
    expect(meta.author).toEqual({ name: 'Channel Owner', url: 'https://example.com/channel/xyz' });
    expect(meta.metaSource.author).toBe('microdata');
  });
});

describe('chooseWebMeta: author の連鎖と除外規則', () => {
  test('JSON-LD author が文字列（オブジェクトでない）＝そのまま名前として採る', () => {
    const p = parsed({ rdfa: { Article: [{ '@type': 'Article', author: 'RDFa Author' }] } });
    const meta = chooseWebMeta(p, CTX);
    expect(meta.author).toEqual({ name: 'RDFa Author', url: null });
    expect(meta.metaSource.author).toBe('rdfa');
  });

  test('著者が配列＝先頭の1名だけを採る（連結しない）', () => {
    const p = parsed({ jsonld: { Article: [{ '@type': 'Article', author: [{ name: 'First Author' }, { name: 'Second Author' }] }] } });
    expect(chooseWebMeta(p, CTX).author?.name).toBe('First Author');
  });

  test('creator も author の代わりとして読む（schema.org の別名）', () => {
    const p = parsed({ jsonld: { CreativeWork: [{ '@type': 'CreativeWork', creator: { name: 'The Creator' } }] } });
    expect(chooseWebMeta(p, CTX).author?.name).toBe('The Creator');
  });

  test('schema.org に無い＝meta[name=author] → dc.creator → citation_author → article:author の順', () => {
    expect(chooseWebMeta(parsed({ metatags: { author: ['Meta Author'], 'dc.creator': ['DC Author'] } }), CTX).author).toEqual({ name: 'Meta Author', url: null });
    expect(chooseWebMeta(parsed({ metatags: { 'dc.creator': ['DC Author'], citation_author: ['Citation Author'] } }), CTX).author).toEqual({ name: 'DC Author', url: null });
    expect(chooseWebMeta(parsed({ metatags: { citation_author: ['Citation Author'], 'article:author': ['Article Author'] } }), CTX).author).toEqual({ name: 'Citation Author', url: null });
    const fromArticle = chooseWebMeta(parsed({ metatags: { 'article:author': ['Plain Name Author'] } }), CTX);
    expect(fromArticle.author).toEqual({ name: 'Plain Name Author', url: null });
    expect(fromArticle.metaSource.author).toBe('ogp');
  });

  test('article:author が URL（Facebook プロフィール等）＝人名として採らない・他に採るものが無ければ author は null のまま', () => {
    const meta = chooseWebMeta(parsed({ metatags: { 'article:author': ['https://www.facebook.com/some.profile'] } }), CTX);
    expect(meta.author).toBe(null);
    expect(meta.metaSource.author).toBeUndefined();
  });

  test('DC.creator は Dc.Creator のように大文字小文字が揺れても拾う（ページの綴りをそのまま保持するライブラリの出力に対する読み側の耐性）', () => {
    const meta = chooseWebMeta(parsed({ metatags: { 'Dc.Creator': ['Mixed Case Dublin Author'] } }), CTX);
    expect(meta.author).toEqual({ name: 'Mixed Case Dublin Author', url: null });
    expect(meta.metaSource.author).toBe('dc');
  });
});

describe('chooseWebMeta: 日付の検証（設計コメント6）', () => {
  test('ISO 8601 の datePublished はそのまま採る', () => {
    const meta = chooseWebMeta(parsed({ jsonld: { Article: [{ '@type': 'Article', datePublished: '2025-07-03T10:00:00Z' }] } }), CTX);
    expect(meta.published).toBe('2025-07-03T10:00:00Z');
    expect(meta.metaSource.published).toBe('jsonld');
  });

  test('自由文の日付（"July 3, 2025"）＝どの層でも採らず published は null のまま', () => {
    const p = parsed({
      jsonld: { Article: [{ '@type': 'Article', datePublished: 'July 3, 2025' }] },
      metatags: { 'article:published_time': ['July 3rd, 2025'], citation_date: ['3 July 2025'], 'dc.date': ['2025 (July)'] },
    });
    expect(chooseWebMeta(p, CTX).published).toBe(null);
  });

  test('citation_date は citation_publication_date の別名として同格に読む', () => {
    const meta = chooseWebMeta(parsed({ metatags: { citation_publication_date: ['2025-01-02'] } }), CTX);
    expect(meta.published).toBe('2025-01-02');
    expect(meta.metaSource.published).toBe('highwire');
  });

  test('datePublished が無く uploadDate はある（動画ページの典型）＝uploadDate を published として採る', () => {
    const meta = chooseWebMeta(parsed({ jsonld: { VideoObject: [{ '@type': 'VideoObject', uploadDate: '2025-07-04T00:00:00Z' }] } }), CTX);
    expect(meta.published).toBe('2025-07-04T00:00:00Z');
  });
});

describe('chooseWebMeta: siteName の連鎖', () => {
  test('publisher がオブジェクト＝ .name を採る', () => {
    expect(chooseWebMeta(parsed({ jsonld: { Article: [{ '@type': 'Article', publisher: { name: 'Example Pub' } }] } }), CTX).siteName).toBe('Example Pub');
  });
  test('publisher が文字列＝そのまま採る', () => {
    expect(chooseWebMeta(parsed({ jsonld: { Article: [{ '@type': 'Article', publisher: 'Example Pub (string form)' }] } }), CTX).siteName).toBe('Example Pub (string form)');
  });
});

describe('buildWebMeta: WebMetaResult を PostRecord へ合成する', () => {
  test('platform は常に null（#195 2026-08-02 設計コメント #2 を維持）', () => {
    const rec = buildWebMeta({ title: 'T', description: null, author: null, published: null, siteName: 'Site', image: null, url: 'https://example.com/a', metaSource: {} }, 'https://example.com/a');
    expect(rec.platform).toBe(null);
  });

  test('著者が取れた＝displayName は著者名（#239 の #195 改訂）・userId は著者の正規化 URL・screenName は null', () => {
    const rec = buildWebMeta({ title: 'T', description: 'D', author: { name: 'Jane Author', url: 'https://example.com/author/1' }, published: '2025-07-03T00:00:00Z', siteName: 'Site Name', image: null, url: 'https://example.com/a', metaSource: { author: 'jsonld' } }, 'https://example.com/a');
    expect(rec.displayName).toBe('Jane Author');
    expect(rec.userId).toBe('https://example.com/author/1');
    expect(rec.screenName).toBe(null);
    expect(rec.date).toBe('2025-07-03T00:00:00Z');
    expect(rec.metaSource).toEqual({ author: 'jsonld' });
  });

  test('著者が名前だけ（url 無し）＝displayName は著者名だが userId は null のまま（#23 の名寄せに入れない #760 の前提）', () => {
    const rec = buildWebMeta({ title: 'T', description: null, author: { name: 'Name Only Author', url: null }, published: null, siteName: 'Site', image: null, url: 'https://example.com/a', metaSource: {} }, 'https://example.com/a');
    expect(rec.displayName).toBe('Name Only Author');
    expect(rec.userId).toBe(null);
    expect(rec.screenName).toBe(null);
  });

  test('著者が取れない＝displayName は従来どおりサイト名（#195 の既定を維持）', () => {
    const rec = buildWebMeta({ title: 'T', description: null, author: null, published: null, siteName: 'Some Site', image: null, url: 'https://example.com/a', metaSource: {} }, 'https://example.com/a');
    expect(rec.displayName).toBe('Some Site');
    expect(rec.userId).toBe(null);
  });

  test('サイト名も無い＝ホスト名に落ちる', () => {
    const rec = buildWebMeta({ title: 'T', description: null, author: null, published: null, siteName: null, image: null, url: 'https://news.example/a/b', metaSource: {} }, 'https://news.example/a/b');
    expect(rec.displayName).toBe('news.example');
  });

  test('タイトルすら取れない最悪のページでも空の殻にしない＝URL 自体を title・displayName に落とす', () => {
    const rec = buildWebMeta({ title: null, description: null, author: null, published: null, siteName: null, image: null, url: null, metaSource: {} }, 'https://bare.example/page');
    expect(rec.url).toBe('https://bare.example/page');
    expect(rec.title).toBe('https://bare.example/page');
    expect(rec.displayName).toBe('bare.example');
  });

  test('image あり＝メディア1件（mediaType:image）', () => {
    const rec = buildWebMeta({ title: 'T', description: null, author: null, published: null, siteName: null, image: 'https://cdn.example.com/i.jpg', url: 'https://example.com/a', metaSource: {} }, 'https://example.com/a');
    expect(rec.mediaType).toBe('image');
    expect(rec.media).toEqual([{ url: 'https://cdn.example.com/i.jpg', alt: null, width: null, height: null }]);
  });

  test('image 無し＝メディア0件（recordHoldsContent は title で通る前提）', () => {
    const rec = buildWebMeta({ title: 'No Image Here', description: null, author: null, published: null, siteName: null, image: null, url: 'https://example.com/no-image', metaSource: {} }, 'https://example.com/no-image');
    expect(rec.media).toEqual([]);
    expect(rec.mediaType).toBe(null);
  });

  test('metaSource が空オブジェクト＝rec.metaSource は null のまま（PostRecord の既定と一致させる）', () => {
    const rec = buildWebMeta({ title: 'T', description: null, author: null, published: null, siteName: null, image: null, url: 'https://example.com/a', metaSource: {} }, 'https://example.com/a');
    expect(rec.metaSource).toBe(null);
  });
});
