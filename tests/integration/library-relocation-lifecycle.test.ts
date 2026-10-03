import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { withLibraryRelocationPaused } from '../../app/src/main/lib-library-relocation-lifecycle';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function libraries() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-relocation-lifecycle-'));
  roots.push(root);
  const oldInbox = path.join(root, 'old', '.hologram-inbox', 'new');
  const newInbox = path.join(root, 'new', '.hologram-inbox', 'new');
  fs.mkdirSync(oldInbox, { recursive: true });
  fs.mkdirSync(newInbox, { recursive: true });
  return { oldInbox, newInbox };
}

describe('library relocation lifecycle', () => {
  test('成功時は pause 中に新しい inbox へ到着した項目を finish で drain する', async () => {
    const { oldInbox, newInbox } = libraries();
    let current = oldInbox;
    const drained: string[] = [];

    await withLibraryRelocationPaused(
      async () => {},
      async () => {
        current = newInbox;
        fs.writeFileSync(path.join(newInbox, 'during-move.json'), '{}');
        return { ok: true };
      },
      async () => {
        drained.push(...fs.readdirSync(current));
      },
    );

    expect(drained).toEqual(['during-move.json']);
  });

  test('移動失敗時は一覧の基準を捨てず、元の inbox を finish で drain する', async () => {
    const { oldInbox } = libraries();
    const baseline = ['既存投稿'];
    const drained: string[] = [];

    const result = await withLibraryRelocationPaused(
      async () => {},
      async () => {
        fs.writeFileSync(path.join(oldInbox, 'during-failure.json'), '{}');
        return { ok: false };
      },
      async () => {
        drained.push(...fs.readdirSync(oldInbox));
      },
    );

    expect(result).toEqual({ ok: false });
    expect(baseline).toEqual(['既存投稿']);
    expect(drained).toEqual(['during-failure.json']);
  });

  test('成功後の再初期化処理が throw しても finish を実行して watcher を復旧する', async () => {
    let watcherRunning = false;

    await expect(
      withLibraryRelocationPaused(
        async () => {
          watcherRunning = false;
        },
        async () => {
          throw new Error('再初期化失敗');
        },
        async () => {
          watcherRunning = true;
        },
      ),
    ).rejects.toThrow('再初期化失敗');
    expect(watcherRunning).toBe(true);
  });
});
