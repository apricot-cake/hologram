// #975: the inspector is a docked column at EVERY width. #259 had it detach into a
// slide-over below 1280px, and what made that wrong is geometry, not a predicate —
// the floating panel covered the very cards it was supposed to spare. So the guard is
// a REAL window resize with the boxes measured, not a mocked matchMedia
// (scripts/inspector-pref.test.ts already holds that half).
import { expect, test } from '../lib/harness.ts';
import { WIDE_MIN_PX, justBelow } from '../lib/viewport.ts';

test('狭幅でもインスペクタは常設カラムのままグリッドを覆わない（#975）', async ({ launchHologram }) => {
  const { app, page } = await launchHologram();
  const narrow = justBelow(WIDE_MIN_PX);
  await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 800), narrow);
  // The layout answers a resize, not the request for one: wait for the window the app
  // actually got. (A background window would not repaint at all — #259's own measurement
  // note — but Playwright's Electron window is on screen.)
  await page.waitForFunction((w) => window.innerWidth <= w, narrow);

  const inspector = page.locator('[data-slot="inspector"]');
  await expect(inspector).toBeVisible();
  // Nothing is selected, and the column still stands — on its placeholder (#244). Under
  // #259 the narrow form rode on the selection and would be absent here.
  await expect(page.locator('[data-slot="inspector-empty"]')).toBeVisible();
  await expect(inspector).toHaveCSS('position', 'relative');

  // The grid keeps its own room: the scroll column ends where the panel begins, so no
  // card is behind it. 1px of tolerance for the border between them.
  const grid = await page.locator('[data-slot="content-scroll"]').boundingBox();
  const panel = await inspector.boundingBox();
  if (!grid || !panel) throw new Error('グリッドまたはインスペクタの矩形が取れなかった');
  expect(grid.x + grid.width).toBeLessThanOrEqual(panel.x + 1);

  // Esc is scoped to transient surfaces (#143/#242). #259 carved out an exception for the
  // narrow overlay; with no such form left, the column must sit through it.
  await page.keyboard.press('Escape');
  await expect(inspector).toBeVisible();

  // And a click on empty grid — which used to wave the overlay away — leaves the column
  // standing (it only empties the panel, #242).
  await page.locator('[data-slot="content-scroll"]').click({ position: { x: 8, y: 8 } });
  await expect(inspector).toBeVisible();
});
