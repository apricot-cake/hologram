import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { resolveClipboardFiles } from '../app/src/main/file-clipboard.ts';

let folder = '';
afterEach(async () => {
  if (folder) await rm(folder, { recursive: true, force: true });
});

test('全ファイルを順序どおりに解決し、重複を除く。形式による制限はしない', async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'hologram-copy-'));
  const names = ['日本語 空白.jpg', 'image.svg', 'video.mp4'];
  await Promise.all(names.map((name) => writeFile(path.join(folder, name), 'fixture')));
  expect(await resolveClipboardFiles([...names, names[0]], folder)).toEqual(names.map((name) => path.join(folder, name)));
});

test('一部だけ欠けた一覧、ディレクトリ、範囲外、不正入力は全体を拒否する', async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'hologram-copy-'));
  await writeFile(path.join(folder, 'ok.jpg'), 'fixture');
  await mkdir(path.join(folder, 'directory'));
  for (const input of [[], null, 'ok.jpg', ['ok.jpg', 'missing.jpg'], ['directory'], ['../ok.jpg'], ['avatars/icon.jpg'], [42]]) {
    expect(await resolveClipboardFiles(input, folder)).toBeNull();
  }
});
