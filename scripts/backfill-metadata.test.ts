// backfill --all: 再取得が「失敗」したとき、保存済みレコードを null で潰してはいけない。
// X/Bluesky はネットワークに出る前に投稿 URL から screenName/handle を埋めるので、失敗した
// 取得でも screenName は載っている＝スキップ判定は API でしか得られない項目（text/likes/date）
// で行わなければならない。実スクリプトを spawn し、fetch スタブを `node -r` で先読みさせる
// （SSRF ガードが localhost を拒むため。avatar-fill.test.ts と同じ手）。ケース:
//   F  X・取得失敗（syndication 404）    → 保存済みメタが保たれ、no-data として飛ばされる
//   S  X・取得成功                        → 新しいメタで更新される
//   P  X・部分的（応答に likes が無い）   → 既存の likes が `?? rec` で生き残る
//   BF Bluesky・getPostThread 失敗        → 保存済みメタが保たれ、飛ばされる

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

// 失敗した再取得で潰されてはいけない、フル装備の保存済みレコード
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

  // レコードはライブラリのDBに置く（#302 以降、保存フォルダにサイドカーは無い）。
  dbFile = path.join(configDir, 'hologram.db');
  const seed = openDatabase(dbFile);
  const stmts = preparePostStmts(seed.sqlite);
  const resolveTagId = makeTagResolver(seed.sqlite);
  const write = (id: string, rec: any) => writePost(stmts, resolveTagId, { ...rec, captureId: id });
  write(F, storedX('100', 'failuser'));
  write(S, storedX('200', 'okuser'));
  write(P, storedX('300', 'partialuser'));
  // Bluesky: handle は解決するがスレッドが 404（handle は URL 由来で、取得成功の証拠ではない）
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

  // fetch スタブ: URL で分岐。id=200 は成功 JSON、id=300 は favorite_count 抜きの成功 JSON、
  // 他の syndication id は 404（失敗）。Bluesky は resolveHandle 成功・getPostThread 404。
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

// 応答に favorite_count が無い＝新しい項目は反映しつつ、欠けた likes は
// `m.likes ?? rec.likes` で保存済みの値へ落ちる
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
