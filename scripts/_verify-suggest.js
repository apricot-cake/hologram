'use strict';
// Throwaway: real-time search suggestions + frequent-tags + popover upgrades.
//  - typing in the search box shows live tag/author suggestions (per keystroke)
//  - clicking a tag suggestion applies the tag filter and clears the box
//  - keyboard: ArrowDown + Enter applies the highlighted suggestion
//  - sidebar shows a よく使うタグ block; a just-used tag rises to its front
//  - ＋フィルタ popover: 10 categories, tag values get group headers + a find
//    input (when >8), instance category lists hosts, 日付 opens the date popover
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-sg-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
// 10 tags so the sidebar frequent block + popover find input both trigger.
const TAGS = ['aori', 'aoba', 'neko', 'inu', 'tora', 'saru', 'kuma', 'usagi', 'kame', 'risu'];
// tag-groups.json: first 4 tags grouped, rest under その他
fs.writeFileSync(path.join(saveFolder, 'tag-groups.json'), JSON.stringify({
  groups: [{ id: 'g1', name: 'ポーズ', tags: ['aori', 'aoba', 'neko', 'inu'] }]
}));
for (let i = 0; i < 10; i++) {
  const id = '170000000000' + i + '-sg' + i;
  // aori appears on 3 posts (highest count), others sparse
  const tags = i < 3 ? ['aori', TAGS[i]] : [TAGS[i]];
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg',
    url: i === 9 ? 'https://misskey.io/notes/n' + i : 'https://x.com/u/status/' + (700 + i),
    platform: i === 9 ? 'misskey' : 'x', text: '本文' + i, displayName: '太郎' + i, screenName: 'taro' + i,
    likes: i, capturedAt: '2026-04-0' + ((i % 9) + 1) + 'T12:00:0' + i + 'Z',
    date: '2026-04-0' + ((i % 9) + 1) + 'T10:00:0' + i + 'Z', media: [], tags, hashtags: []
  }, null, 2));
}
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  const grid = document.getElementById('postGrid');
  const cards = () => grid.querySelectorAll('.post-card').length;
  await waitFor(() => cards() >= 10);
  const sb = document.getElementById('searchBox');
  const sg = document.querySelector('.search-suggest');
  const type = (v) => { sb.value = v; sb.dispatchEvent(new Event('input', { bubbles: true })); };

  // real-time: each keystroke updates the dropdown
  sb.focus();
  type('ao'); await wait(80);
  const live1 = sg.style.display !== 'none' && sg.querySelectorAll('.sg-row').length >= 2;   // aori, aoba
  type('aor'); await wait(80);
  const live2 = sg.querySelectorAll('.sg-row').length === 1 &&
    sg.querySelector('.sg-row .sg-name').textContent === 'aori';

  // click applies the tag filter + clears the box
  sg.querySelector('.sg-row').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await wait(150);
  const applied = sb.value === '' && cards() === 3 &&
    [...document.querySelectorAll('#queryChips .sb-active-chip')].some(c => c.textContent === '#aori');

  // keyboard: type → ArrowDown → Enter applies the highlighted author
  type('太郎5'); await wait(80);
  sb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  await wait(40);
  sb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await wait(150);
  const kbApplied = sb.value === '' && document.querySelectorAll('#queryChips .sb-active-chip.qc-user').length === 1;
  document.getElementById('postResetBtn').click(); await wait(120);

  // 📌 ピン留め: グループフライアウトの行のピンで登録 → サイドバーにチップ常駐
  const pop = document.querySelector('.qf-pop');
  const cats10 = document.querySelectorAll('#filterRows .sb-row').length === 7;
  const gBtn = [...document.querySelectorAll('#sbTagGroupRows [data-tag-group]')].find(b => b.textContent.includes('ポーズ'));
  gBtn.click(); await wait(50);
  const hasGhead = pop.querySelector('.qf-back').textContent === 'ポーズ' &&
    pop.querySelectorAll('[data-qfval]').length === 4;
  const aoriPin = pop.querySelector('[data-qfval="aori"] .qf-pin');
  aoriPin.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(80);
  const freqBlock = document.querySelectorAll('#sbPinnedTags .sb-chip').length === 1 &&
    document.getElementById('sbPinTitle').style.display !== 'none';
  const freqFirst = (document.querySelector('#sbPinnedTags .sb-chip') || { dataset: {} }).dataset.filterValue === 'aori';
  // 作者行（10人 > 8）→ 絞り込み入力つき
  document.querySelector('#filterRows [data-qfrow="user"]').click(); await wait(50);
  const hasFind = !!pop.querySelector('.qf-find');
  const fi = pop.querySelector('.qf-find');
  fi.value = '太郎5'; fi.dispatchEvent(new Event('input', { bubbles: true })); await wait(40);
  const findFilters = [...pop.querySelectorAll('.qf-vals .fm-row')].filter(r => r.style.display !== 'none').length === 1;
  // プラットフォーム行 → misskey ホストがサブ行で列挙される
  document.querySelector('#filterRows [data-qfrow="platform"]').click(); await wait(50);
  const instOk = [...pop.querySelectorAll('[data-qftype="instance"]')].some(r => r.textContent.includes('misskey.io'));
  // 日付行 → 専用ポップオーバーが開く
  document.querySelector('#filterRows [data-qfrow="date"]').click(); await wait(60);
  const dateOpens = document.getElementById('qfDatePopover').style.display === 'block' && !pop.classList.contains('show');

  return { live1, live2, applied, kbApplied, freqBlock, freqFirst: !!freqFirst,
    cats10, hasFind, hasGhead, findFilters, instOk, dateOpens };
})()`;
const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
  const keys = ['live1', 'live2', 'applied', 'kbApplied', 'freqBlock', 'freqFirst',
    'cats10', 'hasFind', 'hasGhead', 'findFilters', 'instOk', 'dateOpens'];
  const ok = keys.every((k) => r[k] === true);
  console.log(keys.map((k) => k + '=' + r[k]).join(' '));
  console.log(ok ? 'SUGGEST_VERIFY_PASS' : 'SUGGEST_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
