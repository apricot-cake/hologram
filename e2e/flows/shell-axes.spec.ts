// The shell's top-edge alignment axes, as invariants (#628).
//
// WHY THIS FILE EXISTS. Two rows of controls at the top of the window have to line up, and
// nothing in the code said so: every control declared its own size and padding, so any one of
// them could be changed without anything failing. Both rows had in fact drifted 6px — the
// window buttons sat 6px above the band's mid-line, the sidebar trigger 6px left of the rail's
// — and it took a person looking at the window to notice. This file is the missing statement:
// the axes belong to the band and to the sidebar column, and the controls are participants.
//
// WHY HERE AND NOT IN scripts/test-app-*.cts. Geometry is only meaningful against a fixed
// viewport and a fixed device scale factor, and lib/harness.ts is where those are fixed (a
// content box on the wide side of the layout breakpoint per lib/viewport.ts,
// --force-device-scale-factor=1, plus theme / language / timezone).
// The scripts/ layer boots hidden at its own default size and inherits the machine's DPI, so
// the same numbers there would be the machine's numbers.
//
// TWO AXES, DELIBERATELY NOT MORE. A third is worth adding when a third drift is actually
// found. Every axis is also a test that fails on an intended change, so they are only cheap
// while each one is paying for a mistake that really happened.
//
// EXPECTATIONS ARE MEASURED, NOT WRITTEN DOWN. The band's centre comes from the band, the
// rail's from the rail. A literal 22 here would turn "the band is 40px tall now" into a
// failure that reads as "the controls are misaligned", and would put the band's height in two
// places at once.
import { expect, test } from '../lib/harness.ts';
import type { Page } from '@playwright/test';

interface Box {
  name: string;
  w: number;
  h: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
}

/** One selector to measure, under the name the failure message will use. */
type Target = [name: string, selector: string, index?: number];

/**
 * Client rects for `targets`, rounded to whole pixels — a fractional band height would
 * otherwise fail an axis that is visually exact, while the drifts this file is about (6px)
 * survive rounding untouched.
 */
async function measure(page: Page, targets: Target[]): Promise<Box[]> {
  const boxes = await page.evaluate((list: Target[]) => {
    return list.map(([name, selector, index]) => {
      const el = document.querySelectorAll(selector)[index ?? 0];
      if (!el) return { name, w: -1, h: -1, left: -1, top: -1, right: -1, bottom: -1, cx: -1, cy: -1, missing: true };
      const r = el.getBoundingClientRect();
      const round = Math.round;
      return { name, w: round(r.width), h: round(r.height), left: round(r.left), top: round(r.top), right: round(r.right), bottom: round(r.bottom), cx: round(r.left + r.width / 2), cy: round(r.top + r.height / 2), missing: false };
    });
  }, targets);
  const missing = boxes.filter((b) => b.missing).map((b) => b.name);
  // A participant that is not on screen is a broken test, not a broken axis — say so before
  // the assertions turn it into "the close button's centre is -1".
  if (missing.length) throw new Error(`採寸できない要素があります（セレクタが古い可能性）: ${missing.join(' / ')}`);
  return boxes;
}

/** The failure log's body: the same table the issue was written from, for the run that failed. */
function table(boxes: Box[]): string {
  const width = Math.max(...boxes.map((b) => [...b.name].length));
  return boxes.map((b) => `  ${b.name.padEnd(width)}  ${String(b.w).padStart(4)}×${String(b.h).padEnd(4)} @${b.left},${b.top}  中心=(${b.cx},${b.cy})  下端=${b.bottom}`).join('\n');
}

/**
 * Prints the採寸表 when the case has collected at least one soft failure. Soft assertions are
 * what let one run report every participant that left the axis — changing one size usually
 * knocks several off at once, and stopping at the first would read as a single stray control.
 */
function dumpOnFailure(title: string, boxes: Box[]): void {
  if (!test.info().errors.length) return;
  console.log(`\n${title}\n${table(boxes)}\n`);
}

/** The band's controls only exist once the tab model has loaded. */
async function bandReady(page: Page): Promise<void> {
  await page.locator('[data-slot="tab-strip"]').waitFor();
  await page.locator('[data-slot="tab-new"]').waitFor();
}

/** Ctrl+B, then wait for the column to actually be the icon rail (the collapse is animated). */
async function collapseToRail(page: Page): Promise<void> {
  await page.keyboard.press('Control+b');
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed');
  await expect.poll(async () => (await measure(page, [['rail', '[data-slot="sidebar"]']]))[0].w, { message: 'サイドバーがアイコンレール幅まで畳まれること' }).toBeLessThan(100);
}

