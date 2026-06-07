// node shared/engagement-store.test.mjs で実行
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { EngagementStore } from './engagement-store.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const mkstore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eagle-info-test-'));
  return { dir, store: new EngagementStore({ libraryPath: dir, fs, path }) };
};

test('get returns null for missing key', () => {
  const { dir, store } = mkstore();
  try {
    assert.equal(store.get('foo'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('upsert + get roundtrip', () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('foo', { platform: 'x', likes: 10 });
    assert.equal(store.get('foo').platform, 'x');
    assert.equal(store.get('foo').likes, 10);
    assert.ok(typeof store.get('foo').lastSyncedAt === 'number');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('upsert merges with existing fields (partial update)', () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('foo', { platform: 'x', likes: 10, views: 100 });
    store.upsert('foo', { likes: 20 });
    const v = store.get('foo');
    assert.equal(v.platform, 'x');
    assert.equal(v.likes, 20);
    assert.equal(v.views, 100);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('save then load preserves data', () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('foo', { platform: 'x', likes: 10 });
    store.setLastSync(12345);
    store.save();

    const store2 = new EngagementStore({ libraryPath: dir, fs, path });
    const found = store2.load();
    assert.equal(found, true);
    assert.equal(store2.get('foo').platform, 'x');
    assert.equal(store2.data.lastSync, 12345);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('load returns false when file missing', () => {
  const { dir, store } = mkstore();
  try {
    assert.equal(store.load(), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('load discards corrupted JSON and starts empty', () => {
  const { dir, store } = mkstore();
  try {
    fs.mkdirSync(store.dir, { recursive: true });
    fs.writeFileSync(store.file, '{ broken json');
    assert.equal(store.load(), false);
    assert.deepEqual(store.data.items, {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('save uses atomic rename (writes through .tmp)', () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('foo', { platform: 'x' });
    store.save();
    assert.ok(fs.existsSync(store.file));
    assert.ok(!fs.existsSync(store.file + '.tmp'));  // tmp は rename で消える
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('delete removes entry', () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('foo', { platform: 'x' });
    store.delete('foo');
    assert.equal(store.get('foo'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('diff: classifies new / changed / deleted ids', () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('a', { modifiedAt: 100 });
    store.upsert('b', { modifiedAt: 200 });
    store.upsert('c', { modifiedAt: 300 });

    const result = store.diff([
      { id: 'a', modifiedAt: 100 },     // unchanged
      { id: 'b', modifiedAt: 999 },     // changed
      { id: 'd', modifiedAt: 400 }      // new
      // 'c' missing → deleted
    ]);

    assert.deepEqual(result.newIds, ['d']);
    assert.deepEqual(result.changedIds, ['b']);
    assert.deepEqual(result.deletedIds, ['c']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('query: filter by platform', () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('1', { platform: 'x', likes: 10 });
    store.upsert('2', { platform: 'pixiv', likes: 20 });
    store.upsert('3', { platform: 'x', likes: 30 });

    const result = store.query({ platform: 'x' });
    assert.equal(result.length, 2);
    assert.deepEqual(result.map(r => r.id).sort(), ['1', '3']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('query: filter + sort by likes desc', () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('1', { platform: 'x', likes: 100 });
    store.upsert('2', { platform: 'pixiv', likes: 500 });
    store.upsert('3', { platform: 'x', likes: 50 });

    const result = store.query({ platform: 'x' }, { field: 'likes', order: 'desc' });
    assert.equal(result.length, 2);
    assert.equal(result[0].id, '1');
    assert.equal(result[1].id, '3');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('query: likesPercentile sorts cross-platform by within-platform rank', () => {
  const { dir, store } = mkstore();
  try {
    // X 3 件 (likes 100/50/10), pixiv 2 件 (likes 5000/100), Bluesky 1 件 (likes 30)
    store.upsert('x-top', { platform: 'x', likes: 100 });
    store.upsert('x-mid', { platform: 'x', likes: 50 });
    store.upsert('x-bot', { platform: 'x', likes: 10 });
    store.upsert('p-top', { platform: 'pixiv', likes: 5000 });
    store.upsert('p-bot', { platform: 'pixiv', likes: 100 });
    store.upsert('b-only', { platform: 'bluesky', likes: 30 });

    const result = store.query({}, { field: 'likesPercentile', order: 'desc' });

    // 各 platform の top が percentile 1.0 で先頭の 3 件 (順序は platform 間で不定なので集合比較)
    const top3 = new Set(result.slice(0, 3).map(r => r.id));
    assert.deepEqual(top3, new Set(['x-top', 'p-top', 'b-only']));

    // 中位は X mid (X 内 percentile 0.5) と pixiv bot (pixiv 内 percentile 0.0) と...
    // n=3 で X bot は最下 (0.0)、n=2 で pixiv bot も最下 (0.0)、n=1 で b-only は top (1.0)
    // 順序確認: 上位 1.0, 1.0, 1.0, 中位 0.5 (x-mid), 下位 0.0 (x-bot, p-bot)
    assert.equal(result[3].id, 'x-mid');
    const last2 = new Set([result[4].id, result[5].id]);
    assert.deepEqual(last2, new Set(['x-bot', 'p-bot']));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('query: likesPercentile with single item returns it', () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('only', { platform: 'x', likes: 42 });
    const result = store.query({}, { field: 'likesPercentile' });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'only');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('query: missing numeric field treated as -Infinity in sort', () => {
  const { dir, store } = mkstore();
  try {
    store.upsert('1', { platform: 'x', likes: 100 });
    store.upsert('2', { platform: 'x' });  // likes 未設定

    const result = store.query({}, { field: 'likes', order: 'desc' });
    assert.equal(result[0].id, '1');
    assert.equal(result[1].id, '2');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('save creates plugin-data/ directory if missing', () => {
  const { dir, store } = mkstore();
  try {
    assert.ok(!fs.existsSync(store.dir));
    store.upsert('foo', { platform: 'x' });
    store.save();
    assert.ok(fs.existsSync(store.dir));
    assert.ok(fs.existsSync(store.file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

let pass = 0;
let fail = 0;
for (const t of tests) {
  try {
    t.fn();
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
