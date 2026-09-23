// #239: 実際にビルドされた entrypoint のバンドル（extension/.output/chrome-mv3-
// test/read-meta.js）をそのまま jsdom で走らせる。本物の @marbec/web-auto-extractor パーサを端から
// 端まで動かすのはここだけ。extension/utils/extractor/web-meta.test.ts は手書きのフィクスチャに対して
// chooseWebMeta 自身の判断のロジックを見ている（あの一式はそもそも本物のパーサを import
// できない＝理由はあのファイルの冒頭コメントにある）。だが、このモジュールがパーサの
// 戻り値をどう仮定しているかと、バンドルした後に実際に何が返るかのずれを捕まえられるのは
// 本物のバンドルだけ。#759 がまさにその種類の不具合だった＝直接呼べば正しく、注入の境界を
// 越えて運んだ途端に壊れる。
//
// 前提: extension/.output/chrome-mv3-test/read-meta.js があること。
// `npm run test:ext` が現在のソースから作ってからテストを始める。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { expect, test, vi } from 'vitest';

const BUNDLE = fs.readFileSync(path.join(import.meta.dirname, '../../extension/.output/chrome-mv3-test/read-meta.js'), 'utf8');

// バンドルを1つのフィクスチャページに対して走らせ、送られた pageMetaExtracted メッセージ
// を返す（entrypoint はちょうど1つ送って役目を終える＝ read-meta.ts の冒頭コメントを参照）。
async function runOn(html: string, url: string): Promise<any> {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const { window } = dom;
  const sent: any[] = [];
  window.chrome = { runtime: { sendMessage: (msg: any) => sent.push(msg) } } as any;
  window.eval(BUNDLE);
  // entrypoint はちょうど1つメッセージを送ってそこで終わる＝そのメッセージ自体が事後条件。
  // だから抽出にどれだけ掛かるかを当てずに、それが来るまで待つ。
  await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0), { timeout: 5000 });
  expect(sent).toHaveLength(1);
  expect(sent[0].type).toBe('pageMetaExtracted');
  return sent[0].result;
}

test('JSON-LD の Article ページ＝著者と公開日が入る', async () => {
  const html = `<!doctype html><html><head>
    <title>Fallback Title</title>
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"NewsArticle","headline":"A Real News Article","description":"The article body summary.","author":{"@type":"Person","name":"Jane Reporter","url":"https://news.example/authors/jane"},"datePublished":"2025-07-03T10:00:00Z","publisher":{"@type":"Organization","name":"Example News"},"mainEntityOfPage":"https://news.example/articles/a-real-news-article"}
    </script>
  </head><body><p>Body content the extraction never reads.</p></body></html>`;
  const result = await runOn(html, 'https://news.example/articles/a-real-news-article');
  expect(result.title).toBe('A Real News Article');
  expect(result.description).toBe('The article body summary.');
  expect(result.author).toEqual({ name: 'Jane Reporter', url: 'https://news.example/authors/jane' });
  expect(result.published).toBe('2025-07-03T10:00:00Z');
  expect(result.siteName).toBe('Example News');
  expect(result.metaSource.author).toBe('jsonld');
});

test('microdata のみのページ（YouTube 型）＝著者は microdata から拾う', async () => {
  const html = `<!doctype html><html><head><title>A Video</title></head><body>
    <div itemscope itemtype="http://schema.org/VideoObject">
      <span itemprop="name">A Great Video</span>
      <meta itemprop="uploadDate" content="2025-07-04T00:00:00Z" />
      <div itemprop="author" itemscope itemtype="http://schema.org/Person">
        <span itemprop="name">Channel Owner</span>
        <link itemprop="url" href="https://video.example/@channelowner" />
      </div>
    </div>
  </body></html>`;
  const result = await runOn(html, 'https://video.example/watch?v=abc123');
  expect(result.title).toBe('A Great Video');
  expect(result.published).toBe('2025-07-04T00:00:00Z');
  expect(result.author).toEqual({ name: 'Channel Owner', url: 'https://video.example/@channelowner' });
  expect(result.metaSource.author).toBe('microdata');
});

test('OGP のみのページ＝#195 と同じ内容で保存される（退行なし）', async () => {
  const html = `<!doctype html><html><head>
    <title>Fallback Title (should not be used)</title>
    <link rel="canonical" href="https://example.com/articles/hello-world" />
    <meta property="og:title" content="Hello World, an OGP Article" />
    <meta property="og:description" content="A short description." />
    <meta property="og:image" content="https://cdn.example.com/images/hello.jpg" />
    <meta property="og:site_name" content="Example Times" />
  </head><body></body></html>`;
  const result = await runOn(html, 'https://example.com/some/page?ref=x');
  expect(result.title).toBe('Hello World, an OGP Article');
  expect(result.description).toBe('A short description.');
  expect(result.image).toBe('https://cdn.example.com/images/hello.jpg');
  expect(result.siteName).toBe('Example Times');
  expect(result.url).toBe('https://example.com/articles/hello-world');
  expect(result.author).toBe(null);
});

