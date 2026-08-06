'use strict';

// Verifies the unified card click model (#143, redesign P2⑥) in a real renderer:
//
//   - post cards carry NO hover ℹ / ○ select ring (zero hover parts — the pure Eagle model)
//   - a plain click single-selects a post AND opens its inspector
//   - the inspector preview thumbnail opens the quick-view lightbox (peek)
//   - Ctrl-click adds a second card to the selection (Shift-range is covered by
//     test-app-drag-out's selection build)
//   - poster cards carry no hover parts either; a plain click opens the poster
//     inspector, a double-click drills into that poster's posts
//   - a double-click on a post opens the image view (in-tab history destination)
//   - Home/End jump the selection to the first/last card, reusing the same guard and
//     post-move steps as arrow nav (#672); Home/End targeted at the search box is left to
//     the browser (caret-to-line motion), not hijacked
//
// The gestures are the cells' own props (#618), so this drives real
// synthetic MouseEvents and asserts the resulting DOM state (inspector open,
// lightbox mounted, image view active) — the same black-box shape as
// test-app-drag-out. Boots its own sandboxed Electron (HOLOGRAM_SMOKE).
//
//   node scripts/test-app-click-model.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { readEvalResult } = require('./lib-eval-result.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { rendererWaits } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-clickmodel-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
// Each post has its own url → each also yields a poster (buildUsers). image is a
// real on-disk screenshot so the card + inspector thumbnail render.
const ids = ['dummy-c1', 'dummy-c2', 'dummy-c3'];
const records: any[] = [];
ids.forEach((id, i) => {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  records.push({
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
  });
});
seedLibrary(configDir, records);

