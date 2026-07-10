'use strict';

// Verifies the search-mode toggle (ぴったり / おおまか) end-to-end in the (unified
// post-view) app, including the おおまか enhancements:
//   ぴったり: query "ねこ" does NOT substring-match the katakana body "ネコかわいい" → 0
//   おおまか(B 正規化): "ねこ" matches "ネコかわいい" (カナ統一) → 1
//   おおまか(C 編集距離): typo "こんにとは" matches "こんにちは世界" → 1
//   方式は macOS 風セグメント（#searchModeSeg の #searchModeExact/#searchModeFuzzy）で切替。
//   両オプション常時表示＝状態 (is-on) と切替手段がひと目で分かる UI もここで検証。
//
// Also verifies the date-filter predicate's timezone boundary (postPredOf /
// localDayRange). The picker value is a LOCAL calendar day, so a post whose UTC
// instant falls on a different UTC day than its local day must bucket by the
// LOCAL day (matching what the app shows on the card). We force TZ=Asia/Tokyo
// (UTC+9) and seed posts straddling JST midnight, then assert the from=to=6/20
// range includes exactly the two posts that read as 6/20 in local time. A
// UTC-anchored bound would mis-bucket the two boundary posts (regression guard).
//
//   node scripts/test-app-search.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-se-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const texts = ['ネコかわいい', 'こんにちは世界', 'いぬのおさんぽ'];
for (let i = 0; i < texts.length; i++) {
  const id = '170000000000' + i + '-se' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, id + '.json'),
    JSON.stringify(
      {
        captureId: id,
        image: id + '.jpg',
        url: 'https://x.com/u/status/' + (900 + i),
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

// Date-filter boundary fixtures. TZ is Asia/Tokyo (UTC+9), so the LOCAL day of
// each `date` instant is what matters. Filter target = local 2026-06-20.
//   dz0: UTC 6/19 16:00 = JST 6/20 01:00  -> local 6/20  -> IN
//   dz1: UTC 6/20 14:59 = JST 6/20 23:59  -> local 6/20  -> IN
//   dz2: UTC 6/20 15:00 = JST 6/21 00:00  -> local 6/21  -> OUT (just after)
//   dz3: UTC 6/19 14:59 = JST 6/19 23:59  -> local 6/19  -> OUT (just before)
// A UTC-anchored bound would flip dz0 (->OUT) and dz2 (->IN): the regression.
const dateFixtures = [
  { id: 'dz0', date: '2026-06-19T16:00:00Z' },
  { id: 'dz1', date: '2026-06-20T14:59:00Z' },
  { id: 'dz2', date: '2026-06-20T15:00:00Z' },
  { id: 'dz3', date: '2026-06-19T14:59:00Z' },
];
for (const dz of dateFixtures) {
  const id = '1750000000000-' + dz.id;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, id + '.json'),
    JSON.stringify(
      {
        captureId: id,
        image: id + '.jpg',
        url: 'https://x.com/u/status/' + dz.id,
        platform: 'x',
        text: 'boundary ' + dz.id,
        displayName: 'D',
        screenName: 'd',
        likes: 0,
        capturedAt: dz.date,
        date: dz.date,
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
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  // React controlled inputs (searchbox island / date popover): a bare .value write is
  // invisible to React's value tracker — go through the prototype setter, then 'input'.
  const setInput = (el, text) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const typeSearch = (text) => setInput(document.getElementById('searchBox'), text);
  await waitFor(() => cards() >= 7);   // 3 search posts + 4 date-boundary posts; post view loads async
  const seg = document.getElementById('searchModeSeg');
  // the segment is the toolbar island now: state shows as .is-on per .seg-opt button
  // (the old #searchModeExact/#searchModeFuzzy ids and the container's .is-fuzzy class
  // are gone — the thumb slides by inline transform instead)
  const exactBtn = seg.querySelector('.seg-opt[data-mode="normal"]');
  const fuzzyBtn = seg.querySelector('.seg-opt[data-mode="fuzzy"]');
  const exactOnByDefault = exactBtn.classList.contains('is-on') && !fuzzyBtn.classList.contains('is-on'); // 既定 = normal
  // ぴったり（既定）: カタカナ本文にひらがなクエリは部分一致しない → 0
  typeSearch('ねこ');
  await wait(220);
  const normalKana = cards();
  // セグメントの「おおまか」をクリックで切替（B 正規化）: 'ねこ' が 'ネコかわいい' に一致 → 1
  fuzzyBtn.click();
  await wait(220);
  const fuzzyKana = cards();
  const fuzzyOn = fuzzyBtn.classList.contains('is-on') && !exactBtn.classList.contains('is-on'); // fuzzy
  // C 編集距離: 'こんにとは'（ち→と 置換ミス）が 'こんにちは世界' に一致 → 1
  typeSearch('こんにとは');
  await wait(220);
  const fuzzyTypo = cards();

  // --- Date filter: local-day boundary (TZ=Asia/Tokyo, see fixtures) ---
  // Clear the search term so it does not co-filter the grid, then drive the real
  // date popover (same path the user takes): set from/to, field, click Apply.
  typeSearch('');
  await wait(220);
  // Collect the boundary-fixture ids (dz*) currently in the grid, sorted+joined.
  // Counting alone is too weak: a UTC-anchored bound mis-buckets dz0 (drops it)
  // AND dz2 (adds it), so the COUNT stays 2 while the SET changes — only the set
  // distinguishes correct (dz0,dz1) from buggy (dz1,dz2).
  // NOTE: this string is itself inside a backtick template literal, so the regex
  // backslash MUST be doubled (\\d) to survive into the evaluated code.
  const dzSet = () => Array.from(document.querySelectorAll('#postGrid .post-card'))
    .map((c) => (c.dataset.url || '').split('/').pop())
    .filter((id) => /^dz\\d$/.test(id)).sort().join(',');
  // The date popover is the filter-popover React island now (no qfDate* ids): the row
  // click opens a fresh .qf-popover, the field-type .chip toggles date↔capturedAt
  // (.active ⇔ capturedAt), and the non-delete .btn-outline applies. Apply with a
  // pre-existing date filter replaces it (addFilter is single-valued for dates).
  const applyDate = async (field, from, to) => {
    document.querySelector('#filterRows [data-qfrow="date"]').click();
    await waitFor(() => !!document.querySelector('.qf-popover input.date-input'));
    const pop = document.querySelector('.qf-popover');
    const [fromEl, toEl] = pop.querySelectorAll('input.date-input');
    setInput(fromEl, from);
    setInput(toEl, to);
    const typeChip = pop.querySelector('button.chip');
    if ((field === 'capturedAt') !== typeChip.classList.contains('active')) { typeChip.click(); await wait(40); }
    pop.querySelector('.btn-outline:not(.qf-popover-delete)').click();
    // The grid re-renders async (folder refresh + animation); poll until the
    // visible post count settles to 2 (the boundary matches) before snapshotting.
    await waitFor(() => cards() === 2);
    await wait(120);
    return dzSet();
  };
  // from=to=2026-06-20 (local). Expect exactly dz0 + dz1 (both read 6/20 in JST).
  const dateRange = await applyDate('date', '2026-06-20', '2026-06-20');
  // capturedAt mirrors date in the fixtures → same field path must yield the same set.
  const capturedRange = await applyDate('capturedAt', '2026-06-20', '2026-06-20');

  return { normalKana, fuzzyKana, fuzzyTypo, exactOnByDefault, fuzzyOn, dateRange, capturedRange };
})()`;

// TZ=Asia/Tokyo (UTC+9) so the date-filter section exercises a non-UTC boundary.
const env = Object.assign({}, process.env, { TZ: 'Asia/Tokyo', APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'), CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
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
  const ok = r.normalKana === 0 && r.fuzzyKana === 1 && r.fuzzyTypo === 1 && r.exactOnByDefault === true && r.fuzzyOn === true && r.dateRange === 'dz0,dz1' && r.capturedRange === 'dz0,dz1';
  console.log(`normalKana=${r.normalKana} fuzzyKana=${r.fuzzyKana} fuzzyTypo=${r.fuzzyTypo} exactOn=${r.exactOnByDefault} fuzzyOn=${r.fuzzyOn} dateRange=${r.dateRange} capturedRange=${r.capturedRange}`);
  console.log(ok ? 'SEARCH_TEST_PASS' : 'SEARCH_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
