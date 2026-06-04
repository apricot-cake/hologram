// Engagement (likes / views 等) を SNS API から取得して store に書き込む。
// store には事前に sync-eagle が走って status='parsed' な record が存在している前提。
//
// fetch / sleep / now は DI (Node テストと Eagle plugin / browser 両対応、テストは
// フェイククロックで間隔を決定論的に検証できる)。
//
// レート制限: platform ごとに concurrency (並列数) と minIntervalMs (リクエスト開始の
// 最小間隔) を指定する。X の Syndication API は未認証エンドポイントで叩きすぎると詰まる
// ため 1 並列 + 間隔を空け、Bluesky / pixiv は並列で流す。ポリシー値は呼び出し側が
// DEFAULT_RATE_LIMIT を渡す形にして、shared 関数自体は素の (= 無制限) 挙動をデフォルトに
// 持つ (純粋なメカニズムに留め、テストを速く保つ)。

import {
  parsePostUrl,
  fetchXEngagement,
  fetchBlueskyEngagement,
  fetchPixivEngagement
} from './sns-api-client.js';

const FETCHERS = {
  x: fetchXEngagement,
  bluesky: fetchBlueskyEngagement,
  pixiv: fetchPixivEngagement
};

// 制限なし: 各 platform を 1 並列・間隔なしで処理 (= 旧来の sequential 挙動)。
const NO_THROTTLE = { concurrency: 1, minIntervalMs: 0 };

// production の推奨ポリシー。UI から渡す。詳細は todo.md の Phase 3「レート制限」。
//   X       — 未認証 Syndication API。1 並列で 1.5 秒間隔を空ける
//   Bluesky — public AppView。4 並列、間隔なし
//   pixiv   — ajax/illust。4 並列、間隔なし
export const DEFAULT_RATE_LIMIT = {
  x: { concurrency: 1, minIntervalMs: 1500 },
  bluesky: { concurrency: 4, minIntervalMs: 0 },
  pixiv: { concurrency: 4, minIntervalMs: 0 }
};

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function syncEngagement({
  store,
  fetch,
  log = () => {},
  filter = {},
  signal,
  onProgress,
  rateLimit = {},
  sleep = defaultSleep,
  now = Date.now
} = {}) {
  const t0 = now();

  // 対象: status='parsed' (annotation 解析済みで engagement 未取得) または 'synced' (再フェッチ)
  let targets = Object.entries(store.data.items)
    .filter(([_, v]) => v.status === 'parsed' || v.status === 'synced')
    .filter(([_, v]) => v.url);

  // スコープ絞り込み (全て AND)。詳細は todo.md の Phase 3「スコープ選択」。
  //   platform  — 指定 platform のみ
  //   ids        — 指定 id の whitelist (UI の「現在のフィルタ」= グリッド表示中の id)
  //   staleDays  — engagement が N 日以上前、または未取得 (status='parsed') の record のみ
  if (filter.platform) {
    targets = targets.filter(([_, v]) => v.platform === filter.platform);
  }
  if (filter.ids) {
    const allow = new Set(filter.ids);
    targets = targets.filter(([id]) => allow.has(id));
  }
  if (filter.staleDays != null) {
    const cutoff = now() - filter.staleDays * 86400000;
    targets = targets.filter(([_, v]) => v.engagementSyncedAt == null || v.engagementSyncedAt < cutoff);
  }

  const total = targets.length;
  log(`engagement targets: ${total}`);

  let okCount = 0;
  let errCount = 0;
  let skipCount = 0;

  // platform ごとにキューへ振り分け。parse できない / 非対応 platform は即 skip。
  const queues = new Map(); // platform -> [{ id, parsed }]
  for (const [id, record] of targets) {
    const parsed = parsePostUrl(record.url);
    if (!parsed || !FETCHERS[parsed.platform]) {
      skipCount++;
      continue;
    }
    if (!queues.has(parsed.platform)) queues.set(parsed.platform, []);
    queues.get(parsed.platform).push({ id, parsed });
  }

  const aborted = () => signal?.aborted === true;
  const reportProgress = (currentId) => {
    onProgress?.({ done: okCount + errCount + skipCount, total, currentId });
  };

  reportProgress(); // 初期表示 (skip 済み分のみ反映された状態)

  const processOne = async ({ id, parsed }) => {
    try {
      const result = await FETCHERS[parsed.platform]({ ...parsed, fetch });
      store.upsert(id, {
        ...result.engagement,
        status: result.status,
        engagementSyncedAt: now()
      });
      okCount++;
      log(`  ${id} (${parsed.platform}) ${result.status} ${JSON.stringify(result.engagement)}`);
    } catch (e) {
      store.upsert(id, { status: 'error', errorMessage: e.message });
      errCount++;
      log(`  ${id} (${parsed.platform}) error: ${e.message}`);
    }
    reportProgress(id);
  };

  // platform 同士は並行に走らせる (X を間隔空けて流す裏で Bluesky / pixiv が並列で進む)。
  await Promise.all(
    [...queues.entries()].map(([platform, entries]) =>
      runPool(entries, rateLimit[platform] || NO_THROTTLE, { processOne, aborted, sleep, now })
    )
  );

  const cancelled = aborted();

  // 完了 (中断含む) で final progress を通知
  onProgress?.({ done: okCount + errCount + skipCount, total });
  store.save();

  return {
    targetCount: total,
    okCount,
    errCount,
    skipCount,
    cancelled,
    elapsedMs: now() - t0
  };
}

// 1 platform 分のキューを concurrency 並列で処理。minIntervalMs > 0 のときは
// pool 全体でリクエスト「開始」を最低 minIntervalMs 間隔に揃える (X 用)。
// abort されたら新規の dispatch を止める (in-flight は完了まで待ち、結果は保存される)。
async function runPool(entries, cfg, { processOne, aborted, sleep, now }) {
  const concurrency = Math.max(1, cfg.concurrency || 1);
  const minIntervalMs = cfg.minIntervalMs || 0;

  let cursor = 0;
  let nextStartAt = 0; // この時刻以降に次のリクエストを開始してよい (pool 共有)

  const worker = async () => {
    while (cursor < entries.length) {
      if (aborted()) return;
      const entry = entries[cursor++];

      if (minIntervalMs > 0) {
        const t = now();
        const wait = nextStartAt - t;
        nextStartAt = Math.max(t, nextStartAt) + minIntervalMs;
        if (wait > 0) await sleep(wait);
        if (aborted()) return; // 間隔待ちの間に cancel された
      }

      await processOne(entry);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}
