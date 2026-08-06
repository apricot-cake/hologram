'use strict';

// Verifies overview zoom (#141) behavior in an isolated instance. Does Ctrl+wheel move the
// size axis by one notch, do cells shrink all the way down to the floor, and does gridSize
// get finalized and persisted once it settles? At the floor, chrome like the ×N badge drops
// away (so it doesn't cover the thumbnail). Also measures whether zooming keeps the post
// under the cursor at the same height on screen (#282). This isn't the real app but a
// separate HOLOGRAM_SMOKE process with a separate config, so it doesn't collide even while
// the user is operating the main app (docs/build.md). Same harness as test-app-tagtypes.cts.
//
//   node scripts/test-app-overview-zoom.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-overview-zoom-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
// Boot with square thumbnails, a grid with no info shown (starting from a position with a
// few notches of room down to the floor of 48). With "show info" ON the floor is 200px, so
// the overview floor itself can't be measured (#618).
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', layoutMode: 'grid', squareThumbs: true, showInfo: false, gridSize: 180 }));

const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' + 'AAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';

// The column-count track is 1 notch = 1 column, so the size axis itself works no matter how
// many items there are. What needs a large count is anchor preservation (#282) — if
// everything fits on one screen the scroll position never moves, and there's no way to tell
// whether it stayed in place or simply had nowhere to go. Seed enough that 180px tiles run to dozens of rows.
const records: any[] = [];
for (let i = 0; i < 200; i++) {
  const captureId = `171750000000${i}-abcd`;
  fs.writeFileSync(path.join(saveFolder, `${captureId}.jpg`), Buffer.from(jpegB64, 'base64'));
  records.push({
    captureId,
    image: `${captureId}.jpg`,
    url: `https://x.com/testuser/status/${i}`,
    platform: 'x',
    text: `俯瞰ズーム検証用のダミー投稿 ${i}`,
    displayName: 'てすと太郎',
    screenName: 'testuser',
    date: '2026-04-04T10:30:00Z',
    capturedAt: '2026-04-04T12:00:00Z',
  });
}
seedLibrary(configDir, records);

