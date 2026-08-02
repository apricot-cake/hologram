// Unit tests for the logic in users.ts. Verifies buildUsers (poster rollup + generation
// cache) with stub deps injected.
//
// buildSuggest (search suggestions = top tags + poster matches) has moved out of here —
// it merged into the command registry's corpus provider in #28, so its tests live in
// command-corpus.test.ts.

import { beforeEach, describe, expect, test } from 'vitest';
import { makeUsers } from '../app/src/renderer/src/services/users';

// --- Stub environment: a newest-first post list (the front is the most recent) ---
// u1(x) has 3 posts — the first non-empty value wins (displayName gets filled in from the
// 2nd post) — and their date range is aggregated.
// u3(misskey) has its instance extracted. Posts with no url are skipped.
const BASE_POSTS = () => [
  { url: 'https://x.com/a/status/3', platform: 'x', userId: 'u1', screenName: 'alice', displayName: '', avatarFile: '', followers: null, date: '2026-03-03', capturedAt: '2026-06-03' },
  { url: 'https://x.com/a/status/2', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'アリス', avatarFile: 'ava1.jpg', followers: 120, date: '2026-03-01', capturedAt: '2026-06-01' },
  { url: 'https://x.com/a/status/1', platform: 'x', userId: 'u1', screenName: 'alice', displayName: '旧アリス', avatarFile: 'ava0.jpg', followers: 99, date: '2026-03-02', capturedAt: '2026-06-02', authorCreatedAt: '2020-01-01' },
  { url: 'https://misskey.io/notes/n1', platform: 'misskey', userId: 'u3', screenName: 'carol', displayName: 'キャロル', tags: ['風景'], date: '2026-02-01' },
  { url: null, platform: null, tags: ['取込タグ'] },
];

let posts: any[];
let gen: number;
let aliasResolve: (key: string) => string;
let buildUsers: ReturnType<typeof makeUsers>['buildUsers'];

beforeEach(() => {
  posts = BASE_POSTS();
  gen = 1;
  aliasResolve = (key) => key; // no aliasing by default — identity, same as an ungrouped poster

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
    resolve: (key) => aliasResolve(key),
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

  // Since it's newest-first, "the first non-empty value" is the most recent value
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

// #23 St1: the fold pass onto resolve(key). aliasResolve stands in for
// services/aliases.ts here — a real merge always resolves every member to the
// SAME primary, which is what these stubs mimic.
describe('buildUsers（名寄せの畳み込み）', () => {
  test('resolve が同じ primary を返す2キーは1件へ畳まれ、件数が合算される', () => {
    aliasResolve = (key) => (key === 'x:u1' || key === 'misskey:u3' ? 'x:u1' : key);

    const merged = buildUsers().find((u) => u.key === 'x:u1');
    expect(merged).toBeTruthy();
    expect(merged.count).toBe(4); // 3 (x:u1) + 1 (misskey:u3)
    expect(buildUsers().find((u) => u.key === 'misskey:u3')).toBeUndefined(); // folded away, not a separate row any more
  });

  test('期間は union（latest/firstPost が畳んだ側にも広がる）', () => {
    aliasResolve = (key) => (key === 'x:u1' || key === 'misskey:u3' ? 'x:u1' : key);

    const merged = buildUsers().find((u) => u.key === 'x:u1');
    // x:u1 alone is 2026-03-01..03; misskey:u3's 2026-02-01 post extends firstPost earlier.
    expect(merged.firstPost).toBe('2026-02-01');
    expect(merged.latest).toBe('2026-03-03');
  });

  test('表示系（displayName 等）は primary 側の agg を採る（畳む順序に依存しない）', () => {
    // primary = misskey:u3 this time (the OTHER direction) — its own displayName
    // must win even though x:u1's raw entries are scanned first in allPosts() order.
    aliasResolve = (key) => (key === 'x:u1' || key === 'misskey:u3' ? 'misskey:u3' : key);

    const merged = buildUsers().find((u) => u.key === 'misskey:u3');
    expect(merged.displayName).toBe('キャロル');
    expect(merged.platform).toBe('misskey');
  });

  test('members / platforms に畳んだ全キー・全プラットフォームが載る', () => {
    aliasResolve = (key) => (key === 'x:u1' || key === 'misskey:u3' ? 'x:u1' : key);

    const merged = buildUsers().find((u) => u.key === 'x:u1');
    expect(merged.members.slice().sort()).toEqual(['misskey:u3', 'x:u1']);
    expect(merged.platforms.slice().sort()).toEqual(['misskey', 'x']);
  });

  test('resolve が恒等写像なら通常どおり畳まれない', () => {
    expect(buildUsers()).toHaveLength(2);
    expect(buildUsers().find((u) => u.key === 'x:u1').members).toEqual(['x:u1']);
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
