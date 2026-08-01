// Unit tests for the logic in zoom-anchor.ts (#282 keeping the zoom anchor in place).
// Of the process behind Ctrl+wheel zoom (#141) "keeping the post you were looking at at
// the same height on screen", this covers the part that can be pinned down numerically:
// (1) which item to grab from the cursor position, and (2) what scrollTop puts that item
// back at its original position.
//
// Whether it actually appears to stay in place (layout recalculation and settle timing) is
// real behavior on the virtual grid, so it's out of scope for automated tests — #282's own
// acceptance criteria say to measure it "on the real app, at thousands-of-items scale".
// What's guarded here is mixing up coordinate systems (container coordinates vs. viewport
// coordinates), edge clamping, and handling coordinates that are "not over a card" — gaps,
// below the last row, and so on.

import { describe, expect, test } from 'vitest';
import * as Z from '../app/src/renderer/src/services/zoom-anchor';

// 3 columns x 2 rows (column width 200, row height 150, no gap). Matches the shape masonic's positioner returns.
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
    // A 1px coordinate equidistant (distance 0 either way) from two adjacent cards.
    // Returning either one is harmless, but if scan order made it waver, the same
    // operation would produce different results, so pin it down.
    expect(Z.pickAnchorIndex(cells, 200, 0)).toBe(0);
    expect(Z.pickAnchorIndex(cells, 0, 150)).toBe(0);
  });

  test('列の溝に落ちても、いちばん近いカードを掴む（掴めないとは言わない）', () => {
    // The base layout has no gap, so use a version with the width trimmed to create one.
    const gapped: Z.ZoomAnchorCell[] = [
      { index: 0, left: 0, top: 0, width: 190, height: 150 },
      { index: 1, left: 200, top: 0, width: 190, height: 150 },
    ];
    expect(Z.pickAnchorIndex(gapped, 192, 40)).toBe(0); // gap closer to the left card
    expect(Z.pickAnchorIndex(gapped, 198, 40)).toBe(1); // gap closer to the right card
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
  // The container starts 80px below the top of the scrolled content (a filter bar etc. sits above it).
  const containerOffset = 80;

  test('画面上の見えている位置を測って、そのまま戻せる', () => {
    const offset = Z.anchorViewportOffset(1000, containerOffset, 700); // position 380px from the top edge
    expect(offset).toBe(380);
    expect(Z.anchorScrollTop(1000, containerOffset, offset, 5000)).toBe(700);
  });

  test('再レイアウトで項目が動いても、画面上の高さは変わらない', () => {
    // Before zoom: 3-column layout, top=1000. Was at position 380px from the top edge of the screen.
    const offset = Z.anchorViewportOffset(1000, containerOffset, 700);
    // After zoom: becomes 2 columns, the same item moves to top=1600 -> scroll down by 600 too.
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
  // Viewport height 600, container 80px down, current scrollTop is 700.
  const containerOffset = 80;
  const scrollTop = 700;
  // 3 columns of width 200 / row height 150, 12 items. index 6 is the left edge of row 3 (top=300).
  const before: Z.ZoomAnchorCell[] = [];
  for (let i = 0; i < 12; i++) before.push({ index: i, left: (i % 3) * 200, top: Math.floor(i / 3) * 150, width: 200, height: 150 });
  // Zooming makes it 2 columns of width 300, and the same 12 items stretch vertically (row height becomes 225 too).
  const after: Z.ZoomAnchorCell[] = [];
  for (let i = 0; i < 12; i++) after.push({ index: i, left: (i % 2) * 300, top: Math.floor(i / 2) * 225, width: 300, height: 225 });

  test('カーソル下の投稿が、ズーム後も画面の同じ高さに来る', () => {
    // The cursor is at container coordinates (100, 350) — over index 6.
    const index = Z.pickAnchorIndex(before, 100, 350);
    expect(index).toBe(6);
    const offset = Z.anchorViewportOffset(before[index as number].top, containerOffset, scrollTop);
    expect(offset).toBe(-320); // even a state where the top pokes out above the screen's top edge is kept as-is
    const next = Z.anchorScrollTop(after[index as number].top, containerOffset, offset, 5000);
    // Subtract the same offset from the post-relayout position — the on-screen height doesn't change.
    expect(Z.anchorViewportOffset(after[index as number].top, containerOffset, next)).toBe(offset);
    expect(next).toBe(1075);
  });

  test('近似（未実測の推定 top）でも同じ式で寄せられる', () => {
    // While the positioner has no position yet, the estimateHeight() estimate is passed in as top.
    // Even if the estimate is 60px lower than the measured value, running the same formula again
    // once it's finalized resolves the gap on its own.
    const offset = -320;
    const approx = Z.anchorScrollTop(1290, containerOffset, offset, 5000);
    const exact = Z.anchorScrollTop(1350, containerOffset, offset, 5000);
    expect(exact - approx).toBe(60);
  });
});
