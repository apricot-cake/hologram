// 投稿情報の DOM への退避（#202 段階1）の、通信しない純粋な単体テスト。
//
// 見る層は2つで、どちらも実際のサイトへは一切アクセスしない。
//
//   1. 合流の規則（extension/utils/extractor/dom-meta.ts）＝「API の値が常に勝ち、
//      DOM が埋めるのは空いている欄だけ」。この Issue が収束する唯一の点なので、
//      「API の成否 × 欄の有無」の分岐を表で網羅する。どちらの側から来た値かは
//      戻り値（domFilled）に出るので、テストから観測できる。
//   2. X からの抽出（extension/utils/extractor/x.ts の extractXDomMeta）＝保存した
//      DOM のフィクスチャ（scripts/fixtures/content/x-dom-meta.html）に対して走らせる。
//      フィクスチャは手で書いたもので、コードが狙うセレクタ・testid の形と、実際に
//      動くと分かっている箇所の両方を再現している（いいねすると testid が変わる、
//      数値の省略表記が UI の言語で変わる、引用カードが自分の部分木の中に来る）。
//
// ここで捕まえるのは「自分のコード変更で壊れた」という回帰。「X が DOM を変えた」は
// 捕まえない＝content-fixtures.test.ts と同じ線引きで、それは実サイトの e2e の仕事。
// ただし、壊れ方が安全側に倒れること（セレクタが全部外れても保存自体は無事）は、丸ごと
// 差し替えたフィクスチャ1つを使ってここでも見る。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DOM_FILLABLE, domRescuedEssentials, mergeDomMeta, parseCount, readDomMeta } from './dom-meta.ts';
import { emptyRecord } from './record.ts';
import type { ContentSite, DomMeta, PostRecord } from './types.ts';
import x, { extractXDomMeta } from './x.ts';

// === 1. 合流の規則 ===========================================================

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

  // 0 は「まだ誰も押していない」という API の答えであって、欠損ではない。falsy
  // かどうかで書き換えると、正確な 0 を画面の概数で上書きしてしまう。
  test('API の 0 は欠損ではない＝上書きしない', () => {
    const rec = apiRecord({ likes: 0, replies: 0 });
    const filled = mergeDomMeta(rec, { likes: 12, replies: 34 });

    expect(rec.likes).toBe(0);
    expect(rec.replies).toBe(0);
    expect(filled).toEqual([]);
  });

  // X の埋め込み API には reposts/bookmarks/表示回数 を返す手段が無い＝取得に成功した
  // 投稿でもこの3つは常に null。「失敗したときだけ DOM を見る」という設計だと、この
  // 3つは永久に空のままになる。
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

  // 埋められる欄は明示的な許可リスト＝URL・platform・media のように「保存の経路と
  // API が決める」ものは、画面からの推測で埋めさせない。
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

  // 数値だけが埋まった状態は「レコードが空でなくなった」とは言えない＝「投稿情報を
  // 取得できなかった」という文言はそのままでよい。
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

// readDomMeta は「サイト側の実装が投げても保存を巻き添えにしない」ための唯一の壁。
describe('readDomMeta: 例外を外へ出さない', () => {
  const post = { nodeType: 1 } as unknown as Element;

  test('投げる実装は null になる（保存は従来どおり続く）', () => {
    const site = {
      platform: 'x',
      getPermalink: () => '',
      extractDomMeta: () => {
        throw new Error('selector blew up');
      },
    } as unknown as ContentSite;
    expect(readDomMeta(site, post)).toBe(null);
  });

  test('extractDomMeta を持たないサイトは null', () => {
    expect(readDomMeta({ platform: 'bluesky', getPermalink: () => '' } as ContentSite, post)).toBe(null);
    expect(readDomMeta(null, post)).toBe(null);
  });

  test('壊れた値は落とされる（空文字・負数・非有限）', () => {
    const site = {
      platform: 'x',
      getPermalink: () => '',
      extractDomMeta: () => ({ text: '   ', displayName: 'Alice', likes: -1, views: Number.NaN, replies: 3 }),
    } as unknown as ContentSite;
    expect(readDomMeta(site, post)).toEqual({ displayName: 'Alice', replies: 3 });
  });
});

