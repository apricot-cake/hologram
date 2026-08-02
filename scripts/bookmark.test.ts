// Offline unit test for URL bookmark intake (#195): OGP extraction from the
// page's own DOM (extractOgp), and composing that read into the PostRecord
// shape a save sends (buildBookmarkMeta). Neither function ever fetches
// anything — extractOgp reads whatever the browser already rendered, so the
// same JSDOM-fixture technique dom-meta.test.ts uses for the site extractors'
// DOM phase applies here unmodified.
//
// What this does NOT cover: the chrome.contextMenus wiring and the actual save
// (background-wiring.test.ts covers that machinery generically for the other
// three save routes; #195's own contribution there is thin glue this file's
// pure functions do all the real work for).

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, test } from 'vitest';
import { buildBookmarkMeta, extractOgp } from '../extension/utils/bookmark.ts';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures', 'content');
// Same swap-and-restore technique as dom-meta.test.ts's installFixture: the
// module under test reads document/location off the globals at CALL time
// (never imported), so swapping them per fixture is safe and needs no module
// reload between tests.
const KEYS = ['window', 'document', 'location', 'HTMLMetaElement', 'HTMLLinkElement'];

function installFixture(fixtureFile: string, url: string) {
  const dom = new JSDOM(fs.readFileSync(path.join(FIXTURES_DIR, fixtureFile), 'utf8'), { url });
  const saved: Record<string, any> = {};
  for (const k of KEYS) {
    saved[k] = (globalThis as any)[k];
    (globalThis as any)[k] = (dom.window as any)[k];
  }
  return () => {
    for (const k of KEYS) (globalThis as any)[k] = saved[k];
  };
}

describe('extractOgp: ページ自身の DOM から読む（fetch なし）', () => {
  let restore: () => void;
  afterEach(() => restore?.());

  test('OGP がそろっているページ＝og:* と canonical を優先する', () => {
    restore = installFixture('bookmark-ogp.html', 'https://example.com/some/page?ref=x');
    expect(extractOgp()).toEqual({
      title: 'Hello World, an OGP Article',
      description: "A short description of the article, for the record's text field.",
      image: 'https://cdn.example.com/images/hello.jpg',
      siteName: 'Example Times',
      url: 'https://example.com/articles/hello-world',
    });
  });

  test('OGP が無いページ＝<title> とページ自身の URL/hostname に落ちる', () => {
    restore = installFixture('bookmark-plain.html', 'https://plain.example/some/path');
    expect(extractOgp()).toEqual({
      title: 'A Plain Page With No OGP At All',
      description: null,
      image: null,
      siteName: 'plain.example',
      url: 'https://plain.example/some/path',
    });
  });

  test('og:image がサイトルート相対＝ページの URL に対して絶対化する', () => {
    restore = installFixture('bookmark-relative-image.html', 'https://relative.example/articles/current');
    const ogp = extractOgp();
    expect(ogp.image).toBe('https://relative.example/static/thumb.png');
    expect(ogp.siteName).toBe('Relative Example');
    // No canonical link in this fixture — falls back to the page's own URL.
    expect(ogp.url).toBe('https://relative.example/articles/current');
  });

  // "//host/path" names its own host (cdn.example.com) and borrows only the
  // SCHEME from the page it's read on — unlike a path-relative URL, which
  // borrows the host too. Two page protocols confirm which part is borrowed.
  test('og:image がプロトコル相対＝ホストは URL 自身のもの・スキームだけページに合わせる（https）', () => {
    restore = installFixture('bookmark-protocol-relative-image.html', 'https://proto.example/page');
    expect(extractOgp().image).toBe('https://cdn.example.com/thumb.png');
  });

  test('og:image がプロトコル相対＝スキームは http のページなら http に合わせる', () => {
    restore = installFixture('bookmark-protocol-relative-image.html', 'http://proto.example/page');
    expect(extractOgp().image).toBe('http://cdn.example.com/thumb.png');
  });
});