const evalJs = `(async () => {
  ${rendererWaits()}
  const byId = (id) => document.getElementById(id);
  const postCards = () => [...document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]')];
  // A card is addressed the way a person would address it: by what it says. The cells
  // carry no key/index attribute any more (#618) — the seeded posts read 本文0/1/2.
  const cardOf = (n) => postCards().find(c => (c.textContent || '').includes('本文' + n));
  const nameOf = (c) => ((c.textContent || '').match(/本文(\\d)/) || [])[0] || '?';
  const selectedCards = () => postCards().filter(c => c.hasAttribute('data-selected'));
  const selectedKeys = () => selectedCards().map(nameOf).sort();
  const selectedCard = () => selectedCards()[0] || null;
  const selectedIndex = () => { const c = selectedCard(); return c ? postCards().indexOf(c) : -1; };
  const arrow = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  const click = (el, mods) => el && el.dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true }, mods)));
  const dblclick = (el) => el && el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  // The panel has no id of its own (P2⑦) — data-slot is the hook, same as the
  // parts inside it.
  const insp = () => document.querySelector('[data-slot="inspector"]');
  const inspVisible = () => { const el = insp(); return !!el && !el.hidden; };
  // The peek overlay is conditionally rendered (P2⑦). Since #62 it is a shadcn Dialog, so
  // the scrim outlives the close by one fade — [data-open] is the open state, not presence.
  const peekOpen = () => !!document.querySelector('[data-slot="lightbox"][data-open]');
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  const out = {};

  await waitFor('the grid to show all 3 seeded posts', () => postCards().length >= 3);
  // The layout these cases were written against, reported so a failure says WHICH layout it
  // failed in (#975): the arrow/Home/End assertions read DOM indices, which only line up
  // while the whole seeded set is inside the virtual window.
  out.viewport = { w: innerWidth, h: innerHeight, cards: postCards().length, grid: Math.round(document.querySelector('[data-slot="post-grid"]').getBoundingClientRect().width) };

  // A. post cards have no ℹ / ○ hover parts (they were retired in #143)
  // Nothing appears on hover at all now (confirmed as Case A): no ℹ, no 🏷, no ○ ring, no highlight.
  out.postHoverParts = document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"] button, [data-slot="post-grid"] [data-slot="post-card"] [class*="act-pill"]').length;
  // Control for the 0 above: the same descendant query, asking for ANY child. A card
  // whose insides we cannot see would report 0 hover parts too, and that 0 would mean
  // nothing (#635).
  out.postCardParts = document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"] *').length;

  // B. plain click = single-select + inspector (post kind, no poster head)
  click(cardOf(0));
  out.inspOpenedB = await waitFor('the inspector to open on the clicked post card', inspVisible);
  out.inspIsPost = inspVisible() && !!insp().querySelector('[data-slot="inspector-post"]');
  // Waiting on "the clicked card is selected" and then reading the WHOLE selection keeps
  // the assertion live: a click that also left another card selected still fails.
  await waitFor('the clicked card to show as selected', () => { const c = cardOf(0); return !!c && c.hasAttribute('data-selected'); });
  out.selAfterB = selectedKeys().join(',');

  // C. inspector preview thumbnail → quick-view lightbox (peek); Esc closes it
  const thumb = insp().querySelector('[data-slot="inspector-thumb"]');
  out.thumbPeekable = !!(thumb && thumb.getAttribute('data-peek') === 'true');
  click(thumb);
  out.lightboxOpened = await waitFor('the quick-view lightbox to open from the inspector thumbnail', () => peekOpen());
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  out.lightboxClosed = await waitFor('the quick-view lightbox to close on Esc', () => !peekOpen());

  // D. Ctrl-click adds a second card (plain click above kept c1 selected)
  click(cardOf(1), { ctrlKey: true });
  await waitFor('the Ctrl-clicked card to join the selection', () => { const c = cardOf(1); return !!c && c.hasAttribute('data-selected'); });
  out.selAfterD = selectedKeys().join(',');

  // D2. Space peeks the selected card — but only with a SINGLE selection (two are
  // selected now, so Space must NOT open the lightbox), then collapse to one and retry.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
  // "Must not open" has no post-condition to wait for, so this window is spent on
  // purpose: it gives a wrong lightbox time to appear (#986).
  out.spaceIgnoredForMulti = await neverHappens('the lightbox to open on Space while two cards are selected', () => peekOpen(), 300);
  click(cardOf(0)); // collapse to a single selection
  await waitFor('the selection to collapse back to a single card', () => selectedCards().length === 1);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
  out.spacePeeked = await waitFor('the lightbox to peek the one selected card on Space', () => peekOpen());
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await waitFor('the peeked lightbox to close again on Esc', () => !peekOpen());

  // D3. Arrow keys move the single selection through the grid (P2⑥), and the
  // inspector follows — the pair that makes continuous tagging a composition. Starts from
  // the MIDDLE card so both directions have somewhere to go whatever the sort is.
  click(cardOf(1));
  await waitFor('the middle card to become the single selection', () => selectedCards().length === 1 && !!cardOf(1) && cardOf(1).hasAttribute('data-selected'));
  const startIdx = postCards().indexOf(cardOf(1));
  arrow('ArrowRight');
  // Waits for the selection to LEAVE where it was, then measures the step separately —
  // waiting for "one card to the right" would be the assertion itself.
  await waitFor('the selection to move off the middle card after →', () => selectedIndex() !== startIdx);
  out.arrowRightSel = selectedKeys().join(',');
  out.arrowRightStep = selectedIndex() - startIdx;
  out.arrowFollowsInspector = !!selectedCard() && selectedCard().hasAttribute('data-inspected');
  arrow('ArrowLeft');
  arrow('ArrowLeft');
  // Two keys in a row have an intermediate position, so "moved" is not enough here:
  // wait for the index to stop changing instead of for any particular value.
  await waitStable('the selection to settle after ← ←', () => selectedIndex());
  out.arrowLeftStep = selectedIndex() - startIdx;
  // Clamps at the first card instead of wrapping to the last.
  arrow('ArrowLeft');
  await waitStable('the selection to settle after ← at the first card', () => selectedIndex());
  out.arrowClampedAtStart = selectedIndex() === 0;

  // D3b. Home/End (#672) jump straight to the two ends arrow movement never reached,
  // reusing the same selection primitive — currently sitting at index 0 from the clamp
  // above, so End must move all the way to the LAST card, and a second End is a no-op
  // (already there — nothing should churn or throw).
  const lastIdx = postCards().length - 1;
  arrow('End');
  await waitFor('the selection to jump away from the first card on End', () => selectedIndex() !== 0);
  out.endSelIndex = selectedIndex();
  out.endFollowsInspector = !!selectedCard() && selectedCard().hasAttribute('data-inspected');
  arrow('End');
  // A no-op has nothing to wait FOR — wait for the index to stop moving and then read it.
  await waitStable('the selection to stay put on a second End', () => selectedIndex());
  out.endIsIdempotent = selectedIndex() === lastIdx;
  arrow('Home');
  await waitFor('the selection to jump away from the last card on Home', () => selectedIndex() !== lastIdx);
  out.homeSelIndex = selectedIndex();

  // D3c. Home/End must NOT hijack a text field's own caret-to-line-start/end motion
  // (#672 accept criteria) — the search box input is real (SearchBox.tsx), so focus it
  // and confirm the grid selection stays put on Home *targeted at the input*, exactly
  // the guard arrow keys already get.
  const searchInput = document.querySelector('input[aria-label="テキスト・ユーザー名で検索"]');
  out.searchInputFound = !!searchInput;
  if (searchInput) {
    searchInput.focus();
    const beforeGuardIdx = selectedIndex();
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    // Both guards prove a NON-event, so each window is spent in full on purpose (#986).
    out.homeIgnoredInSearchBox = await neverHappens('the grid selection to move on Home inside the search box', () => selectedIndex() !== beforeGuardIdx, 300);
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    out.endIgnoredInSearchBox = await neverHappens('the grid selection to move on End inside the search box', () => selectedIndex() !== beforeGuardIdx, 300);
    searchInput.blur();
  }

  // The 投稿者 nav's active state tracks browseMode (grids are CSS-hidden, not
  // unmounted, so poster cards stay in the DOM — the active nav is the mode marker).
  const navActive = () => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '投稿者'); return !!(b && b.hasAttribute('data-active') && b.getAttribute('data-active') !== 'false'); };

  // E. switch to the posters view → poster cards carry no ℹ button
  [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '投稿者')?.click();
  out.posterCardsShown = await waitFor('the posters view to become active and show its poster cards', () => navActive() && document.querySelectorAll('[data-slot="poster-grid"] [data-slot="poster-card"]').length >= 1);
  // Poster cards have no hover parts either = counted the same way as A.
  // This used to count [data-slot="poster-info"], but after tag-pop was removed
  // (1512e839) that ℹ button is gone everywhere in the app, so the count would always be
  // 0 = a check that could never fail (#635). The two markers now in use are both
  // confirmed live within the same run: poster-card is confirmed by posterCardsShown
  // just above being >= 1, and button is an HTML tag, so it can't disappear. Do not go
  // back to counting a name that has been retired.
  out.posterHoverParts = document.querySelectorAll('[data-slot="poster-grid"] [data-slot="poster-card"] button, [data-slot="poster-grid"] [data-slot="poster-card"] [class*="act-pill"]').length;
  out.posterCardParts = document.querySelectorAll('[data-slot="poster-grid"] [data-slot="poster-card"] *').length; // same control as A

  // F. plain click a poster → poster inspector (has the poster head block)
  document.querySelector('[data-slot="poster-grid"] [data-slot="poster-card"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  out.inspOpenedF = await waitFor('the inspector to open on the clicked poster card', inspVisible);
  out.inspIsPoster = inspVisible() && !!insp().querySelector('[data-slot="inspector-poster"]');

  // G. double-click a poster → drill into their posts (browseMode leaves posters)
  dblclick(document.querySelector('[data-slot="poster-grid"] [data-slot="poster-card"]'));
  out.drilledIn = await waitFor('the double-clicked poster to drill into their posts', () => !navActive());

  // H. double-click a post → the image view (in-tab history destination)
  dblclick(postCards()[0]);
  out.imageViewActive = await waitFor('the image view to open on the double-clicked post', () => !!document.querySelector('[data-slot="image-tab-view"]'));

  out.errors = errors;
  return JSON.stringify(out);
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
  const r = readEvalResult(out);
  if (!r) {
    console.log('CLICK_MODEL_TEST_FAIL (no eval result)');
    process.exit(1);
  }
  const checks = [
    ['post cards have no ℹ / ○ hover parts', r.postHoverParts === 0],
    ['…and we could see inside them (that 0 is a real 0)', r.postCardParts >= 1],
    ['plain click opens the inspector', r.inspOpenedB === true],
    ['plain click shows the POST inspector', r.inspIsPost === true],
    ['plain click single-selects the card', r.selAfterB === '本文0'],
    ['inspector thumbnail advertises the peek (zoom-in)', r.thumbPeekable === true],
    ['inspector thumbnail opens the quick-view lightbox', r.lightboxOpened === true],
    ['Esc closes the quick-view lightbox', r.lightboxClosed === true],
    ['Ctrl-click adds a second card', r.selAfterD === '本文0,本文1'],
    ['Space is ignored while multiple are selected', r.spaceIgnoredForMulti === true],
    ['Space peeks the single selected card', r.spacePeeked === true],
    ['→ moves the selection one card and keeps it single', r.arrowRightStep === 1 && r.arrowRightSel.split(',').length === 1],
    ['arrow movement swaps the inspector to the new card', r.arrowFollowsInspector === true],
    ['← moves the selection back', r.arrowLeftStep === -1],
    ['← clamps at the first card instead of wrapping', r.arrowClampedAtStart === true],
    ['End jumps to the last card', r.endSelIndex === 2],
    ['End follows with the inspector, same as arrow movement', r.endFollowsInspector === true],
    ['a second End (already there) is a no-op, not an error', r.endIsIdempotent === true],
    ['Home jumps back to the first card', r.homeSelIndex === 0],
    ['the search box input was actually found (guard below is not a false positive)', r.searchInputFound === true],
    ['Home targeted at the search box leaves the grid selection alone', r.homeIgnoredInSearchBox === true],
    ['End targeted at the search box leaves the grid selection alone', r.endIgnoredInSearchBox === true],
    ['poster cards render', r.posterCardsShown === true],
    ['poster cards have no ℹ / ○ hover parts', r.posterHoverParts === 0],
    ['…and we could see inside them (that 0 is a real 0)', r.posterCardParts >= 1],
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
