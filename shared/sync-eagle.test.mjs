// node shared/sync-eagle.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { EngagementStore } from './engagement-store.js';
import { syncFromEagle } from './sync-eagle.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const mkstore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eagle-info-test-'));
  return { dir, store: new EngagementStore({ libraryPath: dir, fs, path }) };
};

const mockEagle = (allItems) => ({
  async getIdsWithModifiedAt() {
    return allItems.map(it => ({ id: it.id, modifiedAt: it.modifiedAt }));
  },
  async getByIds(ids) {
    const set = new Set(ids);
    return allItems.filter(it => set.has(it.id));
  }
});

test('first sync inserts all items as new', async () => {
  const { dir, store } = mkstore();
  try {
    const eagle = mockEagle([
      { id: 'a', modifiedAt: 100, url: 'https://x.com/foo/status/1', annotation: 'Platform: X (Twitter)\nAuthor: @foo\nText: hello' },
      { id: 'b', modifiedAt: 200, url: 'https://www.pixiv.net/artworks/42', annotation: 'Platform: Pixiv\nAuthor: @123\nTitle: art' }
    ]);
    const result = await syncFromEagle({ eagleItem: eagle, store });
    assert.equal(result.newCount, 2);
    assert.equal(result.changedCount, 0);
    assert.equal(result.deletedCount, 0);

    const a = store.get('a');
    assert.equal(a.platform, 'x');
    assert.equal(a.author, 'foo');
    assert.equal(a.text, 'hello');
    assert.equal(a.url, 'https://x.com/foo/status/1');
    assert.equal(a.status, 'parsed');

    const b = store.get('b');
    assert.equal(b.platform, 'pixiv');
    assert.equal(b.title, 'art');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('second sync detects changed item by modifiedAt', async () => {
  const { dir, store } = mkstore();
  try {
    const eagle1 = mockEagle([
      { id: 'a', modifiedAt: 100, url: 'u', annotation: 'Platform: X (Twitter)\nText: v1' }
    ]);
    await syncFromEagle({ eagleItem: eagle1, store });

    const eagle2 = mockEagle([
      { id: 'a', modifiedAt: 200, url: 'u', annotation: 'Platform: X (Twitter)\nText: v2' }
    ]);
    const result = await syncFromEagle({ eagleItem: eagle2, store });
    assert.equal(result.newCount, 0);
    assert.equal(result.changedCount, 1);
    assert.equal(store.get('a').text, 'v2');
    assert.equal(store.get('a').modifiedAt, 200);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('items missing from Eagle side are deleted', async () => {
  const { dir, store } = mkstore();
  try {
    const eagle1 = mockEagle([
      { id: 'a', modifiedAt: 100, annotation: 'Platform: X (Twitter)' },
      { id: 'b', modifiedAt: 100, annotation: 'Platform: Bluesky' }
    ]);
    await syncFromEagle({ eagleItem: eagle1, store });

    const eagle2 = mockEagle([
      { id: 'a', modifiedAt: 100, annotation: 'Platform: X (Twitter)' }
      // 'b' 消失
    ]);
    const result = await syncFromEagle({ eagleItem: eagle2, store });
    assert.equal(result.deletedCount, 1);
    assert.equal(store.get('b'), null);
    assert.ok(store.get('a'));  // 残存
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('items without Info+ annotation get status=no-annotation', async () => {
  const { dir, store } = mkstore();
  try {
    const eagle = mockEagle([
      { id: 'a', modifiedAt: 100, url: 'https://example.com/some-image.jpg', annotation: '' }
    ]);
    await syncFromEagle({ eagleItem: eagle, store });
    const a = store.get('a');
    assert.equal(a.status, 'no-annotation');
    assert.equal(a.platform, null);
    assert.equal(a.url, 'https://example.com/some-image.jpg');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy annotation fields are preserved on the record', async () => {
  const { dir, store } = mkstore();
  try {
    const eagle = mockEagle([{
      id: 'a',
      modifiedAt: 100,
      url: 'u',
      annotation: 'Platform: X (Twitter)\nAuthor: @foo\nUID: 12345\nPost ID: 99\nPublished: 2026-04-04T12:00:00Z\nText: legacy'
    }]);
    await syncFromEagle({ eagleItem: eagle, store });
    const a = store.get('a');
    assert.equal(a.legacyUid, '12345');
    assert.equal(a.legacyPostId, '99');
    assert.equal(a.legacyPublishedAt, '2026-04-04T12:00:00Z');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sync persists to disk (load after save returns same data)', async () => {
  const { dir, store } = mkstore();
  try {
    const eagle = mockEagle([
      { id: 'a', modifiedAt: 100, annotation: 'Platform: X (Twitter)\nAuthor: @foo' }
    ]);
    await syncFromEagle({ eagleItem: eagle, store });

    const store2 = new EngagementStore({ libraryPath: dir, fs, path });
    store2.load();
    assert.equal(store2.get('a').author, 'foo');
    assert.ok(typeof store2.data.lastSync === 'number');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('empty Eagle library results in zero counts', async () => {
  const { dir, store } = mkstore();
  try {
    const result = await syncFromEagle({ eagleItem: mockEagle([]), store });
    assert.equal(result.newCount, 0);
    assert.equal(result.changedCount, 0);
    assert.equal(result.deletedCount, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
