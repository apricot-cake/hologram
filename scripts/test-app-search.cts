'use strict';

// Verifies the single smart search end-to-end in the app (P2④: the ぴったり(exact)/おおまか(loose)
// toggle is gone — the loose matcher is the only behavior):
//   B normalization: "ねこ" matches the katakana body "ネコかわいい" → 1
//   C edit distance: typo "こんにとは" matches "こんにちは世界" → 1
//   unrelated term → 0
//
// Also verifies the date-filter predicate's timezone boundary (postPredOf /
// localDayRange) through the real UI — the "+ フィルタ" flow's date form (P2③
// filterbar; the retired qf date popover is gone). The picker value is a LOCAL
// calendar day, so a post whose UTC instant falls on a different UTC day than its
// local day must bucket by the LOCAL day (matching what the app shows on the card).
// We force TZ=Asia/Tokyo (UTC+9) and seed posts straddling JST midnight, then assert
// the from=to=6/20 range includes exactly the two posts that read as 6/20 in local
// time. A UTC-anchored bound would mis-bucket the two boundary posts (regression
// guard). The dateField=capturedAt path (a Base UI Select in the form — not reliably
// drivable with synthetic events) is covered at the predicate level by
// test-query-unit.cts.
//
//   node scripts/test-app-search.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-se-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const records: any[] = [];
const texts = ['ネコかわいい', 'こんにちは世界', 'いぬのおさんぽ'];
for (let i = 0; i < texts.length; i++) {
  const id = '170000000000' + i + '-se' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
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
  });
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
  records.push({
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
  });
}
seedLibrary(configDir, records);

const evalJs = evalSource(async ({ waitFor, waitStable }) => {
  const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  // React controlled inputs (searchbox component / date form): a bare .value write is
  // invisible to React's value tracker — go through the prototype setter, then 'input'.
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!valueSetter) throw new Error("HTMLInputElement.prototype has no 'value' setter to drive React's tracker through");
  const setInput = (el: HTMLInputElement, text: string) => {
    valueSetter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // The searchbox component's Autocomplete input (no #searchBox id since P2④).
  const searchInput = document.querySelector<HTMLInputElement>('input[placeholder="テキスト・ユーザー名で検索"]');
  // Named rather than optional-chained: typing IS what this harness does, so a missing
  // box has to stop the run and say so instead of letting every later check report a
  // grid that simply never changed.
  if (!searchInput) throw new Error('the search box input is missing');
  const typeSearch = (text: string) => setInput(searchInput, text);
  // WHICH posts the grid is showing, not just how many. The two smart-search steps
  // below both land on exactly one card, so a count-based wait would be satisfied
  // before the second query had been applied at all (1 → 1 is not a change); the
  // identity of the card is what actually moves between them.
  const gridKey = () => [...document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]')].map((c) => (c.textContent || '').trim()).join('|');
  // Type a query, then wait for the result set to become a DIFFERENT one and stop
  // moving. The searchbox's 150ms debounce needs no delay of its own — the poll
  // simply keeps looking until it has fired and React has re-rendered.
  const search = async (label: string, text: string) => {
    const before = gridKey();
    typeSearch(text);
    await waitFor('the grid to leave its previous results behind after searching for ' + label, () => gridKey() !== before);
    await waitStable('the results for ' + label + ' to stop moving', gridKey);
  };
  await waitFor('the grid to show all 7 seeded posts', () => cards() >= 7); // 3 search posts + 4 date-boundary posts; post view loads async

  // --- Single smart search (the only behavior — no mode toggle) ---
  // B normalization: a hiragana query hits the katakana body text
  await search('ねこ', 'ねこ');
  const smartKana = cards();
  // C edit distance: 'こんにとは' (a ち→と substitution typo) matches 'こんにちは世界'
  await search('こんにとは', 'こんにとは');
  const smartTypo = cards();
  // an unrelated term doesn't match
  await search('存在しない語', '存在しない語');
  const smartMiss = cards();

  // --- Date filter: local-day boundary (TZ=Asia/Tokyo, see fixtures) ---
  // Clear the search term so it does not co-filter the grid, then drive the real
  // "+ フィルタ" flow (filterbar component): open the popover, pick 日付 (date), fill the
  // from/to date inputs, click 適用 (apply).
  typeSearch('');
  await waitFor('the grid to refill once the search term is cleared', () => cards() >= 7);
  // Collect the boundary-fixture ids (dz*) currently in the grid, sorted+joined.
  // Counting alone is too weak: a UTC-anchored bound mis-buckets dz0 (drops it)
  // AND dz2 (adds it), so the COUNT stays 2 while the SET changes — only the set
  // distinguishes correct (dz0,dz1) from buggy (dz1,dz2).
  // Read off the card's own text ('boundary dz0') — the cells carry no data-url (#618).
  const dzSet = () =>
    Array.from(document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]'))
      .map((c) => ((c.textContent || '').match(/boundary (dz\d)/) || [])[1])
      .filter(Boolean)
      .sort()
      .join(',');
  const byText = (sel: string, text: string) => Array.from(document.querySelectorAll<HTMLElement>(sel)).find((el) => (el.textContent || '').trim() === text) || null;
  // Same reasoning as the search box above: name the control that is missing and stop,
  // rather than `?.`-ing the click away and leaving the date assertions to misreport it.
  const clickByText = (sel: string, text: string) => {
    const el = byText(sel, text);
    if (!el) throw new Error('no element matching ' + sel + ' has the text ' + text);
    el.click();
  };
  // The "+ フィルタ" button (AddFilterButton: icon + 'フィルタ')
  clickByText('button', 'フィルタ');
  await waitFor('the filter menu to list the 日付 category', () => !!byText('[data-slot="command-item"]', '日付'));
  clickByText('[data-slot="command-item"]', '日付'); // date category → DateForm
  await waitFor('the date form to show its from/to inputs', () => document.querySelectorAll('[data-slot="popover-content"] input[type="date"]').length === 2);
  const [fromEl, toEl] = document.querySelectorAll<HTMLInputElement>('[data-slot="popover-content"] input[type="date"]');
  setInput(fromEl, '2026-06-20');
  setInput(toEl, '2026-06-20');
  const beforeApply = dzSet();
  clickByText('[data-slot="popover-content"] button', '適用');
  // The grid re-renders async. Wait for the boundary set to CHANGE and then to stop
  // moving — waiting for the expected count instead would pre-assert the very thing
  // this section checks, and a bare stability poll returns fastest when the filter
  // has not been applied at all.
  await waitFor('the boundary posts to be re-filtered by the applied date range', () => dzSet() !== beforeApply);
  await waitStable('the date-filtered grid to stop moving', dzSet);
  const dateRange = dzSet(); // expect exactly dz0 + dz1 (both read 6/20 in JST)

  return { smartKana, smartTypo, smartMiss, dateRange };
});

// TZ=Asia/Tokyo (UTC+9) so the date-filter section exercises a non-UTC boundary.
const env = Object.assign({}, process.env, { TZ: 'Asia/Tokyo', APPDATA: tmp, HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'), HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });
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
  const ok = r.smartKana === 1 && r.smartTypo === 1 && r.smartMiss === 0 && r.dateRange === 'dz0,dz1';
  console.log(`smartKana=${r.smartKana} smartTypo=${r.smartTypo} smartMiss=${r.smartMiss} dateRange=${r.dateRange}`);
  console.log(ok ? 'SEARCH_TEST_PASS' : 'SEARCH_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
