'use strict';

// Verifies the remaining text-leaf stability invariant (previously only argued by
// review — BACKLOG「残」):
//   タブ復元の二重葉: an EDITING text leaf survives a tab round-trip without
//   duplicating. Type「いぬ」(no Enter) → open a new tab → switch back → the box value
//   is restored AND rebound to the same leaf, so typing one more char EDITS that leaf
//   (chips stay 1) instead of spawning a second one.
//   seeds: p0 本文「ネコかわいい」/ p1「こんにちは世界」/ p2「いぬのおさんぽ」
// (The old Part B — 確定済み葉の exact/fuzzy モード凍結 — retired with the search-mode
// toggle itself: P2④ 単一スマート検索 has no per-leaf mode.)
//
//   node scripts/test-app-textleaf-stable.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-stb-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const texts = ['ネコかわいい', 'こんにちは世界', 'いぬのおさんぽ'];
for (let i = 0; i < texts.length; i++) {
  const id = '170000000000' + i + '-stb' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, id + '.json'),
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );
}

const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const cards = () => document.querySelectorAll('#postGrid .post-card').length;
  // Filter chips = the FilterChips component ([data-slot=filter-chips], one span per chip).
  // Only text terms are active in this test, so counting all chips counts text chips.
  const chipRow = () => document.querySelector('[data-slot="filter-chips"]');
  const textChips = () => (chipRow() ? chipRow().querySelectorAll(':scope > span').length : 0);
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  await waitFor(() => cards() >= 3);
  // The searchbox component's Autocomplete input (no #searchBox id since P2④).
  const sb = document.querySelector('input[placeholder="テキスト・ユーザー名で検索"]');
  // React controlled input: write via the prototype setter + 'input'
  const setVal = (v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(sb, v);
    sb.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const r = {};

  // --- editing text leaf survives a tab round-trip without duplicating ---
  setVal('いぬ'); await wait(240);
  r.aChips = textChips();          // 1 (editing leaf)
  r.aCards = cards();              // 1 (いぬのおさんぽ)
  const firstTab = (document.querySelector('.tab-item.active') || {}).dataset.tab;
  document.querySelector('.tab-new').click(); await wait(200);   // addTab → fresh empty tab
  r.newChips = textChips();        // 0 (new tab is empty)
  r.newCards = cards();            // 3 (all)
  document.querySelector('.tab-item[data-tab="' + firstTab + '"]').click(); await wait(240);  // back
  r.backChips = textChips();       // 1 (restored leaf)
  r.backCards = cards();           // 1
  r.backBox = sb.value;            // 'いぬ'
  setVal('いぬの'); await wait(240);   // append one more char — must EDIT the rebound leaf
  r.editChips = textChips();       // 1 (NOT 2 — the headline anti-regression)
  r.editCards = cards();           // 1 (いぬのおさんぽ)

  setVal(''); await wait(240);
  r.resetChips = textChips();      // 0
  r.resetCards = cards();          // 3
  return r;
})()`;

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
