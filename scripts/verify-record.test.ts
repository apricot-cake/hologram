// Judgment rules for the API check on saved records (`verifyRecord` in `test-watch-verify.cts`).
// Until #60 this checker existed in duplicate with a Python version (verify-store.py), and
// neither had tests — only someone who ran it by hand could notice a problem. What's covered
// here is just "what counts as a FAIL"; no network and no database are used (fetch is
// stubbed, files live in a temp folder).
//
// In particular, **missing media[] files** is a regression test: back when only `image` was
// checked, a record with none of the post's original-size files on disk would PASS (since
// #377, the original-size files live in media[]).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { verifyRecord } from './test-watch-verify.cts';

const URL_BSKY = 'https://bsky.app/profile/alice.bsky.social/post/rk';

// A response from the live API (getPostThread). verifyRecord fetches it via the extractor,
// so what gets stubbed is one layer below that: fetch.
function mockBluesky(post: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', async (url: unknown) => {
    const u = String(url);
    if (u.includes('resolveHandle')) return new Response(JSON.stringify({ did: 'did:plc:abc' }), { status: 200 });
    if (u.includes('getPostThread')) {
      return new Response(
        JSON.stringify({
          thread: {
            post: {
              uri: 'at://did:plc:abc/app.bsky.feed.post/rk',
              cid: 'cid1',
              author: { did: 'did:plc:abc', handle: 'alice.bsky.social', displayName: 'Alice' },
              record: { text: 'こんにちは世界', createdAt: '2026-07-01T00:00:00.000Z', langs: ['ja'] },
              likeCount: 5,
              repostCount: 1,
              replyCount: 0,
              ...post,
            },
          },
        }),
        { status: 200 },
      );
    }
    return new Response('{}', { status: 404 });
  });
}

let dir = '';
let lines: string[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-verify-'));
  lines = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.join(' '));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const out = () => lines.join('\n');

// A properly-formed record pointing at files placed on disk. Each test breaks exactly one thing from here.
function goodRecord() {
  fs.writeFileSync(path.join(dir, 'cap1.jpg'), 'shot');
  fs.writeFileSync(path.join(dir, 'cap1-media-0.jpg'), 'orig');
  fs.mkdirSync(path.join(dir, 'avatars'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'avatars', 'a1.jpg'), 'face');
  return {
    captureId: 'cap1',
    image: 'cap1.jpg',
    video: null,
    url: URL_BSKY,
    platform: 'bluesky',
    text: 'こんにちは世界',
    displayName: 'Alice',
    screenName: 'alice.bsky.social',
    userId: 'did:plc:abc',
    avatarFile: 'avatars/a1.jpg',
    date: '2026-07-01T00:00:00.000Z',
    capturedAt: '2026-07-02T03:04:05.000Z',
    mediaType: 'image',
    lang: 'ja',
    isReply: null,
    isQuote: null,
    isThread: null,
    trashedAt: null,
    media: [{ url: 'https://cdn.example/1.jpg', file: 'cap1-media-0.jpg', posterFile: null }],
    tags: ['風景'],
  };
}

