// backfill --avatars: アバターの URL はあるがローカルにファイルの無いレコードについて、
// 共有のストア（avatars/<urlhash>.<ext>）へ落として avatarFile を立てる。すでに埋まっている
// レコードと、アバターの無いレコードは飛ばす。実スクリプトを本当に spawn し、fetch のスタブは
// `node -r` で先に読ませる（SSRF の防ぎが localhost を弾くので、ローカルサーバーでは代用でき
// ない）。pixivRefererFor の単体テストも兼ねる。

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { pixivRefererFor } from '../../native-host/media-download.mts';
import { openDatabase } from '../../app/src/main/lib-db';
import { postsByIds } from '../../app/src/main/lib-db-query';
import { makeTagResolver, preparePostStmts, writePost } from '../../app/src/main/lib-db-record-writer';

describe('pixivRefererFor（純関数）', () => {
  test.each(['https://i.pximg.net/img/x.jpg', 'https://s.pximg.net/x.png', 'https://pximg.net/x.png'])('pximg 系は pixiv の Referer: %s', (url) => {
    expect(pixivRefererFor(url)).toBe('https://www.pixiv.net/');
  });

  test.each(['https://pbs.twimg.com/x.jpg', 'not a url', 'https://notpximg.net.evil.com/x'])('それ以外は undefined: %s', (url) => {
    expect(pixivRefererFor(url)).toBeUndefined();
  });
});

describe('backfill --avatars（実スクリプトを spawn）', () => {
  // A: アバター URL があってファイルが無い → 埋まるはず／B: すでに avatarFile がある → 飛ばす／
  // C: アバターが無い → 飛ばす
  const A = '1717500000000-aaaa';
  const B = '1717500000000-bbbb';
  const C = '1717500000000-cccc';
  const avHash = crypto.createHash('sha1').update('https://h/photo.jpg').digest('hex').slice(0, 16);

  let tmp: string;
  let saveFolder: string;
  let res: ReturnType<typeof spawnSync>;
  let dbFile: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-avfill-'));
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
    writePost(stmts, resolveTagId, { captureId: A, url: 'https://x/1', avatar: 'https://h/photo.jpg' } as any);
    writePost(stmts, resolveTagId, { captureId: B, avatar: 'https://h/photo.jpg', avatarFile: `${B}-avatar.jpg` } as any);
    writePost(stmts, resolveTagId, { captureId: C, url: 'https://x/3' } as any);
    seed.sqlite.close();

    // スクリプトが動き出す前に global.fetch を差し替える先読み（通信も TLS も無し）
    const stub = path.join(tmp, 'stub-fetch.js');
    fs.writeFileSync(
      stub,
      [
        "const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');",
        'global.fetch = async (url) => {',
        '  const u = String(url);',
        "  if (u.endsWith('/photo.jpg')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });",
        "  return new Response('no', { status: 404 });",
        '};',
      ].join('\n'),
    );

    res = spawnSync(process.execPath, ['-r', stub, path.join(import.meta.dirname, '../../scripts/backfill-metadata.cts'), '--avatars'], {
      env: { ...process.env, APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir },
      encoding: 'utf8',
    });
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function record(id: string) {
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

  test('stdout が「埋めた1件」を報告する', () => {
    expect(res.stdout).toMatch(/埋めた1件/);
  });

  test('A: avatarFile が avatars/<urlhash>.png になる', async () => {
    expect((await record(A)).avatarFile).toBe(`avatars/${avHash}.png`);
  });

  test('A: 画像がディスクに置かれる', () => {
    expect(fs.existsSync(path.join(saveFolder, 'avatars', `${avHash}.png`))).toBe(true);
  });

  test('B: すでに avatarFile があるレコードは触らない', async () => {
    expect((await record(B)).avatarFile).toBe(`${B}-avatar.jpg`);
    expect(fs.existsSync(path.join(saveFolder, `${B}-avatar.png`))).toBe(false);
  });

  test('C: アバター URL が無ければ avatarFile も付かない', async () => {
    expect((await record(C)).avatarFile).toBeNull();
  });
});
