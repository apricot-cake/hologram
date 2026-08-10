// users.ts のロジックの単体テスト。差し替えの依存を注入して buildUsers（投稿者の集約と
// 世代キャッシュ）を見る。
//
// buildSuggest（検索の候補＝上位のタグと投稿者の一致）はここから出た＝#28 でコマンド
// 登録簿の corpus プロバイダへ合流したので、そのテストは command-corpus.test.ts にある。

import { beforeEach, describe, expect, test } from 'vitest';
import { makeUsers } from '../app/src/renderer/src/services/users';

// --- 差し替えの環境: 新しい順の投稿一覧（先頭が最新） ---
// u1(x) は3投稿を持ち、最初の非空値が勝つ（displayName は2件目の投稿から埋まる）。
// 日付の範囲は集約される。
// u3(misskey) はインスタンスが抽出される。url を持たない投稿は飛ばす。
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
  aliasResolve = (key) => key; // 既定では名寄せしない＝恒等写像で、まとめられていない投稿者と同じ

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

  // #760: 判定条件は「url の有無」ではなく「著者の同一性（userId/screenName）の有無」。
  // #195 のブックマークは url を持つが著者情報を一切持たない（displayName は
  // og:site_name）ので、旧条件（url があれば数える）だとブックマークが全部
  // buildUsers に入り、userKey の '@'+'' フォールバックで1つの投稿者に潰れていた。
  test('url はあっても著者情報（userId/screenName）が無いレコードは投稿者を作らない（#760）', () => {
    posts.push({ url: 'https://sitea.example/article', platform: null, userId: null, screenName: '', displayName: 'サイトA', date: '2026-04-01' });
    posts.push({ url: 'https://siteb.example/article', platform: null, userId: null, screenName: '', displayName: 'サイトB', date: '2026-04-02' });
    gen = 2;

    expect(buildUsers()).toHaveLength(2); // 2件のブックマークは1人も増やさない
  });

  test('同一投稿者の3投稿を1件へ畳む', () => {
    const a = buildUsers().find((u) => u.key === 'x:u1');
    expect(a.count).toBe(3);
  });

  // 新しい順なので、「最初の非空値」は最新の値になる
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

// #23 St1: resolve(key) の上で畳む段。ここでの aliasResolve は services/aliases.ts の代役＝
// 実際の合流ではどのメンバーも必ず同じ primary へ解決されるので、この差し替えもそれを真似る。
describe('buildUsers（名寄せの畳み込み）', () => {
  test('resolve が同じ primary を返す2キーは1件へ畳まれ、件数が合算される', () => {
    aliasResolve = (key) => (key === 'x:u1' || key === 'misskey:u3' ? 'x:u1' : key);

    const merged = buildUsers().find((u) => u.key === 'x:u1');
    expect(merged).toBeTruthy();
    expect(merged.count).toBe(4); // 3 (x:u1) + 1 (misskey:u3)
    expect(buildUsers().find((u) => u.key === 'misskey:u3')).toBeUndefined(); // 畳まれて、独立した行ではなくなる
  });

  test('期間は union（latest/firstPost が畳んだ側にも広がる）', () => {
    aliasResolve = (key) => (key === 'x:u1' || key === 'misskey:u3' ? 'x:u1' : key);

    const merged = buildUsers().find((u) => u.key === 'x:u1');
    // x:u1 単体では 2026-03-01..03。misskey:u3 の 2026-02-01 の投稿が firstPost を前へ広げる。
    expect(merged.firstPost).toBe('2026-02-01');
    expect(merged.latest).toBe('2026-03-03');
  });

  test('表示系（displayName 等）は primary 側の agg を採る（畳む順序に依存しない）', () => {
    // 今回は primary が misskey:u3（さっきと逆の向き）＝allPosts() の順では x:u1 の生の
    // エントリが先に走査されるが、それでも misskey:u3 自身の displayName が勝たなければいけない。
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