// === 2. X からの抽出 =============================================================

const FIXTURES_DIR = path.join(import.meta.dirname, '../../../scripts/fixtures/content');
// content-fixtures.test.ts と同じ仕掛け＝サイトモジュールは呼ばれた時点でグローバルを
// 読むので、フィクスチャごとに差し替えて構わない。
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

  test('サイトモジュールの content 設定から呼べる', () => {
    expect(typeof x.content.extractDomMeta).toBe('function');
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

  // 認証バッジは <svg><title>Verified account</title></svg> ＝表示名の一部ではない。
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

  // 別の投稿の言葉を書き込む取り違えが、この機能で実害の出る唯一の壊れ方。
  test('引用は引用した側の本文・作者・日時を取る（被引用カードではない）', () => {
    const meta = read('tweetQuote');
    expect(meta.text).toBe('これは引用した側の本文');
    expect(meta.displayName).toBe('Carol');
    expect(meta.screenName).toBe('carol');
    expect(meta.date).toBe('2026-03-04T00:00:00.000Z');
  });

  // 本文のノードが無い、あるいは 0 件で数値がそもそも描かれない＝どちらも普通の状態。
  // 空文字や 0 を書くと「本文を失ったレコード」と見分けがつかなくなるので、欄そのものを
  // 置かない。
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

  // 壊れ方が安全側に倒れること＝段階1の設計でいちばん大事な性質。
  test('セレクタが全滅しても投げず、何も埋めない', () => {
    const el = ctx.document.getElementById('tweetRedesigned') as Element;
    expect(() => extractXDomMeta(el)).not.toThrow();
    expect(extractXDomMeta(el)).toEqual({});
    expect(mergeDomMeta(apiRecord(), extractXDomMeta(el))).toEqual([]);
  });

  // 画像の拡大表示（#325）では <img> 自体が投稿要素になる＝その中には何も無い。
  test('投稿要素の形が想定外でも投げない', () => {
    const img = ctx.document.createElement('img');
    expect(() => extractXDomMeta(img)).not.toThrow();
    expect(extractXDomMeta(img)).toEqual({});
  });
});

// === 3. 収束 =================================================================
//
// 実害のいちばん大きい壊れ方（年齢制限＝API は tombstone を返し、画像は見えているのに
// 投稿情報が空）を、フィクスチャの DOM で実際に埋まるところまで通す。
describe('年齢制限の投稿: API が黙っても画面から埋まる', () => {
  let ctx: ReturnType<typeof installFixture>;

  beforeAll(() => {
    ctx = installFixture('x-dom-meta.html', 'https://x.com/home');
  });
  afterAll(() => ctx.restore());

  test('本文・作者・日時が入り、metaError はそのまま残る', () => {
    // x.ts の fetchXTweet が tombstone に対して組むレコードと同じ形＝URL から取れた
    // screenName と、snowflake から取れた date しか持たない。
    const rec = apiRecord({ metaError: 'ageRestricted', screenName: 'alice' });
    const filled = mergeDomMeta(rec, extractXDomMeta(ctx.document.getElementById('tweetPlain') as Element));

    expect(rec.text).toBe('Hello 🌸\nworld');
    expect(rec.displayName).toBe('Alice Example');
    expect(rec.likes).toBe(56);
    // URL からすでに得ていた screenName は API 側の値＝DOM は触らない。
    expect(rec.screenName).toBe('alice');
    expect(filled).not.toContain('screenName');
    // metaOk の意味は変わらない＝部分的な保存のままで、変わるのはバナーの文言だけ。
    expect(rec.metaError).toBe('ageRestricted');
    expect(domRescuedEssentials(filled)).toBe(true);
  });
});
