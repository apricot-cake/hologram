// users.ts のロジック単体テスト。buildUsers（投稿者ロールアップ＋世代キャッシュ）を
// スタブ deps 注入で検証する。
//
// buildSuggest（検索サジェスト＝タグ上位＋投稿者マッチ）はここから出て行った＝#28 で
// コマンドレジストリの corpus provider に合流したので、その分の検証は
// command-corpus.test.ts にある。

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
let buildUsers: ReturnType<typeof makeUsers>['buildUsers'];

beforeEach(() => {
  posts = BASE_POSTS();
  gen = 1;

  ({ buildUsers } = makeUsers({
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
