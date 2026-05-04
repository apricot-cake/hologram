// Engagement (likes / views 等) を SNS API から取得して store に書き込む。
// store には事前に sync-eagle が走って status='parsed' な record が存在している前提。
//
// fetch は DI。レート制限・並列度は MVP では 1 並列 sequential、改善は後段。

import {
  parsePostUrl,
  fetchXEngagement,
  fetchBlueskyEngagement,
  fetchPixivEngagement
} from './sns-api-client.js';

export async function syncEngagement({ store, fetch, log = () => {}, filter = {}, signal, onProgress } = {}) {
  const t0 = Date.now();

  // 対象: status='parsed' (annotation 解析済みで engagement 未取得) または 'synced' (再フェッチ)
  let targets = Object.entries(store.data.items)
    .filter(([_, v]) => v.status === 'parsed' || v.status === 'synced')
    .filter(([_, v]) => v.url);
  if (filter.platform) {
    targets = targets.filter(([_, v]) => v.platform === filter.platform);
  }

  log(`engagement targets: ${targets.length}`);

  let okCount = 0;
  let errCount = 0;
  let skipCount = 0;
  let cancelled = false;

  for (let i = 0; i < targets.length; i++) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }

    const [id, record] = targets[i];
    onProgress?.({ done: i, total: targets.length, currentId: id });

    const parsed = parsePostUrl(record.url);
    if (!parsed) {
      skipCount++;
      continue;
    }

    try {
      let result;
      if (parsed.platform === 'x') {
        result = await fetchXEngagement({ postId: parsed.postId, fetch });
      } else if (parsed.platform === 'bluesky') {
        result = await fetchBlueskyEngagement({ handle: parsed.handle, postId: parsed.postId, fetch });
      } else if (parsed.platform === 'pixiv') {
        result = await fetchPixivEngagement({ postId: parsed.postId, fetch });
      } else {
        skipCount++;
        continue;
      }

      store.upsert(id, {
        ...result.engagement,
        status: result.status,
        engagementSyncedAt: Date.now()
      });
      okCount++;
      log(`  ${id} (${parsed.platform}) ${result.status} ${JSON.stringify(result.engagement)}`);
    } catch (e) {
      store.upsert(id, { status: 'error', errorMessage: e.message });
      errCount++;
      log(`  ${id} (${parsed.platform}) error: ${e.message}`);
    }
  }

  // 完了 (中断含む) で final progress を通知
  onProgress?.({ done: okCount + errCount + skipCount, total: targets.length });
  store.save();

  return {
    targetCount: targets.length,
    okCount,
    errCount,
    skipCount,
    cancelled,
    elapsedMs: Date.now() - t0
  };
}
