// backfill --all: when a refetch "fails", the stored record must not be clobbered with null.
// X/Bluesky fill in screenName/handle from the post URL before ever hitting the network, so even a failed
// fetch still has screenName set = the skip decision must be based only on fields that can only come from the API
// (text/likes/date). Spawns the real script and preloads the fetch stub via `node -r`
// (because the SSRF guard rejects localhost; same trick as avatar-fill.test.ts). Cases:
//   F  X, fetch fails (syndication 404)    → stored meta is preserved, skipped as no-data
//   S  X, fetch succeeds                    → updated with fresh meta
//   P  X, partial (response missing likes)  → existing likes survives via `?? rec`
//   BF Bluesky, getPostThread fails          → stored meta is preserved, skipped

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { postsByIds } from '../app/src/main/lib-db-query';
import { makeTagResolver, preparePostStmts, writePost } from '../app/src/main/lib-db-record-writer';

const F = '100-fail';
const S = '200-ok';
const P = '300-partial';
const BF = '400-bskyfail';

let tmp: string;
let saveFolder: string;
let dbFile: string;
let res: ReturnType<typeof spawnSync>;

// A fully-populated stored record that must not be clobbered by a failed refetch
const storedX = (id: string, screenName: string) => ({
  captureId: id,
  url: `https://x.com/${screenName}/status/${id}`,
  platform: 'x',
  text: 'stored body text',
  displayName: 'Stored Name',
  screenName,
  userId: '999',
  likes: 42,
  replies: 3,
  date: '2024-01-01T00:00:00.000Z',
  lang: 'ja',
});

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-backfill-'));
  const configDir = path.join(tmp, 'Hologram');
  saveFolder = path.join(tmp, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(saveFolder, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

  // Records live in the library DB (since #302, there's no sidecar in the save folder).
  dbFile = path.join(configDir, 'hologram.db');
  const seed = openDatabase(dbFile);
  const stmts = preparePostStmts(seed.sqlite);
  const resolveTagId = makeTagResolver(seed.sqlite);
  const write = (id: string, rec: any) => writePost(stmts, resolveTagId, { ...rec, captureId: id });
  write(F, storedX('100', 'failuser'));
  write(S, storedX('200', 'okuser'));
  write(P, storedX('300', 'partialuser'));
  // Bluesky: handle resolves but the thread 404s (the handle comes from the URL, not proof of a successful fetch)
  write(BF, {
    captureId: BF,
    url: 'https://bsky.app/profile/failhandle.bsky.social/post/abc123',
    platform: 'bluesky',
    text: 'bsky stored text',
    displayName: 'Bsky Stored',
    screenName: 'failhandle.bsky.social',
    userId: 'did:plc:stored',
    likes: 7,
    reposts: 2,
    replies: 1,
    date: '2024-02-02T00:00:00.000Z',
    lang: 'en',
  });

  // fetch stub: branches on URL. id=200 returns success JSON, id=300 returns success JSON without favorite_count,
  // other syndication ids return 404 (failure). Bluesky: resolveHandle succeeds, getPostThread 404s.
  const stub = path.join(tmp, 'stub-fetch.js');
  fs.writeFileSync(
    stub,
    [
      'global.fetch = async (url) => {',
      '  const u = String(url);',
      '  if (u.includes("cdn.syndication.twimg.com")) {',
      '    if (u.includes("id=200")) {',
      '      const j = { text: "fresh tweet body", user: { name: "Fresh Name", screen_name: "okuser", id_str: "555" }, favorite_count: 99, conversation_count: 5, created_at: "2025-05-05T00:00:00.000Z", lang: "en" };',
      '      return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });',
      '    }',
      '    if (u.includes("id=300")) {',
      '      const j = { text: "partial body", user: { name: "Partial Name", screen_name: "partialuser", id_str: "777" }, created_at: "2025-06-06T00:00:00.000Z", lang: "en" };',
      '      return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });',
      '    }',
      '    return new Response("nope", { status: 404 });',
      '  }',
      '  if (u.includes("com.atproto.identity.resolveHandle")) {',
      '    return new Response(JSON.stringify({ did: "did:plc:resolved" }), { status: 200, headers: { "content-type": "application/json" } });',
      '  }',
      '  if (u.includes("app.bsky.feed.getPostThread")) {',
      '    return new Response("down", { status: 404 });',
      '  }',
      '  return new Response("no", { status: 404 });',
      '}',
    ].join('\n'),
  );

  seed.sqlite.close();

  res = spawnSync(process.execPath, ['-r', stub, path.join(import.meta.dirname, 'backfill-metadata.cts'), '--all'], {
    env: { ...process.env, APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir },
    encoding: 'utf8',
  });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function read(id: string) {
  const handle = openDatabase(dbFile);
  try {
    return (await postsByIds(handle.sqlite, [id]))[0];
  } finally {
    handle.sqlite.close();
  }
}

test('スクリプトが 0 で終了する', () => {
  expect(res.status).toBe(0);
});

describe('F: X の取得失敗＝保存済みメタを潰さない', () => {
  test('全フィールドがそのまま残る', async () => {
    expect(await read(F)).toMatchObject({
      text: 'stored body text',
      displayName: 'Stored Name',
      userId: '999',
      likes: 42,
      date: '2024-01-01T00:00:00.000Z',
      lang: 'ja',
    });
  });
});

describe('S: X の取得成功＝新しいメタで更新', () => {
  test('新しい値へ入れ替わる', async () => {
    expect(await read(S)).toMatchObject({
      text: 'fresh tweet body',
      displayName: 'Fresh Name',
      userId: '555',
      likes: 99,
      date: '2025-05-05T00:00:00.000Z',
    });
  });
});

// The response has no favorite_count = new fields get applied, but the missing likes
// falls back to the stored value via `m.likes ?? rec.likes`
describe('P: X の部分的な応答', () => {
  test('来た項目は更新され、欠けた likes は保存済みの値が残る', async () => {
    expect(await read(P)).toMatchObject({ text: 'partial body', userId: '777', likes: 42 });
  });
});

describe('BF: Bluesky のスレッド取得失敗', () => {
  test('保存済みメタが保たれる', async () => {
    expect(await read(BF)).toMatchObject({
      text: 'bsky stored text',
      displayName: 'Bsky Stored',
      likes: 7,
      date: '2024-02-02T00:00:00.000Z',
    });
  });
});

describe('実行サマリと後始末', () => {
  test('stdout が 2件更新・2件 no-data を報告する', () => {
    expect(res.stdout).toMatch(/backfilled 2\b/);
    expect(res.stdout).toMatch(/no-data 2\b/);
  });

  test('.tmp の書きかけが残らない（原子的書き込みの後始末）', () => {
    expect(fs.readdirSync(saveFolder).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
