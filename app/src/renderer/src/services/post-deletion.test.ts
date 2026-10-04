import { expect, test, vi } from 'vitest';
import { deletePosts } from './post-deletion.ts';
import { createTranslator } from './translation.ts';

vi.mock('./ui.ts', () => ({ notify: vi.fn() }));
vi.mock('./i18n.ts', () => ({ hologramI18n: Promise.resolve(null) }));
import { createFolderStore } from './folders.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const records = [
    { captureId: 'image', image: 'image.jpg', video: null },
    { captureId: 'video', image: null, video: 'video.mp4' },
    { captureId: 'text', image: null, video: null },
  ];
  const existing = new Set(records.map((record) => record.captureId));
  const folders = createFolderStore({ idPrefix: 'test', isLibrary: true, persist: vi.fn() });
  folders.setAll([
    { id: 'a', name: 'A', items: [...existing] },
    { id: 'b', name: 'B', items: ['image', 'video'] },
  ]);
  const removePosts = vi.fn((ids: Iterable<string>) => {
    for (const id of ids) existing.delete(id);
    folders.reconcile(existing);
  });
  const refreshTrash = vi.fn(async () => {});
  const loadPosts = vi.fn(async () => {});
  const notify = vi.fn();
  const t = await createTranslator('ja');
  return { records, existing, folders, deps: { removePosts, refreshTrash, loadPosts, notify, t } };
}

test('全要求が確定するまで所属を残し、ゴミ箱へ元の複数フォルダを保存できる', async () => {
  const f = await fixture();
  const held = deferred<{ ok: boolean }>();
  const savedMembership = new Map<string, string[]>();
  const deletePost = vi.fn(async (file: string) => {
    if (file === 'video.mp4') await held.promise;
    const id = file === 'image.jpg' ? 'image' : file === 'video.mp4' ? 'video' : file;
    savedMembership.set(
      id,
      f.folders
        .all()
        .filter((folder) => folder.items.includes(id))
        .map((folder) => folder.id),
    );
    return { ok: true };
  });
  const deletion = deletePosts(f.records, { ...f.deps, deletePost });
  await Promise.resolve();
  expect(deletePost.mock.calls.map(([file]) => file)).toEqual(['image.jpg', 'video.mp4', 'text']);
  expect(f.folders.byId('a')?.items).toEqual(['image', 'video', 'text']);
  expect(f.deps.removePosts).not.toHaveBeenCalled();
  expect(f.deps.refreshTrash).not.toHaveBeenCalled();
  expect(f.deps.notify).not.toHaveBeenCalled();
  held.resolve({ ok: true });
  await deletion;
  expect(savedMembership.get('image')).toEqual(['a', 'b']);
  expect(savedMembership.get('video')).toEqual(['a', 'b']);
  expect(savedMembership.get('text')).toEqual(['a']);
  expect(f.existing.size).toBe(0);
  expect(f.deps.notify).toHaveBeenCalledWith('3 件削除しました');
  expect(f.deps.refreshTrash).toHaveBeenCalledOnce();
  expect(f.deps.loadPosts).toHaveBeenCalledWith(true);
});

test('成功・ok:false・例外が混在すると成功だけを除去し、失敗投稿の所属と件数を保持する', async () => {
  const f = await fixture();
  const deletePost = vi.fn(async (file: string) => {
    if (file === 'text') throw new Error('unavailable');
    return { ok: file === 'image.jpg' };
  });
  await deletePosts(f.records, { ...f.deps, deletePost });
  expect(f.deps.removePosts).toHaveBeenCalledExactlyOnceWith(['image']);
  expect(f.folders.byId('a')?.items).toEqual(['video', 'text']);
  expect(f.folders.byId('b')?.items).toEqual(['video']);
  expect(f.deps.notify).toHaveBeenCalledExactlyOnceWith('1 件削除しました。2 件の削除に失敗しました');
  expect(f.deps.refreshTrash).toHaveBeenCalledOnce();
  expect(f.deps.loadPosts).toHaveBeenCalledWith(true);
});

test('全件失敗では再集計を行わず、成功通知も出さない', async () => {
  const f = await fixture();
  await deletePosts(f.records, { ...f.deps, deletePost: async () => ({ ok: false }) });
  expect(f.deps.removePosts).not.toHaveBeenCalled();
  expect(f.folders.byId('a')?.items).toEqual(['image', 'video', 'text']);
  expect(f.deps.notify).toHaveBeenCalledExactlyOnceWith('3 件の削除に失敗しました');
});

test('単一レコードのカード削除も確定後に除去し、正しい件数を表示する', async () => {
  const f = await fixture();
  await deletePosts([f.records[0]!], { ...f.deps, deletePost: async () => ({ ok: true }) });
  expect(f.deps.removePosts).toHaveBeenCalledExactlyOnceWith(['image']);
  expect(f.folders.byId('b')?.items).toEqual(['video']);
  expect(f.deps.notify).toHaveBeenCalledExactlyOnceWith('1 件削除しました');
});
