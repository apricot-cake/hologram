// backfill --avatars: アバター URL はあるがローカルファイルが無い sidecar について、
// 共有ストア（avatars/<urlhash>.<ext>）へ落として avatarFile を立てる。すでに埋まっている
// ものとアバターが無いものは飛ばす。実スクリプトを本当に spawn し、fetch スタブを
// `node -r` で先読みさせる（SSRF ガードが localhost を拒むのでローカルサーバでは代用
// できない）。pixivRefererFor のユニットテストも兼ねる。

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { pixivRefererFor } from '../native-host/media-download.cts';

describe('pixivRefererFor（純関数）', () => {
  test.each(['https://i.pximg.net/img/x.jpg', 'https://s.pximg.net/x.png', 'https://pximg.net/x.png'])('pximg 系は pixiv の Referer: %s', (url) => {
    expect(pixivRefererFor(url)).toBe('https://www.pixiv.net/');
  });

  test.each(['https://pbs.twimg.com/x.jpg', 'not a url', 'https://notpximg.net.evil.com/x'])('それ以外は undefined: %s', (url) => {
    expect(pixivRefererFor(url)).toBeUndefined();
  });
});

describe('backfill --avatars（実スクリプトを spawn）', () => {
  // A: アバター URL あり・ファイル無し → 埋まるべき / B: すでに avatarFile あり → 飛ばす /
  // C: アバター無し → 飛ばす
  const A = '1717500000000-aaaa';
  const B = '1717500000000-bbbb';
  const C = '1717500000000-cccc';
  const avHash = crypto.createHash('sha1').update('https://h/photo.jpg').digest('hex').slice(0, 16);

  let tmp: string;
  let saveFolder: string;
  let res: ReturnType<typeof spawnSync>;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-avfill-'));
    const configDir = path.join(tmp, 'Hologram');
    saveFolder = path.join(tmp, 'saves');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(saveFolder, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

    fs.writeFileSync(path.join(saveFolder, `${A}.json`), JSON.stringify({ captureId: A, url: 'https://x/1', avatar: 'https://h/photo.jpg' }));
    fs.writeFileSync(path.join(saveFolder, `${B}.json`), JSON.stringify({ captureId: B, avatar: 'https://h/photo.jpg', avatarFile: `${B}-avatar.jpg` }));
    fs.writeFileSync(path.join(saveFolder, `${C}.json`), JSON.stringify({ captureId: C, url: 'https://x/3' }));

    // スクリプトが動き出す前に global.fetch を差し替える preload（ネットワークも TLS も無し）
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

    res = spawnSync(process.execPath, ['-r', stub, path.join(import.meta.dirname, 'backfill-metadata.cts'), '--avatars'], {
      env: { ...process.env, APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir },
      encoding: 'utf8',
    });
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const sidecar = (id: string) => JSON.parse(fs.readFileSync(path.join(saveFolder, `${id}.json`), 'utf8'));

  test('スクリプトが 0 で終了する', () => {
    expect(res.status).toBe(0);
  });

  test('stdout が filled 1 を報告する', () => {
    expect(res.stdout).toMatch(/filled 1\b/);
  });

  test('A: avatarFile が avatars/<urlhash>.png になる', () => {
    expect(sidecar(A).avatarFile).toBe(`avatars/${avHash}.png`);
  });

  test('A: 画像がディスクに置かれる', () => {
    expect(fs.existsSync(path.join(saveFolder, 'avatars', `${avHash}.png`))).toBe(true);
  });

  test('B: すでに avatarFile がある sidecar は触らない', () => {
    expect(sidecar(B).avatarFile).toBe(`${B}-avatar.jpg`);
    expect(fs.existsSync(path.join(saveFolder, `${B}-avatar.png`))).toBe(false);
  });

  test('C: アバター URL が無ければ avatarFile も付かない', () => {
    expect(sidecar(C).avatarFile).toBeUndefined();
  });
});
