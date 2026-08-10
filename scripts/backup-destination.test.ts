// ローカルフォルダ宛先のアダプタ (app/src/main/lib-backup-destination.ts)。
//
// 効き目を持つのは身元ファイル。#176 は宛先がどのライブラリのものかを知っていることを求め、
// エンジンはそれが食い違う実行を拒む。ここで成り立たなければならない性質は2つあり、どちらかが
// 崩れると仕組み自体がデータ喪失の不具合に変わる＝ファイルが往復すること、そして list() には
// 決して出ないこと。エンジンは、ライブラリに対応するものが無い宛先のエントリを削除するため。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { BACKUP_SUBDIR, IDENTITY_FILE, backupRoot, createLocalFolderDestination } from '../app/src/main/lib-backup-destination';

const made: string[] = [];
function tempDest(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-dest-'));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('宛先の身元（libraryId）', () => {
  test('書いたものが読み戻る', async () => {
    const dir = tempDest();
    const dest = createLocalFolderDestination(dir);
    expect(await dest.readIdentity()).toBeNull(); // 未設置の宛先＝引き取り前
    await dest.writeIdentity({ libraryId: 'lib-a', lastRunAt: '2026-08-02T00:00:00.000Z' });
    expect(await dest.readIdentity()).toEqual({ libraryId: 'lib-a', lastRunAt: '2026-08-02T00:00:00.000Z' });
    expect(fs.existsSync(path.join(dir, BACKUP_SUBDIR, IDENTITY_FILE))).toBe(true);
  });

  test('読めない身元は「不一致」ではなく「未設置」として扱う', async () => {
    const dir = tempDest();
    const dest = createLocalFolderDestination(dir);
    fs.mkdirSync(backupRoot(dir), { recursive: true });
    fs.writeFileSync(path.join(backupRoot(dir), IDENTITY_FILE), 'not json at all');
    expect(await dest.readIdentity()).toBeNull();
    fs.writeFileSync(path.join(backupRoot(dir), IDENTITY_FILE), JSON.stringify({ lastRunAt: 'x' }));
    expect(await dest.readIdentity()).toBeNull();
  });

  test('身元ファイルは list に出ない（＝刈られる側に回らない）', async () => {
    const dir = tempDest();
    const dest = createLocalFolderDestination(dir);
    await dest.writeIdentity({ libraryId: 'lib-a', lastRunAt: null });
    const src = path.join(dir, 'src.jpg');
    fs.writeFileSync(src, 'x');
    await dest.put('a.jpg', src);
    expect([...(await dest.list()).keys()]).toEqual(['a.jpg']);
  });
});

describe('宛先の基本操作', () => {
  test('put / move / remove は相対パスで効く', async () => {
    const dir = tempDest();
    const dest = createLocalFolderDestination(dir);
    const src = path.join(dir, 'src.jpg');
    fs.writeFileSync(src, 'xyz');

    await dest.put('a.jpg', src);
    expect(fs.readFileSync(path.join(backupRoot(dir), 'a.jpg'), 'utf8')).toBe('xyz');

    // ゴミ箱への移動はファイル名を保つ＝#233 の計画が当てにしている形。
    await dest.move('a.jpg', '.trash/a.jpg');
    expect(fs.existsSync(path.join(backupRoot(dir), 'a.jpg'))).toBe(false);
    expect([...(await dest.list()).keys()]).toEqual(['.trash/a.jpg']);

    await dest.remove('.trash/a.jpg');
    expect([...(await dest.list()).keys()]).toEqual([]);
  });

  test('未作成の宛先は空として読める', async () => {
    expect([...(await createLocalFolderDestination(tempDest()).list()).keys()]).toEqual([]);
  });
});
