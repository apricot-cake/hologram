// node extension/drag-matching.test.mjs
import assert from 'node:assert/strict';
import { urlMatches, findMatchingItem, selectMatches, MATCH_WINDOW_MS } from './drag-matching.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// Eagle item / pendingDrag のミニファクトリ (テストの意図を読みやすく)
const item = (id, url, modificationTime) => ({ id, url, modificationTime });
const drag = (imageUrls, link, timestamp) => ({
  imageUrls,
  pageUrl: link,
  metadata: { link, annotation: 'x' },
  timestamp
});

const T = 1_000_000; // 基準ドラッグ時刻
const POST = 'https://x.com/user/status/123';

// === urlMatches ===

test('urlMatches: 完全一致', () => {
  assert.equal(urlMatches(POST, POST), true);
});

test('urlMatches: パス境界の前方一致 (permalink ⊂ /photo/N、双方向)', () => {
  assert.equal(urlMatches(POST, POST + '/photo/2'), true);
  assert.equal(urlMatches(POST + '/photo/2', POST), true);
});

test('urlMatches: 境界でない部分一致は false (/status/12 ⊄ /status/123)', () => {
  assert.equal(urlMatches('https://x.com/user/status/12', POST), false);
});

test('urlMatches: ホスト違いは false (画像 CDN vs 投稿)', () => {
  assert.equal(urlMatches(POST, 'https://pbs.twimg.com/media/AAA.jpg'), false);
});

test('urlMatches: クエリ違いは無視 (pathname で比較)', () => {
  assert.equal(urlMatches(POST + '?s=20', POST), true);
});

test('urlMatches: null / 空文字は false', () => {
  assert.equal(urlMatches('', POST), false);
  assert.equal(urlMatches(POST, null), false);
  assert.equal(urlMatches(null, null), false);
});

// === findMatchingItem ===

test('findMatchingItem: pass1 画像固有 URL で一致', () => {
  const img = 'https://pbs.twimg.com/media/AAA.jpg';
  const entry = drag([img], POST, T);
  const items = [item('i', img, T + 1)];
  assert.equal(findMatchingItem(items, entry, new Set())?.id, 'i');
});

test('findMatchingItem: pass2 投稿 URL で一致 (画像 URL は item.url と不一致)', () => {
  const entry = drag(['https://pbs.twimg.com/media/AAA.jpg'], POST, T);
  const items = [item('i', POST, T + 1)];
  assert.equal(findMatchingItem(items, entry, new Set())?.id, 'i');
});

test('findMatchingItem: マッチ窓 (30s) より古い item は除外', () => {
  const entry = drag([], POST, T);
  const tooOld = [item('old', POST, T - MATCH_WINDOW_MS - 1)];
  assert.equal(findMatchingItem(tooOld, entry, new Set()), null);
  const fresh = [item('fresh', POST, T - MATCH_WINDOW_MS + 1)];
  assert.equal(findMatchingItem(fresh, entry, new Set())?.id, 'fresh');
});

test('findMatchingItem: consumed の item はスキップ', () => {
  const entry = drag([], POST, T);
  const items = [item('item1', POST, T + 1)];
  assert.equal(findMatchingItem(items, entry, new Set(['item1'])), null);
  assert.equal(findMatchingItem(items, entry, new Set())?.id, 'item1');
});

test('findMatchingItem: url を持たない item は無視', () => {
  const entry = drag([], POST, T);
  const items = [item('nourl', '', T + 1), item('ok', POST, T + 1)];
  assert.equal(findMatchingItem(items, entry, new Set())?.id, 'ok');
});

// === selectMatches (回帰の本丸) ===

