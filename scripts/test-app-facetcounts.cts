'use strict';

// Verifies facet counts across the "+ フィルタ" value editors (filterbar component —
// the qf-pop flyouts are gone since P2③). Two behaviours are asserted:
//   fixed lists (platform): every value carries a count, counts reflect the
//     CURRENT query, and a 0 keeps its place (no greying — order is stable).
//   facetDim lists (tag): counts reflect the query AND a 0 value is greyed.
//   「タグなし」 (P2⑬): pinned to the top of the tag editor, counted like any value,
//     and picking it leaves exactly the untagged post — the filter half of the
//     composition that replaced the retired tagging-session mode.
//   seeds: p0 x/猫/reply, p1 x/犬, p2 x/猫, p3 bluesky/猫, p4 misskey/(no tag)
//     all platform → x=3, bluesky=1, misskey=1
//     filter tag=猫 → x=2, bluesky=1, misskey=0 (misskey row stays, not greyed);
//                     tag editor: 犬 count 0 and greyed
//
//   node scripts/test-app-facetcounts.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-fc-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const seeds = [
  { plat: 'x', url: 'https://x.com/u0/status/800', tags: ['猫'], isReply: true },
  { plat: 'x', url: 'https://x.com/u1/status/801', tags: ['犬'] },
  { plat: 'x', url: 'https://x.com/u2/status/802', tags: ['猫'] },
  { plat: 'bluesky', url: 'https://bsky.app/profile/u3/post/803', tags: ['猫'] },
  { plat: 'misskey', url: 'https://misskey.io/notes/804', tags: [] },
];
const records: any[] = [];
seeds.forEach((s, i) => {
  const id = '170000000000' + i + '-fc' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: s.url,
    platform: s.plat,
    text: '本文' + i,
    displayName: '人' + i,
    screenName: 'u' + i,
    isReply: !!s.isReply,
    likes: 10 + i,
    capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [],
    tags: s.tags,
    hashtags: [],
  });
});
seedLibrary(configDir, records);

