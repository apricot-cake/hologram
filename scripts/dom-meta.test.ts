// 投稿情報の DOM 補完（#202 段1）のオフライン純ユニットテスト。
//
// 見るのは2層で、どちらも実サイトへは一切アクセスしない:
//
//   1. **マージ規則**（extension/utils/extractor/dom-meta.ts）＝「API の値が常に勝ち、
//      DOM は空いている欄だけを埋める」。ここが本 Issue の唯一の合流点なので、
//      「API 成功／失敗 × フィールドの有無」の分岐を表で潰す。どの値がどちらから
//      来たかは戻り値（domFilled）に現れるので、テストから見える。
//   2. **X の抽出**（extension/utils/extractor/x.ts の extractXDomMeta）＝保存済みの
//      DOM フィクスチャ（scripts/fixtures/content/x-dom-meta.html）に対して走らせる。
//      フィクスチャは手書きで、コードが狙っているセレクタ／testid の形と、
//      実際に揺れると分かっている箇所（いいね済みで testid が変わる・数値の
//      省略表記が UI 言語で変わる・引用カードが自分の subtree に入る）を再現したもの。
//
// ここで捕まるのは「自分のコード変更が壊した」退行。「X 側が DOM を変えた」は
// 捕まらない＝それは content-fixtures.test.ts と同じ線引きで、実サイト e2e の担当。
// ただし**壊れ方が安全側であること**（セレクタが全滅しても保存は無傷）は、
// 総取り替えしたフィクスチャ1件でここでも見ている。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DOM_FILLABLE, domRescuedEssentials, mergeDomMeta, parseCount, readDomMeta } from '../extension/utils/extractor/dom-meta.ts';
import { emptyRecord } from '../extension/utils/extractor/record.ts';
import type { CaptureSite, DomMeta, PostRecord } from '../extension/utils/extractor/types.ts';
import x, { extractXDomMeta } from '../extension/utils/extractor/x.ts';

// === 1. マージ規則 ===========================================================

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

  // 0 は「まだ誰も押していない」という API の答え＝欠損ではない。falsy 判定で
  // 書き換えると、画面側の概数で正確な 0 を上書きしてしまう。
  test('API の 0 は欠損ではない＝上書きしない', () => {
    const rec = apiRecord({ likes: 0, replies: 0 });
    const filled = mergeDomMeta(rec, { likes: 12, replies: 34 });

    expect(rec.likes).toBe(0);
    expect(rec.replies).toBe(0);
    expect(filled).toEqual([]);
  });

  // X の埋め込み用 API はリポスト／ブクマ／表示回数を返す口を持たない＝取得が
  // 成功した投稿でも常に null。「失敗した時だけ DOM を見る」設計だと、この3つは
  // 永遠に空のまま残る。
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

  // 埋められる欄は明示リスト＝URL・プラットフォーム・メディアのような
  // 「保存経路と API が決めるもの」を画面側の推測で埋めさせない。
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

  // 数値だけが埋まった状態は「レコードが空でなくなった」ではない＝
  // 「投稿情報は取得できません」の文言のままでよい。
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

// readDomMeta は「サイト側の実装が投げても保存を巻き込まない」ための唯一の壁。
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

// === 2. X の抽出 =============================================================

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures', 'content');
// content-fixtures.test.ts と同じ据え方＝サイトモジュールは呼び出し時にグローバルから
// 読むので、フィクスチャごとに差し替えて安全。
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

  // 認証バッジは <svg><title>Verified account</title></svg>＝表示名の一部ではない。
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

  // 誤マッチで別投稿の言葉を書き込むのが、この機能の唯一の実害ある壊れ方。
  test('引用は引用した側の本文・作者・日時を取る（被引用カードではない）', () => {
    const meta = read('tweetQuote');
    expect(meta.text).toBe('これは引用した側の本文');
    expect(meta.displayName).toBe('Carol');
    expect(meta.screenName).toBe('carol');
    expect(meta.date).toBe('2026-03-04T00:00:00.000Z');
  });

  // 本文ノードが無い／数値が 0 で描かれない＝どちらも正常な状態。空文字や 0 を
  // 書くと「本文を失ったレコード」と区別が付かなくなるので、欄ごと置かない。
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

  // 壊れ方が安全側であること＝段1 の設計上いちばん重要な性質。
  test('セレクタが全滅しても投げず、何も埋めない', () => {
    const el = ctx.document.getElementById('tweetRedesigned') as Element;
    expect(() => extractXDomMeta(el)).not.toThrow();
    expect(extractXDomMeta(el)).toEqual({});
    expect(mergeDomMeta(apiRecord(), extractXDomMeta(el))).toEqual([]);
  });

  // 画像拡大表示（#325）は <img> そのものが投稿要素になる＝内側に何も無い。
  test('投稿要素の形が想定外でも投げない', () => {
    const img = ctx.document.createElement('img');
    expect(() => extractXDomMeta(img)).not.toThrow();
    expect(extractXDomMeta(img)).toEqual({});
  });
});

// === 3. 合流 =================================================================
//
// 実機で最も損の大きい壊れ方（年齢制限＝API が tombstone を返し、画像は見えている
// のに投稿情報が空）が、フィクスチャの DOM で実際に埋まるところまで通す。
describe('年齢制限の投稿: API が黙っても画面から埋まる', () => {
  let ctx: ReturnType<typeof installFixture>;

  beforeAll(() => {
    ctx = installFixture('x-dom-meta.html', 'https://x.com/home');
  });
  afterAll(() => ctx.restore());

  test('本文・作者・日時が入り、metaError はそのまま残る', () => {
    // x.ts の fetchXTweet が tombstone に対して作るレコードと同じ形＝
    // URL 由来の screenName と snowflake 由来の日時だけを持つ。
    const rec = apiRecord({ metaError: 'ageRestricted', screenName: 'alice' });
    const filled = mergeDomMeta(rec, extractXDomMeta(ctx.document.getElementById('tweetPlain') as Element));

    expect(rec.text).toBe('Hello 🌸\nworld');
    expect(rec.displayName).toBe('Alice Example');
    expect(rec.likes).toBe(56);
    // URL から取れていた screenName は API 側の値＝DOM は触らない。
    expect(rec.screenName).toBe('alice');
    expect(filled).not.toContain('screenName');
    // metaOk の意味は変えない＝部分保存のままで、バナーの文言だけが変わる。
    expect(rec.metaError).toBe('ageRestricted');
    expect(domRescuedEssentials(filled)).toBe(true);
  });
});
