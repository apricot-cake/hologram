// backfill --all: 取り直しが「失敗」したとき、保存済みのレコードを null で潰してはいけない。
// X と Bluesky は通信に出る前に投稿 URL から screenName / handle を埋めるので、取得に失敗しても
// screenName は入っている＝飛ばすかどうかの判断は、API からしか来ない欄（text / likes / date）だけで
// 決める。実スクリプトを spawn し、fetch のスタブは `node -r` で先に読ませる（SSRF の防ぎが
// localhost を弾くため。avatar-fill.test.ts と同じ手）。ケース:
//   F  X、取得に失敗（syndication が 404）  → 保存済みメタは保たれ、no-data として飛ばす
//   S  X、取得に成功                        → 新しいメタで更新
//   P  X、部分的（応答に likes が無い）     → 既存の likes は `?? rec` で生き残る
//   BF Bluesky、getPostThread が失敗        → 保存済みメタは保たれ、飛ばす

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db';
import { postsByIds } from '../../app/src/main/lib-db-query';
import { makeTagResolver, preparePostStmts, writePost } from '../../app/src/main/lib-db-record-writer';

const F = '100-fail';
const S = '200-ok';
const P = '300-partial';
const BF = '400-bskyfail';

let tmp: string;
let saveFolder: string;
let dbFile: string;
let res: ReturnType<typeof spawnSync>;

// 取り直しに失敗しても潰してはいけない、欄がすべて埋まった保存済みレコード
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

  // レコードはライブラリの DB にある（#302 以降、保存フォルダにサイドカーは無い）。
  // #176: hologram.db は configDir ではなく保存フォルダの中に置く。
  dbFile = path.join(saveFolder, 'hologram.db');
  const seed = openDatabase(dbFile);
  const stmts = preparePostStmts(seed.sqlite);
  const resolveTagId = makeTagResolver(seed.sqlite);
  const write = (id: string, rec: any) => writePost(stmts, resolveTagId, { ...rec, captureId: id });
  write(F, storedX('100', 'failuser'));
  write(S, storedX('200', 'okuser'));
  write(P, storedX('300', 'partialuser'));
  // Bluesky: handle は解決するがスレッドが 404（handle は URL から来るので、取得できた証拠にはならない）
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

  // fetch のスタブ: URL で分岐する。id=200 は成功の JSON、id=300 は favorite_count の無い成功の JSON、
  // それ以外の syndication の id は 404（失敗）。Bluesky は resolveHandle が成功し、getPostThread が 404。
  const stub = path.join(tmp, 'stub-fetch.js');
  fs.writeFileSync(
    stub,
    [
      'global.fetch = async (url) => {',
      '  const u = String(url);',
      '  if (u.includes("cdn.syndication.twimg.com")) {',
      '    if (u.includes("id=200")) {',
      '      const j = { id_str: "200", text: "fresh tweet body", user: { name: "Fresh Name", screen_name: "okuser", id_str: "555", profile_image_url_https: "https://example.com/avatar.png" }, favorite_count: 99, conversation_count: 5, created_at: "2025-05-05T00:00:00.000Z", lang: "en" };',
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

  res = spawnSync(process.execPath, ['-r', stub, path.join(import.meta.dirname, '../../scripts/backfill-metadata.cts'), '--all'], {
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

test('契約違反を報告し、非ゼロで終了する', () => {
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/favorite_count/);
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

// 必須の件数を欠く応答では、保存済みの投稿を変更しない。
describe('P: X の部分的な応答', () => {
  test('必須値欠落では保存済みレコードを変更しない', async () => {
    expect(await read(P)).toMatchObject({ text: 'stored body text', userId: '999', likes: 42 });
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
  test('stdout が 1件更新・2件データ無しを報告する', () => {
    expect(res.stdout).toMatch(/後追い更新1件/);
    expect(res.stdout).toMatch(/データ無し2件/);
  });

  test('.tmp の書きかけが残らない（原子的書き込みの後始末）', () => {
    expect(fs.readdirSync(saveFolder).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
