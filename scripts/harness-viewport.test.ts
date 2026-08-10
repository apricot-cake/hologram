// E2E のウィンドウ幅は、レイアウトのブレークポイントに追随する (#649)。
//
// 何を守っているか。フロー系のスイートは wide のレイアウトを前提に書いてあり、以前は
// ブレークポイントのちょうど上に乗っていた＝ハーネスがレイアウトと同じ数値を書いていた。
// ブレークポイントを上げれば全ケースが narrow 側へ移るのに、15件とも緑のままだった＝
// スイートは、どのケースも対象にしていないレイアウトを見ながら通り続けたことになる。
//
// だからこのテストが問うのは「ハーネスがまだ N ピクセル幅か」ではない＝数値を焼き付けた
// ことこそが不具合の原因だった。問うのは「ブレークポイントを動かすとハーネスも一緒に動くか」
// で、layout-mode を差し替えた上で e2e/lib/viewport.ts を解決し直して確かめる。あわせて、
// その数値が2度目に書き下されるのを止める走査も置く。

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { CONTENT_SIZE, justAbove, justBelow, WIDE_MIN_PX, wideOf } from '../e2e/lib/viewport.ts';
import { SMOKE_WINDOW } from '../app/src/main/smoke-window-size.ts';

const layoutModeModule = '../app/src/renderer/src/services/layout-mode.ts';
const e2eDir = path.join(__dirname, '..', 'e2e');

/** レイアウトのブレークポイントが `breakpoint` だったとしたときの e2e/lib/viewport.ts。 */
async function viewportAtBreakpoint(breakpoint: number) {
  vi.resetModules();
  vi.doMock(layoutModeModule, () => ({ WIDE_MIN_PX: breakpoint }));
  try {
    return await import('../e2e/lib/viewport.ts');
  } finally {
    vi.doUnmock(layoutModeModule);
  }
}

describe('e2e viewport', () => {
  test('ブレークポイントを動かすとハーネスの幅が追随する', async () => {
    // 今の値より下・上・はるか上＝算出した幅は3つとも追随するが、リテラルで書き下した幅は
    // せいぜい1つしか生き残らない。
    for (const breakpoint of [960, 1280, 1600, 2048]) {
      const viewport = await viewportAtBreakpoint(breakpoint);
      expect(viewport.WIDE_MIN_PX).toBe(breakpoint);
      // `min-width` はその値自身を含むので、「wide」は >= になる。ハーネスはそれより大きい
      // 幅を求める＝切り替えの点にちょうど乗ってはいけない。
      expect(viewport.CONTENT_SIZE.width).toBeGreaterThan(breakpoint);
    }
  });

  test('CONTENT_SIZE の幅は実際のブレークポイントから算出されている', () => {
    expect(CONTENT_SIZE.width).toBe(wideOf(WIDE_MIN_PX));
    expect(CONTENT_SIZE.width).toBeGreaterThan(WIDE_MIN_PX);
  });

  test('justAbove / justBelow が境界を挟む', () => {
    for (const breakpoint of [960, 1280, 1600, 2048]) {
      // 切り替えの点はこの2つの間にあり、この2つの間には他に何も無い。
      expect(justBelow(breakpoint)).toBe(breakpoint - 1);
      expect(justAbove(breakpoint)).toBe(breakpoint);
      expect(justAbove(breakpoint) - justBelow(breakpoint)).toBe(1);
      expect(wideOf(breakpoint)).toBeGreaterThan(justAbove(breakpoint));
    }
  });

  // アプリのハーネス (scripts/test-app-*.cts) は仮想グリッドが実際に描いた DOM を読むので、
  // フロー系のスイートと同じく wide のレイアウトを前提に書いてある。そのウィンドウは main
  // から来ていて、main は layout-mode.ts を import して数値を導けない＝そこに置かれた
  // リテラルが正しいままであることを保っているのが、この繋ぎ目。#975: 以前は 1100px
  // (narrow) で走っていて、インスペクタがそこで1列を取り始めて初めて、黙って効いていたことが
  // 表に出た。
  test('ハーネスのウィンドウも wide 側にある（#975）', () => {
    expect(SMOKE_WINDOW.width).toBeGreaterThan(WIDE_MIN_PX);
  });

  test('e2e/ にブレークポイントの数値が書かれていない', () => {
    const files = fs
      .readdirSync(e2eDir, { recursive: true, encoding: 'utf8' })
      .map((entry) => entry.replaceAll('\\', '/'))
      .filter((entry) => entry.endsWith('.ts'))
      // viewport.ts は値が到着する場所（リテラルではなく import として）。そこで値が正しい
      // ままであることを保っているのが、上のテスト。
      .filter((entry) => entry !== 'lib/viewport.ts');
    expect(files.length).toBeGreaterThan(0);
    for (const rel of files) {
      const source = fs.readFileSync(path.join(e2eDir, rel), 'utf8');
      // コメントも数に入れる。幅を名指ししたコメントもまた数値の2つ目の写しで、走らない分
      // 黙って古くなるだけ。
      expect(source, `e2e/${rel} にブレークポイントの値 ${WIDE_MIN_PX} が直接書かれています。幅は e2e/lib/viewport.ts 経由で layout-mode.ts から取ってください（別の意味でたまたま同じ数字になった場合は、その数字を書かずに済む形へ直すのが先です）`).not.toMatch(new RegExp(`\\b${WIDE_MIN_PX}\\b`));
    }
  });
});
