'use strict';

// Verifies the folder features against the redesigned shell (#154 P2⑧ / #41), where
// the sidebar tree IS the manager for library folders — the modal this suite used to
// drive is gone:
//  - the + on the group heading creates a root folder (naming dialog)
//  - a row context menu creates a SUBfolder under it, and the parent opens so the new
//    row is actually visible
//  - a post joins the CHILD through the card menu, whose rows are labelled by path now
//    that a bare name no longer identifies a folder
//  - clicking the PARENT shows the child's post: a folder condition covers its subtree
//  - 「このフォルダのみ」 narrows it back to the parent's own posts, and the chip says so
//  - deleting the parent takes the child with it, and the posts stay in the library
//
// The clip half of this suite went away with the clip surfaces themselves (the
// redesigned sidebar has no clip row; removing the feature is #135).
//
//   node scripts/test-app-folders.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-fold-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

// Known captureIds so the test can drive membership by id without scraping the DOM.
const CIDS: any[] = [];
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-f0' + i;
  CIDS.push(id);
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, id + '.json'),
    JSON.stringify(
      {
        captureId: id,
        image: id + '.jpg',
        url: 'https://www.pixiv.net/artworks/' + (200 + i),
        platform: 'pixiv',
        title: '作品' + i,
        displayName: '絵師' + i,
        screenName: '80000' + i,
        likes: 1000 + i,
        capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
        date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
        media: [],
        tags: [],
        hashtags: [],
        source: 'eagle-migration',
      },
      null,
      2,
    ),
  );
}

// Seed a two-level tree with the post sitting in the GRANDCHILD, so the aggregation
// assertions below are about a real subtree rather than one level of nesting.
fs.writeFileSync(
  path.join(saveFolder, 'folders.json'),
  JSON.stringify({
    folders: [
      { id: 'f-root', name: '一次資料', kind: 'static', created: 1, parentId: null, items: [] },
      { id: 'f-kid', name: 'スケッチ', kind: 'static', created: 2, parentId: 'f-root', items: [CIDS[0]] },
    ],
    activeId: null,
    clip: [],
    posterWorkspace: [],
  }),
);

const evalJs = `(async () => {
  const grid = document.getElementById('postGrid');
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  const click = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const rclick = (el) => el && el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
  const cards = () => grid.querySelectorAll('.post-card').length;
  const rows = () => [...document.querySelectorAll('[data-slot="folder-row"]')];
  const rowNamed = (name) => rows().find(r => r.textContent.trim() === name);
  // menu.ts renders every context menu through the shared DropdownMenu island.
  const menuRow = (txt) => [...document.querySelectorAll('[data-slot="dropdown-menu-item"]')].find(r => (r.textContent || '').includes(txt));
  const chips = () => [...document.querySelectorAll('[data-slot="filter-chip"]')];
  const getFolders = () => window.hologram.getFolders();
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  const out = {};

  // React owns the dialog input, so a plain .value assignment is invisible to it.
  const setInput = (el, v) => {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // The naming dialog. Its OK is matched by LABEL, not position — a layout change
  // must not quietly press Cancel and leave this suite still passing.
  const nameIt = async (name) => {
    if (!await waitFor(() => !!document.querySelector('[data-slot="dialog-content"] input'))) return false;
    setInput(document.querySelector('[data-slot="dialog-content"] input'), name);
    await sleep(40);
    click([...document.querySelectorAll('[data-slot="dialog-content"] button')].find(b => b.textContent.trim() === 'OK'));
    await sleep(140);
    return true;
  };

  await waitFor(() => cards() >= 3);
  out.totalBefore = cards();                                        // 3

  // --- A. the seeded child is nested: hidden until its parent is opened ---
  out.parentShown = await waitFor(() => !!rowNamed('一次資料'));
  out.childHiddenAtFirst = !rowNamed('スケッチ');
  click(document.querySelector('[data-slot="folder-twisty"]'));
  out.childShownAfterTwisty = await waitFor(() => !!rowNamed('スケッチ'));

  // --- B. a row's context menu makes a SUBfolder under it ---
  rclick(rowNamed('スケッチ'));
  out.rowMenuOpened = await waitFor(() => !!menuRow('サブフォルダを作成'));
  click(menuRow('サブフォルダを作成'));
  out.namedSub = await nameIt('線画');
  // The parent opens on create: a new row hidden inside a collapsed parent is
  // indistinguishable from nothing having happened.
  out.newSubShown = await waitFor(() => !!rowNamed('線画'));
  const c1 = await getFolders();
  const made = c1.folders.find(f => f.name === '線画');
  const child = c1.folders.find(f => f.name === 'スケッチ');
  out.newSubHasParent = !!made && !!child && made.parentId === child.id;

  // --- C. clicking the ROOT shows the grandchild's post: a folder condition
  //        covers its whole subtree (aggregation is the default meaning) ---
  click(rowNamed('一次資料').querySelector('[data-slot="sidebar-menu-button"]'));
  await sleep(350);
  out.aggregated = cards();                                         // 1 — held two levels down

  // --- D. 「このフォルダのみ」 narrows it to the root's own posts (it holds none) ---
  click(chips().find(c => c.textContent.includes('一次資料')).querySelector('button'));
  out.editorOpened = await waitFor(() => [...document.querySelectorAll('label')].some(l => l.textContent.includes('このフォルダのみ')));
  click(document.querySelector('[data-slot="switch"]'));
  await sleep(350);
  out.onlyCount = cards();                                          // 0
  out.chipSaysOnly = chips().some(c => c.textContent.includes('のみ'));
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(120);
  const x = chips().find(c => c.textContent.includes('一次資料'));
  click([...x.querySelectorAll('button')].pop());                   // drop the condition again
  await sleep(300);
  out.backToAll = cards();                                          // 3

  // --- E. deleting the root takes both descendants with it ---
  rclick(rowNamed('一次資料'));
  await waitFor(() => !!menuRow('削除'));
  click(menuRow('削除'));
  // The dialog says how many subfolders go too: one folder and nine are different
  // decisions, and the count is the only thing that can tell them apart.
  const desc = () => document.querySelector('[data-slot="alert-dialog-description"]');
  out.cascadeWarned = await waitFor(() => !!desc() && desc().textContent.includes('2'));
  click(document.querySelector('[data-slot="alert-dialog-action"]'));
  await sleep(350);
  const c2 = await getFolders();
  out.leftAfterDelete = c2.folders.length;                          // 0 — all three went
  out.postsKept = cards();                                          // 3 — the posts stay in the library
  out.noErrors = errors.length === 0;
  return out;
})()`;

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'),
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
  const expect = {
    totalBefore: 3,
    parentShown: true,
    childHiddenAtFirst: true,
    childShownAfterTwisty: true,
    rowMenuOpened: true,
    namedSub: true,
    newSubShown: true,
    newSubHasParent: true,
    aggregated: 1,
    editorOpened: true,
    onlyCount: 0,
    chipSaysOnly: true,
    backToAll: 3,
    cascadeWarned: true,
    leftAfterDelete: 0,
    postsKept: 3,
    noErrors: true,
  };
  const keys = Object.keys(expect);
  const ok = keys.every((k) => r[k] === expect[k]);
  console.log(keys.map((k) => k + '=' + r[k]).join(' '));
  console.log(ok ? 'FOLDERS_TEST_PASS' : 'FOLDERS_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
