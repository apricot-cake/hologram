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
