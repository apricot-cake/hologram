// node shared/annotation-builder.test.mjs
import assert from 'node:assert/strict';
import { buildAnnotation, platformLabel } from './annotation-builder.js';
import { parseAnnotation } from './annotation-parser.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('platformLabel: 正規化', () => {
  assert.equal(platformLabel('x'), 'X (Twitter)');
  assert.equal(platformLabel('bluesky'), 'Bluesky');
  assert.equal(platformLabel('pixiv'), 'Pixiv');
  assert.equal(platformLabel('unknown'), 'unknown');
});

test('X: build → parse round-trip', () => {
  const ann = buildAnnotation({
    platform: 'x', displayName: 'たっぷり鈍器', author: 'ihana_k',
    text: '投稿本文', hashtags: ['foo', 'bar']
  });
  const p = parseAnnotation(ann);
  assert.equal(p.platform, 'x');
  assert.equal(p.platformLabel, 'X (Twitter)');
  assert.equal(p.displayName, 'たっぷり鈍器');
  assert.equal(p.author, 'ihana_k');         // @ は parser が剥がす
  assert.deepEqual(p.hashtags, ['foo', 'bar']);
  assert.equal(p.text, '投稿本文');
  assert.equal(p.title, null);
  assert.equal(p.alt, null);
  assert.equal(p.image, null);
});

test('pixiv: title を使い alt は出ない', () => {
  const ann = buildAnnotation({
    platform: 'pixiv', displayName: '赤倉', author: '882569',
    title: 'チュッパチャプス', text: 'これは無視されるべき', hashtags: ['オリジナル']
  });
  const p = parseAnnotation(ann);
  assert.equal(p.platform, 'pixiv');
  assert.equal(p.author, '882569');
  assert.equal(p.title, 'チュッパチャプス'); // title 優先
  assert.equal(p.text, null);                // text 行は出ない
  assert.equal(p.alt, null);
});

test('hashtags: # あり / なし どちらも同じ出力に正規化', () => {
  const a = buildAnnotation({ platform: 'x', author: 'u', hashtags: ['foo', 'bar'] });
  const b = buildAnnotation({ platform: 'x', author: 'u', hashtags: ['#foo', '#bar'] });
  assert.equal(a, b);
  assert.ok(a.includes('Hashtags: #foo #bar'));
});

test('alt: X/Bluesky で出る。デフォルト代替文言 (画像/Image) は落とす', () => {
  assert.ok(buildAnnotation({ platform: 'x', author: 'u', alt: '猫の写真' }).includes('Alt: 猫の写真'));
  assert.ok(!/Alt:/.test(buildAnnotation({ platform: 'x', author: 'u', alt: '画像' }) || ''));
  assert.ok(!/Alt:/.test(buildAnnotation({ platform: 'x', author: 'u', alt: 'Image' }) || ''));
});

test('Image 行: 与えれば出る (ドラッグ経路用)', () => {
  const ann = buildAnnotation({ platform: 'x', author: 'u', image: '2/4', text: 't' });
  assert.equal(parseAnnotation(ann).image, '2/4');
});

test('truncate: text は 200 字で省略記号', () => {
  const long = 'あ'.repeat(300);
  const ann = buildAnnotation({ platform: 'x', author: 'u', text: long });
  const p = parseAnnotation(ann);
  assert.equal(p.text.length, 200);
  assert.ok(p.text.endsWith('…'));
});

test('改行は空白に潰す (parser の行分割を壊さない)', () => {
  const ann = buildAnnotation({ platform: 'x', author: 'u', text: '1行目\n2行目' });
  const p = parseAnnotation(ann);
  assert.equal(p.text, '1行目 2行目');
});

test('全フィールド空 → null', () => {
  assert.equal(buildAnnotation({}), null);
  assert.equal(buildAnnotation({ hashtags: [] }), null);
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
