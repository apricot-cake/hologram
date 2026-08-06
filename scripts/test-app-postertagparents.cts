'use strict';

// App-level check for #810's poster half — poster tags read as ENTITIES, with
// #774's query-time parent application reaching them. The unit suites cover the
// derivation (db-write) and the predicate (query); what this pins is the WIRING
// that only exists in the running app: poster facet row → pick → leaf carrying a
// tagId → poster predicate → the grid.
//
//   seeds:  posters u0/u1/u2, one post each
//   poster tags:  u0 = レミリア   u1 = 東方   u2 = (none)
//   edges:  レミリア → 東方
//
//   Asserted:
//     1. the 東方 row counts 2 (u1 names it; u0 reaches it through レミリア)
//     2. picking 東方 leaves those 2 poster cards — the asymmetry #810 closes
//        (before it, only u1 matched)
//     3. removing the rule collapses the effective set at the next read
//        (reversibility, observed live through get-poster-tags)
//
//   node scripts/test-app-postertagparents.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-ptp-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const records: any[] = [];
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-ptp' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: 'https://x.com/u' + i + '/status/80' + i,
    platform: 'x',
    text: '本文' + i,
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
// Poster tags and parent edges are seeded straight into the DB, for the same
// reason test-app-tagparents does it: the UIs that write them are other features,
// and driving them here would test those instead of this derivation. posterKey is
// query.ts's userKey — platform + the @handle when there is no platform user id.
const handle = seedLibrary(configDir, records, { close: false });
const { sqlite } = handle;
const insTag = sqlite.prepare('INSERT INTO tags (name) VALUES (?)');
insTag.run('レミリア');
insTag.run('東方');
const idOf = (name: string) => (sqlite.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number }).id;
const remiliaId = idOf('レミリア');
const touhouId = idOf('東方');
const insPosterTag = sqlite.prepare('INSERT INTO poster_tags (posterKey, tagId) VALUES (?, ?)');
insPosterTag.run('x:@u0', remiliaId);
insPosterTag.run('x:@u1', touhouId);
sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, 0)').run(remiliaId, touhouId);
sqlite.close();

const evalJs = evalSource(
  async ({ waitFor }, args) => {
    // The body is serialised, so nothing here may close over this file — the tag
    // ids arrive through `args`. The bridge is reached off `window` because
    // scripts/ has no preload typings of its own.
    const hologram = (window as any).hologram;
    const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
    const posterCards = () => document.querySelectorAll('[data-slot="poster-grid"] [data-slot="poster-card"]').length;
    // Same filterbar idioms as test-app-facetcounts (one popover session; the smoke
    // window throttles exit animations, so never await a full unmount).
    const POP = '[data-slot="popover-content"]:not([data-closed])';
    const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text) || null;
    const edRows = () => [...document.querySelectorAll<HTMLElement>(POP + ' div.cursor-default')];
    const rowEl = (name) =>
      edRows().find((el) => {
        const n = el.querySelector('span.truncate');
        return n && n.textContent === name;
      }) || null;
    // Named rather than optional-chained: the row IS what each step is about, so a
    // missing one has to stop the run and say which row. `?.` would skip the click
    // and leave the next assertion to report something else.
    const mustRow = (name) => {
      const el = rowEl(name);
      if (!el) throw new Error('the ' + name + ' row is missing from the tag editor');
      return el;
    };
    const cntOf = (name) => {
      const r = rowEl(name);
      const c = r && r.querySelector('span.tabular-nums');
      return c ? c.textContent : null;
    };
    await waitFor('the grid to show all 3 seeded posts', () => cards() >= 3);
    const r: Record<string, any> = {};
    byText('button', '投稿者').click();
    await waitFor('the poster view to show all 3 posters', () => posterCards() >= 3);
    byText('button', 'フィルタ').click();
    await waitFor('the filter menu to open', () => !!document.querySelector(POP + ' [data-slot="command-item"]'));
    byText(POP + ' [data-slot="command-item"]', 'タグ').click();
    await waitFor('the tag editor to list the poster tags', () => edRows().length > 0);
    r.rows = edRows()
      .map((el) => {
        const n = el.querySelector('span.truncate');
        return n ? n.textContent : null;
      })
      .filter(Boolean);
    r.touhou = cntOf('東方'); // 2 — u1 names it, u0 reaches it through レミリア
    r.remilia = cntOf('レミリア'); // 1
    // Picking the PARENT row must leave the poster tagged only with the child.
    // Both toggles change the poster count, so waiting for the new count observes
    // the transition instead of the state the click started from.
    mustRow('東方').click();
    await waitFor('the poster grid to narrow to the posters that reach 東方', () => posterCards() === 2);
    r.touhouCards = posterCards(); // 2 (u0, u1)
    mustRow('東方').click();
    await waitFor('the poster grid to show every poster again once the 東方 leaf is off', () => posterCards() === 3);
    r.backCards = posterCards(); // 3
    byText('button', 'フィルタ').click();
    // POP excludes [data-closed], so the popover stops matching as soon as the close
    // is committed — no need to await the (throttled) exit animation.
    await waitFor('the filter popover to close', () => !document.querySelector(POP));
    // Reversibility, read live: nothing is stored on the poster, so dropping the
    // edge has to change the next read on its own.
    const effOf = (snap, key, tag) => ((snap.tags[key] || {}).effectiveTags || []).includes(tag);
    r.effBefore = effOf(await hologram.getPosterTags(), 'x:@u0', '東方');
    await hologram.removeTagParent(args.remiliaId, args.touhouId);
    r.effAfter = effOf(await hologram.getPosterTags(), 'x:@u0', '東方');
    return r;
  },
  { remiliaId, touhouId },
);

const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir, HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });
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
  const counts = r.touhou === '2' && r.remilia === '1';
  const picking = r.touhouCards === 2 && r.backCards === 3;
  const reversible = r.effBefore === true && r.effAfter === false;
  const ok = counts && picking && reversible;
  console.log(`counts: 東方=${r.touhou} レミリア=${r.remilia} rows=${JSON.stringify(r.rows)}`);
  console.log(`picking: parentCards=${r.touhouCards} back=${r.backCards}`);
  console.log(`reversible: before=${r.effBefore} after=${r.effAfter}`);
  console.log(ok ? 'POSTERTAGPARENTS_TEST_PASS' : 'POSTERTAGPARENTS_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
