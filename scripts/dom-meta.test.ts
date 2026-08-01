// Offline pure unit test for the post info DOM fallback (#202 phase 1).
//
// Two layers are checked, and neither ever accesses a real site:
//
//   1. **the merge rule** (extension/utils/extractor/dom-meta.ts) = "the API's
//      value always wins, DOM only fills fields that are empty". Since this is
//      the sole point where this Issue converges, the "API success/failure x
//      field present/absent" branches are exhaustively covered in a table.
//      Which value came from which side shows up in the return value
//      (domFilled), so the test can observe it.
//   2. **X's extraction** (extractXDomMeta in extension/utils/extractor/x.ts) =
//      run against a saved DOM fixture (scripts/fixtures/content/x-dom-meta.html).
//      The fixture is hand-written, reproducing both the selector/testid shapes
//      the code targets and the spots known to actually shift (testid changes
//      once liked, abbreviated number notation changes with the UI language,
//      a quote card lands inside its own subtree).
//
// What this catches is regressions "my own code change broke". It does not
// catch "X changed its DOM" = that's the same dividing line as
// content-fixtures.test.ts, and is the real-site e2e's job. However, **that
// the failure mode is fail-safe** (a save stays intact even if every selector
// misses) is also checked here, with one fixture that's swapped out entirely.

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DOM_FILLABLE, domRescuedEssentials, mergeDomMeta, parseCount, readDomMeta } from '../extension/utils/extractor/dom-meta.ts';
import { emptyRecord } from '../extension/utils/extractor/record.ts';
import type { CaptureSite, DomMeta, PostRecord } from '../extension/utils/extractor/types.ts';
import x, { extractXDomMeta } from '../extension/utils/extractor/x.ts';

// === 1. merge rule ===========================================================

function apiRecord(fields: Partial<PostRecord> = {}): PostRecord {
  return Object.assign(emptyRecord('https://x.com/alice/status/111', 'x'), fields);
}

describe('mergeDomMeta: API が答えた値は常に勝つ', () => {
  test('API が空にした欄だけを埋め、埋めた欄の名前を返す', () => {
    const rec = apiRecord();
    const filled = mergeDomMeta(rec, { text: '画面の本文', displayName: 'Alice', likes: 56 });

    expect(rec.text).toBe('画面の本文');
    expect(rec.displayName).toBe('Alice');
    expect(rec.likes).toBe(56);
    expect(filled.sort()).toEqual(['displayName', 'likes', 'text']);
  });

  test('API に値がある欄は DOM が違うことを言っても書き換えない', () => {
    const rec = apiRecord({ text: 'API の本文', displayName: 'API の作者', likes: 100 });
    const filled = mergeDomMeta(rec, { text: '画面の本文', displayName: '画面の作者', likes: 105 });

    expect(rec.text).toBe('API の本文');
    expect(rec.displayName).toBe('API の作者');
    expect(rec.likes).toBe(100);
    expect(filled).toEqual([]);
  });

  // 0 is the API's answer meaning "no one has pressed this yet" = not a
  // missing value. Rewriting it based on a falsy check would overwrite an exact 0 with the screen's rough count.
  test('API の 0 は欠損ではない＝上書きしない', () => {
    const rec = apiRecord({ likes: 0, replies: 0 });
    const filled = mergeDomMeta(rec, { likes: 12, replies: 34 });

    expect(rec.likes).toBe(0);
    expect(rec.replies).toBe(0);
    expect(filled).toEqual([]);
  });

  // X's embed API has no way to return reposts/bookmarks/view count = these are
  // always null even for a post whose fetch succeeded. With a design of "only
  // look at the DOM on failure", these three would stay empty forever.
  test('API 取得が成功していても、構造的に返せない欄は埋める', () => {
    const rec = apiRecord({ text: 'API の本文', displayName: 'API の作者', likes: 56, replies: 12 });
    const filled = mergeDomMeta(rec, { text: '画面の本文', likes: 55, reposts: 34, bookmarks: 78, views: 9012 });

    expect(rec.reposts).toBe(34);
    expect(rec.bookmarks).toBe(78);
    expect(rec.views).toBe(9012);
    expect(rec.text).toBe('API の本文');
    expect(filled.sort()).toEqual(['bookmarks', 'reposts', 'views']);
  });

  test('DOM 側が無い／空なら何も起きない', () => {
    const rec = apiRecord();
    expect(mergeDomMeta(rec, null)).toEqual([]);
    expect(mergeDomMeta(rec, undefined)).toEqual([]);
    expect(mergeDomMeta(rec, {})).toEqual([]);
    expect(rec.text).toBe(null);
  });

  // The fields that can be filled are an explicit allowlist = things like URL,
  // platform, and media, which "the save path and the API decide", are never allowed to be filled by a screen guess.
  test('リストに無い欄は DOM から埋まらない', () => {
    const rec = apiRecord();
    mergeDomMeta(rec, { url: 'https://evil.example/', platform: 'evil', media: [{ url: 'x' }] } as unknown as DomMeta);

    expect(rec.url).toBe('https://x.com/alice/status/111');
    expect(rec.platform).toBe('x');
    expect(rec.media).toEqual([]);
    expect(DOM_FILLABLE).not.toContain('url');
    expect(DOM_FILLABLE).not.toContain('media');
  });
});

