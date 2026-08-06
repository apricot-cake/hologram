// #239: runs the ACTUAL BUILT entrypoint bundle (extension/.output/chrome-mv3-
// release/read-meta.js) through jsdom — the same technique
// capture-mode-select.test.ts uses for capture.js. This is what exercises the
// real @marbec/web-auto-extractor parser end to end: scripts/web-meta.test.ts
// covers chooseWebMeta's own decision logic against hand-written fixtures
// (that suite cannot import the real parser at all — see its header comment
// for why), but only a real bundle can catch a mismatch between what THIS
// module assumes the parser returns and what it actually returns once
// bundled — precisely the class of bug #759 was: correct when called
// directly, broken once carried across the injection boundary.
//
// Prerequisite: extension/.output/chrome-mv3-release/read-meta.js (built by
// `npm run build:ext`, which scripts/vitest.global-setup.ts runs automatically
// when the output is stale).

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { expect, test, vi } from 'vitest';

const BUNDLE = fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3-release', 'read-meta.js'), 'utf8');

// Runs the bundle against one fixture page and returns the single
// pageMetaExtracted message it sent (the entrypoint sends exactly one, then
// its job is done — see read-meta.ts's header comment).
async function runOn(html: string, url: string): Promise<any> {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const { window } = dom;
  const sent: any[] = [];
  window.chrome = { runtime: { sendMessage: (msg: any) => sent.push(msg) } } as any;
  window.eval(BUNDLE);
  // The entrypoint sends exactly one message and then it is done — that message IS the
  // post-condition, so poll for it rather than guessing how long extraction takes.
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

// #894: the parser returns attribute values verbatim, entities and all. A meta
// URL with more than one query parameter therefore arrived with `&amp;` between
// them, so every parameter after the first was renamed `amp;…` — for Qiita's
// signed imgix og:image that dropped the signature and the CDN answered 403,
// which failed the whole bookmark save. Pages whose og:image carries no query
// string never showed it, which is what made it look site-specific.
test('og:image のクエリ区切りが実体参照で書かれていても壊れない（#894）', async () => {
  const html = `<!doctype html><html><head>
    <title>Tom &amp; Jerry</title>
    <meta property="og:title" content="Tom &amp; Jerry &mdash; Signed Image" />
    <meta property="og:image" content="https://cdn.example.com/i/base.png?w=1200&amp;fm=jpg&amp;s=b0e948365c411875" />
  </head><body></body></html>`;
  const result = await runOn(html, 'https://example.com/articles/signed');

  // The URL the page MEANS — one `&` per separator, no `amp;` parameter names.
  expect(result.image).toBe('https://cdn.example.com/i/base.png?w=1200&fm=jpg&s=b0e948365c411875');
  expect([...new URL(result.image).searchParams.keys()]).toEqual(['w', 'fm', 's']);
  // Text fields decode too — the same defect, just visible rather than fatal.
  expect(result.title).toBe('Tom & Jerry — Signed Image');
});

test('<title> フォールバックも実体参照を解いて返す（#894）', async () => {
  const html = '<!doctype html><html><head><title>Tom &amp; Jerry &mdash; title tag</title></head><body></body></html>';
  const result = await runOn(html, 'https://example.com/plain');

  expect(result.title).toBe('Tom & Jerry — title tag');
  expect(result.metaSource.title).toBe('title');
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
