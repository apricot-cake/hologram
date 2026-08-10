// zoom-anchor.ts のロジック（#282 ズームのアンカーを動かさない）の単体テスト。
// Ctrl+ホイールのズーム（#141）で「見ていた投稿を画面の同じ高さに留める」という筋道の
// うち、数値で固定できる部分を対象にする＝(1) カーソル位置からどの項目を掴むか、
// (2) その項目を元の位置へ戻す scrollTop はいくつか。
//
// 実際に留まって見えるかどうか（レイアウトの再計算と、落ち着くまでの間）は仮想グリッド上の
// 実挙動なので、自動テストの範囲外＝#282 の受け入れ条件自身が「実アプリで、数千件の規模で」
// 測ると言っている。ここで守るのは、座標系の取り違え（コンテナ座標とビューポート座標）、
// 端での止め、そして「カードの上ではない」座標＝隙間や最終行より下などの扱い。

import { describe, expect, test } from 'vitest';
import * as Z from '../app/src/renderer/src/services/zoom-anchor';

// 3列×2行（列幅 200、行の高さ 150、隙間なし）。masonic の positioner が返す形に合わせてある。
const cells: Z.ZoomAnchorCell[] = [
  { index: 0, left: 0, top: 0, width: 200, height: 150 },
  { index: 1, left: 200, top: 0, width: 200, height: 150 },
  { index: 2, left: 400, top: 0, width: 200, height: 150 },
  { index: 3, left: 0, top: 150, width: 200, height: 150 },
  { index: 4, left: 200, top: 150, width: 200, height: 150 },
  { index: 5, left: 400, top: 150, width: 200, height: 150 },
];

describe('pickAnchorIndex: カーソル下の項目を掴む', () => {
  test('カードの内側なら、そのカード', () => {
    expect(Z.pickAnchorIndex(cells, 10, 10)).toBe(0);
    expect(Z.pickAnchorIndex(cells, 250, 200)).toBe(4);
    expect(Z.pickAnchorIndex(cells, 599, 299)).toBe(5);
  });

  test('カードの継ぎ目ちょうどは index の小さい方＝左上寄りへ倒れる', () => {
    // 隣り合う2枚のカードから等距離（どちらへも距離 0）になる 1px の座標。
    // どちらを返しても害は無いが、走査順で揺れると同じ操作が違う結果を出すので固定する。
    expect(Z.pickAnchorIndex(cells, 200, 0)).toBe(0);
    expect(Z.pickAnchorIndex(cells, 0, 150)).toBe(0);
  });

  test('列の溝に落ちても、いちばん近いカードを掴む（掴めないとは言わない）', () => {
    // 元のレイアウトは隙間が無いので、幅を削って隙間を作った版を使う。
    const gapped: Z.ZoomAnchorCell[] = [
      { index: 0, left: 0, top: 0, width: 190, height: 150 },
      { index: 1, left: 200, top: 0, width: 190, height: 150 },
    ];
    expect(Z.pickAnchorIndex(gapped, 192, 40)).toBe(0); // 隙間のうち左のカードに近い側
    expect(Z.pickAnchorIndex(gapped, 198, 40)).toBe(1); // 隙間のうち右のカードに近い側
  });

  test('等距離なら index の小さい方（走査順に依存しない）', () => {
    const gapped: Z.ZoomAnchorCell[] = [
      { index: 3, left: 0, top: 0, width: 190, height: 150 },
      { index: 1, left: 200, top: 0, width: 190, height: 150 },
    ];
    expect(Z.pickAnchorIndex(gapped, 195, 40)).toBe(1);
    expect(Z.pickAnchorIndex([...gapped].reverse(), 195, 40)).toBe(1);
  });

  test('最終行より下（コンテンツの外）でも、いちばん近い行を掴む', () => {
    expect(Z.pickAnchorIndex(cells, 250, 900)).toBe(4);
  });

  test('左端より外へはみ出しても掴める', () => {
    expect(Z.pickAnchorIndex(cells, -50, 200)).toBe(3);
  });

  test('1件も配置されていなければ null（＝アンカー無しでズームする）', () => {
    expect(Z.pickAnchorIndex([], 10, 10)).toBe(null);
  });
});

