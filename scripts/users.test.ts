// users.ts のロジック単体テスト。buildUsers（投稿者ロールアップ＋世代キャッシュ）と
// buildSuggest（検索サジェスト＝タグ上位＋投稿者マッチ）を、スタブ deps 注入で検証する。

import { beforeEach, describe, expect, test } from 'vitest';
import { makeUsers } from '../app/src/renderer/src/services/users';

// --- スタブ環境: newest-first の投稿列（先頭が最新） ---
// u1(x) は3投稿＝最初の非空値が勝つ（displayName は2投稿目で補完）・日付範囲を集計。
// u3(misskey) はインスタンス抽出。url 無しはスキップ。
const BASE_POSTS = () => [
  { url: 'https://x.com/a/status/3', platform: 'x', userId: 'u1', screenName: 'alice', displayName: '', avatarFile: '', followers: null, date: '2026-03-03', capturedAt: '2026-06-03' },
  { url: 'https://x.com/a/status/2', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'アリス', avatarFile: 'ava1.jpg', followers: 120, date: '2026-03-01', capturedAt: '2026-06-01' },
  { url: 'https://x.com/a/status/1', platform: 'x', userId: 'u1', screenName: 'alice', displayName: '旧アリス', avatarFile: 'ava0.jpg', followers: 99, date: '2026-03-02', capturedAt: '2026-06-02', authorCreatedAt: '2020-01-01' },
  { url: 'https://misskey.io/notes/n1', platform: 'misskey', userId: 'u3', screenName: 'carol', displayName: 'キャロル', tags: ['風景'], date: '2026-02-01' },
  { url: null, platform: null, tags: ['取込タグ'] },
];

let posts: any[];
let gen: number;
let compileCalls: string[];
let buildUsers: ReturnType<typeof makeUsers>['buildUsers'];
let buildSuggest: ReturnType<typeof makeUsers>['buildSuggest'];

beforeEach(() => {
  posts = BASE_POSTS();
  gen = 1;
  compileCalls = [];

  // compile スタブ（単一スマートマッチ）: 通常クエリは大文字小文字を無視した部分一致、
  // '☆' だけは「'風' か 'carol' を含む」へ解釈＝部分一致では絶対当たらないクエリで
  // 注入経路そのものを検証する（query.ts テストと同じ流儀）。
  const compile = (q: string) => {
    compileCalls.push(q);
    if (q === '☆') return (s: unknown) => String(s).includes('風') || String(s).includes('carol');
    const nq = String(q).toLowerCase();
    return (s: unknown) => String(s).toLowerCase().includes(nq);
  };

  ({ buildUsers, buildSuggest } = makeUsers({
    allPosts: () => posts,
    generation: () => gen,
    userKey: (p) => `${p.platform}:${p.userId || `@${p.screenName || ''}`}`,
    hostOf: (url) => {
      try {
        return new URL(url).hostname;
      } catch {
        return '';
      }
    },
    compile,
  }));
});

describe('buildUsers（ロールアップ）', () => {
  test('url 無しの投稿はスキップ', () => {
    expect(buildUsers()).toHaveLength(2);
  });

  test('同一投稿者の3投稿を1件へ畳む', () => {
    const a = buildUsers().find((u) => u.key === 'x:u1');
    expect(a.count).toBe(3);
  });

  // newest-first なので「最初の非空値」＝最新の値
  test('displayName / avatarFile / followers は最初の非空値', () => {
    const a = buildUsers().find((u) => u.key === 'x:u1');
    expect({ displayName: a.displayName, avatarFile: a.avatarFile, followers: a.followers }).toEqual({ displayName: 'アリス', avatarFile: 'ava1.jpg', followers: 120 });
  });

  test('authorCreatedAt は後続投稿からでも補完される', () => {
    expect(buildUsers().find((u) => u.key === 'x:u1').authorCreatedAt).toBe('2020-01-01');
  });

  test('投稿日の範囲（latest / firstPost）', () => {
    const a = buildUsers().find((u) => u.key === 'x:u1');
    expect({ latest: a.latest, firstPost: a.firstPost }).toEqual({ latest: '2026-03-03', firstPost: '2026-03-01' });
  });

  test('取得日の範囲（lastCapture / firstCapture）', () => {
    const a = buildUsers().find((u) => u.key === 'x:u1');
    expect({ lastCapture: a.lastCapture, firstCapture: a.firstCapture }).toEqual({ lastCapture: '2026-06-03', firstCapture: '2026-06-01' });
  });

  test('x はインスタンス無し・misskey はホストを抽出', () => {
    const users = buildUsers();
    expect(users.find((u) => u.key === 'x:u1').instance).toBe('');
    expect(users.find((u) => u.key === 'misskey:u3').instance).toBe('misskey.io');
  });
});