const BAND: Target = ['帯', '[data-slot="titlebar-band"]'];
// The band's icon controls. Three owners: the sidebar's component draws the first, the tab
// strip the second, the shell the third, and the app-drawn caption strip (portaled to body,
// outside the band's flex row entirely) the last three. That spread is exactly why the axis
// needs stating — no single container lays all six out.
const BAND_CONTROLS: Target[] = [
  ['サイドバーのトグル', '[data-sidebar="trigger"]'],
  ['新しいタブ', '[data-slot="tab-new"]'],
  ['詳細パネルのトグル', '[data-slot="inspector-toggle"]'],
  ['最小化', '[data-slot="window-control"]', 0],
  ['最大化', '[data-slot="window-control"]', 1],
  ['閉じる', '[data-slot="window-control"]', 2],
];

test('帯のアイコン軸: 上端の帯のアイコンコントロールは帯の中心 y を共有する', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await bandReady(page);

  const [viewport, band, ...controls] = await measure(page, [['ウィンドウ', 'html'], BAND, ...BAND_CONTROLS]);
  for (const c of controls) {
    expect.soft(c.cy, `帯のアイコン軸: 〈${c.name}〉の中心 y は帯の中心 y (${band.cy}) と一致すること`).toBe(band.cy);
  }
  // The caption strip is the one participant that reaches the axis by being as tall as the
  // band rather than by centring inside it (Windows' caption buttons run the full height of
  // the title bar), so its height is its own assertion — centred-but-short would satisfy the
  // line above while losing the top-right corner that makes the close button throwable-at.
  const close = controls[controls.length - 1];
  expect.soft(close.h, `帯のアイコン軸: 〈閉じる〉は帯の高さいっぱい (${band.h}) であること`).toBe(band.h);
  expect.soft(close.top, '帯のアイコン軸: 〈閉じる〉は帯の上端に接していること').toBe(band.top);
  expect.soft(close.right, `帯のアイコン軸: 〈閉じる〉はウィンドウの右上隅 (x=${viewport.right}) に接していること`).toBe(viewport.right);

  dumpOnFailure('帯のアイコン軸 — 採寸', [viewport, band, ...controls]);
});

test('帯のアイコン軸: タブ本体は対象外＝帯の下端に接する別の軸に乗る', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await bandReady(page);

  // Not an omission: tabs are bottom-flush on purpose (Chrome's anatomy — the active tab has
  // to connect into the surface below it), so their centre is BELOW the band's. Asserted
  // rather than left silent, so that "let's centre the tabs too" has to argue with a test
  // instead of quietly passing.
  const [band, tab] = await measure(page, [BAND, ['タブ本体', '[data-slot="tab"]']]);
  expect.soft(tab.bottom, `タブ本体の軸: タブは帯の下端 (${band.bottom}) に接していること`).toBe(band.bottom);
  expect.soft(tab.cy, 'タブ本体の軸: タブの中心 y は帯の中心とは一致しない（下端揃えの別の軸）').not.toBe(band.cy);

  dumpOnFailure('タブ本体の軸 — 採寸', [band, tab]);
});

test('サイドバー列の軸: トグルとナビ行が列の左端を共有し、レール形では列の中心 x に乗る', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await bandReady(page);

  const NAV: Target[] = [0, 1, 2, 3, 4].map((i) => [`ナビ行[${i}]`, '[data-slot="sidebar-menu-button"]', i]);
  const TRIGGER: Target = ['サイドバーのトグル', '[data-sidebar="trigger"]'];

  // Expanded first. Here the rows fill the column's width, so the shared thing is the left
  // edge: the trigger has to start where the rows start.
  const expanded = await measure(page, [['列（展開）', '[data-slot="sidebar"]'], TRIGGER, ...NAV]);
  const [, expandedTrigger, ...expandedNav] = expanded;
  for (const row of expandedNav) {
    expect.soft(expandedTrigger.left, `サイドバー列の軸（展開）: 〈トグル〉の左端は〈${row.name}〉の左端 (${row.left}) と一致すること`).toBe(row.left);
  }
  dumpOnFailure('サイドバー列の軸（展開） — 採寸', expanded);

  // Then the icon rail, where the rows are square and the same statement — same left edge,
  // same width — is what puts everything on the rail's own centre line.
  await collapseToRail(page);
  const rail = await measure(page, [['レール', '[data-slot="sidebar"]'], TRIGGER, ...NAV]);
  const [railBox, railTrigger, ...railNav] = rail;
  for (const row of railNav) {
    expect.soft(railTrigger.left, `サイドバー列の軸（レール）: 〈トグル〉の左端は〈${row.name}〉の左端 (${row.left}) と一致すること`).toBe(row.left);
    expect.soft(railTrigger.w, `サイドバー列の軸（レール）: 〈トグル〉の幅は〈${row.name}〉の幅 (${row.w}) と一致すること`).toBe(row.w);
    expect.soft(row.cx, `サイドバー列の軸（レール）: 〈${row.name}〉の中心 x はレールの中心 (${railBox.cx}) と一致すること`).toBe(railBox.cx);
  }
  expect.soft(railTrigger.cx, `サイドバー列の軸（レール）: 〈トグル〉の中心 x はレールの中心 (${railBox.cx}) と一致すること`).toBe(railBox.cx);
  dumpOnFailure('サイドバー列の軸（レール） — 採寸', rail);
});