// Fire the wheel event over the grid (the handler only looks inside the scroll surface).
// Firing straight at window makes target === window, which gets ignored as outside the scroll area.
const evalJs = evalSource(async ({ waitFor, waitStable, neverHappens }) => {
  const grid = document.querySelector('[data-slot="post-grid"]');
  // Named rather than optional-chained: every measurement below reads this element, so a
  // missing grid has to stop the run under its own name instead of turning into a NaN
  // that the value checks would report as "the cells never shrank".
  if (!grid) throw new Error('the post grid is missing');
  // The size axis is only observable from outside as "how big are the cells" (the path
  // that wrote a CSS variable was removed in #618) — measure the width of an actually
  // rendered card. Columns stretch to fill the width, so this ends up reading the result
  // of "how many columns fit at that setting" rather than the raw minimum column width.
  const size = () => {
    const c = grid.querySelector('[data-slot="post-card"]');
    return c ? Math.round(c.getBoundingClientRect().width) : Number.NaN;
  };
  const fire = (deltaY: number, x?: number, y?: number) => {
    const r = grid.getBoundingClientRect();
    grid.dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey: true, clientX: x == null ? r.left + 20 : x, clientY: y == null ? r.top + 20 : y, bubbles: true, cancelable: true }));
  };

  // Resolved here, above the waits that close over it — same reasoning as the grid: the
  // scroll surface is what every anchor measurement reads, so its absence stops the run
  // under its own name.
  const scroller = document.querySelector('[data-slot="content-scroll"]');
  if (!scroller) throw new Error('the content scroll surface is missing');

  // --- Anchor preservation (#282) ---
  // Does the post that was being looked at stay at the same height on screen before and
  // after zooming? Alignment is done by the grid island reading its own layout, so what's
  // measured here is only the result — the card's on-screen top.
  //
  // Careful with how you wait: a fixed sleep would measure before the first layout pass
  // finishes, and would misread a state where the scroll happened over still-short content
  // (i.e. it had nowhere to go anyway) as "didn't drift". In practice the fixed-sleep
  // version broke this way 2 times out of 3. So wait for the state instead.
  //
  // Wait until the scroll position stops moving (the change applies on an rAF, finalizes
  // 150ms later, and after that another relayout-and-settle pass follows for the measurement).
  const settle = () => waitStable('the scroll position to stop moving', () => Math.round(scroller.scrollTop), 3000);
  // Twin of settle() above, but for the SIZE axis instead of scrollTop — and unlike
  // a plain stability poll it must never read "the value has not moved yet" as
  // "settled", which is the trap this harness kept falling into.
  //
  // A burst of notches only becomes visible once its 150ms commit fires AND the
  // grid has re-rendered at the new column width (grid-density-builder.ts's
  // handleZoomWheel). The frames before that carry the live column width, but this
  // harness's window is hidden, so it paints nothing and the rAF that would apply
  // them does not run: measured here, the rAF for one notch fired 422ms after the
  // wheel while the size moved at 165ms — through the commit's setTimeout, never
  // through the frame. So the wait is 150ms plus a full re-layout of the render
  // window, and on a loaded runner that re-layout is not free.
  //
  // Before #618 the size was read off a CSS variable the state layer wrote, so only
  // the commit had to be waited out and a fixed ~300ms sleep covered it; reading a
  // real card's box added the re-render on top, which is what put the nightly
  // Windows runner over the edge (green 7/30, red 7/31 and 8/1 at identical values).
  // Replacing that sleep with a stability poll did not help, because a poll returns
  // FASTEST when nothing has happened yet.
  //
  // So: wait for the size to LEAVE the value it had before the wheel, then wait for
  // it to stop moving.
  const settleFrom = async (label: string, from: number, ms: number) => {
    const moved = await waitFor(
      'the cell size to leave ' + from + 'px after ' + label,
      () => {
        const s = size();
        return Number.isFinite(s) && s !== from;
      },
      ms,
    );
    if (!moved) return from;
    await waitStable('the cell size to stop moving after ' + label, size, ms);
    return size();
  };
  // The opposite assertion — that a notch does NOT move the size — cannot be a
  // settle at all: "unchanged" is exactly what a settle reports fastest, so it would
  // pass without ever outliving the commit. neverHappens holds for the whole window
  // instead and reports the moment the size leaves.
  const holdSize = (from: number, ms: number) =>
    neverHappens(
      'the cell size to move while the track is already at its end',
      () => {
        const s = size();
        return Number.isFinite(s) && s !== from;
      },
      ms,
    );
  // Wait until the full-content height stands up, i.e. until the virtual grid finishes its first layout pass.
  const laidOut = await waitFor('the virtual grid to stand up a full-length scroll height', () => scroller.scrollHeight > scroller.clientHeight * 4, 8000);
  scroller.scrollTop = 2000;
  const scrolled = await waitFor('the scroll position to land at 2000px', () => Math.abs(scroller.scrollTop - 2000) < 2, 3000);
  const sr = scroller.getBoundingClientRect();
  const seen = () => [...grid.querySelectorAll('[data-slot="post-card"]')].map((c): [Element, DOMRect] => [c, c.getBoundingClientRect()]).filter(([, box]) => box.bottom > sr.top && box.top < sr.bottom);
  // Assigning scrollTop directly is a "big jump" — until the virtual grid rebuilds its
  // render window, it still holds cells from the previous location. Reading right after
  // scrollTop **alone** settles can see an empty screen (the trap called out in #282's own
  // body; measured hitting it 2 times out of 3), so wait until cells are actually visible.
  const windowed = await waitFor('the virtual grid to rebuild its render window at the new scroll position', () => seen().length > 0, 8000);
  await settle();
  // THE BASELINE IS TAKEN HERE, not at the top of this script. A card's box only carries the
  // size axis once the virtual grid has laid out for real; before that first pass it is a
  // couple of pixels wide, and reading the baseline there hands every later comparison a
  // number the grid never had. That is what the runner reported on 8/2 (start=2), so
  // "cells shrink" compared 51 against 2 and failed while the zoom itself had worked (#818).
  // Local runs never saw it because the layout landed before the first statement ran; the
  // runner is simply slower, which is the same reason the waits above exist at all.
  const sized = await waitFor(
    'a real card box to carry the size axis (the baseline measurement)',
    () => {
      const s = size();
      return Number.isFinite(s) && s >= 48;
    },
    8000,
  );
  const start = size();
  const scrolledTo = Math.round(scroller.scrollTop);
  const midY = sr.top + sr.height / 2;
  // Among the cards visible on screen, target the one closest to the viewport center.
  const visible = seen();
  visible.sort((a, b) => Math.abs(a[1].top + a[1].height / 2 - midY) - Math.abs(b[1].top + b[1].height / 2 - midY));
  const target = visible.length ? visible[0][0] : null;
  const r0 = visible.length ? visible[0][1] : null;
  // With "show info" off, cells carry no text, so the one grabbed is identified by the
  // "displayed image" instead (cells carry no key attribute — #618).
  // Thumbnail width changes with the size axis, so drop the URL query and compare only which file it is.
  const srcOf = (c: Element | null) => {
    const el = c && c.querySelector('[data-slot="post-card-media"]');
    return el ? (el.getAttribute('src') || '').split('?')[0] : null;
  };
  const anchorKey = srcOf(target);
  // `target` and `r0` are the two halves of the same lookup — both are set exactly when a
  // card was visible, so testing both here is the same condition, spelled so tsc can see it.
  if (target && r0) fire(-120, r0.left + r0.width / 2, r0.top + r0.height / 2); // zoom in one notch
  // The alignment rides on the very commit that applies the size, so wait for the
  // size to actually move before letting the scroll position settle — otherwise
  // "moved" is read while the burst has not been applied at all.
  if (target) await settleFrom('zooming in one notch', start, 8000);
  await settle();
  const moved = Math.round(scroller.scrollTop) !== scrolledTo; // did alignment actually kick in
  const held = anchorKey ? [...grid.querySelectorAll('[data-slot="post-card"]')].find((c) => srcOf(c) === anchorKey) : null;
  const drift = held && r0 ? Math.round(held.getBoundingClientRect().top - r0.top) : 9999;
  const anchorReady = laidOut && scrolled && windowed && !!anchorKey;
  // Return to the original size before entering the series below (start was already read above).
  const zoomed = size();
  fire(120);
  await settleFrom('zooming back out to the starting size', zoomed, 8000);
  await settle();

  // Pull all the way down to the floor (stops at the track's end — further notches are
  // no-ops beyond that). Notches are applied batched in a single frame, so reading
  // synchronously would read the pre-change value — wait for the 150ms settle before reading.
  const beforePull = size();
  for (let i = 0; i < 40; i++) fire(120);
  const small = await settleFrom('pulling all the way down to the floor', beforePull, 8000);
  // Persisting gridSize is a SEPARATE, later event than the size becoming visible:
  // the cells reach their new width on the live column width, the pref is only
  // written when the burst settles. Reading it once right after the size lands
  // therefore reads the value from before the pull on a slow runner. Wait for the
  // pref to catch up with what is on screen instead (they agree to within the 1px
  // the stretch rounds away).
  let persistedSize = Number.NaN;
  // window.hologram is the preload bridge; scripts/ has no declaration for it, so the
  // shape is named here at the one place this harness reads it.
  const prefs = () => (window as unknown as { hologram: { getPrefs(): Promise<{ gridSize: number }> } }).hologram.getPrefs();
  await waitFor(
    'the persisted gridSize to catch up with the cells on screen',
    async () => {
      persistedSize = (await prefs()).gridSize;
      return Math.abs(persistedSize - small) <= 1;
    },
    8000,
  );
  // Turning it further while pinned to the edge doesn't move the size any more. **Not
  // running the finalize step** can't actually be verified here — at this scale (200
  // records) finalizing is nearly free and triggers neither a DOM node swap nor a thumbnail
  // re-request, so passing would be a meaningless assertion (confirmed green under both
  // implementations). Eyeballing and measuring at real-library scale is the authority here.
  for (let i = 0; i < 10; i++) fire(120);
  // 1.5s outlives the 150ms commit plus a re-layout even on a loaded runner, so a
  // notch that DID move the size cannot hide inside the window.
  const stableAtLimit = await holdSize(small, 1500);
  // Zoom back in (zoom-in is deltaY<0)
  for (let i = 0; i < 3; i++) fire(-120);
  const back = await settleFrom('zooming back in three notches', small, 8000);
  return [start, small, persistedSize, back, stableAtLimit, anchorReady ? 1 : 0, drift, moved ? 1 : 0, sized ? 1 : 0].join(',');
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
  const m = out.match(/EVAL_RESULT "([^"]*)"/);
  if (!m) {
    console.log('OVERVIEW_ZOOM_TEST_FAIL (no EVAL_RESULT)');
    process.exit(1);
  }
  const [start, small, persisted, back, stableAtLimit, anchored, drift, moved, sized] = m[1].split(',');
  const checks = [
    // Stated separately from the value checks below: "the grid never laid out" and "the grid
    // laid out at the wrong size" are different failures, and only the second one is about
    // the feature. Without this line the first one arrives disguised as the second (#818).
    ['開始サイズの採寸前提が整っている（グリッドの初回レイアウト完了）', sized === '1'],
    ['開始サイズは復元された180あたり', Number(start) >= 180],
    ['Ctrl+ホイール下でセルが縮む', Number(small) < Number(start)],
    ['下限は48（それ以下へ落ちない）', Number(small) >= 48],
    ['俯瞰サイズまで引ける（<96）', Number(small) < 96],
    ['停止後に gridSize が確定・永続化', Number(persisted) >= 48 && Number(persisted) < 96],
    ['端で回し続けてもサイズが動かない', stableAtLimit === 'true'],
    ['Ctrl+ホイール上でズームインして戻る', Number(back) > Number(small)],
    // #282: the grabbed post survives and stays at nearly the same height on screen. 8px is
    // one tile-gap's worth — wide enough to always fail a "drifted by a whole row", while
    // letting a 1-2px rounding difference through.
    ['アンカー計測の前提が整っている（レイアウト完了・スクロール成立・掴めた）', anchored === '1'],
    ['掴んだ投稿がズーム後も同じ高さに残る', Math.abs(Number(drift)) <= 8],
    ['位置合わせが実際にスクロールを動かしている', moved === '1'],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) failed++;
  }
  console.log(`values: start=${start} small=${small} persisted=${persisted} back=${back} drift=${drift} moved=${moved} sized=${sized}`);
  console.log(failed ? 'OVERVIEW_ZOOM_TEST_FAIL' : 'OVERVIEW_ZOOM_TEST_PASS');
  process.exit(failed ? 1 : 0);
});