describe('buildUsers（世代キャッシュ）', () => {
  test('同一世代なら同じ配列を返す（同一参照）', () => {
    expect(buildUsers()).toBe(buildUsers());
  });

  test('世代据え置きでは新規投稿が見えない', () => {
    buildUsers();
    posts.push({ url: 'https://x.com/b/status/9', platform: 'x', userId: 'u2', screenName: 'bob', date: '2026-01-01' });

    expect(buildUsers()).toHaveLength(2);
  });

  test('世代バンプで再構築される', () => {
    buildUsers();
    posts.push({ url: 'https://x.com/b/status/9', platform: 'x', userId: 'u2', screenName: 'bob', date: '2026-01-01' });
    gen = 2;

    const fresh = buildUsers();
    expect(fresh).toHaveLength(3);
    expect(fresh.map((u) => u.key)).toContain('x:u2');
  });
});

describe('buildSuggest', () => {
  test('url 無し投稿のタグは集計外（SNS 投稿のみ）', () => {
    expect(buildSuggest('取込').some((it) => it.kind === 'tag')).toBe(false);
  });

  test('tag 候補は value と note=count を持つ', () => {
    expect(buildSuggest('風景').find((it) => it.kind === 'tag')).toMatchObject({ value: '風景', note: 1 });
  });

  test('user 候補は大文字小文字を無視（screenName マッチ）', () => {
    expect(buildSuggest('ALICE').some((it) => it.kind === 'user' && it.value === 'x:u1')).toBe(true);
  });

  test('displayName マッチ＝label は displayName・note は count', () => {
    expect(buildSuggest('アリス').find((it) => it.kind === 'user')).toMatchObject({ value: 'x:u1', label: 'アリス', note: 3 });
  });

  test('displayName が空なら label は screenName へフォールバック', () => {
    posts.push({ url: 'https://x.com/b/status/9', platform: 'x', userId: 'u2', screenName: 'bob', date: '2026-01-01' });
    gen = 2;

    expect(buildSuggest('bob').find((it) => it.kind === 'user').label).toBe('bob');
  });
});

// '☆' は部分一致では絶対に当たらない＝matcher が本当に注入経路を通っているかを見る
describe('buildSuggest（compile 注入経路）', () => {
  test('compile がクエリで呼ばれる', () => {
    buildSuggest('☆');
    expect(compileCalls).toContain('☆');
  });

  test('matcher 経由でタグ「風景」が当たる', () => {
    expect(buildSuggest('☆').some((it) => it.kind === 'tag' && it.value === '風景')).toBe(true);
  });

  test('matcher 経由で carol が当たる', () => {
    expect(buildSuggest('☆').some((it) => it.kind === 'user' && it.value === 'misskey:u3')).toBe(true);
  });
});

describe('buildSuggest の件数上限', () => {
  beforeEach(() => {
    gen = 3;
    posts = [];
    // 共通0..共通9 を出現回数が階段状になるよう配る
    for (let i = 0; i < 10; i++) {
      posts.push({
        url: `https://x.com/t/status/${i}`,
        platform: 'x',
        userId: 'tagger',
        screenName: 'tagger',
        tags: Array.from({ length: 10 }, (_, j) => `共通${j}`).slice(0, 10 - i),
      });
    }
    for (let i = 0; i < 6; i++) {
      posts.push({ url: `https://x.com/u${i}/status/1`, platform: 'x', userId: `common${i}`, screenName: `共通ユーザー${i}` });
    }
  });

  test('tag 候補は上位6件', () => {
    expect(buildSuggest('共通').filter((it) => it.kind === 'tag')).toHaveLength(6);
  });

  test('tag は count 降順（共通0 が10件で先頭）', () => {
    const tags = buildSuggest('共通').filter((it) => it.kind === 'tag');
    expect(tags[0]).toMatchObject({ value: '共通0', note: 10 });
    expect(tags.map((t) => t.note)).toEqual([...tags.map((t) => t.note)].sort((a, b) => b - a));
  });

  test('user 候補は4件まで', () => {
    expect(buildSuggest('共通').filter((it) => it.kind === 'user')).toHaveLength(4);
  });
});
