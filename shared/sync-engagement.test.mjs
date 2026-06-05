// node shared/sync-engagement.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { EngagementStore } from './engagement-store.js';
import { syncEngagement } from './sync-engagement.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const mkstore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eagle-info-test-'));
  return { dir, store: new EngagementStore({ libraryPath: dir, fs, path }) };
};

const mockJson = (body, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  async json() { return body; }
});

test('syncEngagement: skips records without parsed status', async () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('a', { status: 'no-annotation', url: 'https://x.com/foo/status/1' });
    const fetch = async () => { throw new Error('should not be called'); };
    const r = await syncEngagement({ store, fetch });
    assert.equal(r.targetCount, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syncEngagement: X record gets engagement upserted', async () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('a', { status: 'parsed', platform: 'x', url: 'https://x.com/foo/status/123' });
    const fetch = async () => mockJson({ favorite_count: 42, conversation_count: 5 });
    const r = await syncEngagement({ store, fetch });
    assert.equal(r.okCount, 1);
    const rec = store.get('a');
    assert.equal(rec.likes, 42);
    assert.equal(rec.replies, 5);
    assert.equal(rec.status, 'synced');
    assert.ok(typeof rec.engagementSyncedAt === 'number');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syncEngagement: Bluesky record', async () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('a', {
      status: 'parsed',
      platform: 'bluesky',
      url: 'https://bsky.app/profile/foo.bsky.social/post/abc'
    });
    const fetch = async () => mockJson({
      thread: { post: { likeCount: 10, repostCount: 2, replyCount: 3, quoteCount: 1 } }
    });
    const r = await syncEngagement({ store, fetch });
    assert.equal(r.okCount, 1);
    assert.equal(store.get('a').likes, 10);
    assert.equal(store.get('a').reposts, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syncEngagement: pixiv record', async () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('a', {
      status: 'parsed',
      platform: 'pixiv',
      url: 'https://www.pixiv.net/artworks/42'
    });
    const fetch = async () => mockJson({
      error: false,
      body: { likeCount: 100, commentCount: 5, viewCount: 5000, bookmarkCount: 200 }
    });
    const r = await syncEngagement({ store, fetch });
    assert.equal(r.okCount, 1);
    assert.equal(store.get('a').views, 5000);
    assert.equal(store.get('a').bookmarks, 200);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syncEngagement: deleted post marks status=deleted', async () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('a', { status: 'parsed', platform: 'x', url: 'https://x.com/foo/status/1' });
    const fetch = async () => mockJson(null, 404);
    const r = await syncEngagement({ store, fetch });
    assert.equal(r.okCount, 1);
    assert.equal(store.get('a').status, 'deleted');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syncEngagement: thrown error marks status=error', async () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('a', { status: 'parsed', platform: 'x', url: 'https://x.com/foo/status/1' });
    const fetch = async () => mockJson(null, 500);
    const r = await syncEngagement({ store, fetch });
    assert.equal(r.errCount, 1);
    assert.equal(store.get('a').status, 'error');
    assert.ok(store.get('a').errorMessage);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syncEngagement: filter.platform restricts targets', async () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('x1', { status: 'parsed', platform: 'x', url: 'https://x.com/a/status/1' });
    store.upsert('p1', { status: 'parsed', platform: 'pixiv', url: 'https://www.pixiv.net/artworks/1' });
    let calls = 0;
    const fetch = async (url) => {
      calls++;
      return mockJson({ favorite_count: 1, conversation_count: 0 });
    };
    const r = await syncEngagement({ store, fetch, filter: { platform: 'x' } });
    assert.equal(r.targetCount, 1);
    assert.equal(calls, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syncEngagement: AbortSignal cancels mid-run, partial results saved', async () => {
  const { dir, store } = mkstore();
  try {
    for (let i = 0; i < 5; i++) {
      store.upsert(`a${i}`, { status: 'parsed', platform: 'x', url: `https://x.com/u/status/${i}` });
    }
    const ac = new AbortController();
    let calls = 0;
    const fetch = async () => {
      calls++;
      if (calls === 2) ac.abort();
      return mockJson({ favorite_count: calls * 10, conversation_count: 0 });
    };
    const r = await syncEngagement({ store, fetch, signal: ac.signal });
    assert.equal(r.cancelled, true);
    assert.ok(r.okCount >= 1 && r.okCount < 5, `partial okCount: ${r.okCount}`);
    // 既に upsert された分は store に残ってる
    assert.equal(store.get('a0').status, 'synced');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syncEngagement: onProgress is called per item', async () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('a', { status: 'parsed', platform: 'x', url: 'https://x.com/u/status/1' });
    store.upsert('b', { status: 'parsed', platform: 'x', url: 'https://x.com/u/status/2' });
    const events = [];
    const fetch = async () => mockJson({ favorite_count: 1, conversation_count: 0 });
    await syncEngagement({
      store, fetch,
      onProgress: (p) => events.push(p)
    });
    // 2 件処理 → done=0 (item a 直前), done=1 (item b 直前), done=2 (final)
    assert.ok(events.length >= 2, `events count: ${events.length}`);
    assert.equal(events[0].total, 2);
    assert.equal(events[events.length - 1].done, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syncEngagement: unparseable URL → skip', async () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('a', { status: 'parsed', platform: 'x', url: 'https://example.com/foo' });
    const fetch = async () => { throw new Error('should not be called'); };
    const r = await syncEngagement({ store, fetch });
    assert.equal(r.skipCount, 1);
    assert.equal(r.okCount, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- スコープ選択 ---

test('syncEngagement: filter.ids whitelists targets (current-filter scope)', async () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('keep', { status: 'parsed', platform: 'x', url: 'https://x.com/u/status/1' });
    store.upsert('drop', { status: 'parsed', platform: 'x', url: 'https://x.com/u/status/2' });
    let calls = 0;
    const fetch = async () => { calls++; return mockJson({ favorite_count: 1, conversation_count: 0 }); };
    const r = await syncEngagement({ store, fetch, filter: { ids: ['keep'] } });
    assert.equal(r.targetCount, 1);
    assert.equal(calls, 1);
    assert.equal(store.get('keep').status, 'synced');
    assert.equal(store.get('drop').status, 'parsed'); // 手付かず
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syncEngagement: filter.staleDays targets only old / never-fetched records', async () => {
  const { dir, store } = mkstore();
  try {
    const nowMs = 1_000_000_000_000;
    const DAY = 86400000;
    // 10 日前に取得済み (stale) / 1 日前に取得済み (fresh) / 未取得 (parsed)
    store.upsert('stale', { status: 'synced', platform: 'x', url: 'https://x.com/u/status/1', engagementSyncedAt: nowMs - 10 * DAY });
    store.upsert('fresh', { status: 'synced', platform: 'x', url: 'https://x.com/u/status/2', engagementSyncedAt: nowMs - 1 * DAY });
    store.upsert('never', { status: 'parsed', platform: 'x', url: 'https://x.com/u/status/3' });
    const fetched = [];
    const fetch = async (url) => { fetched.push(url); return mockJson({ favorite_count: 1, conversation_count: 0 }); };
    const r = await syncEngagement({ store, fetch, filter: { staleDays: 7 }, now: () => nowMs });
    // stale (10d > 7d) と never (未取得) が対象、fresh (1d) は除外
    assert.equal(r.targetCount, 2);
    assert.equal(fetched.length, 2);
    assert.ok(fetched.some((u) => u.includes('id=1')) && fetched.some((u) => u.includes('id=3')));
    assert.ok(!fetched.some((u) => u.includes('id=2')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- バックフィル (no-annotation 取り込み) ---

test('syncEngagement: backfill processes no-annotation items when statuses includes it', async () => {
  const { dir, store } = mkstore();
  try {
    // annotation 無しだが SNS の post URL は持つ (Eagle for Chrome の素ドラッグ等)
    store.upsert('n', { status: 'no-annotation', url: 'https://x.com/foo/status/1' });
    store.upsert('p', { status: 'parsed', platform: 'x', url: 'https://x.com/foo/status/2' });
    let calls = 0;
    const fetch = async () => { calls++; return mockJson({ favorite_count: 9, conversation_count: 1 }); };
    const r = await syncEngagement({ store, fetch, filter: { statuses: ['no-annotation'] } });
    // no-annotation のみ対象、parsed は対象外
    assert.equal(r.targetCount, 1);
    assert.equal(calls, 1);
    const rec = store.get('n');
    assert.equal(rec.status, 'synced');
    assert.equal(rec.likes, 9);
    assert.equal(rec.platform, 'x'); // URL 由来で platform が埋まる
    assert.equal(store.get('p').status, 'parsed'); // 手付かず
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syncEngagement: no-annotation is excluded by default', async () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('n', { status: 'no-annotation', url: 'https://x.com/foo/status/1' });
    const fetch = async () => { throw new Error('should not be called'); };
    const r = await syncEngagement({ store, fetch });
    assert.equal(r.targetCount, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- 429 / 確認 ---

test('syncEngagement: 429 stops the run, item left unprocessed, rateLimited=true', async () => {
  const { dir, store } = mkstore();
  try {
    for (let i = 0; i < 4; i++) {
      store.upsert(`x${i}`, { status: 'parsed', platform: 'x', url: `https://x.com/u/status/${i}` });
    }
    let calls = 0;
    const fetch = async () => {
      calls++;
      if (calls === 2) return mockJson(null, 429); // 2 件目で 429
      return mockJson({ favorite_count: 1, conversation_count: 0 });
    };
    const r = await syncEngagement({ store, fetch });
    assert.equal(r.rateLimited, true);
    assert.ok(r.okCount >= 1 && r.okCount < 4, `okCount: ${r.okCount}`);
    assert.equal(r.errCount, 0); // 429 は error 印を付けない
    // 429 を踏んだ item と未処理 item は parsed のまま (error 化しない)
    const stillParsed = ['x0', 'x1', 'x2', 'x3'].filter((id) => store.get(id).status === 'parsed');
    assert.ok(stillParsed.length >= 1, `still parsed: ${stillParsed}`);
    // 取り残しが resume に記録される
    assert.ok(store.data.engagementResume.ids.length >= 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syncEngagement: onConfirm=false skips fetching entirely', async () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('a', { status: 'parsed', platform: 'x', url: 'https://x.com/u/status/1' });
    let calls = 0;
    const fetch = async () => { calls++; return mockJson({ favorite_count: 1, conversation_count: 0 }); };
    const r = await syncEngagement({ store, fetch, onConfirm: async () => false });
    assert.equal(calls, 0);
    assert.equal(r.okCount, 0);
    assert.equal(r.cancelled, true);
    assert.equal(store.get('a').status, 'parsed'); // 手付かず
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syncEngagement: onConfirm receives per-platform counts', async () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('x1', { status: 'parsed', platform: 'x', url: 'https://x.com/u/status/1' });
    store.upsert('x2', { status: 'parsed', platform: 'x', url: 'https://x.com/u/status/2' });
    store.upsert('p1', { status: 'parsed', platform: 'pixiv', url: 'https://www.pixiv.net/artworks/1' });
    let seen = null;
    const fetch = async (url) => url.includes('pixiv')
      ? mockJson({ error: false, body: { likeCount: 1 } })
      : mockJson({ favorite_count: 1, conversation_count: 0 });
    await syncEngagement({ store, fetch, onConfirm: async (counts) => { seen = counts; return true; } });
    assert.equal(seen.x, 2);
    assert.equal(seen.pixiv, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- 日次上限 ---

test('syncEngagement: dailyLimit caps requests per day and carries the rest over', async () => {
  const { dir, store } = mkstore();
  try {
    for (let i = 0; i < 3; i++) {
      store.upsert(`x${i}`, { status: 'no-annotation', platform: 'x', url: `https://x.com/u/status/${i}` });
    }
    const DAY = new Date('2026-06-04T00:00:00Z').getTime();
    let calls = 0;
    const fetch = async () => { calls++; return mockJson({ favorite_count: 1, conversation_count: 0 }); };

    const NO_ANNO = { statuses: ['no-annotation'] };

    // 1 回目: 上限 2 → 2 件だけ取得、1 件繰り越し
    const r1 = await syncEngagement({ store, fetch, filter: NO_ANNO, dailyLimit: { x: 2 }, now: () => DAY });
    assert.equal(calls, 2);
    assert.equal(r1.dailyLimited, true);
    assert.equal(store.data.dailyFetch.counts.x, 2);
    const left = ['x0', 'x1', 'x2'].filter((id) => store.get(id).status === 'no-annotation');
    assert.equal(left.length, 1);

    // 同日 2 回目: 残量 0 → 取得 0
    const r2 = await syncEngagement({ store, fetch, filter: NO_ANNO, dailyLimit: { x: 2 }, now: () => DAY });
    assert.equal(calls, 2); // 増えない
    assert.equal(r2.dailyLimited, true);

    // 翌日: カウントがリセットされ残り 1 件を取得 (日付文字列は端末 TZ 依存なので件数で確認)
    const dayBefore = store.data.dailyFetch.date;
    const NEXT = DAY + 86400000;
    const r3 = await syncEngagement({ store, fetch, filter: NO_ANNO, dailyLimit: { x: 2 }, now: () => NEXT });
    assert.equal(calls, 3);
    assert.notEqual(store.data.dailyFetch.date, dayBefore); // 日付が進んだ
    assert.equal(store.data.dailyFetch.counts.x, 1);        // カウントがリセットされた
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- レート制限 ---

test('syncEngagement: minIntervalMs spaces out request starts (X)', async () => {
  const { dir, store } = mkstore();
  try {
    for (let i = 0; i < 3; i++) {
      store.upsert(`x${i}`, { status: 'parsed', platform: 'x', url: `https://x.com/u/status/${i}` });
    }
    // フェイククロック: sleep が時計を進める。実時間ゼロで間隔を検証できる。
    let clock = 0;
    const sleeps = [];
    const sleep = (ms) => { sleeps.push(ms); clock += ms; return Promise.resolve(); };
    const now = () => clock;
    const fetch = async () => mockJson({ favorite_count: 1, conversation_count: 0 });

    const r = await syncEngagement({
      store, fetch, sleep, now,
      rateLimit: { x: { concurrency: 1, minIntervalMs: 1500 } }
    });

    assert.equal(r.okCount, 3);
    // 3 リクエスト → 1 件目は即時、2/3 件目の前に 1500ms ずつ待つ
    assert.equal(sleeps.length, 2);
    assert.ok(sleeps.every((ms) => ms === 1500), `sleeps: ${sleeps}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syncEngagement: concurrency caps simultaneous in-flight requests', async () => {
  const { dir, store } = mkstore();
  try {
    for (let i = 0; i < 5; i++) {
      store.upsert(`b${i}`, {
        status: 'parsed', platform: 'bluesky',
        url: `https://bsky.app/profile/u.bsky.social/post/${i}`
      });
    }
    let inFlight = 0, maxInFlight = 0;
    const fetch = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5)); // 重ねるための実遅延
      inFlight--;
      return mockJson({ thread: { post: { likeCount: 1 } } });
    };

    const r = await syncEngagement({
      store, fetch,
      rateLimit: { bluesky: { concurrency: 4, minIntervalMs: 0 } }
    });

    assert.equal(r.okCount, 5);
    assert.equal(maxInFlight, 4, `maxInFlight: ${maxInFlight}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syncEngagement: different platforms run concurrently', async () => {
  const { dir, store } = mkstore();
  try {
    // X は 1 並列に絞っても、別 platform (pixiv) は同時に走り出せる
    store.upsert('x0', { status: 'parsed', platform: 'x', url: 'https://x.com/u/status/0' });
    store.upsert('p0', { status: 'parsed', platform: 'pixiv', url: 'https://www.pixiv.net/artworks/0' });
    let inFlight = 0, maxInFlight = 0;
    const fetch = async (url) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return url.includes('pixiv')
        ? mockJson({ error: false, body: { likeCount: 1 } })
        : mockJson({ favorite_count: 1, conversation_count: 0 });
    };

    const r = await syncEngagement({
      store, fetch,
      rateLimit: { x: { concurrency: 1, minIntervalMs: 1500 }, pixiv: { concurrency: 4, minIntervalMs: 0 } }
    });

    assert.equal(r.okCount, 2);
    assert.equal(maxInFlight, 2, `maxInFlight: ${maxInFlight}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- resume ---

test('syncEngagement: cancel records remaining ids, resume finishes them', async () => {
  const { dir, store } = mkstore();
  try {
    for (let i = 0; i < 5; i++) {
      store.upsert(`a${i}`, { status: 'parsed', platform: 'x', url: `https://x.com/u/status/${i}` });
    }
    const ac = new AbortController();
    let calls = 0;
    const fetch1 = async () => {
      calls++;
      if (calls === 2) ac.abort();
      return mockJson({ favorite_count: 1, conversation_count: 0 });
    };
    const r1 = await syncEngagement({ store, fetch: fetch1, signal: ac.signal });
    assert.equal(r1.cancelled, true);
    // 取り残しが result と store の両方に記録される
    assert.ok(r1.remainingIds.length > 0 && r1.remainingIds.length < 5, `remaining: ${r1.remainingIds}`);
    assert.deepEqual(store.data.engagementResume.ids, r1.remainingIds);

    // 再開: 記録された ids だけを対象に処理 → 完走で resume 状態が消える
    const resumeIds = store.data.engagementResume.ids;
    let calls2 = 0;
    const fetch2 = async () => { calls2++; return mockJson({ favorite_count: 7, conversation_count: 0 }); };
    const r2 = await syncEngagement({ store, fetch: fetch2, filter: { ids: resumeIds } });
    assert.equal(r2.targetCount, resumeIds.length);
    assert.equal(calls2, resumeIds.length);
    assert.equal(r2.remainingIds.length, 0);
    assert.equal(store.data.engagementResume, undefined);
    // 全 5 件が最終的に synced
    for (let i = 0; i < 5; i++) assert.equal(store.get(`a${i}`).status, 'synced');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syncEngagement: full completion leaves no resume state', async () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('a', { status: 'parsed', platform: 'x', url: 'https://x.com/u/status/1' });
    const fetch = async () => mockJson({ favorite_count: 1, conversation_count: 0 });
    const r = await syncEngagement({ store, fetch });
    assert.equal(r.remainingIds.length, 0);
    assert.equal(store.data.engagementResume, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

let pass = 0, fail = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`  PASS  ${t.name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${t.name}`);
    console.log(`        ${e.message}`);
    fail++;
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
