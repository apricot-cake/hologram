// Unit tests for the trash view's state model (#268).
//
// What's covered is only the part that grew when "trash went from a small settings-page
// listing to a destination with cards" — the 4 pieces: ordering, grouping, selection, and
// bulk apply. IPC itself is a 1:1 forwarder in trash.ts, so it's stubbed out and only how
// it gets called is checked (what got called is the entirety of the real-world effect of
// restore / permanent delete).
//
// Grouping injects the real implementation (records.ts's makeGroupRecords) — the design
// requirement is that a multi-image post deleted as a single card comes back as a single
// card in trash too (the finalized design decision "reuse card selection and preview"), and
// mocking that would leave nothing actually verified.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const ipc = vi.hoisted(() => ({
  records: [] as any[],
  restored: [] as string[],
  deleted: [] as string[],
  emptied: 0,
}));

vi.mock('../app/src/renderer/src/services/trash.ts', () => ({
  listTrash: async () => ipc.records,
  restorePost: async (image: string) => {
    ipc.restored.push(image);
    return { ok: true };
  },
  deleteFromTrash: async (id: string) => {
    ipc.deleted.push(id);
    return { ok: true };
  },
  emptyTrash: async () => {
    ipc.emptied++;
    return { ok: true };
  },
}));
// sonner has a browser-side render target — here it's enough that it was called.
vi.mock('../app/src/renderer/src/services/ui.ts', () => ({ notify: () => {}, escapeHtml: (s: string) => s }));

import { close as confirmClose, get as confirmGet } from '../app/src/renderer/src/services/confirm';
import { makeGroupRecords } from '../app/src/renderer/src/services/records';
import { get as storeGet } from '../app/src/renderer/src/services/store';
import * as trashView from '../app/src/renderer/src/services/trash-view';

const groupRecords = makeGroupRecords({ manualGroups: () => [], ungrouped: () => new Set<string>() });
const quickViewed: string[] = [];
trashView.configure({
  t: (key: string) => key,
  groupRecords,
  openQuickView: (g) => quickViewed.push(g.rep.captureId),
});

const rec = (captureId: string, url: string, trashedAt: string) => ({ captureId, url, image: `${captureId}.png`, trashedAt, tags: [] }) as any;
// a and b share the same post URL -> one card. c is a separate post.
const A = rec('a', 'https://x.com/u/status/1', '2026-07-30T10:00:00Z');
const B = rec('b', 'https://x.com/u/status/1', '2026-07-30T09:00:00Z');
const C = rec('c', 'https://x.com/u/status/2', '2026-07-30T11:00:00Z');

async function load(records: any[]) {
  ipc.records = records.map((r) => ({ ...r }));
  await trashView.refresh();
}

beforeEach(async () => {
  ipc.restored.length = 0;
  ipc.deleted.length = 0;
  ipc.emptied = 0;
  quickViewed.length = 0;
  confirmClose(); // in production ConfirmHost closes it on button press (doOk in Confirm.tsx)
  await load([A, B, C]);
  trashView.clearSelection();
});

// Press in the same order as ConfirmHost: close first, then onOk. Reversing this would
// let the next "shouldn't be open" check pick up the previous dialog and pass by accident.
function pressOk() {
  const dialog = confirmGet();
  confirmClose();
  dialog?.onOk({ skip: false });
}

describe('ゴミ箱の読み込み', () => {
  test('捨てた順（新しい方が上）に並び、同じ投稿は1枚のカードにまとまる', () => {
    const snap = trashView.getSnapshot();
    // There are 2 cards (c and a+b). The count badge is the number of "trashed posts", not "cards" — 3.
    expect(snap.groups.map((g) => g.records.map((r) => r.captureId))).toEqual([['c'], ['a', 'b']]);
    expect(snap.count).toBe(3);
  });

  test('グリッドの items はストア経由で、空のときだけ null（セルを畳む合図）', async () => {
    expect((storeGet('trashGroups') as any[]).length).toBe(2);
    await load([]);
    expect(storeGet('trashGroups')).toBeNull();
    expect(trashView.getSnapshot().count).toBe(0);
  });

  test('読み直しで消えた分は選択から落ちる', async () => {
    trashView.clickCard('c', {});
    trashView.clickCard('a', { ctrl: true });
    expect(trashView.getSnapshot().selected.size).toBe(2);
    await load([C]);
    expect([...trashView.getSnapshot().selected]).toEqual(['c']);
  });
});

describe('選択', () => {
  test('素のクリックは置き換え、Ctrl は足し引き', () => {
    trashView.clickCard('c', {});
    expect([...trashView.getSnapshot().selected]).toEqual(['c']);
    trashView.clickCard('a', {});
    expect([...trashView.getSnapshot().selected]).toEqual(['a']);
    trashView.clickCard('c', { ctrl: true });
    expect(trashView.getSnapshot().selected.size).toBe(2);
    trashView.clickCard('c', { ctrl: true });
    expect([...trashView.getSnapshot().selected]).toEqual(['a']);
  });

  test('Shift は直前にクリックしたカードからの範囲（並び順で数える）', () => {
    trashView.clickCard('c', {}); // starting point
    trashView.clickCard('a', { shift: true });
    expect([...trashView.getSnapshot().selected]).toEqual(['c', 'a']);
  });

  test('すべて選択と解除', () => {
    trashView.selectAll();
    expect(trashView.getSnapshot().selected.size).toBe(2);
    trashView.clearSelection();
    expect(trashView.getSnapshot().selected.size).toBe(0);
  });

  test('プレビューは選択と独立にカード単位で開く', () => {
    trashView.preview('a');
    expect(quickViewed).toEqual(['a']);
  });
});

describe('一括適用', () => {
  test('復元は選んだカードの全レコードを戻す（複数画像投稿は1枚で2件）', async () => {
    trashView.clickCard('a', {});
    trashView.restoreSelected();
    await vi.waitFor(() => expect(ipc.restored).toEqual(['a.png', 'b.png']));
  });

  test('復元も完全削除も、選択が空なら何も呼ばない', () => {
    trashView.restoreSelected();
    trashView.requestDeleteSelected();
    expect(ipc.restored).toEqual([]);
    expect(confirmGet()).toBeNull();
  });

  test('完全削除は確認を挟んでから captureId 単位で消す', async () => {
    trashView.selectAll();
    trashView.requestDeleteSelected();
    expect(confirmGet()?.message).toBe('trashDeleteConfirm');
    expect(ipc.deleted).toEqual([]); // nothing happens before confirmation
    pressOk();
    await vi.waitFor(() => expect(ipc.deleted).toEqual(['c', 'a', 'b']));
  });

  test('空にするは #105 の確認をそのまま通す（0件なら開きもしない）', async () => {
    trashView.requestEmptyAll();
    expect(confirmGet()?.message).toBe('trashEmptyBtn');
    expect(confirmGet()?.description).toBe('trashEmptyConfirm');
    pressOk();
    await vi.waitFor(() => expect(ipc.emptied).toBe(1));

    await load([]);
    trashView.requestEmptyAll();
    expect(confirmGet()).toBeNull();
  });
});
