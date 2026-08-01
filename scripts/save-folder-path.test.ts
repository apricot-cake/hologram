// Unit tests for the save-folder containment rule (app/src/main/lib-save-folder-path.ts).
// Pure logic = needs neither the filesystem nor Electron (the answer is determined even
// for a nonexistent path).
//
// What's at stake here is "when one permission is widened, it isn't widened too far".
// #267 added `.trash/<file>`, and since that widens the range asset:// can serve = the
// surface where the whole library is held under a single origin (see asset-headers.ts's
// explanation), the shapes that pass and the shapes that don't are pinned down
// **side by side in the same file**. Writing only one side would let a change that loosens
// the rule slip through green on just the "passes" tests.
//
// What the real-Electron side (scripts/test-app-asset-csp.cts) checks is what Chromium
// actually reads; this side checks "which path it's decided to return".

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { AVATAR_SUBDIR, TRASH_SUBDIR, resolveInSaveFolder } from '../app/src/main/lib-save-folder-path';
import { listTrashRecords } from '../app/src/main/lib-trash-capture';

const ROOT = path.resolve(path.sep === '\\' ? 'C:\\lib\\Hologram\\library' : '/lib/Hologram/library');
const at = (...parts: string[]) => path.join(ROOT, ...parts);
const resolve = (name: string | null | undefined) => resolveInSaveFolder(ROOT, name);

describe('resolveInSaveFolder — 通る3形', () => {
  test('ルート直下のファイル名', () => {
    expect(resolve('1700000000100-aa01.jpg')).toBe(at('1700000000100-aa01.jpg'));
  });

  test('avatars/<file>（共有アバター置き場）', () => {
    expect(resolve(`${AVATAR_SUBDIR}/abc123.png`)).toBe(at(AVATAR_SUBDIR, 'abc123.png'));
  });

  test('.trash/<file>（ゴミ箱＝#267 で足した許可）', () => {
    expect(resolve(`${TRASH_SUBDIR}/1700000000100-aa01.jpg`)).toBe(at(TRASH_SUBDIR, '1700000000100-aa01.jpg'));
  });

  test('区切りが円記号でも同じ（Windows 表記のレコードが来ても揺れない）', () => {
    expect(resolve(`${TRASH_SUBDIR}\\1700000000100-aa01.jpg`)).toBe(at(TRASH_SUBDIR, '1700000000100-aa01.jpg'));
  });

  test('先頭のドットを持つファイル名そのものは普通に通る（.trash という名前と混同しない）', () => {
    expect(resolve('.hidden.jpg')).toBe(at('.hidden.jpg'));
  });
});

describe('resolveInSaveFolder — 保存フォルダの外へは出さない', () => {
  // The difference between "collapse to root" and "refuse with null" carries no meaning
  // here = either way, nothing outside the save folder gets read. What's always checked is "never points outside ROOT".
  const escapes = ['..', '../secret.jpg', '../../secret.jpg', `${TRASH_SUBDIR}/..`, `${TRASH_SUBDIR}/../..`, `${TRASH_SUBDIR}/../../secret.jpg`, `${AVATAR_SUBDIR}/..`, `${AVATAR_SUBDIR}/../../secret.jpg`, '.', `${TRASH_SUBDIR}/.`];
  for (const name of escapes) {
    test(`${JSON.stringify(name)} は ROOT の外を指さない`, () => {
      const resolved = resolve(name);
      if (resolved !== null) expect(resolved.startsWith(ROOT + path.sep)).toBe(true);
    });
  }

  test('親を名指しする形（.. と .trash/..）は null で断る', () => {
    expect(resolve('..')).toBeNull();
    expect(resolve(`${TRASH_SUBDIR}/..`)).toBeNull();
    expect(resolve(`${AVATAR_SUBDIR}/..`)).toBeNull();
  });

  test('絶対パスは basename まで畳まれる（別ドライブ・別フォルダを読ませない）', () => {
    const abs = path.sep === '\\' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/hosts';
    expect(resolve(abs)).toBe(at(path.basename(abs)));
  });
});

describe('resolveInSaveFolder — 許可ディレクトリの広がり方', () => {
  test('許可していないサブフォルダは通さず basename へ畳む', () => {
    expect(resolve('inbox/new/evt.json')).toBe(at('evt.json'));
    expect(resolve('secrets/key.pem')).toBe(at('key.pem'));
  });

  test('許可ディレクトリでも2階層目は通さない（単一階層だけ）', () => {
    expect(resolve(`${TRASH_SUBDIR}/sub/x.jpg`)).toBe(at('x.jpg'));
    expect(resolve(`${AVATAR_SUBDIR}/sub/x.png`)).toBe(at('x.png'));
  });

  test('許可ディレクトリの名前を含むだけの1階層目は別物', () => {
    expect(resolve('.trashy/x.jpg')).toBe(at('x.jpg'));
    expect(resolve('my.trash/x.jpg')).toBe(at('x.jpg'));
  });

  test('二重エンコードは1回 decode されただけでは区切りにも .. にもならない', () => {
    // The asset:// handler runs decodeURIComponent exactly once. `%252e%252e` only becomes
    // `%2e%2e` there, which as a path segment is just an ordinary name.
    expect(resolve('%2e%2e')).toBe(at('%2e%2e'));
    expect(resolve(`${TRASH_SUBDIR}/%2e%2e`)).toBe(at(TRASH_SUBDIR, '%2e%2e'));
    expect(resolve(`${TRASH_SUBDIR}%2Fx.jpg`)).toBe(at(`${TRASH_SUBDIR}%2Fx.jpg`));
  });
});

