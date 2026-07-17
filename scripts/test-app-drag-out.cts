'use strict';

// Verifies the #postGrid dragstart wiring for drag-out (#132) in a real renderer:
//
//  - a drag started on a card image is INTERCEPTED (preventDefault) — otherwise
//    the browser's own drag runs and carries the psimg:// thumbnail URL instead
//    of the original files
//  - dragging a card OUTSIDE the current selection re-points the selection at
//    that card (the Explorer/Eagle rule), while dragging one INSIDE it leaves
//    the selection alone
//  - a drag started off the image (post text) is left to the browser
//
// What each drag HANDS OVER can't be observed from here: window.corpus is deep
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
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-dragout-'));
const configDir = path.join(tmp, 'Corpus');
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
ids.forEach((id, i) => {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, `${id}.json`),
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );
});

const evalJs = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  await waitFor(() => document.querySelectorAll('#postGrid .post-card').length >= 3);
  const cardOf = (key) => document.querySelector('#postGrid .post-card[data-key="' + key + '"]');
  const selectedKeys = () => [...document.querySelectorAll('#postGrid .post-card.selected')].map(c => c.dataset.key).sort().join(',');
  const dragFrom = async (el) => {
    const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    await sleep(80); // selection replacement re-renders the cells (corpusStore subscription)
    return ev.defaultPrevented;
  };
  const out = {};

  // 1. no selection: dragging a card image is intercepted and selects that card
  out.prevented1 = await dragFrom(cardOf('dummy-d1').querySelector('.card-img'));
  out.selAfter1 = selectedKeys();

  // 2. dragging a card already IN the selection leaves the selection alone
  out.prevented2 = await dragFrom(cardOf('dummy-d1').querySelector('.card-img'));
  out.selAfter2 = selectedKeys();

  // 3. add d2 via the ○ ring, then drag d1 (inside the selection) → both stay
  cardOf('dummy-d2').querySelector('.select-check').click();
  await sleep(80);
  out.selBefore3 = selectedKeys();
  await dragFrom(cardOf('dummy-d1').querySelector('.card-img'));
  out.selAfter3 = selectedKeys();

  // 4. drag d3 — OUTSIDE the selection → selection collapses onto d3 (Explorer rule)
  await dragFrom(cardOf('dummy-d3').querySelector('.card-img'));
  out.selAfter4 = selectedKeys();

  // 5. a drag started on the post text is NOT ours — the browser keeps it
  const txt = cardOf('dummy-d3').querySelector('.text') || cardOf('dummy-d3').querySelector('.post-meta');
  out.preventedText = await dragFrom(txt);
  out.selAfterText = selectedKeys();
  return JSON.stringify(out);
})()`;

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  CORPUS_CONFIG_DIR: configDir,
  CORPUS_SMOKE: '1',
  CORPUS_SMOKE_EVAL: evalJs,
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', () => {
  fs.rmSync(tmp, { recursive: true, force: true });
  const m = /EVAL_RESULT "(.+?)"\s*$/m.exec(out);
  let r = null;
  try {
    r = JSON.parse(JSON.parse('"' + (m ? m[1] : '') + '"'));
  } catch {
    /* fall through to the null report below */
  }
  if (!r) {
    console.log('DRAG_OUT_TEST_FAIL (no eval result)');
    process.exit(1);
  }
  const checks = [
    ['card image drag is intercepted', r.prevented1 === true],
    ['drag with nothing selected selects the dragged card', r.selAfter1 === 'dummy-d1'],
    ['re-dragging the selected card keeps the selection', r.prevented2 === true && r.selAfter2 === 'dummy-d1'],
    ['ring click adds to the selection', r.selBefore3 === 'dummy-d1,dummy-d2'],
    ['dragging inside the selection leaves it alone', r.selAfter3 === 'dummy-d1,dummy-d2'],
    ['dragging outside the selection collapses it onto that card', r.selAfter4 === 'dummy-d3'],
    ['a drag off the image is left to the browser', r.preventedText === false],
    ['a drag off the image leaves the selection alone', r.selAfterText === 'dummy-d3'],
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
