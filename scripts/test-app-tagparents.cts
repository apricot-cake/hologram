'use strict';

// App-level check for #774 — the query-time application of tag parent
// relationships, driven through the real renderer and the real DB rather than
// through injected stubs (the unit suites cover the logic; what this pins is the
// WIRING: the facet row → pick → leaf → predicate chain, and the fact that the
// effective set is derived on every read instead of stored).
//
//   seeds: p0 レミリア / p1 レミリア / p2 東方 / p3 風景 / p4 (no tags)
//   edges: レミリア → 紅魔郷 → 東方   (紅魔郷 exists only as vocabulary)
//
//   Asserted:
//     1. the 東方 row counts 3 (p2 names it; p0/p1 reach it through 紅魔郷)
//     2. picking 東方 leaves those 3 cards — the parent leaf matches child posts
//     3. 紅魔郷 gets its own row even though no post carries it directly
//     4. removing the rule collapses the effective set at the next read
//        (reversibility, observed live through listPosts)
//
//   node scripts/test-app-tagparents.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-tp-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const seeds = [{ tags: ['レミリア'] }, { tags: ['レミリア'] }, { tags: ['東方'] }, { tags: ['風景'] }, { tags: [] }];
const records: any[] = [];
seeds.forEach((s, i) => {
  const id = '170000000000' + i + '-tp' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: 'https://x.com/u' + i + '/status/90' + i,
    platform: 'x',
    text: '本文' + i,
    displayName: '人' + i,
    screenName: 'u' + i,
    likes: 10 + i,
    capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [],
    tags: s.tags,
    hashtags: [],
  });
});
// Keep the handle open to seed the parent edges: no feature writes tag_parents
// through the record writer, and the tag management page (#21) is the only UI
// that does — driving it here would test that page, not this derivation.
const handle = seedLibrary(configDir, records, { close: false });
const { sqlite } = handle;
sqlite.prepare('INSERT INTO tags (name, kind, reading) VALUES (?, ?, ?)').run('紅魔郷', null, null);
const idOf = (name: string) => (sqlite.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number }).id;
const remiliaId = idOf('レミリア');
const scarletId = idOf('紅魔郷');
const touhouId = idOf('東方');
const insEdge = sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, ?)');
insEdge.run(remiliaId, scarletId, 0);
insEdge.run(scarletId, touhouId, 0);
sqlite.close();

const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  // Same filterbar idioms as test-app-facetcounts (one popover session, navigate
  // between categories with 戻る — the smoke window throttles exit animations).
  const POP = '[data-slot="popover-content"]:not([data-closed])';
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text) || null;
  const edRows = () => [...document.querySelectorAll(POP + ' div.cursor-default')];
  const rowEl = (name) => edRows().find((el) => { const n = el.querySelector('span.truncate'); return n && n.textContent === name; }) || null;
  const cntOf = (name) => { const r = rowEl(name); const c = r && r.querySelector('span.tabular-nums'); return c ? c.textContent : null; };
  await waitFor(() => cards() >= 5);
  const r = {};
  byText('button', 'フィルタ').click();
  await waitFor(() => !!document.querySelector(POP + ' [data-slot="command-item"]'));
  byText(POP + ' [data-slot="command-item"]', 'タグ').click();
  await waitFor(() => edRows().length > 0);
  r.rows = edRows().map((el) => { const n = el.querySelector('span.truncate'); return n ? n.textContent : null; }).filter(Boolean);
  r.touhou = cntOf('東方');     // 3 — p2 names it, p0/p1 reach it through 紅魔郷
  r.scarlet = cntOf('紅魔郷');  // 2 — carried by nothing directly, implied by p0/p1
  r.remilia = cntOf('レミリア'); // 2
  r.scenery = cntOf('風景');    // 1
  // Picking the PARENT row must leave the child-tagged posts (the whole point).
  rowEl('東方').click(); await wait(260);
  r.touhouCards = cards();      // 3 (p0,p1,p2)
  rowEl('東方').click(); await wait(260);
  r.backCards = cards();        // 5
  byText('button', 'フィルタ').click(); await wait(120);
  // Reversibility, read live: drop the 紅魔郷→東方 edge and re-read the library.
  // Nothing was ever stored, so the next SELECT alone has to show the change.
  const edges = await window.hologram.getTagParentEdges();
  const scarletEdge = edges.find((e) => e.parentTagName === '東方' || e.parentTagId === ${touhouId});
  r.sawEdge = !!scarletEdge;
  const before = await window.hologram.listPosts();
  const effOf = (snap, tag) => (snap.posts || snap.records || snap).filter((p) => (p.effectiveTags || []).includes(tag)).length;
  r.effTouhouBefore = effOf(before, '東方');  // 3
  await window.hologram.removeTagParent(${scarletId}, ${touhouId});
  const after = await window.hologram.listPosts();
  r.effTouhouAfter = effOf(after, '東方');    // 1 — only the post that names it
  r.effScarletAfter = effOf(after, '紅魔郷'); // 2 — the レミリア→紅魔郷 edge survives
  return r;
})()`;

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
  const counts = r.touhou === '3' && r.scarlet === '2' && r.remilia === '2' && r.scenery === '1';
  const picking = r.touhouCards === 3 && r.backCards === 5;
  const vocab = Array.isArray(r.rows) && r.rows.includes('紅魔郷');
  const reversible = r.sawEdge === true && r.effTouhouBefore === 3 && r.effTouhouAfter === 1 && r.effScarletAfter === 2;
  const ok = counts && picking && vocab && reversible;
  console.log(`counts: 東方=${r.touhou} 紅魔郷=${r.scarlet} レミリア=${r.remilia} 風景=${r.scenery}`);
  console.log(`picking: parentCards=${r.touhouCards} back=${r.backCards}`);
  console.log(`vocab: rows=${JSON.stringify(r.rows)}`);
  console.log(`reversible: sawEdge=${r.sawEdge} before=${r.effTouhouBefore} after=${r.effTouhouAfter} scarletAfter=${r.effScarletAfter}`);
  console.log(ok ? 'TAGPARENTS_TEST_PASS' : 'TAGPARENTS_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
