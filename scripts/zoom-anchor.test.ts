// zoom-anchor.ts のロジック単体テスト（#282 ズームのアンカー維持）。
// Ctrl+ホイールズーム（#141）で「見ていた投稿を画面の同じ高さに留める」処理のうち、
// 数値で固定できる部分＝①カーソル位置からどの項目を掴むか ②その項目を元の位置へ
// 戻す scrollTop はいくつか、を押さえる。
//
// 実際に留まって見えるか（レイアウトの再計算・確定合わせのタイミング）は仮想グリッド
// 上の実挙動なので自動テストの射程外＝#282 本文の受け入れ条件も「実機・数千件規模」で
// 測ると書いている。ここで守るのは座標系の取り違え（コンテナ座標とビューポート座標）と
// 端でのクランプ、そして溝・最終行より下といった「カードの上に無い」座標の扱い。

import { describe, expect, test } from 'vitest';
import * as Z from '../app/src/renderer/src/services/zoom-anchor';

// 3列×2行（列幅200・行高150・溝なし）。masonic の positioner が返す形に合わせている。
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
    // 隣り合う2枚から等距離（どちらも距離0）になる1pxの座標。どちらを返しても
    // 実害は無いが、走査順で揺れると同じ操作が別の結果を出すので固定しておく。
    expect(Z.pickAnchorIndex(cells, 200, 0)).toBe(0);
    expect(Z.pickAnchorIndex(cells, 0, 150)).toBe(0);
  });

  test('列の溝に落ちても、いちばん近いカードを掴む（掴めないとは言わない）', () => {
    // 溝が無いレイアウトなので、幅を削って溝を作った版で見る
    const gapped: Z.ZoomAnchorCell[] = [
      { index: 0, left: 0, top: 0, width: 190, height: 150 },
      { index: 1, left: 200, top: 0, width: 190, height: 150 },
    ];
    expect(Z.pickAnchorIndex(gapped, 192, 40)).toBe(0); // 左寄りの溝
    expect(Z.pickAnchorIndex(gapped, 198, 40)).toBe(1); // 右寄りの溝
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
  // コンテナはスクロール内容の 80px 下から始まる（上にフィルタバーなどが居る）。
  const containerOffset = 80;

  test('画面上の見えている位置を測って、そのまま戻せる', () => {
    const offset = Z.anchorViewportOffset(1000, containerOffset, 700); // 上端から 380px の位置
    expect(offset).toBe(380);
    expect(Z.anchorScrollTop(1000, containerOffset, offset, 5000)).toBe(700);
  });

  test('再レイアウトで項目が動いても、画面上の高さは変わらない', () => {
    // ズーム前: 3列レイアウトで top=1000。画面上端から 380px の位置に居た。
    const offset = Z.anchorViewportOffset(1000, containerOffset, 700);
    // ズーム後: 2列になって同じ項目が top=1600 へ移った → スクロールも 600 下げる。
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
  // ビューポート高さ 600・コンテナは 80px 下・現在の scrollTop は 700。
  const containerOffset = 80;
  const scrollTop = 700;
  // 列幅200・行高150 の 3 列で 12 件。index 6 は 3 行目の左端 (top=300)。
  const before: Z.ZoomAnchorCell[] = [];
  for (let i = 0; i < 12; i++) before.push({ index: i, left: (i % 3) * 200, top: Math.floor(i / 3) * 150, width: 200, height: 150 });
  // ズームで列幅300・2列になり、同じ 12 件が縦に伸びる（行高も 225 へ）。
  const after: Z.ZoomAnchorCell[] = [];
  for (let i = 0; i < 12; i++) after.push({ index: i, left: (i % 2) * 300, top: Math.floor(i / 2) * 225, width: 300, height: 225 });

  test('カーソル下の投稿が、ズーム後も画面の同じ高さに来る', () => {
    // カーソルはコンテナ座標 (100, 350) ＝ index 6 の上。
    const index = Z.pickAnchorIndex(before, 100, 350);
    expect(index).toBe(6);
    const offset = Z.anchorViewportOffset(before[index as number].top, containerOffset, scrollTop);
    expect(offset).toBe(-320); // 画面の上端より上に頭が出ている状態も、そのまま保つ
    const next = Z.anchorScrollTop(after[index as number].top, containerOffset, offset, 5000);
    // 再レイアウト後の位置から同じ offset を引く＝画面上の高さは不変。
    expect(Z.anchorViewportOffset(after[index as number].top, containerOffset, next)).toBe(offset);
    expect(next).toBe(1075);
  });

  test('近似（未実測の推定 top）でも同じ式で寄せられる', () => {
    // positioner に位置がまだ入っていない間は estimateHeight() の推定値を top として渡す。
    // 推定が実測より 60px 低くても、確定時にもう一度同じ式を通せば差はそのまま解消する。
    const offset = -320;
    const approx = Z.anchorScrollTop(1290, containerOffset, offset, 5000);
    const exact = Z.anchorScrollTop(1350, containerOffset, offset, 5000);
    expect(exact - approx).toBe(60);
  });
});
