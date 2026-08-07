// The E2E window's width follows the layout's breakpoint (#649).
//
// WHAT THIS IS GUARDING. The flow suite is written against the WIDE layout, and it used to sit
// on the breakpoint exactly — the harness wrote the same number the layout did. Moving the
// breakpoint up would have moved every case to the narrow side while all 15 stayed green: the
// suite would have gone on passing while looking at a layout none of the cases were about.
//
// So the test is not "the harness is still N pixels wide" — pinning the number is what caused
// the bug. It is "move the breakpoint and the harness moves with it", asked by re-resolving
// e2e/lib/viewport.ts against a substituted layout-mode, plus a scan that stops the number
// from being written down a second time.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { CONTENT_SIZE, justAbove, justBelow, WIDE_MIN_PX, wideOf } from '../e2e/lib/viewport.ts';
import { SMOKE_WINDOW } from '../app/src/main/smoke-window-size.ts';

const layoutModeModule = '../app/src/renderer/src/services/layout-mode.ts';
const e2eDir = path.join(__dirname, '..', 'e2e');

/** e2e/lib/viewport.ts as it would be if the layout's breakpoint were `breakpoint`. */
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
    // Below today's value, above it, and far above it — a derived width tracks all three; a
    // width written down as a literal survives at most one of them.
    for (const breakpoint of [960, 1280, 1600, 2048]) {
      const viewport = await viewportAtBreakpoint(breakpoint);
      expect(viewport.WIDE_MIN_PX).toBe(breakpoint);
      // `min-width` includes the value it names, so "wide" is >=. The harness asks for more
      // than that: it must not be sitting ON the switch.
      expect(viewport.CONTENT_SIZE.width).toBeGreaterThan(breakpoint);
    }
  });

  test('CONTENT_SIZE の幅は実際のブレークポイントから算出されている', () => {
    expect(CONTENT_SIZE.width).toBe(wideOf(WIDE_MIN_PX));
    expect(CONTENT_SIZE.width).toBeGreaterThan(WIDE_MIN_PX);
  });

  test('justAbove / justBelow が境界を挟む', () => {
    for (const breakpoint of [960, 1280, 1600, 2048]) {
      // The switch lies between these two, and nothing lies between them.
      expect(justBelow(breakpoint)).toBe(breakpoint - 1);
      expect(justAbove(breakpoint)).toBe(breakpoint);
      expect(justAbove(breakpoint) - justBelow(breakpoint)).toBe(1);
      expect(wideOf(breakpoint)).toBeGreaterThan(justAbove(breakpoint));
    }
  });

  // The app-harness scripts (scripts/test-app-*.cts) read the DOM the virtual grid actually
  // rendered, so they are written against the wide layout just like the flow suite. Their
  // window comes from main, which cannot import layout-mode.ts to derive the number — this is
  // the join that keeps the literal there honest. #975: they used to run at 1100px (narrow),
  // which only stopped mattering-in-silence once the inspector started taking a column there.
  test('ハーネスのウィンドウも wide 側にある（#975）', () => {
    expect(SMOKE_WINDOW.width).toBeGreaterThan(WIDE_MIN_PX);
  });

  test('e2e/ にブレークポイントの数値が書かれていない', () => {
    const files = fs
      .readdirSync(e2eDir, { recursive: true, encoding: 'utf8' })
      .map((entry) => entry.replaceAll('\\', '/'))
      .filter((entry) => entry.endsWith('.ts'))
      // viewport.ts is where the value ARRIVES (as an import, not a literal); the tests above
      // are what keep it honest there.
      .filter((entry) => entry !== 'lib/viewport.ts');
    expect(files.length).toBeGreaterThan(0);
    for (const rel of files) {
      const source = fs.readFileSync(path.join(e2eDir, rel), 'utf8');
      // Comments count. A comment that names the width is a second copy of the number too —
      // it just goes stale silently instead of running.
      expect(source, `e2e/${rel} にブレークポイントの値 ${WIDE_MIN_PX} が直接書かれています。幅は e2e/lib/viewport.ts 経由で layout-mode.ts から取ってください（別の意味でたまたま同じ数字になった場合は、その数字を書かずに済む形へ直すのが先です）`).not.toMatch(new RegExp(`\\b${WIDE_MIN_PX}\\b`));
    }
  });
});
