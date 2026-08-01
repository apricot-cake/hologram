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
const evalJs = `(async () => {
  const grid = document.querySelector('[data-slot="post-grid"]');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // The size axis is only observable from outside as "how big are the cells" (the path
  // that wrote a CSS variable was removed in #618) — measure the width of an actually
  // rendered card. Columns stretch to fill the width, so this ends up reading the result
  // of "how many columns fit at that setting" rather than the raw minimum column width.
  const size = () => { const c = grid.querySelector('[data-slot="post-card"]'); return c ? Math.round(c.getBoundingClientRect().width) : Number.NaN; };
  const fire = (deltaY, x, y) => {
    const r = grid.getBoundingClientRect();
    grid.dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey: true, clientX: x == null ? r.left + 20 : x, clientY: y == null ? r.top + 20 : y, bubbles: true, cancelable: true }));
  };
  const start = size();

  // --- Anchor preservation (#282) ---
  // Does the post that was being looked at stay at the same height on screen before and
  // after zooming? Alignment is done by the grid island reading its own layout, so what's
  // measured here is only the result — the card's on-screen top.
  //
  // Careful with how you wait: a fixed sleep would measure before the first layout pass
  // finishes, and would misread a state where the scroll happened over still-short content
  // (i.e. it had nowhere to go anyway) as "didn't drift". In practice the fixed-sleep
  // version broke this way 2 times out of 3. So wait for the state instead.
  const waitFor = async (fn, ms) => {
    for (let i = 0; i * 50 < ms; i++) { if (fn()) return true; await sleep(50); }
    return false;
  };
  // Wait until the scroll position stops moving (the change applies on an rAF, finalizes
  // 150ms later, and after that another relayout-and-settle pass follows for the measurement).
  const settle = async () => {
    let last = Number.NaN, stable = 0;
    for (let i = 0; i < 60 && stable < 3; i++) {
      await sleep(50);
      const s = Math.round(scroller.scrollTop);
      if (s === last) stable++;
      else { stable = 0; last = s; }
    }
  };
  // Twin of settle() above, but for the SIZE axis instead of scrollTop: a size
  // commit goes through the same rAF-then-150ms-settle pipeline (see
  // grid-density-builder.ts's handleZoomWheel), and on a loaded machine that
  // pipeline can take meaningfully longer than a fixed sleep budgets for — the
  // same trap the comment above already called out for scrollTop (a fixed 300ms
  // sleep here read the pre-commit value on a slow CI runner's nightly run).
  const settleSize = async (ms) => {
    let last = Number.NaN, stable = 0;
    for (let i = 0; i * 50 < ms && stable < 3; i++) {
      await sleep(50);
      const s = size();
      if (s === last) stable++;
      else { stable = 0; last = s; }
    }
    return size();
  };
  const scroller = document.querySelector('[data-slot="content-scroll"]');
  // Wait until the full-content height stands up, i.e. until the virtual grid finishes its first layout pass.
  const laidOut = await waitFor(() => scroller.scrollHeight > scroller.clientHeight * 4, 8000);
  scroller.scrollTop = 2000;
  const scrolled = await waitFor(() => Math.abs(scroller.scrollTop - 2000) < 2, 3000);
  const sr = scroller.getBoundingClientRect();
  const seen = () => [...grid.querySelectorAll('[data-slot="post-card"]')].map((c) => [c, c.getBoundingClientRect()]).filter(([, r]) => r.bottom > sr.top && r.top < sr.bottom);
  // Assigning scrollTop directly is a "big jump" — until the virtual grid rebuilds its
  // render window, it still holds cells from the previous location. Reading right after
  // scrollTop **alone** settles can see an empty screen (the trap called out in #282's own
  // body; measured hitting it 2 times out of 3), so wait until cells are actually visible.
  const windowed = await waitFor(() => seen().length > 0, 8000);
  await settle();
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
  const srcOf = (c) => { const el = c && c.querySelector('[data-slot="post-card-media"]'); return el ? (el.getAttribute('src') || '').split('?')[0] : null; };
  const anchorKey = srcOf(target);
  if (target) fire(-120, r0.left + r0.width / 2, r0.top + r0.height / 2); // zoom in one notch
  await settle();
  const moved = Math.round(scroller.scrollTop) !== scrolledTo; // did alignment actually kick in
  const held = anchorKey ? [...grid.querySelectorAll('[data-slot="post-card"]')].find(c => srcOf(c) === anchorKey) : null;
  const drift = held && r0 ? Math.round(held.getBoundingClientRect().top - r0.top) : 9999;
  const anchorReady = laidOut && scrolled && windowed && !!anchorKey;
  // Return to the original size before entering the series below (start was already read above).
  fire(120);
  await settle();

  // Pull all the way down to the floor (stops at the track's end — further notches are
  // no-ops beyond that). Notches are applied batched in a single frame, so reading
  // synchronously would read the pre-change value — wait for the 150ms settle before reading.
  for (let i = 0; i < 40; i++) fire(120);
  const small = await settleSize(5000);
  const prefs = await window.hologram.getPrefs();
  // Turning it further while pinned to the edge doesn't move the size any more. **Not
  // running the finalize step** can't actually be verified here — at this scale (200
  // records) finalizing is nearly free and triggers neither a DOM node swap nor a thumbnail
  // re-request, so passing would be a meaningless assertion (confirmed green under both
  // implementations). Eyeballing and measuring at real-library scale is the authority here.
  for (let i = 0; i < 10; i++) fire(120);
  const stableAtLimit = (await settleSize(5000)) === small;
  // Zoom back in (zoom-in is deltaY<0)
  for (let i = 0; i < 3; i++) fire(-120);
  const back = await settleSize(5000);
  return [start, small, prefs.gridSize, back, stableAtLimit, anchorReady ? 1 : 0, drift, moved ? 1 : 0].join(',');
})()`;

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
  const [start, small, persisted, back, stableAtLimit, anchored, drift, moved] = m[1].split(',');
  const checks = [
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
  console.log(`values: start=${start} small=${small} persisted=${persisted} back=${back} drift=${drift} moved=${moved}`);
  console.log(failed ? 'OVERVIEW_ZOOM_TEST_FAIL' : 'OVERVIEW_ZOOM_TEST_PASS');
  process.exit(failed ? 1 : 0);
});
