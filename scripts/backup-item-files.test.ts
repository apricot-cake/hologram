import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false } }));
vi.mock('electron-log/main', () => ({ default: { info: () => {}, warn: () => {}, error: () => {} } }));
import { collectLibraryFiles } from '../app/src/main/lib-backup';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('collectLibraryFiles: 項目フォルダー', () => {
  test('生きた項目とゴミ箱の項目を相対パスのまま集める', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-backup-items-'));
    dirs.push(folder);
    fs.mkdirSync(path.join(folder, 'items', 'cap-1'), { recursive: true });
    fs.mkdirSync(path.join(folder, '.trash', 'cap-2'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'items', 'cap-1', 'cap-1.jpg'), 'live');
    fs.writeFileSync(path.join(folder, '.trash', 'cap-2', 'cap-2.jpg'), 'trash');
    fs.writeFileSync(path.join(folder, '.trash', 'cap-2.json'), '{}');

    const files = await collectLibraryFiles(folder);

    expect([...files.keys()]).toEqual(expect.arrayContaining(['items/cap-1/cap-1.jpg', '.trash/cap-2/cap-2.jpg', '.trash/cap-2.json']));
    expect(files.get('items/cap-1/cap-1.jpg')?.abs).toBe(path.join(folder, 'items', 'cap-1', 'cap-1.jpg'));
  });
});
