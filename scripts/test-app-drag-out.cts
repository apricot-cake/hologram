'use strict';

// Verifies the card's dragstart wiring for drag-out (#132) in a real renderer:
//
//  - a drag started on a card image is INTERCEPTED (preventDefault) — otherwise
//    the browser's own drag runs and carries the asset:// thumbnail URL instead
//    of the original files
//  - a drag NEVER writes the selection, inside it or outside it. Explorer looks
//    like it selects what you drag, but that's its mousedown; and Hologram's
//    selection is a working set built by hand across a scroll, not Explorer's
//    throwaway cursor, so a gesture that leaves the app must not rewrite it
//  - a drag started off the image (post text) is left to the browser
//
// What each drag HANDS OVER can't be observed from here: window.hologram is deep
// frozen by contextBridge, so the IPC can't be spied on, and the OS drag itself
// is out of reach. That rule is pure and lives in records.ts's dragFilesOf —
// covered by scripts/test-records-unit.cts. This harness covers the glue around
// it; main's side (name gate, missing files) is scripts/test-library-files.cts.
//
//   node scripts/test-app-drag-out.cts

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-dragout-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
// The card renders from `image` (a real screenshot on disk), but the ORIGINALS a
// drag hands over are `media` — deliberately NOT written. main's drag-out drops
// missing paths, so the handler runs its full course without ever starting a real
// OS drag session on the machine running the tests.
const ids = ['dummy-d1', 'dummy-d2', 'dummy-d3'];
const records: any[] = [];
ids.forEach((id, i) => {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  records.push({
    captureId: id,
    image: `${id}.jpg`,
    url: `https://x.com/u/status/${900 + i}`,
    platform: 'x',
    text: `本文${i}`,
    displayName: `人${i}`,
    screenName: `u${i}`,
    capturedAt: `2026-05-0${i + 1}T12:00:00Z`,
    date: `2026-04-0${i + 1}T10:00:00Z`,
    media: [{ file: `${id}-orig.jpg`, url: 'https://x.com/i/1.jpg' }],
    tags: [],
    hashtags: [],
  });
});
seedLibrary(configDir, records);

const evalJs = evalSource(async ({ waitFor, neverHappens }) => {
  await waitFor('the grid to show all 3 seeded posts', () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length >= 3);
  // Addressed by what the card says (the cells carry no key attribute — #618).
  const postCards = () => [...document.querySelectorAll<HTMLElement>('[data-slot="post-grid"] [data-slot="post-card"]')];
  const cardOf = (n) => postCards().find((c) => (c.textContent || '').includes('本文' + n));
  // Named + thrown rather than optional-chained: the card and the part of it a drag starts
  // on ARE the step, so a missing one has to stop the run and say which was gone. `?.`
  // would skip the gesture and leave a later assertion to report something unrelated.
  const cardMust = (n) => {
    const c = cardOf(n);
    if (!c) throw new Error('the card 本文' + n + ' is missing from the grid');
    return c;
  };
  const partMust = (n, slot) => {
    const part = cardMust(n).querySelector('[data-slot="' + slot + '"]');
    if (!part) throw new Error('the ' + slot + ' of card 本文' + n + ' is missing');
    return part;
  };
  const nameOf = (c) => ((c.textContent || '').match(/本文(\d)/) || [])[0] || '?';
  const selectedKeys = () =>
    postCards()
      .filter((c) => c.hasAttribute('data-selected'))
      .map(nameOf)
      .sort()
      .join(',');
  // A handler that throws is the failure mode this suite exists for: dispatchEvent
  // does NOT rethrow, so a dead line after the throw is invisible from the page —
  // it only surfaces as an uncaught error. That's how drag-out shipped broken with
  // this suite green (#132/#185): everything asserted below happened BEFORE the
  // throw, and the hologramIpc.dragOut() after it never ran.
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  // Every case here asserts that a drag CHANGED NOTHING, so there is no post-condition to
  // wait for: a wait would end the moment it was set up and prove nothing. The window is
  // spent in full on purpose, giving a wrong selection write (which re-renders the cells
  // through the hologramStore subscription) time to show up before it is read (#986).
  const dragFrom = async (el, keep) => {
    const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    await neverHappens('the drag to rewrite the selection (expected it to stay ' + (keep || 'empty') + ')', () => selectedKeys() !== keep, 300);
    return ev.defaultPrevented;
  };
  const out: Record<string, any> = {};

  // 1. nothing selected: the drag is intercepted and selects NOTHING — an export
  //    gesture leaves the library as it found it
  out.prevented1 = await dragFrom(partMust(0, 'post-card-media'), '');
  out.selAfter1 = selectedKeys();

  // 2. build a real selection by hand the way a user does now that the ○ ring is
  //    gone (#143): a plain click single-selects, Ctrl-click adds the second card.
  cardMust(0).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  cardMust(1).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  // Waits on the SIZE of the selection, then reads which cards are in it — so a pair
  // built out of the wrong cards still fails.
  await waitFor('the two clicked cards to both show as selected', () => selectedKeys().split(',').length === 2);
  out.selBuilt = selectedKeys();

  // 3. drag a card INSIDE that selection → selection untouched
  out.prevented3 = await dragFrom(partMust(0, 'post-card-media'), '本文0,本文1');
  out.selAfter3 = selectedKeys();

  // 4. drag a card OUTSIDE it → still untouched. The hand-built working set is not
  //    Explorer's throwaway cursor; dragging one card must not wipe it (which files
  //    actually leave is records.ts's dragFilesOf — test-records-unit).
  out.prevented4 = await dragFrom(partMust(2, 'post-card-media'), '本文0,本文1');
  out.selAfter4 = selectedKeys();

  // 5. a drag started on the post text is NOT ours — the browser keeps it
  const txt = partMust(2, 'post-card-meta');
  out.preventedText = await dragFrom(txt, '本文0,本文1');
  out.selAfterText = selectedKeys();
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
    console.log('DRAG_OUT_TEST_FAIL (no eval result)');
    process.exit(1);
  }
  const checks = [
    ['card image drag is intercepted', r.prevented1 === true],
    ['a drag selects nothing (export must not change the library)', r.selAfter1 === ''],
    ['click + Ctrl-click builds the selection', r.selBuilt === '本文0,本文1'],
    ['dragging inside the selection leaves it alone', r.prevented3 === true && r.selAfter3 === '本文0,本文1'],
    ['dragging outside the selection leaves it alone too', r.prevented4 === true && r.selAfter4 === '本文0,本文1'],
    ['a drag off the image is left to the browser', r.preventedText === false],
    ['a drag off the image leaves the selection alone', r.selAfterText === '本文0,本文1'],
    // The one that would have caught the shipped bug: no drag may throw, or the
    // ipc call after the throw silently never happens.
    ['no drag threw (a throw skips the IPC after it)', Array.isArray(r.errors) && r.errors.length === 0],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  if (failed) console.log('  got: ' + JSON.stringify(r));
  console.log(failed ? 'DRAG_OUT_TEST_FAIL' : 'DRAG_OUT_TEST_PASS');
  process.exit(failed ? 1 : 0);
});
