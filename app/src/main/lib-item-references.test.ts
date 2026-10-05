import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { restoreTrashCapture, trashCapture } from './lib-trash-capture.ts';
import { itemFileRelative } from '../../../native-host/item-storage.mts';
import * as publisherModule from './archive-file-publisher.ts';

let folder: string, trash: string;
const id = 'legacy-post';
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-restore-references-'));
  trash = path.join(folder, '.trash');
  fs.mkdirSync(trash);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(folder, { recursive: true, force: true });
});
function write(relative: string, bytes = relative) {
  const file = path.join(folder, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}
const names = [id + '.png', id + '.mp4', id + '-poster.png', 'foreign-thumbnail.png', id + '-avatar.png'];
function record(prefix = '') {
  return { captureId: id, image: prefix + names[0], video: prefix + names[1], avatarFile: prefix + names[4], media: [{ file: prefix + names[0], posterFile: prefix + names[2], frames: { file: 'frame.zip' } }, { file: 'quoted-media/shared.png' }], linkCard: { thumbnailFile: prefix + names[3] } };
}
test.each(['flat', 'nested-flat', 'nested'])('%s 復元は全参照を実配置へ揃え、共有参照とframesを保持する', async (mode) => {
  const input = record(mode === 'nested' ? `items/${id}/` : '');
  const prefix = mode === 'flat' ? '.trash/' : `.trash/${id}/`;
  for (const name of names) write(prefix + name);
  write(`.trash/${id}.json`, JSON.stringify(input));
  write('quoted-media/shared.png', 'shared');
  const commit = vi.fn();
  await restoreTrashCapture({ folder, trashDir: trash, captureId: id, record: input, allowExistingItem: false, commitRestore: commit });
  const restored = commit.mock.calls[0][0];
  expect(restored).toMatchObject({ image: itemFileRelative(id, names[0]), video: itemFileRelative(id, names[1]), avatarFile: itemFileRelative(id, names[4]), linkCard: { thumbnailFile: itemFileRelative(id, names[3]) } });
  expect(restored.media[0]).toMatchObject({ file: itemFileRelative(id, names[0]), posterFile: itemFileRelative(id, names[2]), frames: { file: 'frame.zip' } });
  expect(restored.media[1].file).toBe('quoted-media/shared.png');
  for (const name of names) expect(fs.readFileSync(path.join(folder, itemFileRelative(id, name)), 'utf8')).toBe(prefix + name);
  expect(fs.readdirSync(trash)).toEqual([]);
});
test('後続rename失敗は先行移動を戻しsidecarを保持する', async () => {
  for (const name of names) write('.trash/' + name, 'original');
  write(`.trash/${id}.json`, 'sidecar');
  const createPublisher = publisherModule.createArchiveFilePublisher;
  let forwards = 0;
  vi.spyOn(publisherModule, 'createArchiveFilePublisher').mockImplementation((executable) => {
    const actual = createPublisher(executable);
    return {
      ...actual,
      publish: async (src, dest) => {
        if (src.startsWith(trash + path.sep) && ++forwards === 2) throw Object.assign(new Error('injected'), { code: 'EIO' });
        return actual.publish(src, dest);
      },
    };
  });
  const commit = vi.fn();
  await expect(restoreTrashCapture({ folder, trashDir: trash, captureId: id, record: record(), allowExistingItem: false, commitRestore: commit })).rejects.toThrow('injected');
  expect(commit).not.toHaveBeenCalled();
  for (const name of names) expect(fs.readFileSync(path.join(trash, name), 'utf8')).toBe('original');
  expect(fs.readFileSync(path.join(trash, id + '.json'), 'utf8')).toBe('sidecar');
  expect(fs.existsSync(path.join(folder, 'items', id))).toBe(false);
});
test.each(['collision', 'db-failure'])('%s 復元で全原本とsidecarを保持する', async (mode) => {
  for (const name of names) write(`.trash/${id}/${name}`, 'original');
  write(`.trash/${id}.json`, 'sidecar');
  if (mode === 'collision') write(itemFileRelative(id, names[3]), 'different');
  await expect(
    restoreTrashCapture({
      folder,
      trashDir: trash,
      captureId: id,
      record: record(),
      allowExistingItem: mode === 'collision',
      commitRestore: () => {
        throw new Error('db denied');
      },
    }),
  ).rejects.toThrow(mode === 'collision' ? 'target already exists' : 'db denied');
  for (const name of names) expect(fs.readFileSync(path.join(trash, id, name), 'utf8')).toBe('original');
  expect(fs.readFileSync(path.join(trash, id + '.json'), 'utf8')).toBe('sidecar');
});
test('contextの同一媒体を保持し、同一bytesのtrashコピーだけ撤去する', async () => {
  for (const name of names) {
    write(`.trash/${id}/${name}`, 'original');
    write(itemFileRelative(id, name), 'original');
  }
  write(`.trash/${id}.json`, 'sidecar');
  await restoreTrashCapture({ folder, trashDir: trash, captureId: id, record: record(), allowExistingItem: true, commitRestore: vi.fn() });
  expect(fs.readdirSync(trash)).toEqual([]);
  for (const name of names) expect(fs.readFileSync(path.join(folder, itemFileRelative(id, name)), 'utf8')).toBe('original');
});
test('旧flat削除sidecarは移動済み配置を記録し、無関係な同basename rootを拾わない', async () => {
  const input = record();
  for (const name of names) write(name, 'owned');
  input.avatarFile = 'avatars/shared.png';
  write(input.avatarFile, 'shared');
  await trashCapture({ folder, trashDir: trash, captureId: id, record: input, mediaExts: ['png', 'mp4'], commitDelete: vi.fn() });
  const sidecar = JSON.parse(fs.readFileSync(path.join(trash, id + '.json'), 'utf8'));
  expect(sidecar.image).toBe(itemFileRelative(id, names[0]));
  expect(sidecar.linkCard.thumbnailFile).toBe(itemFileRelative(id, names[3]));
  expect(sidecar.avatarFile).toBe('avatars/shared.png');
  expect(fs.readFileSync(path.join(folder, input.avatarFile), 'utf8')).toBe('shared');
});

test('未存在 item の親 junction へ復元せず、外部と sidecar を保持する', async () => {
  const outside = path.join(folder, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(folder, 'items'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const name of names) write('.trash/' + name, 'original');
  write('.trash/' + id + '.json', 'sidecar');
  const commit = vi.fn();
  await expect(restoreTrashCapture({ folder, trashDir: trash, captureId: id, record: record(), allowExistingItem: false, commitRestore: commit })).rejects.toThrow();
  expect(commit).not.toHaveBeenCalled();
  expect(fs.readdirSync(outside)).toEqual([]);
  for (const name of names) expect(fs.readFileSync(path.join(trash, name), 'utf8')).toBe('original');
  expect(fs.readFileSync(path.join(trash, id + '.json'), 'utf8')).toBe('sidecar');
});

test('context hash 確認後の媒体変更は DB 確定せず sidecar を残す', async () => {
  for (const name of names) {
    write('.trash/' + id + '/' + name, 'original');
    write(itemFileRelative(id, name), 'original');
  }
  write('.trash/' + id + '.json', 'sidecar');
  const stream = fs.createReadStream;
  let observed = false;
  vi.spyOn(fs, 'createReadStream').mockImplementation((...args) => {
    const result = stream(...args);
    if (String(args[0]) === path.join(folder, itemFileRelative(id, names[0])) && !observed) {
      observed = true;
      result.once('end', () => fs.writeFileSync(path.join(folder, itemFileRelative(id, names[0])), 'new context'));
    }
    return result;
  });
  const commit = vi.fn();
  await expect(restoreTrashCapture({ folder, trashDir: trash, captureId: id, record: record(), allowExistingItem: true, commitRestore: commit })).rejects.toThrow('Restore media changed');
  expect(commit).not.toHaveBeenCalled();
  expect(fs.readFileSync(path.join(folder, itemFileRelative(id, names[0])), 'utf8')).toBe('new context');
  expect(fs.readFileSync(path.join(trash, id + '.json'), 'utf8')).toBe('sidecar');
});

test('text-only 復元は共有 avatar と引用参照をそのまま保持する', async () => {
  const input = { captureId: id, content: 'text', avatarFile: 'avatars/shared.png', media: [{ file: 'quoted-media/shared.png' }] };
  write(input.avatarFile, 'shared-avatar');
  write(input.media[0].file, 'shared-quote');
  write(`.trash/${id}.json`, JSON.stringify(input));
  const commit = vi.fn();
  await restoreTrashCapture({ folder, trashDir: trash, captureId: id, record: input, allowExistingItem: false, commitRestore: commit });
  expect(commit).toHaveBeenCalledWith(expect.objectContaining(input));
  expect(fs.readFileSync(path.join(folder, input.avatarFile), 'utf8')).toBe('shared-avatar');
  expect(fs.readFileSync(path.join(folder, input.media[0].file), 'utf8')).toBe('shared-quote');
  expect(fs.readdirSync(trash)).toEqual([]);
});

test('flat と nested の同名媒体は曖昧として動かさず拒否する', async () => {
  write(`.trash/${id}/${names[0]}`, 'nested');
  write(`.trash/${names[0]}`, 'flat');
  write(`.trash/${id}.json`, 'sidecar');
  const commit = vi.fn();
  await expect(restoreTrashCapture({ folder, trashDir: trash, captureId: id, record: record(), allowExistingItem: false, commitRestore: commit })).rejects.toThrow('Ambiguous');
  expect(commit).not.toHaveBeenCalled();
  expect(fs.readFileSync(path.join(trash, id, names[0]), 'utf8')).toBe('nested');
  expect(fs.readFileSync(path.join(trash, names[0]), 'utf8')).toBe('flat');
});
