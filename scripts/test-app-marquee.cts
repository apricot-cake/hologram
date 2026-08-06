'use strict';

// Verifies the grid's empty-space gesture in a real renderer — both halves of the
// same press: drag it and a band selects the cards it touches (#484), release it
// without dragging and the selection clears (#242).
//
// What this covers that scripts/marquee.test.ts cannot: the gesture is wired to
// the right element, the hit test reads masonic's positioner, and the answer it
// produces matches where the cards actually ARE (the test derives its expectation
// from live DOM rects and compares — model vs. reality, which is the whole risk in
// a virtualized grid). Plus the guards: Ctrl extends instead of replacing, Esc
// restores, a held modifier makes a background click a no-op, and the inspector
// follows the selection down to its placeholder.
//
// What it cannot cover: the feel of the real gesture and auto-scroll — synthetic
// events step through the frames instantly. That needs a real pointer (per #484's own body).
//
//   node scripts/test-app-marquee.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { readEvalResult } = require('./lib-eval-result.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-marquee-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
// Enough posts for several masonry rows, so a band can cut one row without
// touching the ones around it.
const records: any[] = [];
for (let i = 0; i < 12; i++) {
  const id = `dummy-m${i}`;
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  records.push({
    captureId: id,
    image: `${id}.jpg`,
    url: `https://x.com/u${i}/status/${900 + i}`,
    platform: 'x',
    text: `本文${i}`,
    displayName: `人${i}`,
    screenName: `u${i}`,
    capturedAt: `2026-05-01T12:00:${String(i).padStart(2, '0')}Z`,
    date: `2026-04-01T10:00:${String(i).padStart(2, '0')}Z`,
    media: [{ file: `${id}-orig.jpg`, url: 'https://x.com/i/1.jpg' }],
    tags: [],
    hashtags: [],
  });
}
seedLibrary(configDir, records);

