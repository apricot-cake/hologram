'use strict';

// search.ts のロジック単体テスト。search.ts は real ES module（named exports）
// なので動的 import() で読み込む。正規化(B)・サブシーケンス(A)・近似部分一致=
// 編集距離(C) を直接検証する。
//
//   node scripts/test-search-unit.cts

const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const S = await import(pathToFileURL(path.join(__dirname, '..', 'app', 'src', 'renderer', 'src', 'services', 'search.ts')).href);

  let failed = 0;
  function assert(name, cond) {
    if (cond) {
      console.log('ok  ', name);
    } else {
      console.log('FAIL', name);
      failed++;
    }
  }

  // --- B: 表記ゆれ正規化 ---
  assert('normalize: カタカナ→ひらがな', S.normalize('ネコ') === 'ねこ');
  assert('normalize: 全角英数→半角+小文字', S.normalize('ＡB１２') === 'ab12');
  assert('normalize: 半角カナ→ひらがな', S.normalize('ﾈｺ') === 'ねこ');

  // --- B: 濁点・半濁点の同一視（#96）---
  assert('normalize: 濁点を落とす', S.normalize('バッグ') === 'はっく');
  assert('normalize: 半濁点を落とす', S.normalize('パン') === 'はん');
  assert('normalize: 半角カナ＋半角濁点も落とす', S.normalize('ﾊﾞｯｸﾞ') === 'はっく');
  assert('normalize: ヴ→う', S.normalize('ヴ') === 'う');
  // ラテン系の分音記号は落とさない（NFC へ戻す＝合成形のまま・語長も従来どおり）。
  assert('normalize: é は分解したままにしない', S.normalize('café') === 'café');
  assert('normalize: é の語長は1文字のまま', S.normalize('é').length === 1);

  const mDaku = S.compile('ハック');
  assert('B: "ハック" が "バッグ" に一致（濁点同一視）', mDaku('バッグ') === true);
  assert('B: 濁点同一視でも無関係語には不一致', mDaku('いぬのおさんぽ') === false);

  // --- B 経由のマッチ（ひらがなクエリ↔カタカナ本文）---
  const mKana = S.compile('ねこ');
  assert('B: "ねこ" が "ネコかわいい" に一致', mKana('ネコかわいい') === true);
  assert('B: "ねこ" は "いぬのおさんぽ" に不一致', mKana('いぬのおさんぽ') === false);

  // --- A: サブシーケンス（順序一致・飛び石OK）---
  const mSub = S.compile('ねこわ');
  assert('A: "ねこわ" が "ねこかわいい" に一致(飛び石)', mSub('ねこかわいい') === true);

  // --- C: 編集距離（置換タイプミス）---
  const mTypo = S.compile('こんにとは'); // 「こんにちは」の ち→と 置換ミス
  assert('C: 置換ミス "こんにとは" が "こんにちは世界" に一致', mTypo('こんにちは世界') === true);
  assert('C: 無関係文には不一致', mTypo('いぬのおさんぽ') === false);

  // --- C: 短語(<=2)は編集距離0（誤爆防止）---
  const mShort = S.compile('ねこ');
  assert('C: 短語は厳密（"ねこ" は "ねね" に不一致）', mShort('ねね') === false);

  // --- AND 結合 + 全角スペース ---
  const mAnd = S.compile('ねこ　かわ'); // 全角スペース区切り
  assert('AND: 両語一致で true', mAnd('ねことかわいい') === true);
  assert('AND: 片方欠落で false', mAnd('ねこだけ') === false);

  // --- 空クエリは常に true ---
  assert('空クエリは常に一致', S.compile('   ')('なんでも') === true);

  if (failed) {
    console.log(`SEARCH_UNIT_FAIL (${failed})`);
    process.exit(1);
  }
  console.log('SEARCH_UNIT_PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