describe('anchorViewportOffset / anchorScrollTop: 座標系の往復', () => {
  // コンテナはスクロールする内容の上端から 80px 下から始まる（上に絞り込みバーなどが載る）。
  const containerOffset = 80;

  test('画面上の見えている位置を測って、そのまま戻せる', () => {
    const offset = Z.anchorViewportOffset(1000, containerOffset, 700); // 画面の上端から 380px の位置
    expect(offset).toBe(380);
    expect(Z.anchorScrollTop(1000, containerOffset, offset, 5000)).toBe(700);
  });

  test('再レイアウトで項目が動いても、画面上の高さは変わらない', () => {
    // ズーム前: 3列のレイアウトで top=1000。画面の上端から 380px の位置にあった。
    const offset = Z.anchorViewportOffset(1000, containerOffset, 700);
    // ズーム後: 2列になり、同じ項目が top=1600 へ動く → スクロールも 600 下げる。
    expect(Z.anchorScrollTop(1600, containerOffset, offset, 5000)).toBe(1300);
  });

  test('ビューポートより上に出る位置は 0 で止まる（負の scrollTop は作らない）', () => {
    expect(Z.anchorScrollTop(10, containerOffset, 400, 5000)).toBe(0);
  });

  test('末尾では最大スクロール量で止まる', () => {
    expect(Z.anchorScrollTop(9000, containerOffset, 100, 5000)).toBe(5000);
  });

  test('スクロールできない（内容が画面に収まる）ときは常に 0', () => {
    expect(Z.anchorScrollTop(1000, containerOffset, 380, 0)).toBe(0);
  });
});

describe('掴む→戻す をひと続きに: ズームしても同じ投稿が同じ高さに残る', () => {
  // ビューポートの高さ 600、コンテナは 80px 下、今の scrollTop は 700。
  const containerOffset = 80;
  const scrollTop = 700;
  // 幅 200 の3列 / 行の高さ 150、12件。index 6 は3行目の左端（top=300）。
  const before: Z.ZoomAnchorCell[] = [];
  for (let i = 0; i < 12; i++) before.push({ index: i, left: (i % 3) * 200, top: Math.floor(i / 3) * 150, width: 200, height: 150 });
  // ズームすると幅 300 の2列になり、同じ12件が縦に伸びる（行の高さも 225 になる）。
  const after: Z.ZoomAnchorCell[] = [];
  for (let i = 0; i < 12; i++) after.push({ index: i, left: (i % 2) * 300, top: Math.floor(i / 2) * 225, width: 300, height: 225 });

  test('カーソル下の投稿が、ズーム後も画面の同じ高さに来る', () => {
    // カーソルはコンテナ座標の (100, 350)＝index 6 の上。
    const index = Z.pickAnchorIndex(before, 100, 350);
    expect(index).toBe(6);
    const offset = Z.anchorViewportOffset(before[index as number].top, containerOffset, scrollTop);
    expect(offset).toBe(-320); // top が画面の上端より外へ出ている状態もそのまま保つ
    const next = Z.anchorScrollTop(after[index as number].top, containerOffset, offset, 5000);
    // 再レイアウト後の位置から同じオフセットを引く＝画面上の高さは変わらない。
    expect(Z.anchorViewportOffset(after[index as number].top, containerOffset, next)).toBe(offset);
    expect(next).toBe(1075);
  });

  test('近似（未実測の推定 top）でも同じ式で寄せられる', () => {
    // positioner がまだ位置を持たない間は、estimateHeight() の推定値が top として渡る。
    // 推定が実測より 60px 低くても、確定した後に同じ式をもう一度回せば、ずれはひとりでに
    // 解消する。
    const offset = -320;
    const approx = Z.anchorScrollTop(1290, containerOffset, offset, 5000);
    const exact = Z.anchorScrollTop(1350, containerOffset, offset, 5000);
    expect(exact - approx).toBe(60);
  });
});
