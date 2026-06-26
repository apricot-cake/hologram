'use strict';
// Throwaway: verify the 詳細検索フォーム (adv-panel) edits the SAME postQB tree as the
// sidebar — each axis filters live, and reopening reflects the current state (round-trip).
// Seeds: p0 x[] like5 '猫' 04-01, p1 bsky[空] like50 '犬' 04-02,
//        p2 x[空] like100 '猫' 04-03, p3 misskey[] like1 '鳥' 04-04.
//   platform=x        -> p0,p2            = 2
//   + tag=空 (AND)     -> p2               = 1   ; reopen: x opt is 'on' + a tag chip exists
//   likes >= 50        -> p1,p2            = 2
//   date 04-02..04-03  -> p1,p2            = 2
//   keyword 猫          -> p0,p2            = 2
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-as-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const seeds = [
  { plat: 'x',       host: 'x.com',       tags: [],     likes: 5,   text: '猫' },
  { plat: 'bluesky', host: 'bsky.app',    tags: ['空'], likes: 50,  text: '犬' },
  { plat: 'x',       host: 'x.com',       tags: ['空'], likes: 100, text: '猫' },
  { plat: 'misskey', host: 'misskey.io',  tags: [],     likes: 1,   text: '鳥' },
];
seeds.forEach((s, i) => {
  const id = '170000000000' + i + '-as' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://' + s.host + '/u/status/' + (500 + i),
    platform: s.plat, text: s.text, displayName: '人' + i, screenName: 'u' + i,
    likes: s.likes, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00',
    date: '2026-04-0' + (i + 1) + 'T12:00:00', media: [], tags: s.tags, hashtags: []
  }, null, 2));
});
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(40); } return null; };
  const cards = () => document.querySelectorAll('#postGrid .post-card').length;
  const click = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const fire = (el, type) => el && el.dispatchEvent(new Event(type, { bubbles: true }));
  const panel = () => document.querySelector('.adv-panel');
  const isOpen = () => !!panel() && panel().style.display === 'block';
  const btn = () => document.getElementById('advSearchBtn');
  const opt = (cat, val) => panel() && panel().querySelector('[data-adv-cat="' + cat + '"][data-adv-val="' + val + '"]');
  const advOpen = async () => { if (!isOpen()) click(btn()); return waitFor(() => isOpen() && opt('platform', 'x')); };
  const advClose = () => { if (isOpen()) click(btn()); };
  const reset = async () => { click(document.getElementById('postResetBtn')); await wait(60); };
  const log = [];
  try {
    await waitFor(() => cards() >= 4);
    const all = cards();

    // 1. platform=x
    await advOpen();
    if (!opt('platform', 'x')) return { ok: false, log, err: 'no platform opt (panel not built)' };
    click(opt('platform', 'x')); await wait(80);
    const platX = cards();

    // 2. + tag=空 via the datalist input (AND at root)
    const tin = panel().querySelector('#advTagInput'); tin.value = '空'; fire(tin, 'change'); await wait(80);
    const platTag = cards();

    // 3. round-trip: reopen → x opt reflects 'on', a tag chip is present
    advClose(); await advOpen(); await wait(40);
    const onX = !!(opt('platform', 'x') && opt('platform', 'x').classList.contains('on'));
    const tagChip = !!panel().querySelector('.adv-tag-chip');

    // 4. engagement likes >= 50
    await reset(); await advOpen();
    panel().querySelector('#advEngType').value = 'likes';
    const emin = panel().querySelector('#advEngMin'); emin.value = '50'; fire(emin, 'change'); await wait(80);
    const eng50 = cards();

    // 5. date range 04-02..04-03 (post date)
    await reset(); await advOpen();
    panel().querySelector('#advDateType').value = 'date';
    panel().querySelector('#advDateFrom').value = '2026-04-02';
    const dto = panel().querySelector('#advDateTo'); dto.value = '2026-04-03'; fire(dto, 'change'); await wait(80);
    const dateRange = cards();

    // 6. keyword 猫 (debounced 150ms)
    await reset(); await advOpen();
    const kw = panel().querySelector('#advKeyword'); kw.value = '猫'; fire(kw, 'input'); await wait(260);
    const kwCats = cards();

    return { ok: true, log, all, platX, platTag, onX, tagChip, eng50, dateRange, kwCats };
  } catch (e) { return { ok: false, log, err: e.message }; }
})()`;
const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'), CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.ok === true && r.all === 4 && r.platX === 2 && r.platTag === 1 &&
    r.onX === true && r.tagChip === true && r.eng50 === 2 && r.dateRange === 2 && r.kwCats === 2;
  console.log(`log=${JSON.stringify(r.log)} err=${r.err || '-'} all=${r.all} platX=${r.platX} platTag=${r.platTag}` +
    ` onX=${r.onX} tagChip=${r.tagChip} eng50=${r.eng50} dateRange=${r.dateRange} kwCats=${r.kwCats}`);
  console.log(ok ? 'ADVSEARCH_VERIFY_PASS' : 'ADVSEARCH_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
