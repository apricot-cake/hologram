'use strict';

// Pure unit test for tags.js (window.corpusTags) — the 8th viewer.js
// extraction slice. tags.js dual-exports via CommonJS, so require it directly
// and drive tagKindOf/kindLabel (custom-label fallback), posterTagsOf/
// posterFilterVocab (kind-ranked ordering), groupedTagVocab (kind sections,
// post vs poster general pools, query filtering), inspectorTagPickerData
// (vocab shape, source hashtags, cooc suggestion tiers) and sameTags with
// stub deps.
//
//   node scripts/test-tags-unit.js

const path = require('node:path');

const T = require(path.join(__dirname, '..', 'app', 'renderer', 'tags.js'));

let failed = 0;
function assert(name, cond) {
  if (cond) {
    console.log('ok  ', name);
  } else {
    console.log('FAIL', name);
    failed++;
  }
}

// --- Stub environment ---------------------------------------------------
let tagTypes = { WorkA: 'work', WorkB: 'work', CharX: 'character' };
let tagLabels = {};
let tagGroups = [
  { id: 'g1', name: '構図', tags: ['俯瞰', 'あおり', 'CharX'] }, // CharX is kinded → pulled out of its group
  { id: 'g2', name: '空グループ', tags: [] },
];
const posterTags = {
  'x:1': ['WorkA', '資料'],
  'x:2': ['CharX', 'あんず'],
  'x:3': 'not-an-array', // malformed entry — must not throw
};
let allPosts = [
  { captureId: 'p1', tags: ['俯瞰', '自由帳'] }, // 自由帳 = ungrouped general
  { captureId: 'p2', tags: ['WorkA'] }, // kinded → NOT in the ungrouped pool
  { captureId: 'p3' }, // no tags — must not throw
];
const MSG = {
  kindWork: '作品',
  kindCharacter: 'キャラ',
  tagGroupOther: '未分類',
  editCoocChars: 'このキャラたち',
  editCoocCharsOf: (w) => `${w} のキャラ`,
  editCoocWhy: (who, n) => `${who} と ${n} 回共起`,
  editCoocRelated: 'よく一緒に付くタグ',
};
let coocCalls = [];
let charCands = [];
let relatedCands = [];
const api = T.makeTags({
  tagTypes: () => tagTypes,
  tagLabels: () => tagLabels,
  tagGroups: () => tagGroups,
  posterTags: () => posterTags,
  allPosts: () => allPosts,
  MSG,
  charCandidatesFor: (w) => {
    coocCalls.push(['char', w]);
    return charCands;
  },
  relatedTagCandidates: (sel, opts) => {
    coocCalls.push(['related', sel, opts]);
    return relatedCands;
  },
});

// --- tagKindOf / kindLabel ------------------------------------------------
assert('tagKindOf: kinded tag', api.tagKindOf('WorkA') === 'work');
assert('tagKindOf: general tag → null', api.tagKindOf('俯瞰') === null);
assert('kindLabel: built-in fallback', api.kindLabel('work') === '作品');
tagLabels = { work: 'シリーズ' };
assert('kindLabel: custom label wins (live getter)', api.kindLabel('work') === 'シリーズ');
assert('kindLabel: other kind keeps built-in', api.kindLabel('character') === 'キャラ');
assert('kindLabel: unknown kind → empty', api.kindLabel('nope') === '');
tagLabels = {};

// --- posterTagsOf / posterFilterVocab --------------------------------------
assert('posterTagsOf: array passthrough', api.posterTagsOf('x:1').join(',') === 'WorkA,資料');
assert('posterTagsOf: malformed → []', api.posterTagsOf('x:3').length === 0);
assert('posterTagsOf: missing key → []', api.posterTagsOf('zzz').length === 0);
{
  const v = api.posterFilterVocab();
  // Rank: work (WorkA) → character (CharX) → general (あんず/資料 ja-collated)
  assert('posterFilterVocab: kind-ranked order', v.join(',') === ['WorkA', 'CharX', ...['あんず', '資料'].sort((a, b) => a.localeCompare(b, 'ja'))].join(','));
}

// --- groupedTagVocab (post scope) ------------------------------------------
{
  const out = api.groupedTagVocab('');
  const names = out.map((g) => g.name);
  assert('vocab: kind sections first, then groups, then 未分類', names.join('|') === '作品|キャラ|構図|未分類');
  assert('vocab: work section lists all kinded works', out[0].tags.join(',') === ['WorkA', 'WorkB'].sort((a, b) => a.localeCompare(b, 'ja')).join(','));
  assert('vocab: kinded tag pulled out of its freeform group', !out[2].tags.includes('CharX') && out[2].tags.length === 2);
  assert('vocab: empty group omitted', !names.includes('空グループ'));
  assert('vocab: ungrouped pool = applied general tags only', out[3].tags.join(',') === '自由帳');
}
{
  const out = api.groupedTagVocab('work');
  assert('vocab: query filters case-insensitively', out.length === 1 && out[0].name === '作品' && out[0].tags.join(',') === 'WorkA,WorkB');
}
{
  tagLabels = { work: 'シリーズ' };
  const out = api.groupedTagVocab('');
  assert('vocab: kind section header uses custom label', out[0].name === 'シリーズ');
  tagLabels = {};
}

