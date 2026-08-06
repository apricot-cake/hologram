'use strict';

// Verifies the remaining text-leaf stability invariant (previously only argued by
// review — BACKLOG「leftover」):
//   Duplicate leaf on tab restore: an EDITING text leaf survives a tab round-trip without
//   duplicating. Type「いぬ」(no Enter) → open a new tab → switch back → the box value
//   is restored AND rebound to the same leaf, so typing one more char EDITS that leaf
//   (chips stay 1) instead of spawning a second one.
//   seeds: p0 text「ネコかわいい」/ p1「こんにちは世界」/ p2「いぬのおさんぽ」
// (The old Part B — freezing exact/fuzzy mode on a finalized leaf — retired with the search-mode
// toggle itself: P2④ single smart search has no per-leaf mode.)
//
//   node scripts/test-app-textleaf-stable.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-stb-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const records: any[] = [];
const texts = ['ネコかわいい', 'こんにちは世界', 'いぬのおさんぽ'];
for (let i = 0; i < texts.length; i++) {
  const id = '170000000000' + i + '-stb' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: 'https://x.com/u/status/' + (300 + i),
    platform: 'x',
    text: texts[i],
    displayName: '人' + i,
    screenName: 'u' + i,
    likes: 10 + i,
    capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [],
    tags: [],
    hashtags: [],
  });
}
seedLibrary(configDir, records);

const evalJs = evalSource(async ({ waitFor }) => {
  const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  // Filter chips = the FilterChips component ([data-slot=filter-chips], one span per chip).
  // Only text terms are active in this test, so counting all chips counts text chips.
  const chipRow = () => document.querySelector('[data-slot="filter-chips"]');
  const chipText = () => {
    const row = chipRow();
    return row ? row.textContent || '' : '';
  };
  const textChips = () => {
    const row = chipRow();
    return row ? row.querySelectorAll(':scope > span').length : 0;
  };
  const activeTab = () => {
    const el = document.querySelector<HTMLElement>('[data-slot="tab"][data-active]');
    return el ? el.dataset.tabId : null;
  };
  // Named rather than optional-chained: each of these IS the step, so a missing one
  // has to stop the run and say which control was gone instead of letting a later
  // assertion report something else.
  const mustEl = (sel, what) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) throw new Error('the ' + what + ' is missing (' + sel + ')');
    return el;
  };
  await waitFor('the grid to show all 3 seeded posts', () => cards() >= 3);
  // The searchbox component's Autocomplete input (no #searchBox id since P2④).
  const sb = document.querySelector<HTMLInputElement>('input[placeholder="テキスト・ユーザー名で検索"]');
  if (!sb) throw new Error('the search box input is missing from the filter bar');
  // React controlled input: write via the prototype setter + 'input'
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!nativeSetter) throw new Error('HTMLInputElement.prototype has no value setter to drive the controlled search box');
  const setVal = (v) => {
    nativeSetter.call(sb, v);
    sb.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const r: Record<string, any> = {};

  // --- editing text leaf survives a tab round-trip without duplicating ---
  // What "stable" means here is leaf IDENTITY across a tab round-trip, not that the
  // screen stops moving — so nothing below needs a fixed delay to be the check. What
  // it does need is care about WHAT is waited on: every step's chip count is asserted,
  // and each step starts from a state whose count already equals the expected one
  // (1 → 1 on the edit), so waiting for that count would return on the PRE state and
  // pass a duplicated leaf. Each wait therefore watches the chip's TEXT (or the box,
  // or the active tab) and the count is left to the assertion.
  setVal('いぬ');
  await waitFor('the typed term to show as a chip and narrow the grid to its one match', () => chipText().includes('いぬ') && cards() === 1);
  r.aChips = textChips(); // 1 (editing leaf)
  r.aCards = cards(); // 1 (いぬのおさんぽ)
  const firstTab = activeTab();
  mustEl('[data-slot="tab-new"]', 'new-tab button').click(); // addTab → fresh empty tab
  await waitFor('the new tab to take over with an unfiltered library', () => activeTab() !== firstTab && !chipRow() && cards() === 3);
  r.newChips = textChips(); // 0 (new tab is empty)
  r.newCards = cards(); // 3 (all)
  mustEl('[data-slot="tab"][data-tab-id="' + firstTab + '"]', 'first tab').click(); // back
  // '>= 1' rather than '=== 1': a duplicated leaf must still reach the assertion below.
  await waitFor('the first tab to come back with its search term in the box', () => activeTab() === firstTab && sb.value === 'いぬ' && textChips() >= 1 && cards() === 1);
  r.backChips = textChips(); // 1 (restored leaf)
  r.backCards = cards(); // 1
  r.backBox = sb.value; // 'いぬ'
  setVal('いぬの'); // append one more char — must EDIT the rebound leaf
  await waitFor('the chip to follow the appended character', () => chipText().includes('いぬの'));
  r.editChips = textChips(); // 1 (NOT 2 — the headline anti-regression)
  r.editCards = cards(); // 1 (いぬのおさんぽ)

  setVal('');
  await waitFor('the emptied box to drop the chip row and unfilter the grid', () => !chipRow() && cards() === 3);
  r.resetChips = textChips(); // 0
  r.resetCards = cards(); // 3
  return r;
});

const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'), HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});
child.on('close', () => {
  let r: Record<string, any> = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) {
    try {
      r = JSON.parse(m[1]);
    } catch {
      /* ignore */
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.aChips === 1 && r.aCards === 1 && r.newChips === 0 && r.newCards === 3 && r.backChips === 1 && r.backCards === 1 && r.backBox === 'いぬ' && r.editChips === 1 && r.editCards === 1 && r.resetChips === 0 && r.resetCards === 3;
  console.log(`aChips=${r.aChips} aCards=${r.aCards} newChips=${r.newChips} newCards=${r.newCards} backChips=${r.backChips} backCards=${r.backCards} backBox="${r.backBox}" editChips=${r.editChips} editCards=${r.editCards} resetChips=${r.resetChips} resetCards=${r.resetCards}`);
  console.log(ok ? 'TEXTLEAF_STABLE_TEST_PASS' : 'TEXTLEAF_STABLE_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
