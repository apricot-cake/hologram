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
// X は非公式 syndication CDN で公開レート制限が無いため保守的に。間隔 + jitter で
// 一定パターンを避ける。本当の安全は 429 検知での停止 (下記) と総量を抑えること。
export const DEFAULT_RATE_LIMIT = {
  x: { concurrency: 1, minIntervalMs: 2500, jitterMs: 1000 },
  bluesky: { concurrency: 4, minIntervalMs: 0 },
  pixiv: { concurrency: 4, minIntervalMs: 0 }
};

// 1 日あたりの取得リクエスト数の上限 (platform 別)。総量を抑える保険。X のみ既定でキャップ。
// store.data.dailyFetch に日別カウントを永続化し、日付が変われば自動リセット。
export const DEFAULT_DAILY_LIMIT = { x: 500 };

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function syncEngagement({
  store,
  fetch,
  log = () => {},
  filter = {},
  signal,
  onProgress,
  onConfirm,        // async (countsByPlatform) => boolean。false で取得せず終了 (大量時の確認用)
  rateLimit = {},
  dailyLimit = {},  // { x: N } 等。1 日あたりの取得リクエスト上限。超過分は翌日へ繰り越し
  limit,            // この 1 回で取得する投稿数の上限 (platform 横断の合計)。テスト取得用
  sleep = defaultSleep,
  now = Date.now
} = {}) {
  const t0 = now();

  // 対象の基本集合 (url を持つ record)。
  //   通常: status='parsed' (engagement 未取得) / 'synced' (再フェッチ) を対象。
  //   filter.statuses で対象 status を差し替え可 (backfill は ['no-annotation'])。
  //   filter.ids 指定時は status を問わない whitelist (resume / current-filter スコープ)。
  //     → backfill を cancel→resume しても no-annotation のまま処理を続けられる。
  let targets = Object.entries(store.data.items).filter(([_, v]) => v.url);
  if (filter.ids) {
    const allow = new Set(filter.ids);
    targets = targets.filter(([id]) => allow.has(id));
  } else {
    const eligible = new Set(filter.statuses || ['parsed', 'synced']);
    targets = targets.filter(([_, v]) => eligible.has(v.status));
  }

  // 追加スコープ (AND)。詳細は todo.md の Phase 3「スコープ選択」。
  //   platform  — 指定 platform のみ
  //   staleDays — engagement が N 日以上前、または未取得の record のみ
  if (filter.platform) {
    targets = targets.filter(([_, v]) => v.platform === filter.platform);
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

  // 日次上限の残量。store.data.dailyFetch に日別カウントを持ち、日付が変われば 0 に戻す。
  // 日付はローカル暦日 (端末の深夜 0 時でリセット)。
  const _d = new Date(now());
  const _pad = (n) => String(n).padStart(2, '0');
  const todayKey = `${_d.getFullYear()}-${_pad(_d.getMonth() + 1)}-${_pad(_d.getDate())}`;
  let daily = store.data.dailyFetch;
  if (!daily || daily.date !== todayKey) {
    daily = { date: todayKey, counts: {} };
    store.data.dailyFetch = daily;
  }
  const remainingBudget = (p) => {
    const cap = dailyLimit[p];
    return cap == null ? Infinity : Math.max(0, cap - (daily.counts[p] || 0));
  };

  // platform ごとにキューへ振り分け。parse できない / 非対応 platform は即 skip。
  // 同じ投稿 (platform:postId) を共有する複数アイテムは 1 エントリにまとめ、fetch を 1 回で
  // 済ませて同グループ全員に適用する (多ページ投稿で X リクエストを節約)。
  const queues = new Map(); // platform -> [{ parsed, ids: [] }]
  const postIndex = new Map(); // `${platform}:${postId}` -> entry
  for (const [id, record] of targets) {
    const parsed = parsePostUrl(record.url);
    if (!parsed || !FETCHERS[parsed.platform]) {
      skipCount++;
      continue;
    }
    const k = `${parsed.platform}:${parsed.postId}`;
    let entry = postIndex.get(k);
    if (!entry) {
      entry = { parsed, ids: [] };
      postIndex.set(k, entry);
      if (!queues.has(parsed.platform)) queues.set(parsed.platform, []);
      queues.get(parsed.platform).push(entry);
    }
    entry.ids.push(id);
  }

  // 日次上限に合わせて各 platform のキューを切り詰める。溢れた分はキューに入れない
  // (= no-annotation のまま残る) ので、翌日 (上限リセット後) に押せば続きが取れる。
  let dailyLimited = false;
  for (const [platform, entries] of queues) {
    const budget = remainingBudget(platform);
    if (entries.length > budget) {
      queues.set(platform, entries.slice(0, budget));
      dailyLimited = true;
    }
  }

  // この 1 回の取得を limit 投稿まで (platform 横断の合計) に制限。テスト取得用。
  if (limit != null) {
    let remaining = Math.max(0, limit);
    for (const platform of [...queues.keys()]) {
      const entries = queues.get(platform);
      if (entries.length > remaining) queues.set(platform, entries.slice(0, remaining));
      remaining -= queues.get(platform).length;
    }
  }

  // 大量時の事前確認 (UI 側で X が多い時に確認ダイアログを出す等)。false なら何もせず終了。
  if (onConfirm) {
    const counts = {};
    for (const [p, entries] of queues) counts[p] = entries.length;
    const proceed = await onConfirm(counts);
    if (!proceed) {
      return { targetCount: total, okCount: 0, errCount: 0, skipCount, cancelled: true, rateLimited: false, dailyLimited, remainingIds: [], elapsedMs: now() - t0 };
    }
  }

  let rateLimited = false; // 429 を踏んだら true にして run を止める
  const aborted = () => signal?.aborted === true || rateLimited;
  const processedIds = new Set();
  const reportProgress = (currentId) => {
    onProgress?.({ done: okCount + errCount + skipCount, total, currentId });
  };

  reportProgress(); // 初期表示 (skip 済み分のみ反映された状態)

  // 取得途中でも定期的に永続化する。取得中にプロセス終了 / live-reload (location.reload) が
  // 走っても、それまでの取得結果と日次カウントを失わないため (旧実装は run 末尾で 1 回だけ
  // save していたので途中で落ちると全損だった)。N 件ごと or 一定時間ごとにスロットル。
  const SAVE_EVERY_N = 25;
  const SAVE_EVERY_MS = 3000;
  let lastSaveAt = now();
  let sinceSave = 0;
  const maybeSave = () => {
    sinceSave++;
    if (sinceSave >= SAVE_EVERY_N || (now() - lastSaveAt) >= SAVE_EVERY_MS) {
      try { store.save(); } catch (e) { log(`mid-run save failed: ${e.message}`); }
      lastSaveAt = now();
      sinceSave = 0;
    }
  };

  // 1 投稿 = 1 fetch。結果を ids 全員に適用する。日次カウントは「リクエスト数 = 投稿数」で +1。
  const processPost = async ({ parsed, ids }) => {
    daily.counts[parsed.platform] = (daily.counts[parsed.platform] || 0) + 1;
    try {
      const result = await FETCHERS[parsed.platform]({ ...parsed, fetch });
      for (const id of ids) {
        store.upsert(id, {
          ...result.engagement,
          ...(result.meta || {}), // 同じレスポンス由来の人間情報 (作者・本文・タイトル・タグ)。リンクだけの項目も埋まる
          platform: parsed.platform, // backfill (no-annotation) でも platform バッジ/フィルタが効くよう URL 由来で埋める
          status: result.status,
          engagementSyncedAt: now()
        });
      }
      okCount += ids.length;
      log(`  ${parsed.platform}:${parsed.postId} ×${ids.length} ${result.status} ${JSON.stringify(result.engagement)}`);
    } catch (e) {
      // レート制限は error 印を付けず run を止める。未処理のまま残し再開可能にする。
      if (e.rateLimited) {
        rateLimited = true;
        log(`  ${parsed.platform}:${parsed.postId} rate limited → stop`);
        return;
      }
      for (const id of ids) store.upsert(id, { status: 'error', errorMessage: e.message });
      errCount += ids.length;
      log(`  ${parsed.platform}:${parsed.postId} ×${ids.length} error: ${e.message}`);
    }
    for (const id of ids) processedIds.add(id);
    reportProgress();
    maybeSave(); // 途中経過を定期的にディスクへ
  };

  // platform 同士は並行に走らせる (X を間隔空けて流す裏で Bluesky / pixiv が並列で進む)。
  await Promise.all(
    [...queues.entries()].map(([platform, entries]) =>
      runPool(entries, rateLimit[platform] || NO_THROTTLE, { processOne: processPost, aborted, sleep, now })
    )
  );

  const cancelled = signal?.aborted === true; // ユーザー cancel
  const interrupted = cancelled || rateLimited;

  // resume: 中断 (cancel または rate limit) で取り残した id を store に記録し、次回 filter.ids で
  // 再開できるように。完走 (または残ゼロ) なら resume 状態を消す。store.save は run 末尾の 1 回。
  const queuedIds = [...queues.values()].flat().flatMap((e) => e.ids);
  const remainingIds = interrupted ? queuedIds.filter((id) => !processedIds.has(id)) : [];
  if (remainingIds.length) {
    store.data.engagementResume = { ids: remainingIds, savedAt: now() };
  } else {
    delete store.data.engagementResume;
  }

  // 完了 (中断含む) で final progress を通知
  onProgress?.({ done: okCount + errCount + skipCount, total });
  store.save();

  return {
    targetCount: total,
    okCount,
    errCount,
    skipCount,
    cancelled,
    rateLimited,
    dailyLimited,
    remainingIds,
    elapsedMs: now() - t0
  };
}

// 1 platform 分のキューを concurrency 並列で処理。minIntervalMs > 0 のときは
// pool 全体でリクエスト「開始」を最低 minIntervalMs 間隔に揃える (X 用)。
// abort されたら新規の dispatch を止める (in-flight は完了まで待ち、結果は保存される)。
async function runPool(entries, cfg, { processOne, aborted, sleep, now }) {
  const concurrency = Math.max(1, cfg.concurrency || 1);
  const minIntervalMs = cfg.minIntervalMs || 0;
  const jitterMs = cfg.jitterMs || 0; // 0〜jitterMs を間隔に上乗せ (一定パターン回避)。テストは 0。

  let cursor = 0;
  let nextStartAt = 0; // この時刻以降に次のリクエストを開始してよい (pool 共有)

  const worker = async () => {
    while (cursor < entries.length) {
      if (aborted()) return;
      const entry = entries[cursor++];

      if (minIntervalMs > 0) {
        const t = now();
        const wait = nextStartAt - t;
        const jitter = jitterMs > 0 ? Math.random() * jitterMs : 0;
        nextStartAt = Math.max(t, nextStartAt) + minIntervalMs + jitter;
        if (wait > 0) await sleep(wait);
        if (aborted()) return; // 間隔待ちの間に cancel された
      }

      await processOne(entry);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}