test('selectMatches: 同一 X 投稿の N 枚が別 item に全て割り当たる (回帰: 旧実装は 1 枚のみ)', () => {
  // 2 枚を続けてドラッグ。content.js が permalink を正規化するので link は両方とも素の status URL。
  // 画像固有 URL (pbs.twimg.com) は Eagle item.url (= permalink) とは一致しない。
  const drags = [
    drag(['https://pbs.twimg.com/media/AAA.jpg?name=orig'], POST, T),
    drag(['https://pbs.twimg.com/media/BBB.jpg?name=orig'], POST, T)
  ];
  // Eagle が同じ permalink で 2 つの新規 item を作る。
  const items = [item('item1', POST, T + 500), item('item2', POST, T + 600)];

  const matches = selectMatches(items, drags);
  assert.equal(matches.length, 2);
  // 別々の item に割り当たっている (旧バグでは 1 枚だけ付いて item2 が取り残された)
  assert.deepEqual([...new Set(matches.map((m) => m.itemId))].sort(), ['item1', 'item2']);
  assert.notEqual(matches[0].itemId, matches[1].itemId);
});

test('selectMatches: 画像固有 URL (pass1) を優先して物理画像↔item を正しく対応付け', () => {
  // Eagle が画像固有 URL で保存したケース。ドラッグ順と item の document order を意図的にずらす。
  const imgA = 'https://pbs.twimg.com/media/AAA.jpg';
  const imgB = 'https://pbs.twimg.com/media/BBB.jpg';
  const drags = [
    drag([imgB], POST, T), // 先に B をドラッグ
    drag([imgA], POST, T)
  ];
  const items = [item('itemA', imgA, T + 500), item('itemB', imgB, T + 600)];

  const matches = selectMatches(items, drags);
  assert.equal(matches.length, 2);
  // document order (A,B) でなく、ドラッグした画像 (B,A) に対応する item へ割り当たる
  assert.equal(matches[0].itemId, 'itemB');
  assert.equal(matches[1].itemId, 'itemA');
});

test('selectMatches: item が足りなければ割り当たった分だけ返す (残りは次 tick)', () => {
  const drags = [drag([], POST, T), drag([], POST, T)];
  const items = [item('only', POST, T + 1)];
  const matches = selectMatches(items, drags);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].itemId, 'only');
});

test('selectMatches: マッチ無しなら空配列', () => {
  const drags = [drag([], POST, T)];
  const items = [item('other', 'https://x.com/user/status/999', T + 1)];
  assert.deepEqual(selectMatches(items, drags), []);
});

// cross-tick 回帰: 2 枚が別々の poll tick で処理され、1 枚目の注釈で url が素の permalink に
// 正規化された後でも、2 枚目が 1 枚目の item に再マッチせず自分の新規 item に付くこと。
// (claimed をシードしないと pass2 で item1 を再取得し item2 が取り残される = 実機 1/2 バグ)
test('selectMatches: claimed 済み item は次 tick で再マッチしない (cross-tick C7 回帰)', () => {
  const claimed = new Set();
  // tick1: pending1 が item1 にマッチ (item2 はまだ未作成)
  const d1 = drag(['https://pbs.twimg.com/media/AAA.jpg'], POST, T);
  const m1 = selectMatches([item('item1', POST, T + 10)], [d1], claimed);
  assert.equal(m1.length, 1);
  assert.equal(m1[0].itemId, 'item1');
  claimed.add('item1'); // background が更新成功時にやる

  // tick2: item1 は注釈済みで url が bare に正規化済み。pending2 と、ようやく作られた item2 がいる。
  const d2 = drag(['https://pbs.twimg.com/media/BBB.jpg'], POST, T + 10);
  const m2 = selectMatches(
    [item('item1', POST, T + 10), item('item2', POST + '/photo/2', T + 20)],
    [d2],
    claimed
  );
  assert.equal(m2.length, 1);
  assert.equal(m2[0].itemId, 'item2'); // item1 ではなく item2 に付く
});

test('selectMatches: 既に annotation が入っている item はマッチ対象外 (上書き防止 / SW 再起動の保険)', () => {
  const d = drag([], POST, T);
  const items = [
    { id: 'annotated', url: POST, modificationTime: T + 10, annotation: 'Platform: X (Twitter)' },
    { id: 'fresh', url: POST + '/photo/2', modificationTime: T + 10 }
  ];
  const m = selectMatches(items, [d]); // claimed 無しでも annotation 済みは弾く
  assert.equal(m.length, 1);
  assert.equal(m[0].itemId, 'fresh');
});

let pass = 0, fail = 0;
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
