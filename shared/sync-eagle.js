// Eagle ライブラリ → store の増分同期。
// engagement 取得 (各 SNS API 呼び出し) はこのファイルでは行わない —
// それは別の sync-engagement.js で後段に分離予定。
//
// eagleItem は { getIdsWithModifiedAt, getByIds } を持つオブジェクト (eagle.item)。
// テストではモックを注入できる。

import { parseAnnotation } from './annotation-parser.js';

const DEFAULT_BATCH_SIZE = 200;

export async function syncFromEagle({ eagleItem, store, batchSize = DEFAULT_BATCH_SIZE, log = () => {} }) {
  const t0 = Date.now();

  // 1. Eagle 側の (id, modifiedAt) と store を diff
  const idsModifiedAt = await eagleItem.getIdsWithModifiedAt();
  const { newIds, changedIds, deletedIds } = store.diff(idsModifiedAt);
  log(`diff: +${newIds.length} ~${changedIds.length} -${deletedIds.length}`);

  // 2. 削除分を反映
  for (const id of deletedIds) store.delete(id);

  // 3. 新規 + 変更分の詳細を batched で取得して annotation parse + upsert
  const targetIds = [...newIds, ...changedIds];
  let upsertedCount = 0;
  for (let i = 0; i < targetIds.length; i += batchSize) {
    const chunk = targetIds.slice(i, i + batchSize);
    const items = await eagleItem.getByIds(chunk);
    log(`  batch ${i}/${targetIds.length}: requested=${chunk.length} returned=${items.length}`);
    for (const item of items) {
      const parsed = parseAnnotation(item.annotation);
      store.upsert(item.id, buildRecord(item, parsed));
      upsertedCount++;
    }
  }

  // 4. 永続化
  store.setLastSync();
  store.save();

  return {
    newCount: newIds.length,
    changedCount: changedIds.length,
    deletedCount: deletedIds.length,
    upsertedCount,                     // 実際に upsert できた件数 (失敗時 newCount+changedCount より少ないことがある)
    elapsedMs: Date.now() - t0
  };
}

function buildRecord(item, parsed) {
  return {
    modifiedAt: item.modifiedAt,
    url: item.url || null,
    // UI 表示用 (Eagle Item から直接)
    name: item.name || null,
    thumbnailURL: item.thumbnailURL || null,
    ext: item.ext || null,
    // annotation 由来 (人間情報)
    platform: parsed?.platform || null,
    platformLabel: parsed?.platformLabel || null,
    displayName: parsed?.displayName || null,
    author: parsed?.author || null,
    hashtags: parsed?.hashtags || [],
    alt: parsed?.alt || null,
    text: parsed?.text || null,
    title: parsed?.title || null,
    // legacy 旧形式の補助情報 (Window Plugin が古いライブラリを sync する場合用)
    legacyUid: parsed?.legacy?.uid || null,
    legacyPostId: parsed?.legacy?.postId || null,
    legacyPublishedAt: parsed?.legacy?.publishedAt || null,
    legacyDescription: parsed?.legacy?.description || null,
    // engagement は後段 (sync-engagement.js) で埋める
    // status:
    //   'parsed'         — Info+ annotation が読めた、SNS API 取得待ち
    //   'no-annotation'  — Info+ で保存されてない (Eagle for Chrome の素のドラッグ等)
    status: parsed ? 'parsed' : 'no-annotation'
  };
}