describe('domRescuedEssentials: バナー文言の切り替え条件', () => {
  test('本文か作者が画面から埋まったら真', () => {
    expect(domRescuedEssentials(['text'])).toBe(true);
    expect(domRescuedEssentials(['displayName'])).toBe(true);
    expect(domRescuedEssentials(['text', 'likes'])).toBe(true);
  });

  // A state where only numbers got filled isn't "the record is no longer
  // empty" = it's fine for the "post info couldn't be retrieved" text to stay as-is.
  test('数値だけなら偽', () => {
    expect(domRescuedEssentials(['likes', 'views', 'bookmarks'])).toBe(false);
    expect(domRescuedEssentials([])).toBe(false);
    expect(domRescuedEssentials(null)).toBe(false);
    expect(domRescuedEssentials(undefined)).toBe(false);
  });
});

describe('parseCount: 省略表記を概数へ', () => {
  test('区切り記号つきの素の数値', () => {
    expect(parseCount('12')).toBe(12);
    expect(parseCount('1,234')).toBe(1234);
    expect(parseCount(' 9 012 ')).toBe(9012);
  });

  test('英語 UI の省略表記', () => {
    expect(parseCount('1.2K')).toBe(1200);
    expect(parseCount('3.4M')).toBe(3400000);
    expect(parseCount('2b')).toBe(2000000000);
  });

  test('日本語 UI の省略表記', () => {
    expect(parseCount('1.2万')).toBe(12000);
    expect(parseCount('3.4万')).toBe(34000);
    expect(parseCount('2.1億')).toBe(210000000);
  });

  test('全角数字も読む', () => {
    expect(parseCount('１２３４')).toBe(1234);
    expect(parseCount('１．２万')).toBe(12000);
  });

  test('数値で始まらない文字列は null（言語依存の aria-label を推測で読まない）', () => {
    expect(parseCount('Reply')).toBe(null);
    expect(parseCount('いいね 1,234 件')).toBe(null);
    expect(parseCount('')).toBe(null);
    expect(parseCount(null)).toBe(null);
    expect(parseCount(undefined)).toBe(null);
  });
});

// readDomMeta is the sole wall for "even if the site-side implementation throws, it doesn't take the save down with it".
describe('readDomMeta: 例外を外へ出さない', () => {
  const post = { nodeType: 1 } as unknown as Element;

  test('投げる実装は null になる（保存は従来どおり続く）', () => {
    const site = {
      platform: 'x',
      getPermalink: () => '',
      extractDomMeta: () => {
        throw new Error('selector blew up');
      },
    } as unknown as CaptureSite;
    expect(readDomMeta(site, post)).toBe(null);
  });

  test('extractDomMeta を持たないサイトは null', () => {
    expect(readDomMeta({ platform: 'bluesky', getPermalink: () => '' } as CaptureSite, post)).toBe(null);
    expect(readDomMeta(null, post)).toBe(null);
  });

  test('壊れた値は落とされる（空文字・負数・非有限）', () => {
    const site = {
      platform: 'x',
      getPermalink: () => '',
      extractDomMeta: () => ({ text: '   ', displayName: 'Alice', likes: -1, views: Number.NaN, replies: 3 }),
    } as unknown as CaptureSite;
    expect(readDomMeta(site, post)).toEqual({ displayName: 'Alice', replies: 3 });
  });
});

// === 2. X's extraction =============================================================

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures', 'content');
// Same setup as content-fixtures.test.ts = the site module reads from globals
// at call time, so it's safe to swap them out per fixture.
const KEYS = ['window', 'document', 'location', 'getComputedStyle', 'Element', 'HTMLElement', 'HTMLAnchorElement', 'HTMLImageElement', 'Node'];

function installFixture(fixtureFile: string, url: string) {
  const dom = new JSDOM(fs.readFileSync(path.join(FIXTURES_DIR, fixtureFile), 'utf8'), { url });
  const saved: Record<string, any> = {};
  for (const k of KEYS) {
    saved[k] = (global as any)[k];
    (global as any)[k] = (dom.window as any)[k];
  }
  return {
    document: dom.window.document,
    restore: () => {
      for (const k of KEYS) (global as any)[k] = saved[k];
    },
  };
}

