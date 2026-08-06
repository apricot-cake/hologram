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
//  - 「このフォルダのみ」 (this folder only) narrows it back to the parent's own posts, and the chip says so
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
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { createDbWriter } = require(path.join(appDir, 'src', 'main', 'lib-db-write.ts'));
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-fold-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

// Known captureIds so the test can drive membership by id without scraping the DOM.
// The DB is the truth source (#298/#302): media goes to the save folder, records go
// straight into the database. Seed a two-level tree with the post sitting in the
// CHILD, so the aggregation assertions below exercise a real subtree.
const CIDS: any[] = [];
const records: any[] = [];
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-f0' + i;
  CIDS.push(id);
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
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
  });
}

{
  const handle = seedLibrary(configDir, records, { close: false });
  createDbWriter(handle.sqlite).setFolders({
    folders: [
      { id: 'f-root', name: '一次資料', kind: 'static', created: 1, parentId: null, items: [] },
      { id: 'f-kid', name: 'スケッチ', kind: 'static', created: 2, parentId: 'f-root', items: [CIDS[0]] },
    ],
    activeId: null,
  });
  handle.sqlite.close();
}

const evalJs = evalSource(async ({ waitFor }) => {
  const grid = document.querySelector('[data-slot="post-grid"]');
  const click = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const rclick = (el) => el && el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
  // Named rather than `!`: everything below counts cards, so a missing grid has to
  // stop the run and say which element was gone.
  const cards = () => {
    if (!grid) throw new Error('the post grid is missing from the document');
    return grid.querySelectorAll('[data-slot="post-card"]').length;
  };
  const rows = () => [...document.querySelectorAll('[data-slot="folder-row"]')];
  const rowNamed = (name) => rows().find((r) => (r.textContent || '').trim() === name);
  // #981: the sidebar is a rail and nothing else, so the folder tree lives in the flyout
  // behind the rail's フォルダ row — it is not in the document until that row is clicked.
  // (Base UI's Trigger stamps its own data-slot on whatever it renders, so the rail rows
  // are popover-triggers rather than sidebar-menu-buttons.) Picking a folder closes the
  // flyout by design, so this is called again wherever the tree is needed after that.
  const railRow = (label) => [...document.querySelectorAll('[data-slot="popover-trigger"]')].find((b) => (b.textContent || '').trim() === label);
  const openTree = async () => {
    if (rows().length) return true;
    click(railRow('フォルダ'));
    return await waitFor('the folder tree to open in the rail flyout', () => rows().length > 0);
  };
  // menu.ts renders every context menu through the shared DropdownMenu component.
  const menuRow = (txt) => [...document.querySelectorAll('[data-slot="dropdown-menu-item"]')].find((r) => (r.textContent || '').includes(txt));
  const chips = () => [...document.querySelectorAll('[data-slot="filter-chip"]')];
  const getFolders = () => (window as any).hologram.getFolders();
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  const out: Record<string, any> = {};

  // React owns the dialog input, so a plain .value assignment is invisible to it.
  const setInput = (el, v) => {
    const proto = Object.getPrototypeOf(el);
    // Named rather than `!`: the whole point of this helper is that React's own
    // setter runs, so a prototype without one has to stop the run and say so.
    const valueDesc = Object.getOwnPropertyDescriptor(proto, 'value');
    const setValue = valueDesc && valueDesc.set;
    if (!setValue) throw new Error('the dialog input prototype has no value setter to drive React with');
    setValue.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // The naming dialog. Its OK is matched by LABEL, not position — a layout change
  // must not quietly press Cancel and leave this suite still passing.
  const okBtn = () => [...document.querySelectorAll<HTMLButtonElement>('[data-slot="dialog-content"] button')].find((b) => (b.textContent || '').trim() === 'OK');
  const nameIt = async (name) => {
    if (!(await waitFor('the naming dialog to show its text field', () => !!document.querySelector('[data-slot="dialog-content"] input')))) return false;
    setInput(document.querySelector('[data-slot="dialog-content"] input'), name);
    // prompt/Prompt.tsx disables OK while the field is blank, so "OK went live" is
    // the observable proof that React took the value — no guess at commit timing.
    const okLive = await waitFor(
      'the OK button to go live once React took the typed name',
      () => {
        const b = okBtn();
        return !!b && !b.disabled;
      },
      3000,
    );
    if (!okLive) return false;
    click(okBtn());
    // The dialog unmounts on OK; waiting for it to go is how we know the click
    // landed before the next step reads the tree.
    await waitFor('the naming dialog to close after OK', () => !document.querySelector('[data-slot="dialog-content"]'), 3000);
    return true;
  };

  await waitFor('the grid to show all 3 seeded posts', () => cards() >= 3);
  out.totalBefore = cards(); // 3

  // --- A. the seeded child is nested: hidden until its parent is opened ---
  out.treeOpened = await openTree();
  out.parentShown = await waitFor('the root folder row to appear in the tree', () => !!rowNamed('一次資料'));
  out.childHiddenAtFirst = !rowNamed('スケッチ');
  click(document.querySelector('[data-slot="folder-twisty"]'));
  out.childShownAfterTwisty = await waitFor('the child folder row to appear once its parent is expanded', () => !!rowNamed('スケッチ'));

  // --- B. a row's context menu makes a SUBfolder under it ---
  rclick(rowNamed('スケッチ'));
  out.rowMenuOpened = await waitFor('the row context menu to offer creating a subfolder', () => !!menuRow('サブフォルダを作成'));
  click(menuRow('サブフォルダを作成'));
  out.namedSub = await nameIt('線画');
  // The parent opens on create: a new row hidden inside a collapsed parent is
  // indistinguishable from nothing having happened. Reopen the tree first — since
  // #981 the flyout goes away with the dialog that closed on top of it, and a
  // flyout that is shut says nothing about where the new folder went.
  out.treeAfterCreate = await openTree();
  out.newSubShown = await waitFor('the newly created subfolder row to appear in the tree', () => !!rowNamed('線画'));
  const c1 = await getFolders();
  const made = c1.folders.find((f) => f.name === '線画');
  const child = c1.folders.find((f) => f.name === 'スケッチ');
  out.newSubHasParent = !!made && !!child && made.parentId === child.id;

  // --- C. clicking the ROOT shows the grandchild's post: a folder condition
  //        covers its whole subtree (aggregation is the default meaning) ---
  // Named rather than optional-chained: the root row IS what this step drives, so a
  // missing one has to stop the run instead of letting the next assertion misreport.
  const rootRow = rowNamed('一次資料');
  if (!rootRow) throw new Error('the 一次資料 row is missing from the folder tree');
  click(rootRow.querySelector('[data-slot="sidebar-menu-button"]'));
  // The condition round-trips through the DB and re-renders the grid; wait for the
  // chip that names it and for the grid to answer, instead of timing the query.
  await waitFor('the folder chip to appear and the grid to narrow to the subtree', () => chips().some((c) => (c.textContent || '').includes('一次資料')) && cards() === 1);
  out.aggregated = cards(); // 1 — held two levels down

  // --- D. 「このフォルダのみ」 (this folder only) narrows it to the root's own posts (it holds none) ---
  const rootChip = chips().find((c) => (c.textContent || '').includes('一次資料'));
  if (!rootChip) throw new Error('the 一次資料 filter chip is missing from the chip bar');
  click(rootChip.querySelector('button'));
  out.editorOpened = await waitFor('the condition editor to offer the このフォルダのみ switch', () => [...document.querySelectorAll('label')].some((l) => (l.textContent || '').includes('このフォルダのみ')));
  click(document.querySelector('[data-slot="switch"]'));
  await waitFor('the chip to say このフォルダのみ and the grid to empty', () => chips().some((c) => (c.textContent || '').includes('のみ')) && cards() === 0);
  out.onlyCount = cards(); // 0
  out.chipSaysOnly = chips().some((c) => (c.textContent || '').includes('のみ'));
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await waitFor('the condition editor to close on Escape', () => ![...document.querySelectorAll('label')].some((l) => (l.textContent || '').includes('このフォルダのみ')), 3000);
  const x = chips().find((c) => (c.textContent || '').includes('一次資料'));
  if (!x) throw new Error('the 一次資料 filter chip went missing before the condition could be dropped');
  click([...x.querySelectorAll('button')].pop()); // drop the condition again
  await waitFor('the grid to show all 3 posts again once the condition is dropped', () => cards() === 3);
  out.backToAll = cards(); // 3

  // --- E. deleting the root takes both descendants with it ---
  out.treeReopened = await openTree();
  rclick(rowNamed('一次資料'));
  await waitFor('the row context menu to offer 削除', () => !!menuRow('削除'));
  click(menuRow('削除'));
  // The dialog says how many subfolders go too: one folder and nine are different
  // decisions, and the count is the only thing that can tell them apart.
  const desc = () => document.querySelector('[data-slot="alert-dialog-description"]');
  out.cascadeWarned = await waitFor('the delete dialog to name how many subfolders go with it', () => {
    const el = desc();
    return !!el && (el.textContent || '').includes('2');
  });
  click(document.querySelector('[data-slot="alert-dialog-action"]'));
  // Wait on the DB, not on the tree emptying: since #981 the tree lives in a flyout
  // that closes for reasons of its own, so an empty sidebar no longer means the
  // cascade landed. getFolders() is the thing the assertion below reads anyway.
  await waitFor('the cascade delete to empty the folder table while the posts stay', async () => (await getFolders()).folders.length === 0 && cards() === 3);
  const c2 = await getFolders();
  out.leftAfterDelete = c2.folders.length; // 0 — all three went
  out.postsKept = cards(); // 3 — the posts stay in the library
  out.noErrors = errors.length === 0;
  return out;
});

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
    treeOpened: true,
    parentShown: true,
    childHiddenAtFirst: true,
    childShownAfterTwisty: true,
    rowMenuOpened: true,
    namedSub: true,
    treeAfterCreate: true,
    newSubShown: true,
    newSubHasParent: true,
    aggregated: 1,
    editorOpened: true,
    onlyCount: 0,
    chipSaysOnly: true,
    backToAll: 3,
    treeReopened: true,
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
