import type { Translate } from './translation.ts';

interface PostDeletionDeps {
  deletePost(file: string): Promise<{ ok: boolean }>;
  removePosts(ids: Iterable<string>): void;
  refreshTrash(): Promise<void>;
  loadPosts(keepLimit?: boolean): Promise<void>;
  notify(message: string): void;
  t: Translate;
}

// 一覧から外すとフォルダ所属も永続化される。ゴミ箱が所属を保存し、
// 成功を返すまでは、削除対象を一覧から外してはいけない。
export async function deletePosts(records: readonly Pick<HologramPost, 'captureId' | 'image' | 'video'>[], deps: PostDeletionDeps): Promise<void> {
  const results = await Promise.all(
    records.map(async (record) => {
      try {
        return (await deps.deletePost(record.image || record.video || record.captureId)).ok ? record.captureId : null;
      } catch {
        return null;
      }
    }),
  );
  const deleted = results.filter((id): id is string => id !== null);
  const failedCount = records.length - deleted.length;
  if (deleted.length) deps.removePosts(deleted);
  if (failedCount) {
    deps.notify(deps.t(deleted.length ? 'deletePartial' : 'deleteFailedN', { count: failedCount, deletedCount: deleted.length }));
  } else if (deleted.length) {
    deps.notify(deps.t('deletedN', { count: deleted.length }));
  }
  await Promise.all([deps.refreshTrash(), deps.loadPosts(true)]);
}
