import { describe, expect, test } from 'vitest';
import { ZodError } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../../app/src/main/lib-db';
import { createDbWriter } from '../../app/src/main/lib-db-write';
import { AppPrefsSchema, FoldersSchema } from '../../app/src/shared/data-schemas';
import { ipcInputs } from '../../app/src/shared/ipc-inputs';
import { isTrustedIpcUrl } from '../../app/src/main/ipc-sender';

test('登録済みの全 IPC に入力定義がある', () => {
  const dir = path.resolve('app/src/main');
  const channels = fs
    .readdirSync(dir)
    .filter((name) => /^ipc-.*\.ts$/.test(name))
    .flatMap((name) => [...fs.readFileSync(path.join(dir, name), 'utf8').matchAll(/ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)].map((m) => m[1]));
  expect(channels.sort()).toEqual(Object.keys(ipcInputs).sort());
});

test('環境設定の既定値と検証は同じ定義を使う', () => {
  expect(AppPrefsSchema.parse({}).showInfo).toBe(true);
  expect(ipcInputs['set-pref'].safeParse(['showInfo', 'false']).success).toBe(false);
  expect(ipcInputs['set-pref'].safeParse(['squareThumbs', 'invalid']).success).toBe(false);
  expect(ipcInputs['set-pref'].safeParse(['showInfo', false]).success).toBe(true);
});

describe('不正な置換入力は保存内容を変えない', () => {
  test.each(['folders', 'ungrouped', 'groups', 'tabs', 'posterTags', 'posterFolders', 'tagGroups'])('%s', (kind) => {
    const { sqlite } = openDatabase(':memory:');
    try {
      const w = createDbWriter(sqlite);
      w.setFolders({ folders: [{ id: 'keep', name: 'Keep' }] });
      w.setUngrouped(['keep']);
      w.setTabs({ tabs: [{ id: 'keep' }] });
      w.setPosterTags({ tags: { keep: ['tag'] } });
      w.setPosterFolders({ folders: [{ id: 'keep', name: 'Keep' }] });
      const snapshot = () => JSON.stringify([w.getFolders(), w.getUngrouped(), w.getManualGroups(), w.getTabs(), w.getPosterTags(), w.getPosterFolders(), w.getTagGroups()]);
      const before = snapshot();
      const bad: any = { unexpected: true };
      const actions = { folders: () => w.setFolders(bad), ungrouped: () => w.setUngrouped(bad), groups: () => w.setManualGroups(bad), tabs: () => w.setTabs(bad), posterTags: () => w.setPosterTags({ tags: { keep: bad } }), posterFolders: () => w.setPosterFolders(bad), tagGroups: () => w.setTagGroups(bad, null) };
      expect(actions[kind]).toThrow(ZodError);
      expect(snapshot()).toBe(before);
    } finally {
      sqlite.close();
    }
  });
});

test('省略可能な項目と不正な項目を区別する', () => {
  expect(FoldersSchema.parse({ folders: [{ id: 'a', name: 'A' }] }).folders[0].items).toEqual([]);
  expect(() => FoldersSchema.parse({ folders: [{ id: 'a', name: 'A', items: 'bad' }] })).toThrow();
});

test('IPC の送信元は配備済み入口と明示された開発サーバーだけ', () => {
  expect(isTrustedIpcUrl('app://bundle/index.html', undefined, true)).toBe(true);
  expect(isTrustedIpcUrl('app://bundle/pin.html', undefined, true)).toBe(false);
  for (const url of ['https://example.com', 'app://bundle.evil/index.html', 'app://bundle/other.html', 'app://user@bundle/index.html']) expect(isTrustedIpcUrl(url, undefined, false)).toBe(false);
  expect(isTrustedIpcUrl('http://localhost:5173/', 'http://localhost:5173/', false)).toBe(true);
  expect(isTrustedIpcUrl('http://localhost:5174/', 'http://localhost:5173/', false)).toBe(false);
  expect(isTrustedIpcUrl('http://localhost:5173/', 'http://localhost:5173/', true)).toBe(false);
});
