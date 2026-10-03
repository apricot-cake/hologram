import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { establishWatcherAndFinalDrain, withLibraryRelocationPaused } from '../../app/src/main/lib-library-relocation-lifecycle';
import { applyPostsDeltaToCache } from '../../app/src/renderer/src/services/post-delta-cache';

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
      async () => 1,
      async (_owner) => {
        current = newInbox;
        fs.writeFileSync(path.join(newInbox, 'during-move.json'), '{}');
        return { ok: true };
      },
      async (_owner) => {
        drained.push(...fs.readdirSync(current));
      },
      { ok: false },
    );

    expect(drained).toEqual(['during-move.json']);
  });

  test('移動失敗時は一覧の基準を捨てず、元の inbox を finish で drain する', async () => {
    const { oldInbox } = libraries();
    const baseline = ['既存投稿'];
    const drained: string[] = [];

    const result = await withLibraryRelocationPaused(
      async () => 1,
      async (_owner) => {
        fs.writeFileSync(path.join(oldInbox, 'during-failure.json'), '{}');
        return { ok: false };
      },
      async (_owner) => {
        drained.push(...fs.readdirSync(oldInbox));
      },
      { ok: false },
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
          return 1;
        },
        async (_owner) => {
          throw new Error('再初期化失敗');
        },
        async (_owner) => {
          watcherRunning = true;
        },
        { ok: false },
      ),
    ).rejects.toThrow('再初期化失敗');
    expect(watcherRunning).toBe(true);
  });

  test('paused response は renderer の実 cache を空配列で置き換えない', () => {
    const cache = new Map<string, { captureId: string; title: string | null }>([['existing', { captureId: 'existing', title: '表示中' }]]);
    const response = { saveFolder: '/moving', full: false, paused: true, profiles: [] };
    const after = applyPostsDeltaToCache(cache, response, (post) => post);
    expect(after).toBe(cache);
    expect([...after.values()]).toEqual([{ captureId: 'existing', title: '表示中' }]);
  });

  test('別 window の同時移動は owner を得られず busy になり、先行移動を finish しない', async () => {
    let finishCount = 0;
    const result = await withLibraryRelocationPaused(
      async () => null,
      async () => {
        throw new Error('busy の移動処理は走らない');
      },
      async () => {
        finishCount++;
      },
      { ok: false, error: 'busy' },
    );
    expect(result).toEqual({ ok: false, error: 'busy' });
    expect(finishCount).toBe(0);
  });

  test('pause 途中の失敗は begin 自身が watcher と owner を復旧してから throw する', async () => {
    let owner: number | null = null;
    let watcherRunning = true;
    const begin = async () => {
      owner = 1;
      watcherRunning = false;
      try {
        throw new Error('watcher close failure');
      } catch (error) {
        watcherRunning = true;
        owner = null;
        throw error;
      }
    };
    await expect(
      withLibraryRelocationPaused(
        begin,
        async () => true,
        async () => {},
        false,
      ),
    ).rejects.toThrow('watcher close failure');
    expect(owner).toBeNull();
    expect(watcherRunning).toBe(true);
  });

  test('watcher ready 直前に native save が到着しても ready 後の最終 drain が拾う', async () => {
    const { newInbox } = libraries();
    const drained: string[] = [];
    await establishWatcherAndFinalDrain(
      async () => {
        // ignoreInitial の初期走査中に既存扱いとなり、watch event が出なかった fixture。
        fs.writeFileSync(path.join(newInbox, 'during-ready.json'), '{}');
        await new Promise((resolve) => setImmediate(resolve));
      },
      async () => {
        drained.push(...fs.readdirSync(newInbox));
      },
    );
    expect(drained).toEqual(['during-ready.json']);
  });
});
