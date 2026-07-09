'use strict';

// cooc.js（window.corpusCooc）のロジック単体テスト。cooc.js は CommonJS でも export
// するので直接 require し、charCandidatesFor（強＝作品→キャラ）・worksCooccurringWith
// （同名キャラ検知の履歴照会）・relatedTagCandidates（弱＝全タグ共起の関連提案）を
// スタブ deps 注入で直接検証する。
//
//   node scripts/test-cooc-unit.cts

const path = require('node:path');

const C = require(path.join(__dirname, '..', 'app', 'renderer', 'cooc.ts'));

let failed = 0;
function assert(name, cond) {
  if (cond) {
    console.log('ok  ', name);
  } else {
    console.log('FAIL', name);
    failed++;
  }
}

// --- スタブ環境: 共起パターンを作り込んだ投稿8件 ---
// 風景↔夜=3件 / 風景↔作品A=3件 / 風景↔キャラX=2件（閾値3未満） / 作品B は1件のみ
const KIND = { 作品A: 'work', 作品B: 'work', キャラX: 'character', キャラY: 'character' };
const posts = [
  { captureId: 'c1', tags: ['作品A', 'キャラX', '風景'] },
  { captureId: 'c2', tags: ['作品A', 'キャラX', '風景'] },
  { captureId: 'c3', tags: ['作品A', 'キャラY', '風景'] },
  { captureId: 'c4', tags: ['作品B', 'キャラY'] },
  { captureId: 'c5', tags: ['風景', '夜'] },
  { captureId: 'c6', tags: ['風景', '夜'] },
  { captureId: 'c7', tags: ['風景', '夜'] },
  { captureId: 'c8', tags: null }, // 欠損 tags は無視される
];

const { charCandidatesFor, worksCooccurringWith, relatedTagCandidates } = C.makeCooc({
  allPosts: () => posts,
  tagKindOf: (t) => KIND[t] || null,
});

// --- charCandidatesFor（強ティア＝作品→キャラ・頻度降順） ---
{
  const c = charCandidatesFor(['作品A']);
  assert('charCandidates 作品A→キャラX(2)・キャラY(1) 降順', c.length === 2 && c[0][0] === 'キャラX' && c[0][1] === 2 && c[1][0] === 'キャラY' && c[1][1] === 1);
  const b = charCandidatesFor(['作品B']);
  assert('charCandidates 作品B→キャラY のみ', b.length === 1 && b[0][0] === 'キャラY');
  assert('charCandidates 空入力→[]', charCandidatesFor([]).length === 0 && charCandidatesFor(null).length === 0);
}

// --- worksCooccurringWith（同名キャラ検知の履歴照会） ---
{
  const w = worksCooccurringWith('キャラY', null);
  assert('worksCooc キャラY→作品A+作品B', w.size === 2 && w.has('作品A') && w.has('作品B'));
  const wx = worksCooccurringWith('キャラY', new Set(['c4']));
  assert('worksCooc excludeIds で c4 除外→作品A のみ', wx.size === 1 && wx.has('作品A'));
  assert('worksCooc 未知タグ→空', worksCooccurringWith('存在しない', null).size === 0);
}

// --- relatedTagCandidates（弱ティア＝全タグ共起） ---
{
  const r = relatedTagCandidates(['風景'], {});
  // 夜=3・作品A=3 は閾値(既定3)を満たす。キャラX=2・キャラY=1 は「薄い」ので沈黙。
  const tags = r.map((x) => x.tag);
  assert('related 既定閾値3: 夜・作品A のみ（キャラX=2 は沈黙）', r.length === 2 && tags.includes('夜') && tags.includes('作品A') && !tags.includes('キャラX'));
  assert(
    'related 根拠の帰属: withTag=風景・count=3',
    r.every((x) => x.withTag === '風景' && x.count === 3),
  );
  assert('related 選択中タグ自身は提案しない', !tags.includes('風景'));

  const r2 = relatedTagCandidates(['風景'], { minCount: 2 });
  assert(
    'related minCount=2 でキャラX(2) が浮上',
    r2.some((x) => x.tag === 'キャラX' && x.count === 2),
  );

  // count はペア最大値であって合算ではない（風景と3件・夜と0件→3のまま）
  const r3 = relatedTagCandidates(['風景', '夜'], { minCount: 1 });
  const workA = r3.find((x) => x.tag === '作品A');
  assert('related count は最強ペアの値（合算しない）', workA && workA.count === 3 && workA.withTag === '風景');

  const r4 = relatedTagCandidates(['風景'], { exclude: new Set(['夜']) });
  assert('related exclude 指定タグは提案しない', !r4.some((x) => x.tag === '夜') && r4.some((x) => x.tag === '作品A'));

  const r5 = relatedTagCandidates(['風景'], { minCount: 1, limit: 1 });
  assert('related limit で件数上限', r5.length === 1 && r5[0].count === 3);

  assert('related 空選択→[]', relatedTagCandidates([], {}).length === 0 && relatedTagCandidates(null, {}).length === 0);
}

if (failed) {
  console.error(`FAIL test-cooc-unit: ${failed} assertion(s) red`);
  process.exit(1);
}
console.log('PASS test-cooc-unit: charCandidatesFor / worksCooccurringWith / relatedTagCandidates all green');