// sleep / waitFor / waitStable / neverHappens + the WAIT_DEADLINE budget (#952)
// come in as the first argument — scripts/lib-wait.cts. The body is a real
// function rather than a template literal so Biome's no-fixed-wait plugin and tsc
// can both read it; it is serialised, so it closes over nothing from this file.
const evalJs = evalSource(async ({ waitFor, waitStable, neverHappens }) => {
  const cards = () => [...document.querySelectorAll<HTMLElement>('[data-slot="post-grid"] [data-slot="post-card"]')];
  // Cards are identified by their own text (no key attribute — #618).
  const nameOf = (c) => ((c.textContent || '').match(/本文\d+/) || [])[0] || '?';
  const selectedKeys = () =>
    cards()
      .filter((c) => c.hasAttribute('data-selected'))
      .map(nameOf)
      .sort();
  const band = () => document.querySelector('[data-slot="grid-marquee"]');
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  const out: Record<string, any> = {};

  const rectsOf = (sel) =>
    [...document.querySelectorAll(sel)].map((c) => {
      const k = c.getBoundingClientRect();
      return [Math.round(k.left), Math.round(k.top), Math.round(k.width), Math.round(k.height)];
    });

  await waitFor('the grid to show all 12 seeded posts', () => cards().length >= 12);
  // Every expectation below is derived from these rects, so wait for masonic's
  // measured heights to stop moving rather than for a fixed number of frames.
  out.gridSettled = await waitStable('the masonry layout to stop moving', () => rectsOf('[data-slot="post-grid"] [data-slot="post-card"]'));

  // Named rather than optional-chained: every coordinate below is measured off this
  // element, so a missing scroller has to stop the run and say so.
  const scroller = document.querySelector<HTMLElement>('[data-slot="content-scroll"]');
  if (!scroller) throw new Error('the content scroller is missing — the grid never mounted');
  const sr = scroller.getBoundingClientRect();

  // `mods` is optional: most presses here carry no modifier, and Object.assign with
  // undefined is a no-op — the same call shape the template-literal version had.
  const down = (x, y, mods?) => scroller.dispatchEvent(new MouseEvent('mousedown', Object.assign({ bubbles: true, button: 0, clientX: x, clientY: y }, mods)));
  const move = (x, y) => window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
  const up = () => window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  // Press and release with no movement at all: the click half of the gesture (#242).
  // No 'click' event is synthesized, so the narrow overlay's outside-click dismiss
  // (a separate listener) cannot be what any of this measures.
  const click = (x, y, mods?) => {
    down(x, y, mods);
    up();
  };
  const inspectedCards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"][data-inspected]').length;
  const panelFilled = () => !!document.querySelector('[data-slot="inspector-body"] [data-slot="inspector-tags"]');
  // The panel's "nothing is selected" state (#244). Asserted on its own rather than
  // as "not filled": the placeholder is what has to be THERE, and the panel renders
  // it at both widths (only whether the column is on screen differs).
  const panelPlaceholder = () => !!document.querySelector('[data-slot="inspector-body"] [data-slot="inspector-empty"]');

  // Cards the band would touch, computed from LIVE DOM rects — the independent
  // answer the app's positioner-based hit test has to agree with.
  const expectFor = (x0, y0, x1, y1) => {
    const l = Math.min(x0, x1),
      r = Math.max(x0, x1),
      t = Math.min(y0, y1),
      b = Math.max(y0, y1);
    return cards()
      .filter((c) => {
        const k = c.getBoundingClientRect();
        return l < k.right && r > k.left && t < k.bottom && b > k.top;
      })
      .map(nameOf)
      .sort();
  };
  // One full pass: press in the left margin, cross the threshold, drag, release.
  // The expect argument is the answer this drag has to converge on — expectFor's
  // independent reading of the live rects. Waiting for it beats sleeping through
  // the gesture, because the two things worth waiting for do not run on a clock:
  //   - the band is created synchronously by the threshold-crossing move, so
  //     "the band exists" is the proof the press armed;
  //   - the release runs one final, SYNCHRONOUS hit test, and the DOM shows its
  //     answer only once React commits the store write.
  // No wait for the rAF frames in between: this suite measured them at 0.7-1.0s
  // apiece in a hidden window, so the sleep(120) that used to sit here never saw
  // one either — the release is what all four of these drags actually assert.
  // Case E owns the live-preview path on purpose, with a wait sized for that.
  const drag = async (x0, y0, x1, y1, mods, expect) => {
    down(x0, y0, mods);
    move(x0 + 8, y0 + 8); // past MARQUEE_THRESHOLD → the band arms itself
    await waitFor('the band to appear once the drag passed its threshold', () => !!band(), 3000);
    move(x1, y1);
    up();
    if (expect) await waitFor('the released drag to select exactly the cards it crossed', () => selectedKeys().join(',') === expect.join(','), 4000);
  };

  // Rows, top-first, grouped by their rounded top and ordered left to right — read
  // fresh on every call rather than snapshotted once. A card reserves its height
  // before its picture reports an aspect (PostCard's CardThumb → onAspect), so the
  // masonry can still move after the settle above, and a band placed from a reading
  // older than the press it belongs to can land where nothing is any more (#1007).
  const readRows = () => {
    const byTop: Record<number, Array<{ el: HTMLElement; r: DOMRect }>> = {};
    for (const c of cards()) {
      const k = c.getBoundingClientRect();
      const key = Math.round(k.top);
      (byTop[key] = byTop[key] || []).push({ el: c, r: k });
    }
    return Object.keys(byTop)
      .map(Number)
      .sort((a, b) => a - b)
      .map((t) => byTop[t].sort((a, b) => a.r.left - b.r.left));
  };
  // The reading cases A/B/D/F/G/H are written against. Row 0 is the one row whose top
  // cannot move (it is the container's), which is why a single reading is enough here
  // and not below — layoutHeldThroughH checks that premise instead of assuming it.
  const rows0 = readRows();
  const row0 = rows0[0];
  const layout0 = JSON.stringify(rectsOf('[data-slot="post-grid"] [data-slot="post-card"]'));
  out.rowCount = rows0.length;
  out.row0Count = row0.length;
  // Thin horizontal band through row 0, from the left margin to the middle of the
  // SECOND column — so it must take exactly the first two cards of that row.
  const cy = Math.round((row0[0].r.top + row0[0].r.bottom) / 2);
  const x0 = Math.round(sr.left + 6); // the scroller's padding: empty space
  const x1 = Math.round((row0[1].r.left + row0[1].r.right) / 2);
  // "Not on a card" is the question, and it is the same one the grid's own press recognizer
  // asks (_shared/VirtualGrid.tsx: a press is background unless it closest()s a cell). This
  // used to demand the element BE the scroller, which is a stricter contract than the app
  // has: at some widths the point lands on the grid's own wrapper — still empty space, still
  // a background press — and the case failed while testing nothing that had changed.
  out.startsOnEmptySpace = !document.elementFromPoint(x0, cy)?.closest('[data-slot="post-card"], [data-slot="poster-card"]');

  // A. plain drag selects what it touched, and nothing else
  out.expectA = expectFor(x0, cy - 5, x1, cy + 5);
  await drag(x0, cy - 5, x1, cy + 5, undefined, out.expectA);
  out.gotA = selectedKeys();
  out.scrolledA = scroller.scrollTop; // the band stayed clear of the auto-scroll edges
  // "Entered selection mode" is checked by whether the bottom floating bar is shown (the
  // grid-side .selecting class disappeared along with the hover parts it was meant to
  // hide — #618 finalized decision A).
  out.selectingClass = document.querySelector('[data-slot="selection-bar"]')?.getAttribute('aria-hidden') === 'false';
  out.bandRemovedA = !band();

  // B. a press that never crosses the threshold draws no band, and with Ctrl held
  //    it leaves the selection completely alone (#242 skips the clear on a modifier)
  down(x0, cy, { ctrlKey: true });
  move(x0 + 1, cy + 1);
  // Both windows below are "prove it did NOT happen" checks, so they spend their
  // whole timeout on purpose (#986) — waiting for a post-condition would make them
  // pass by construction. Kept short for the same reason.
  out.bandDuringB = !(await neverHappens('a band to appear from a press under the threshold', () => !!band(), 200));
  up();
  const afterA = out.gotA.join(',');
  await neverHappens('the release under the threshold to disturb the selection', () => selectedKeys().join(',') !== afterA, 200);
  out.gotB = selectedKeys();

  // C. Ctrl held at press time EXTENDS: row 1's first two cards join row 0's.
  // Row 1 is read here rather than up top, and only once the layout has stopped moving
  // again: the cases above changed the selection, and this is the first band that is
  // NOT anchored to row 0, so it is the first one a shifted layout can miss (#1007).
  out.settledBeforeC = await waitStable('the masonry layout to stop moving before the Ctrl+drag places its band', () => rectsOf('[data-slot="post-grid"] [data-slot="post-card"]'));
  const rowsC = readRows();
  const row1 = rowsC[1];
  // Named rather than optional-chained: every coordinate of this case is measured off
  // these two cards, so a grid that laid out no such row has to stop the run.
  if (!row1 || row1.length < 2) throw new Error('the grid laid out no second row of two cards for the Ctrl+drag case');
  const cy1 = Math.round((row1[0].r.top + row1[0].r.bottom) / 2);
  const x1b = Math.round((row1[1].r.left + row1[1].r.right) / 2);
  // Kept as its own field, and checked as its own line, because expectC below is a
  // UNION with what case A left selected: a band that crosses nothing collapses expectC
  // onto gotA, and the check then asks the release for two contradictory things at once
  // ("the same cards as before" AND "more cards than before"). No answer satisfies that,
  // so the case reported a broken Ctrl+drag while Ctrl+drag was working (#1007).
  out.bandC = expectFor(x0, cy1 - 5, x1b, cy1 + 5);
  out.expectC = [...new Set([...out.gotA, ...out.bandC])].sort();
  await drag(x0, cy1 - 5, x1b, cy1 + 5, { ctrlKey: true }, out.expectC);
  out.gotC = selectedKeys();

  // D. a plain drag over a single card REPLACES everything selected so far
  const only = row0[0];
  const onlyX = Math.round((only.r.left + only.r.right) / 2);
  out.expectD = expectFor(x0, cy - 5, onlyX, cy + 5);
  await drag(x0, cy - 5, onlyX, cy + 5, undefined, out.expectD);
  out.gotD = selectedKeys();

  // E. the band paints while dragging, and Esc puts the selection back
  const before = selectedKeys();
  down(x0, cy1 - 5);
  move(x0 + 8, cy1);
  out.bandVisibleE = await waitFor('the band to be painted while dragging', () => !!band(), 3000);
  move(x1b, cy1 + 5);
  // Live preview needs an animation frame, and a hidden window throttles rAF hard
  // (the passes above only land because the release does one final synchronous
  // pass) — so wait generously instead of assuming a 60Hz clock.
  out.changedDuringE = await waitFor('the selection to preview live while the band moves', () => selectedKeys().join(',') !== before.join(','), 6000);
  esc();
  out.bandRemovedE = !band(); // finish('cancel') removes the overlay synchronously
  await waitFor('Esc to put the pre-drag selection back', () => selectedKeys().join(',') === before.join(','), 4000);
  out.gotE = selectedKeys();
  out.expectE = before;
  up(); // the real gesture still ends with a release; it must not re-apply the band
  // "Nothing happens" again: spending the window is the check (#986).
  await neverHappens('the release after Esc to re-apply the cancelled band', () => selectedKeys().join(',') !== before.join(','), 200);
  out.gotEAfterUp = selectedKeys();

  // F. a drag that starts ON a card is not a marquee (cards own the OS drag-out)
  const cardEl = row0[0].el;
  cardEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: onlyX, clientY: cy }));
  move(x1, cy + 40);
  out.bandFromCard = !(await neverHappens('a band to appear from a drag that started on a card', () => !!band(), 200));
  up(); // no listeners are attached (the press never armed a gesture) — nothing to settle

  // G. a plain click on empty space clears the selection AND sends the inspector
  //    back to its placeholder (#242). The card click first is what fills the panel.
  cardEl.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, clientX: onlyX, clientY: cy }));
  await waitFor('the clicked card to be selected and fill the inspector', () => selectedKeys().length === 1 && inspectedCards() === 1 && panelFilled(), 4000);
  out.selectedBeforeG = selectedKeys();
  out.inspectedBeforeG = inspectedCards();
  out.panelFilledBeforeG = panelFilled();
  click(x0, cy);
  await waitFor('the background click to clear the selection and empty the inspector', () => selectedKeys().length === 0 && !panelFilled() && panelPlaceholder(), 4000);
  out.gotG = selectedKeys();
  out.inspectedAfterG = inspectedCards();
  out.panelFilledAfterG = panelFilled();
  out.panelPlaceholderAfterG = panelPlaceholder();
  out.bandDuringG = !!band(); // a click must not leave a rectangle behind

  // H. the same click with a modifier held changes nothing (Nautilus / Dolphin
  //    both gate their unselect_all on Ctrl/Shift being up)
  await drag(x0, cy - 5, x1, cy + 5, undefined, expectFor(x0, cy - 5, x1, cy + 5));
  out.beforeH = selectedKeys();
  const beforeH = out.beforeH.join(',');
  // Both are "the modifier makes this a no-op" claims — the window has to be spent,
  // not short-circuited by a post-condition (#986).
  click(x0, cy, { ctrlKey: true });
  await neverHappens('Ctrl + a background click to touch the selection', () => selectedKeys().join(',') !== beforeH, 200);
  out.gotHCtrl = selectedKeys();
  click(x0, cy, { shiftKey: true });
  await neverHappens('Shift + a background click to touch the selection', () => selectedKeys().join(',') !== beforeH, 200);
  out.gotHShift = selectedKeys();

  // The premise every case from A to H rests on: cy / x1 / onlyX were measured once,
  // off row 0, and stay meaningful only while the masonry has not re-laid itself out
  // underneath them. Checked here rather than assumed, so a layout that moved is
  // reported as a layout that moved instead of as a gesture that broke (#1007). Case I
  // scrolls, so this is the last moment the comparison means anything.
  out.layoutHeldThroughH = JSON.stringify(rectsOf('[data-slot="post-grid"] [data-slot="post-card"]')) === layout0;

  // I. the empty space BELOW the last row is background too (#242 finalized design 3):
  //    the grid is only as tall as its cards, so this is the biggest click target
  //    of all and the one a rect-of-the-grid hit test would miss.
  scroller.scrollTop = scroller.scrollHeight;
  // Scrolling to the end rebuilds masonic's render window, so the answer to "where
  // is the last row" moves for a while — wait for it to stop.
  out.bottomSettled = await waitStable('the last row to stop moving after scrolling to the bottom', () => [Math.round(scroller.scrollTop), rectsOf('[data-slot="post-grid"] [data-slot="post-card"]')]);
  const lowest = Math.max(...cards().map((c) => c.getBoundingClientRect().bottom));
  const belowY = Math.round(lowest + 24);
  const belowX = Math.round(sr.left + scroller.clientWidth / 2);
  out.belowAvailable = belowY < sr.bottom - 4;
  out.belowIsEmpty = out.belowAvailable && !document.elementFromPoint(belowX, belowY)?.closest('[data-slot="post-card"]');
  out.beforeI = selectedKeys();
  if (out.belowAvailable) {
    click(belowX, belowY);
    await waitFor('the click below the last row to clear the selection', () => selectedKeys().length === 0, 4000);
  }
  out.gotI = selectedKeys();

  // J. the poster grid rides the same gesture (#242). It has no selection — poster
  //    cards are inspected, never selected — so all its background click does is put
  //    the panel both grids share back to the placeholder.
  [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '投稿者')?.click();
  out.posterCardsShown = await waitFor('the poster grid to show its cards', () => document.querySelectorAll('[data-slot="poster-grid"] [data-slot="poster-card"]').length >= 1);
  // masonic lays the poster grid out from scratch — same rect-repeats wait as the
  // post grid above, since the press point below is read off these rects.
  out.posterSettled = await waitStable('the poster grid layout to stop moving', () => rectsOf('[data-slot="poster-grid"] [data-slot="poster-card"]'));
  // Named rather than optional-chained: this card is both the click target and the
  // ruler for the press point below, so a missing one has to stop the run.
  const posterCard = document.querySelector('[data-slot="poster-grid"] [data-slot="poster-card"]');
  if (!posterCard) throw new Error('the poster grid rendered no poster card to click');
  posterCard.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  out.posterFilledBeforeJ = await waitFor('the clicked poster to fill the inspector', () => !!document.querySelector('[data-slot="inspector-body"] [data-slot="inspector-poster"]'), 4000);
  const pr = posterCard.getBoundingClientRect();
  const py = Math.round((pr.top + pr.bottom) / 2);
  out.posterPressOnEmpty = !document.elementFromPoint(x0, py)?.closest('[data-slot="poster-card"]');
  click(x0, py);
  out.posterPlaceholderAfterJ = await waitFor('the poster grid background click to return the inspector to its placeholder', () => panelPlaceholder(), 4000);

  out.errors = errors;
  return JSON.stringify(out);
});

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: configDir,
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_EVAL: evalJs,
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', () => {
  fs.rmSync(tmp, { recursive: true, force: true });
  const r = readEvalResult(out);
  if (!r) {
    console.log('MARQUEE_TEST_FAIL (no eval result)');
    process.exit(1);
  }
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const checks: Array<[string, boolean]> = [
    // Reported rather than assumed: every expectation below is read off rects that
    // are only meaningful once masonic stopped moving them (#952).
    ['the grid stopped moving before the rects were read', r.gridSettled === true],
    ['the grid laid out several rows', r.rowCount >= 2 && r.row0Count >= 2],
    ['the press point is empty space, not a card', r.startsOnEmptySpace === true],
    ['a drag selects exactly the cards it touched', same(r.gotA, r.expectA) && r.gotA.length >= 2],
    ['the band stayed clear of the auto-scroll edges', r.scrolledA === 0],
    ['the grid enters selection mode', r.selectingClass === true],
    ['the band is removed on release', r.bandRemovedA === true],
    ['a press under the threshold draws no band', r.bandDuringB === false],
    ['Ctrl + a background click leaves the selection alone', same(r.gotB, r.gotA)],
    ['the grid stopped moving again before the Ctrl+drag placed its band', r.settledBeforeC === true],
    // Ahead of the check below because it is what makes that one answerable at all: an
    // empty band makes "extends the selection" unsatisfiable rather than false (#1007).
    ["the Ctrl+drag's band crosses cards of its own to add", Array.isArray(r.bandC) && r.bandC.length >= 2],
    ['Ctrl+drag extends the selection', same(r.gotC, r.expectC) && r.gotC.length > r.gotA.length],
    ['a plain drag replaces the selection', same(r.gotD, r.expectD) && r.gotD.length === 1],
    ['the band paints while dragging', r.bandVisibleE === true],
    ['the selection previews live during the drag', r.changedDuringE === true],
    ['Esc removes the band', r.bandRemovedE === true],
    ['Esc restores the pre-drag selection', same(r.gotE, r.expectE)],
    ['the release after Esc does not re-apply the band', same(r.gotEAfterUp, r.expectE)],
    ['a drag starting on a card is not a marquee', r.bandFromCard === false],
    ['a card click fills the inspector and selects the card', r.selectedBeforeG.length === 1 && r.inspectedBeforeG === 1 && r.panelFilledBeforeG === true],
    ['a background click empties the selection', same(r.gotG, [])],
    ['a background click returns the inspector to its placeholder', r.inspectedAfterG === 0 && r.panelFilledAfterG === false && r.panelPlaceholderAfterG === true],
    ['a background click leaves no band behind', r.bandDuringG === false],
    ['Ctrl + a background click keeps the selection', same(r.gotHCtrl, r.beforeH) && r.beforeH.length >= 2],
    ['Shift + a background click keeps the selection', same(r.gotHShift, r.beforeH)],
    ['the layout the row-0 coordinates were read from held through case H', r.layoutHeldThroughH === true],
    ['the space below the last row is background too', r.bottomSettled === true && r.belowAvailable === true && r.belowIsEmpty === true && r.beforeI.length > 0 && same(r.gotI, [])],
    ['a poster click fills the inspector', r.posterCardsShown === true && r.posterSettled === true && r.posterFilledBeforeJ === true],
    ['the poster grid background returns the inspector too', r.posterPressOnEmpty === true && r.posterPlaceholderAfterJ === true],
    ['no handler threw', Array.isArray(r.errors) && r.errors.length === 0],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  if (failed) console.log('  got: ' + JSON.stringify(r));
  console.log(failed ? 'MARQUEE_TEST_FAIL' : 'MARQUEE_TEST_PASS');
  process.exit(failed ? 1 : 0);
});