describe('ファイルの実在', () => {
  test('指しているファイルが全部あれば PASS', async () => {
    mockBluesky();
    expect(await verifyRecord(goodRecord(), dir)).toBe(true);
  });

  test('media[] の原寸が無ければ FAIL（image だけ見ていた頃の退行）', async () => {
    mockBluesky();
    const rec = goodRecord();
    fs.rmSync(path.join(dir, 'cap1-media-0.jpg'));
    expect(await verifyRecord(rec, dir)).toBe(false);
    expect(out()).toContain('ファイルなし: cap1-media-0.jpg');
  });

  test('アバターと poster も検査対象', async () => {
    mockBluesky();
    const rec = goodRecord();
    rec.media[0].posterFile = 'cap1-poster.jpg';
    fs.rmSync(path.join(dir, 'avatars', 'a1.jpg'));
    expect(await verifyRecord(rec, dir)).toBe(false);
    expect(out()).toContain('ファイルなし: avatars/a1.jpg');
    expect(out()).toContain('ファイルなし: cap1-poster.jpg');
  });

  test('ファイルを1つも指していなければ FAIL', async () => {
    mockBluesky();
    const rec = goodRecord();
    rec.image = null;
    rec.avatarFile = null;
    rec.media = [];
    expect(await verifyRecord(rec, dir)).toBe(false);
    expect(out()).toContain('保存ファイルを1つも指していない');
  });

  test('ゴミ箱の中はファイル検査をしない（ファイルは .trash/ へ移っている）', async () => {
    mockBluesky();
    const rec = goodRecord();
    rec.trashedAt = '2026-07-03T00:00:00.000Z';
    fs.rmSync(path.join(dir, 'cap1.jpg'));
    fs.rmSync(path.join(dir, 'cap1-media-0.jpg'));
    expect(await verifyRecord(rec, dir)).toBe(true);
    expect(out()).toContain('ゴミ箱の中');
  });
});

describe('API 照合', () => {
  test('投稿者が食い違えば FAIL', async () => {
    mockBluesky();
    const rec = goodRecord();
    rec.screenName = 'bob.bsky.social';
    expect(await verifyRecord(rec, dir)).toBe(false);
    expect(out()).toContain('screenName 不一致');
  });

  test('本文が食い違えば FAIL（先頭一致は許す）', async () => {
    mockBluesky();
    const rec = goodRecord();
    rec.text = 'こんにちは';
    expect(await verifyRecord(rec, dir)).toBe(true);
    rec.text = 'まったく別の本文です';
    expect(await verifyRecord(rec, dir)).toBe(false);
    expect(out()).toContain('text 不一致');
  });

  test('日付が食い違えば FAIL', async () => {
    mockBluesky();
    const rec = goodRecord();
    rec.date = '2026-06-01T00:00:00.000Z';
    expect(await verifyRecord(rec, dir)).toBe(false);
    expect(out()).toContain('date 不一致');
  });

  // Don't misread "couldn't fetch" as "fetched". The extractor builds screenName from the
  // URL **before it ever goes to the network**, so even a failed response comes back with
  // at least a screenName — if that's treated as "fetched", the record's poster gets
  // matched against the record's own url and it prints a ✅ PASS (looking like a check was
  // done when nothing was actually checked).
  test('API が答えなければ照合を飛ばす（URL 由来の screenName を根拠にしない）', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
    expect(await verifyRecord(goodRecord(), dir)).toBe(true);
    expect(out()).toContain('liveメタ取得不可');
    expect(out()).not.toContain('不一致');
  });

  test('エンゲージメント数の変動は FAIL にしない（info 行に出す）', async () => {
    mockBluesky();
    const rec = goodRecord();
    Object.assign(rec, { likes: 1, reposts: 0, replies: 0 });
    expect(await verifyRecord(rec, dir)).toBe(true);
    expect(out()).toContain('likes 1→5');
  });
});

describe('URL の正規形', () => {
  test('パーマリンク以外は FAIL', async () => {
    mockBluesky();
    const rec = goodRecord();
    rec.url = `${URL_BSKY}/liked-by`;
    expect(await verifyRecord(rec, dir)).toBe(false);
    expect(out()).toContain('パーマリンク形式でない');
  });
});

describe('手動確認用の保存値', () => {
  test('API では確かめられない項目が印字される', async () => {
    mockBluesky();
    const rec = goodRecord();
    rec.isQuote = true;
    await verifyRecord(rec, dir);
    // null and false are different answers — don't collapse both into "not set".
    expect(out()).toContain('mediaType=image');
    expect(out()).toContain('lang=ja');
    expect(out()).toContain('isReply=null');
    expect(out()).toContain('isQuote=true');
    expect(out()).toContain('tags=風景');
  });
});

describe('レコードとして読めないもの', () => {
  test('captureId が無ければ検証対象にしない', async () => {
    expect(await verifyRecord({ url: URL_BSKY }, dir)).toBe(null);
  });
});