// #894: パーサは属性の値を実体参照ごとそのまま返す。だからクエリパラメータが2つ以上ある
// meta の URL は、区切りが `&amp;` のまま届き、2つ目以降のパラメータ名がすべて `amp;…` へ
// 化けていた。Qiita の署名つき imgix の og:image ではそれで署名が落ち、CDN が 403 を返し、
// ブックマークの保存ごと失敗した。og:image がクエリ文字列を持たないページでは一度も出ない
// ので、サイト固有の問題に見えていた。
test('og:image のクエリ区切りが実体参照で書かれていても壊れない（#894）', async () => {
  const html = `<!doctype html><html><head>
    <title>Tom &amp; Jerry</title>
    <meta property="og:title" content="Tom &amp; Jerry &mdash; Signed Image" />
    <meta property="og:image" content="https://cdn.example.com/i/base.png?w=1200&amp;fm=jpg&amp;s=b0e948365c411875" />
  </head><body></body></html>`;
  const result = await runOn(html, 'https://example.com/articles/signed');

  // ページが意味している方の URL＝区切りごとに `&` が1つ、`amp;` という名前のパラメータは無い。
  expect(result.image).toBe('https://cdn.example.com/i/base.png?w=1200&fm=jpg&s=b0e948365c411875');
  expect([...new URL(result.image).searchParams.keys()]).toEqual(['w', 'fm', 's']);
  // テキストの欄も復号される＝同じ欠陥だが、致命的ではなく目に見えるだけ。
  expect(result.title).toBe('Tom & Jerry — Signed Image');
});

test('<title> フォールバックも実体参照を解いて返す（#894）', async () => {
  const html = '<!doctype html><html><head><title>Tom &amp; Jerry &mdash; title tag</title></head><body></body></html>';
  const result = await runOn(html, 'https://example.com/plain');

  expect(result.title).toBe('Tom & Jerry — title tag');
  expect(result.metaSource.title).toBe('title');
});

// #902、#894 のもう半分: metatags は `<meta>` を DOM から読むことで直った。しかし
// microdata と RDFa はライブラリが直列化された HTML を自分で読んで組み立てるので、値は
// 実体参照が入ったまま届いていた。復号するのはこの2つの形式だけ（read-meta.ts の
// decodeBucket）＝下の JSON-LD の場合が、その規則の反対側にあたる。
test('microdata の値が実体参照を解いて返る（#902）', async () => {
  const html = `<!doctype html><html><head><title>Fallback</title></head><body>
    <div itemscope itemtype="http://schema.org/Article">
      <span itemprop="headline">Tom &amp; Jerry &mdash; microdata</span>
      <meta itemprop="description" content="Cats &amp; mice &mdash; see https://x.example/s?q=1&ampersand=2" />
      <div itemprop="author" itemscope itemtype="http://schema.org/Person">
        <span itemprop="name">Ada &amp; Co.</span>
        <link itemprop="url" href="https://blog.example/authors/tom&amp;jerry" />
      </div>
    </div>
  </body></html>`;
  const result = await runOn(html, 'https://blog.example/posts/tom-and-jerry');

  expect(result.title).toBe('Tom & Jerry — microdata');
  expect(result.metaSource.title).toBe('microdata');
  expect(result.author.name).toBe('Ada & Co.');
  // この段の欄のうち、見た目のためのテキストではなく URL であるただ1つ。
  expect(result.author.url).toBe('https://blog.example/authors/tom&jerry');
  // `&ampersand` はセミコロンの無い旧式の実体参照だ。HTML のテキストの規則なら `&amp` を
  // 復号して `ersand=2` を後ろに残す。そう書かれたクエリ文字列をそのまま残すためにこそ
  // decodeHTMLAttribute を使っている＝#894 の壊れ方の逆向き。
  expect(result.description).toBe('Cats & mice — see https://x.example/s?q=1&ampersand=2');
});

test('RDFa の値が実体参照を解いて返る（#902）', async () => {
  const html = `<!doctype html><html><head><title>Fallback</title></head><body>
    <div vocab="https://schema.org/" typeof="Article">
      <span property="headline">Tom &amp; Jerry &mdash; RDFa</span>
      <meta property="description" content="Cats &amp; mice &mdash; a study." />
      <div property="author" typeof="Person">
        <span property="name">Ada &amp; Co.</span>
      </div>
    </div>
  </body></html>`;
  const result = await runOn(html, 'https://blog.example/posts/tom-and-jerry');

  expect(result.title).toBe('Tom & Jerry — RDFa');
  expect(result.metaSource.title).toBe('rdfa');
  expect(result.description).toBe('Cats & mice — a study.');
  expect(result.author.name).toBe('Ada & Co.');
});

// 上の2つの裏返し: JSON-LD は <script> 要素の生のテキストから来る。そこには実体参照が
// 一切無いので、中にある `&amp;` という字面は書き手が実際に書いたテキストだ。このバケットも
// 復号すると、それを壊してしまう。
test('JSON-LD のリテラル &amp; は復号されない（#902）', async () => {
  const html = `<!doctype html><html><head><title>Fallback</title>
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Article","headline":"Escaping HTML: write &amp; for an ampersand","description":"&mdash; is an em dash."}
    </script>
  </head><body>
    <div itemscope itemtype="http://schema.org/Person"><span itemprop="name">Ada &amp; Co.</span></div>
  </body></html>`;
  const result = await runOn(html, 'https://blog.example/posts/escaping-html');

  expect(result.title).toBe('Escaping HTML: write &amp; for an ampersand');
  expect(result.description).toBe('&mdash; is an em dash.');
  expect(result.metaSource.title).toBe('jsonld');
});

test('canonical が別オリジン＝タブの URL が使われる', async () => {
  const html = `<!doctype html><html><head>
    <link rel="canonical" href="https://syndicate.example/copy/of/this/page" />
    <meta property="og:title" content="Syndicated Article" />
  </head><body></body></html>`;
  const result = await runOn(html, 'https://origin.example/articles/real');
  expect(result.url).toBe('https://origin.example/articles/real');
  expect(result.metaSource.url).toBe('tab');
});
