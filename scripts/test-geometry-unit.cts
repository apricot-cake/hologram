'use strict';

// geometry.ts のロジック単体テスト。geometry.ts は real ES module（named exports）
// なので動的 import() で読み込む。列数計算（colsFor/sizeFor/minColsFor）・スライダー
// トラック導出（sliderTrack/trackCols＝反転規約）・サムネ幅の60px量子化（thumbW）
// を検証する。旧 viewer.js の pColsFor/tileColsFor（重複実装）が単一所有へ
// 統合されたスライスの回帰ガード。
//
//   node scripts/test-geometry-unit.cts

const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const G = await import(pathToFileURL(path.join(__dirname, '..', 'app', 'renderer', 'geometry.ts')).href);

  let failed = 0;
  function assert(name, cond) {
    if (cond) {
      console.log('ok  ', name);
    } else {
      console.log('FAIL', name);
      failed++;
    }
  }

  // --- colsFor / sizeFor: auto-fill minmax の列数式と往復整合 ---
  const m = { W: 1000, g: 14 }; // card-ish gutter
  assert('colsFor: 1000px/gap14 に size200 は 4列', G.colsFor(200, m) === 4);
  assert('colsFor: ちょうど収まる境界（size239.5→floor）', G.colsFor(239, m) === 4);
  assert('colsFor: 巨大 size でも最低1列', G.colsFor(5000, m) === 1);
  assert('sizeFor: 4列の exact-fit は 239px', G.sizeFor(4, m) === 239);
  assert('sizeFor: 1列はコンテナ幅そのまま', G.sizeFor(1, m) === 1000);
  // 往復: sizeFor の結果を colsFor に戻すと同じ列数（floor 同士で安定）
  for (const n of [1, 2, 3, 5, 8]) {
    assert(`往復整合: ${n}列 → sizeFor → colsFor = ${n}`, G.colsFor(G.sizeFor(n, m), m) === n);
  }

  // --- minColsFor: 「size≤max のまま置ける最少列数」は ceil（floor だと max 超えの
  //     notch を提示してしまう＝旧コメントの回帰ポイント） ---
  assert('minColsFor: max340 なら 1000px は最少3列', G.minColsFor(340, m) === 3);
  assert('minColsFor: sizeFor(その列数) は max 以下', G.sizeFor(G.minColsFor(340, m), m) <= 340);
  assert('minColsFor: 1列足りる巨大 max は 1', G.minColsFor(2000, m) === 1);

  // --- sliderTrack: nBig..nSmall のレンジ・現在値の clamp・反転規約 ---
  {
    // poster card 相当: min150 max340
    const tr = G.sliderTrack({ min: 150, max: 340, size: 200 }, m);
    assert('sliderTrack: nBig=3 (max340)', tr.nBig === 3);
    assert('sliderTrack: nSmall=6 (min150)', tr.nSmall === 6);
    assert('sliderTrack: single=false', tr.single === false);
    // size200 → 4列 → value = 3+6-4 = 5
    assert('sliderTrack: value は反転（右=大きい）', tr.value === 5);
    // trackCols は自己逆写像: value から列数へ戻る
    assert('trackCols: value→列数の復元', G.trackCols(tr.value, tr.nBig, tr.nSmall) === 4);
  }
  {
    // 現在 size がレンジ外（min 未満まで縮んだ保存値）でも value は端に clamp
    const tr = G.sliderTrack({ min: 150, max: 340, size: 40 }, m);
    assert('sliderTrack: size がレンジ外でも nSmall 側へ clamp', tr.value === tr.nBig); // 最多列 = 反転で最小値
  }
  {
    // minCols=1（card ビューの「常に1列を許す」）が nBig の下限を上書き
    const tr = G.sliderTrack({ min: 240, max: 340, size: 280 }, m, { minCols: 1 });
    assert('sliderTrack: minCols=1 で nBig=1', tr.nBig === 1);
    assert('sliderTrack: minCols でも nSmall は min 由来', tr.nSmall === G.colsFor(240, m));
  }
  {
    // 幅が狭く1択しかない → single=true（呼び出し側がスライダー行を隠す契約）
    const narrow = { W: 200, g: 10 };
    const tr = G.sliderTrack({ min: 150, max: 340, size: 200 }, narrow);
    assert('sliderTrack: 幅狭で single=true', tr.single === true && tr.nBig === tr.nSmall);
  }

  // --- thumbW: 60px バケット量子化＋clamp（psimg キャッシュキーの断片化防止） ---
  assert('thumbW: 60の倍数へ切り上げ', G.thumbW(252, 180, 960) === 300);
  assert('thumbW: ちょうど倍数はそのまま', G.thumbW(300, 180, 960) === 300);
  assert('thumbW: min clamp', G.thumbW(10, 180, 960) === 180);
  assert('thumbW: max clamp', G.thumbW(5000, 180, 960) === 960);
  // 旧 viewer.js 実装（Math.min(960, Math.max(180, Math.ceil((s*1.4)/60)*60))）との
  // バイト等価性: 代表値でパリティ確認（tile 既定180・端点）
  for (const s of [120, 180, 300, 420, 900]) {
    const legacy = Math.min(960, Math.max(180, Math.ceil((s * 1.4) / 60) * 60));
    assert(`thumbW: 旧 tileThumbW とパリティ (size=${s})`, G.thumbW(s * 1.4, 180, 960) === legacy);
  }

  if (failed) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nall geometry unit tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