describe('X: 画面から読む投稿情報', () => {
  let ctx: ReturnType<typeof installFixture>;
  const read = (id: string) => extractXDomMeta(ctx.document.getElementById(id) as Element);

  beforeAll(() => {
    ctx = installFixture('x-dom-meta.html', 'https://x.com/home');
  });
  afterAll(() => ctx.restore());

  test('サイトモジュールの capture 設定から呼べる', () => {
    expect(typeof x.capture.extractDomMeta).toBe('function');
  });

  test('通常の投稿＝本文・作者・日時・5種の数値', () => {
    expect(read('tweetPlain')).toEqual({
      text: 'Hello 🌸\nworld',
      displayName: 'Alice Example',
      screenName: 'alice',
      date: '2026-01-02T03:04:05.000Z',
      replies: 12,
      reposts: 34,
      likes: 56,
      bookmarks: 78,
      views: 9012,
    });
  });

  // The verification badge is <svg><title>Verified account</title></svg> = it isn't part of the display name.
  test('認証バッジの文字列が表示名に混ざらない', () => {
    expect(read('tweetPlain').displayName).not.toContain('Verified');
  });

  test('絵文字は alt、改行は <br> から拾う', () => {
    expect(read('tweetPlain').text).toBe('Hello 🌸\nworld');
  });

  test('いいね済み・リポスト済みで testid が変わっても読める（日本語の省略表記つき）', () => {
    expect(read('tweetActed')).toEqual({
      text: 'ふつうの投稿',
      displayName: 'Bob',
      screenName: 'bob',
      date: '2026-02-03T00:00:00.000Z',
      replies: 1234,
      reposts: 34000,
      likes: 12000,
      bookmarks: 567,
      views: 210000000,
    });
  });

  // A mismatch writing in another post's words is this feature's only failure mode that causes actual harm.
  test('引用は引用した側の本文・作者・日時を取る（被引用カードではない）', () => {
    const meta = read('tweetQuote');
    expect(meta.text).toBe('これは引用した側の本文');
    expect(meta.displayName).toBe('Carol');
    expect(meta.screenName).toBe('carol');
    expect(meta.date).toBe('2026-03-04T00:00:00.000Z');
  });

  // No body text node, or a count that renders as 0 and so isn't drawn at all
  // = both are normal states. Writing an empty string or 0 would make this
  // indistinguishable from "a record that lost its body text", so the field isn't placed at all.
  test('本文の無い画像投稿は text を置かない（空文字を書かない）', () => {
    const meta = read('tweetNoText');
    expect('text' in meta).toBe(false);
    expect(meta.displayName).toBe('Erin');
    expect(meta.date).toBe('2026-04-05T00:00:00.000Z');
  });

  test('数値が描かれていない（0件）欄は置かない', () => {
    const meta = read('tweetNoText');
    expect('likes' in meta).toBe(false);
    expect('replies' in meta).toBe(false);
  });

  // That the failure mode is fail-safe = the single most important property of phase 1's design.
  test('セレクタが全滅しても投げず、何も埋めない', () => {
    const el = ctx.document.getElementById('tweetRedesigned') as Element;
    expect(() => extractXDomMeta(el)).not.toThrow();
    expect(extractXDomMeta(el)).toEqual({});
    expect(mergeDomMeta(apiRecord(), extractXDomMeta(el))).toEqual([]);
  });

  // In the enlarged image view (#325), the <img> itself becomes the post element = there's nothing inside it.
  test('投稿要素の形が想定外でも投げない', () => {
    const img = ctx.document.createElement('img');
    expect(() => extractXDomMeta(img)).not.toThrow();
    expect(extractXDomMeta(img)).toEqual({});
  });
});

// === 3. convergence =================================================================
//
// Carries the failure mode with the biggest real-world cost (age restriction =
// the API returns a tombstone, the image is visible but the post info is
// empty) through to actually being filled in by the fixture's DOM.
describe('年齢制限の投稿: API が黙っても画面から埋まる', () => {
  let ctx: ReturnType<typeof installFixture>;

  beforeAll(() => {
    ctx = installFixture('x-dom-meta.html', 'https://x.com/home');
  });
  afterAll(() => ctx.restore());

  test('本文・作者・日時が入り、metaError はそのまま残る', () => {
    // The same shape as the record x.ts's fetchXTweet builds for a tombstone =
    // it only has a screenName derived from the URL and a date derived from the snowflake.
    const rec = apiRecord({ metaError: 'ageRestricted', screenName: 'alice' });
    const filled = mergeDomMeta(rec, extractXDomMeta(ctx.document.getElementById('tweetPlain') as Element));

    expect(rec.text).toBe('Hello 🌸\nworld');
    expect(rec.displayName).toBe('Alice Example');
    expect(rec.likes).toBe(56);
    // The screenName that was already obtained from the URL is the API-side value = the DOM doesn't touch it.
    expect(rec.screenName).toBe('alice');
    expect(filled).not.toContain('screenName');
    // The meaning of metaOk doesn't change = it stays a partial save, only the banner's text changes.
    expect(rec.metaError).toBe('ageRestricted');
    expect(domRescuedEssentials(filled)).toBe(true);
  });
});