// --- groupedTagVocab (poster scope) -----------------------------------------
{
  const out = api.groupedTagVocab('', { scope: 'poster' });
  const names = out.map((g) => g.name);
  assert('poster vocab: kind sections shared', names[0] === '作品' && names[1] === 'キャラ');
  const general = out[names.indexOf('未分類')];
  // General pool comes from posterTags (資料/あんず), NOT the post groups/pool.
  assert('poster vocab: separate general pool from posterTags', general && general.tags.join(',') === ['あんず', '資料'].sort((a, b) => a.localeCompare(b, 'ja')).join(','));
  assert('poster vocab: no freeform post groups', !names.includes('構図'));
}

// --- inspectorTagPickerData --------------------------------------------------
{
  coocCalls = [];
  charCands = [
    ['CharX', 5],
    ['CharY', 3],
  ];
  relatedCands = [{ tag: '資料', withTag: 'WorkA', count: 4 }];
  const d = api.inspectorTagPickerData(['WorkA', 'CharX'], [{ hashtags: ['ht1', 'ht1', 'ht2'] }, { hashtags: 'bad' }], 'post');
  assert(
    'picker: vocabGroups mirror groupedTagVocab with kind on items',
    d.vocabGroups[0].items.every((it) => it.kind === 'work'),
  );
  assert('picker: source hashtags deduped', d.srcTagsForPicker.map((s) => s.tag).join(',') === 'ht1,ht2');
  assert('picker: tier1 present, selected char excluded', d.coocGroups[0].items.map((i) => i.tag).join(',') === 'CharY');
  assert('picker: tier1 single-work header via editCoocCharsOf', d.coocGroups[0].name === 'WorkA のキャラ');
  assert('picker: tier1 title carries the why', d.coocGroups[0].items[0].title === 'WorkA と 3 回共起');
  assert('picker: tier2 present for post scope', d.coocGroups[1] && d.coocGroups[1].name === 'よく一緒に付くタグ');
  const relCall = coocCalls.find((c) => c[0] === 'related');
  assert('picker: tier2 dedupes against tier1 via exclude set', relCall && relCall[2].exclude.has('CharY'));
}
{
  coocCalls = [];
  charCands = [];
  relatedCands = [{ tag: 'x', withTag: 'y', count: 2 }];
  const d = api.inspectorTagPickerData(['WorkA'], [], 'poster');
  assert('picker: poster scope skips tier2', d.coocGroups.length === 0 && !coocCalls.some((c) => c[0] === 'related'));
}
{
  charCands = [
    ['c1', 9],
    ['c2', 8],
    ['c3', 7],
    ['c4', 6],
    ['c5', 5],
    ['c6', 4],
    ['c7', 3],
    ['c8', 2],
    ['c9', 1],
  ];
  relatedCands = [];
  const d = api.inspectorTagPickerData(['WorkA', 'WorkB'], [], 'post');
  assert('picker: tier1 capped at 8', d.coocGroups[0].items.length === 8);
  assert('picker: multi-work header via editCoocChars', d.coocGroups[0].name === 'このキャラたち');
  assert('picker: multi-work why joins with ・', d.coocGroups[0].items[0].title === 'WorkA・WorkB と 9 回共起');
}
{
  const d = api.inspectorTagPickerData(null, null, undefined);
  assert('picker: null-safe args', d.vocabGroups.length > 0 && d.srcTagsForPicker.length === 0 && d.coocGroups.length === 0);
}

// --- sameTags ----------------------------------------------------------------
assert('sameTags: order-insensitive equal', T.sameTags(['a', 'b'], ['b', 'a']));
assert('sameTags: length mismatch', !T.sameTags(['a'], ['a', 'b']));
assert('sameTags: different members', !T.sameTags(['a', 'b'], ['a', 'c']));
assert('sameTags: both empty', T.sameTags([], []));

// --- live-getter behavior: store reassignment is picked up --------------------
allPosts = [{ captureId: 'q1', tags: ['新規タグ'] }];
tagGroups = [];
tagTypes = {};
{
  const out = api.groupedTagVocab('');
  assert('getters: wholesale reassignment visible', out.length === 1 && out[0].tags.join(',') === '新規タグ');
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll tags.js unit tests passed');