const evalJs = evalSource(async ({ waitFor, waitStable }) => {
  const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  const posterCards = () => document.querySelectorAll('[data-slot="poster-grid"] [data-slot="poster-card"]').length;
  // Filterbar idioms (see test-app-tabs): the "+ フィルタ" popover → Command category
  // list → ValueEditor rows (div.cursor-default with a label span + tabular-nums count).
  // The smoke window is unfocused, so exit animations are throttled — awaiting a full
  // popup unmount costs seconds against the 9s harness cap. Instead navigate BETWEEN
  // categories with the editor's 戻る button inside ONE popover session, scoping every
  // query to the open (:not([data-closed])) popup.
  const POP = '[data-slot="popover-content"]:not([data-closed])';
  const byText = (sel: string, text: string) => [...document.querySelectorAll<HTMLElement>(sel)].find((el) => (el.textContent || '').trim() === text) || null;
  const edRows = () => [...document.querySelectorAll<HTMLElement>(POP + ' div.cursor-default')];
  const rowEl = (name: string) =>
    edRows().find((el) => {
      const n = el.querySelector('span.truncate');
      return n && n.textContent === name;
    }) || null;
  const cntSpan = (name: string) => {
    const r = rowEl(name);
    return r ? r.querySelector('span.tabular-nums') : null;
  };
  const cntOf = (name: string) => {
    const c = cntSpan(name);
    return c ? c.textContent : null;
  };
  const offOf = (name: string) => {
    const c = cntSpan(name);
    return c ? c.className.includes('/60') : null;
  }; // muted 0-count (ValueRow off state)
  // Every control this harness drives is named, and a missing one throws under that
  // name. Optional-chaining the click instead would skip it silently and leave the
  // count assertions at the bottom to report a facet that was never opened.
  const clickByText = (sel: string, text: string) => {
    const el = byText(sel, text);
    if (!el) throw new Error('no element matching ' + sel + ' has the text ' + text);
    el.click();
  };
  const openMenu = async () => {
    clickByText('button', 'フィルタ');
    await waitFor('the filter menu to list its categories', () => !!document.querySelector(POP + ' [data-slot="command-item"]'));
  };
  const pickCat = async (label: string) => {
    clickByText(POP + ' [data-slot="command-item"]', label);
    await waitFor('the ' + label + ' editor to list its values', () => edRows().length > 0);
  };
  const goBack = async () => {
    const back = document.querySelector<HTMLElement>(POP + ' button[aria-label="戻る"]');
    if (!back) throw new Error('the 戻る button is missing from the open value editor');
    back.click();
    await waitFor('the category list to come back', () => !!document.querySelector(POP + ' [data-slot="command-item"]'));
  };
  // Toggling a value row re-runs the query. The observable post-condition is that the
  // grid LEAVES the count it had — not that it reaches the expected one, which is what
  // the checks at the bottom are for.
  const pickValue = async (name: string) => {
    const before = cards();
    const row = rowEl(name);
    if (!row) throw new Error('the ' + name + ' row is missing from the open value editor');
    row.click();
    await waitFor('the grid to re-filter after picking ' + name, () => cards() !== before);
    await waitStable('the grid to stop moving after picking ' + name, cards);
  };
  await waitFor('the grid to show all 5 seeded posts', () => cards() >= 5);
  const r: Record<string, unknown> = {};
  // all-platform counts (fixed list — order preserved, counts present)
  await openMenu();
  await pickCat('サイト'); // #253: renamed from プラットフォーム
  r.pfX_all = cntOf('X'); // 3
  r.pfBsky_all = cntOf('Bluesky'); // 1
  r.pfMisskey_all = cntOf('Misskey'); // 1
  // apply tag=猫 via its editor
  await goBack();
  await pickCat('タグ');
  // 「タグなし」 (P2⑬) — pinned first, counted over the same population, and picking it
  // leaves only the post that carries no tags (p4). Picked twice to get back to all 5:
  // the row toggles like every other value row.
  const firstRow = edRows()[0];
  const firstLabel = firstRow ? firstRow.querySelector('span.truncate') : null;
  r.noneFirst = firstLabel ? firstLabel.textContent : undefined; // 'タグなし'
  r.noneCount = cntOf('タグなし'); // 1
  await pickValue('タグなし');
  r.noneCards = cards(); // 1 (p4)
  await pickValue('タグなし');
  r.noneOffCards = cards(); // 5 again
  await pickValue('猫');
  r.afterCatCards = cards(); // 3 (p0,p2,p3)
  // back to platform — counts now reflect the 猫 query (values() reads the live tree)
  await goBack();
  await pickCat('サイト'); // #253: renamed from プラットフォーム
  r.pfX_cat = cntOf('X'); // 2
  r.pfMisskey_cat = cntOf('Misskey'); // 0
  r.pfMisskey_off = offOf('Misskey'); // false (fixed list: count but no greying)
  // back to tag — 犬 is now absent (0) and greyed on a facetDim list
  await goBack();
  await pickCat('タグ');
  r.tagCat = cntOf('猫'); // 3
  r.tagDog = cntOf('犬'); // 0
  r.tagDogOff = offOf('犬'); // true (facetDim greys a 0)
  r.noneCatCount = cntOf('タグなし'); // 0 (no untagged post is a 猫)
  r.noneCatOff = offOf('タグなし'); // true — greyed like any other absent value
  // --- poster view: counts come from filteredPosters() (population = posters) ---
  clickByText('button', 'フィルタ'); // toggle shut
  // The popup is marked [data-closed] the moment it starts leaving, which is the
  // post-condition worth having; the unmount itself is animation-throttled in this
  // unfocused window and costs seconds, so POP (which excludes [data-closed]) is
  // what we wait on.
  await waitFor('the filter popover to start closing', () => !document.querySelector(POP));
  clickByText('button', '投稿者');
  await waitFor('the poster view to show all 5 posters', () => posterCards() >= 5);
  await openMenu();
  await pickCat('プラットフォーム'); // poster-platform (same label in poster mode)
  r.posterPfX = cntOf('X'); // 3 posters (u0,u1,u2)
  r.posterPfBsky = cntOf('Bluesky'); // 1 (u3)
  r.posterPfMisskey = cntOf('Misskey'); // 1 (u4)
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
  const fixed = r.pfX_all === '3' && r.pfBsky_all === '1' && r.pfMisskey_all === '1' && r.afterCatCards === 3 && r.pfX_cat === '2' && r.pfMisskey_cat === '0' && r.pfMisskey_off === false;
  const facetDim = r.tagCat === '3' && r.tagDog === '0' && r.tagDogOff === true;
  const none = r.noneFirst === 'タグなし' && r.noneCount === '1' && r.noneCards === 1 && r.noneOffCards === 5 && r.noneCatCount === '0' && r.noneCatOff === true;
  const poster = r.posterPfX === '3' && r.posterPfBsky === '1' && r.posterPfMisskey === '1';
  const ok = fixed && facetDim && none && poster;
  console.log(`fixed: pfX_all=${r.pfX_all} bsky=${r.pfBsky_all} misskey=${r.pfMisskey_all} afterCat=${r.afterCatCards} pfX_cat=${r.pfX_cat} misskey_cat=${r.pfMisskey_cat} misskey_off=${r.pfMisskey_off}`);
  console.log(`facetDim: tagCat=${r.tagCat} tagDog=${r.tagDog} tagDogOff=${r.tagDogOff}`);
  console.log(`tagNone: first=${r.noneFirst} count=${r.noneCount} cards=${r.noneCards} offCards=${r.noneOffCards} catCount=${r.noneCatCount} catOff=${r.noneCatOff}`);
  console.log(`poster: pfX=${r.posterPfX} bsky=${r.posterPfBsky} misskey=${r.posterPfMisskey}`);
  console.log(ok ? 'FACETCOUNTS_TEST_PASS' : 'FACETCOUNTS_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