// #759: extractOgp is chrome.scripting.executeScript's `func` (background.ts).
// Chrome serializes `func` to a source string and evaluates it with NO closure
// over this module's scope (Chrome docs, chrome.scripting: "any bound
// parameters and execution context will be lost") — a helper the function
// merely closes over (module-scope metaContent/absolutize, before this fix)
// disappears on the injected side even though every test above, which calls
// extractOgp() directly, still sees it and passes. Reproduce that detachment
// for real: pull the function's own source out with toString() and evaluate
// it with `new Function`, which — like the real injection — builds a
// function with no lexical access to this module's top-level bindings, only
// the global object (document/location/URL, which installFixture puts there
// same as above).
describe('extractOgp: chrome.scripting.executeScript の直列化を通しても読める（#759）', () => {
  let restore: () => void;
  afterEach(() => restore?.());

  test('関数ソースを new Function で評価した直列化コピーが、直接呼んだ結果と一致する', () => {
    restore = installFixture('bookmark-ogp.html', 'https://example.com/some/page?ref=x');
    const serialized = new Function(`return (${extractOgp.toString()})`)() as typeof extractOgp;
    expect(serialized()).toEqual(extractOgp());
  });

  test('og:image が無いページでも直列化コピーが直接呼んだ結果と一致する', () => {
    restore = installFixture('bookmark-plain.html', 'https://plain.example/some/path');
    const serialized = new Function(`return (${extractOgp.toString()})`)() as typeof extractOgp;
    expect(serialized()).toEqual(extractOgp());
  });
});

describe('buildBookmarkMeta: OGP の読みを保存レコードへ合成する', () => {
  test('platform は常に null（#195 2026-08-02 設計コメント #2）', () => {
    const rec = buildBookmarkMeta({ title: 'T', description: 'D', image: 'https://cdn.example.com/i.jpg', siteName: 'Site', url: 'https://example.com/a' }, 'https://example.com/a');
    expect(rec.platform).toBe(null);
  });

  test('OGP がそろっている＝title/text/displayName とメディア1件が埋まる', () => {
    const rec = buildBookmarkMeta({ title: 'A Title', description: 'A description', image: 'https://cdn.example.com/i.jpg', siteName: 'Some Site', url: 'https://example.com/a' }, 'https://example.com/a');
    expect(rec.url).toBe('https://example.com/a');
    expect(rec.title).toBe('A Title');
    expect(rec.text).toBe('A description');
    expect(rec.displayName).toBe('Some Site');
    expect(rec.mediaType).toBe('image');
    expect(rec.media).toEqual([{ url: 'https://cdn.example.com/i.jpg', alt: null, width: null, height: null }]);
  });

  // メディアゼロを許容する（#195 の受け入れ条件）＝og:image が無くてもレコードは
  // 組み上がり、native host 側の recordHoldsContent は title で通る。
  test('og:image が無い＝メディア0件のレコード（title で内容ありと判定される）', () => {
    const rec = buildBookmarkMeta({ title: 'No Image Here', description: null, image: null, siteName: 'Site', url: 'https://example.com/no-image' }, 'https://example.com/no-image');
    expect(rec.media).toEqual([]);
    expect(rec.mediaType).toBe(null);
    expect(rec.title).toBe('No Image Here');
  });

  // タイトルすら取れない最悪のページでも、空の殻レコードにはしない（#492 の
  // recordHoldsContent が拒否する形を作らない）＝URL 自体を title に落とす。
  test('OGP も <title> も無い＝URL 自体を title・displayName に落とす（空の殻にしない）', () => {
    const rec = buildBookmarkMeta({ title: null, description: null, image: null, siteName: null, url: null }, 'https://bare.example/page');
    expect(rec.url).toBe('https://bare.example/page');
    expect(rec.title).toBe('https://bare.example/page');
    expect(rec.displayName).toBe('bare.example');
  });

  test('サイト名が無い＝ホスト名に落ちる', () => {
    const rec = buildBookmarkMeta({ title: 'T', description: null, image: null, siteName: null, url: 'https://news.example/a/b' }, 'https://news.example/a/b');
    expect(rec.displayName).toBe('news.example');
  });
});
