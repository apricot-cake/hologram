'use strict';

// Verifies the unified card click model (#143, redesign P2⑥) in a real renderer:
//
//   - post cards carry NO hover ℹ / ○ select ring (ホバー部品ゼロ・Eagle 純型)
//   - a plain click single-selects a post AND opens its inspector
//   - the inspector preview thumbnail opens the quick-view lightbox (peek)
//   - Ctrl-click adds a second card to the selection (Shift-range is covered by
//     test-app-drag-out's selection build)
//   - poster cards carry no ℹ button; a plain click opens the poster inspector,
//     a double-click drills into that poster's posts
//   - a double-click on a post opens the image view (in-tab history destination)
//
// The gestures are delegated on #postGrid / #posterGrid, so this drives real
// synthetic MouseEvents and asserts the resulting DOM state (inspector open,
// lightbox mounted, image view active) — the same black-box shape as
// test-app-drag-out. Boots its own sandboxed Electron (CORPUS_SMOKE).
//
//   node scripts/test-app-click-model.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-clickmodel-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
// Each post has its own url → each also yields a poster (buildUsers). image is a
// real on-disk screenshot so the card + inspector thumbnail render.
const ids = ['dummy-c1', 'dummy-c2', 'dummy-c3'];
ids.forEach((id, i) => {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, `${id}.json`),
    JSON.stringify(
      {
        captureId: id,
        image: `${id}.jpg`,
        url: `https://x.com/u${i}/status/${900 + i}`,
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
  const byId = (id) => document.getElementById(id);
  const postCards = () => [...document.querySelectorAll('#postGrid .post-card')];
  const cardOf = (key) => document.querySelector('#postGrid .post-card[data-key="' + key + '"]');
  const selectedKeys = () => [...document.querySelectorAll('#postGrid .post-card.selected')].map(c => c.dataset.key).sort();
  const click = (el, mods) => el && el.dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true }, mods)));
  const dblclick = (el) => el && el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const inspVisible = () => byId('postDetail') && !byId('postDetail').hidden;
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  const out = {};

  await waitFor(() => postCards().length >= 3);

  // A. post cards have no ℹ / ○ hover parts (they were retired in #143)
  out.postHoverParts = document.querySelectorAll('#postGrid .info-btn, #postGrid .select-check').length;

  // B. plain click = single-select + inspector (post kind, no poster head)
  click(cardOf('dummy-c1'));
  out.inspOpenedB = await waitFor(inspVisible);
  out.inspIsPost = inspVisible() && !byId('postDetail').querySelector('.iv-poster-head');
  await sleep(60);
  out.selAfterB = selectedKeys().join(',');

  // C. inspector preview thumbnail → quick-view lightbox (peek); Esc closes it
  const thumb = byId('postDetail').querySelector('.iv-insp-thumb');
  out.thumbPeekable = !!(thumb && thumb.classList.contains('iv-insp-thumb--peek'));
  click(thumb);
  out.lightboxOpened = await waitFor(() => byId('lightbox') && byId('lightbox').childElementCount > 0);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  out.lightboxClosed = await waitFor(() => byId('lightbox') && byId('lightbox').childElementCount === 0);

  // D. Ctrl-click adds a second card (plain click above kept c1 selected)
  click(cardOf('dummy-c2'), { ctrlKey: true });
  await sleep(60);
  out.selAfterD = selectedKeys().join(',');

  // The 投稿者 nav's active state tracks browseMode (grids are CSS-hidden, not
  // unmounted, so poster cards stay in the DOM — the active nav is the mode marker).
  const navActive = () => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '投稿者'); return !!(b && b.hasAttribute('data-active') && b.getAttribute('data-active') !== 'false'); };

  // E. switch to the posters view → poster cards carry no ℹ button
  [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '投稿者')?.click();
  out.posterCardsShown = await waitFor(() => navActive() && document.querySelectorAll('#posterGrid .poster-card').length >= 1);
  out.posterHoverInfo = document.querySelectorAll('#posterGrid .poster-info').length;

  // F. plain click a poster → poster inspector (has the poster head block)
  document.querySelector('#posterGrid .poster-card')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  out.inspOpenedF = await waitFor(inspVisible);
  out.inspIsPoster = inspVisible() && !!byId('postDetail').querySelector('.iv-poster-head');

  // G. double-click a poster → drill into their posts (browseMode leaves posters)
  dblclick(document.querySelector('#posterGrid .poster-card'));
  out.drilledIn = await waitFor(() => !navActive());

  // H. double-click a post → the image view (in-tab history destination)
  dblclick(postCards()[0]);
  out.imageViewActive = await waitFor(() => document.body.classList.contains('image-tab-active'));

  out.errors = errors;
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
    console.log('CLICK_MODEL_TEST_FAIL (no eval result)');
    process.exit(1);
  }
  const checks = [
    ['post cards have no ℹ / ○ hover parts', r.postHoverParts === 0],
    ['plain click opens the inspector', r.inspOpenedB === true],
    ['plain click shows the POST inspector', r.inspIsPost === true],
    ['plain click single-selects the card', r.selAfterB === 'dummy-c1'],
    ['inspector thumbnail advertises the peek (zoom-in)', r.thumbPeekable === true],
    ['inspector thumbnail opens the quick-view lightbox', r.lightboxOpened === true],
    ['Esc closes the quick-view lightbox', r.lightboxClosed === true],
    ['Ctrl-click adds a second card', r.selAfterD === 'dummy-c1,dummy-c2'],
    ['poster cards render', r.posterCardsShown === true],
    ['poster cards have no ℹ button', r.posterHoverInfo === 0],
    ['plain click opens the poster inspector', r.inspOpenedF === true && r.inspIsPoster === true],
    ['double-click a poster drills into their posts', r.drilledIn === true],
    ['double-click a post opens the image view', r.imageViewActive === true],
    ['no handler threw', Array.isArray(r.errors) && r.errors.length === 0],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  if (failed) console.log('  got: ' + JSON.stringify(r));
  console.log(failed ? 'CLICK_MODEL_TEST_FAIL' : 'CLICK_MODEL_TEST_PASS');
  process.exit(failed ? 1 : 0);
});