describe('resolveInSaveFolder — 入力が無い', () => {
  test('保存フォルダが未設定なら常に null', () => {
    expect(resolveInSaveFolder(null, 'x.jpg')).toBeNull();
    expect(resolveInSaveFolder('', 'x.jpg')).toBeNull();
  });

  test('名前が空なら null', () => {
    expect(resolve('')).toBeNull();
    expect(resolve(null)).toBeNull();
    expect(resolve(undefined)).toBeNull();
  });
});

// #267's cause was 2 independent things (the path a record claims, and the containment
// allow-list), and fixing only one didn't fix the picture. So the two are meshed
// together in one test = it verifies that the names the trash listing claims resolve
// all the way to files that actually exist on disk.
const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});
function mkLibrary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-trash-path-'));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, TRASH_SUBDIR), { recursive: true });
  return dir;
}

describe('ゴミ箱のレコードが名乗るパスが、そのまま封じ込め規則を通る（#267）', () => {
  test('image / video / media[].file / media[].posterFile が .trash/ 越しに実ファイルへ解決する', async () => {
    const folder = mkLibrary();
    const trashDir = path.join(folder, TRASH_SUBDIR);
    const files = ['cap-1.jpg', 'cap-1-media-1.mp4', 'cap-1-media-1-poster.jpg', 'cap-1-video.mp4'];
    for (const f of files) fs.writeFileSync(path.join(trashDir, f), 'BINARY');
    fs.writeFileSync(
      path.join(trashDir, 'cap-1.json'),
      JSON.stringify({
        captureId: 'cap-1',
        image: 'cap-1.jpg',
        video: 'cap-1-video.mp4',
        media: [{ file: 'cap-1-media-1.mp4', type: 'video', posterFile: 'cap-1-media-1-poster.jpg' }],
        trashedAt: '2026-03-01T00:00:00Z',
      }),
    );

    const [rec] = await listTrashRecords(trashDir);
    const named = [rec.image, rec.video, rec.media[0].file, rec.media[0].posterFile];

    // The shape before the renderer builds a URL = a path relative to the save folder.
    expect(named).toEqual([`${TRASH_SUBDIR}/cap-1.jpg`, `${TRASH_SUBDIR}/cap-1-video.mp4`, `${TRASH_SUBDIR}/cap-1-media-1.mp4`, `${TRASH_SUBDIR}/cap-1-media-1-poster.jpg`]);
    for (const name of named) {
      const resolved = resolveInSaveFolder(folder, name as string);
      expect(resolved, `${name} が解決できる`).not.toBeNull();
      expect(fs.existsSync(resolved as string), `${name} の実体がある`).toBe(true);
    }
  });

  test('共有アバターだけは書き換えない（ゴミ箱へ移していないので avatars/ のまま）', async () => {
    const folder = mkLibrary();
    const trashDir = path.join(folder, TRASH_SUBDIR);
    fs.mkdirSync(path.join(folder, AVATAR_SUBDIR), { recursive: true });
    fs.writeFileSync(path.join(folder, AVATAR_SUBDIR, 'hash.png'), 'PNG');
    fs.writeFileSync(path.join(trashDir, 'cap-2.json'), JSON.stringify({ captureId: 'cap-2', avatarFile: `${AVATAR_SUBDIR}/hash.png`, trashedAt: '2026-03-01T00:00:00Z' }));

    const [rec] = await listTrashRecords(trashDir);

    expect(rec.avatarFile).toBe(`${AVATAR_SUBDIR}/hash.png`);
    expect(fs.existsSync(resolveInSaveFolder(folder, rec.avatarFile) as string)).toBe(true);
  });

  test('投稿ごとのアバターはゴミ箱へ移っているので書き換える', async () => {
    const folder = mkLibrary();
    const trashDir = path.join(folder, TRASH_SUBDIR);
    fs.writeFileSync(path.join(trashDir, 'cap-3-avatar.png'), 'PNG');
    fs.writeFileSync(path.join(trashDir, 'cap-3.json'), JSON.stringify({ captureId: 'cap-3', avatarFile: 'cap-3-avatar.png', trashedAt: '2026-03-01T00:00:00Z' }));

    const [rec] = await listTrashRecords(trashDir);

    expect(rec.avatarFile).toBe(`${TRASH_SUBDIR}/cap-3-avatar.png`);
    expect(fs.existsSync(resolveInSaveFolder(folder, rec.avatarFile) as string)).toBe(true);
  });

  test('レコードが仕込まれたパスを名乗っても、ゴミ箱の直下しか指さない', async () => {
    const folder = mkLibrary();
    const trashDir = path.join(folder, TRASH_SUBDIR);
    fs.writeFileSync(path.join(trashDir, 'cap-4.json'), JSON.stringify({ captureId: 'cap-4', image: '../../../secret.jpg', trashedAt: '2026-03-01T00:00:00Z' }));

    const [rec] = await listTrashRecords(trashDir);

    expect(rec.image).toBe(`${TRASH_SUBDIR}/secret.jpg`);
    expect(resolveInSaveFolder(folder, rec.image)).toBe(path.join(folder, TRASH_SUBDIR, 'secret.jpg'));
  });
});
