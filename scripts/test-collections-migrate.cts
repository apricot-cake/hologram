'use strict';

// Verifies the one-time folders.json → collections.json migration (clean cutover):
//  - each folder becomes a static collection with its id preserved
//  - the legacy workspace tray is DROPPED (not migrated); clip starts empty []
//  - activeId is always null (legacy key; the renderer never writes it)
//  - posterWorkspace rides along
//  - folders.json is DELETED after migration; collections.json is written
//  - get-collections is idempotent (2nd call reads collections.json, no re-migrate)
// Seeds real captures so the renderer's reconcile keeps the referenced ids.
//
//   node scripts/test-collections-migrate.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

// The eval is generic: it inspects whatever migration produced.
const evalJs = `(async () => {
  const grid = document.getElementById('postGrid');
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  await waitFor(() => grid.querySelectorAll('.post-card').length >= 1);
  await sleep(200);   // let posts load + reconcile settle
  const r1 = await window.corpus.getCollections();
  const r2 = await window.corpus.getCollections();   // idempotency: now reads collections.json
  const legacy = await window.corpus.getFolders();    // folders.json deleted → empty
  return {
    collections: r1.collections.map((c) => ({ id: c.id, name: c.name, kind: c.kind, items: c.items.slice().sort() })),
    activeId: r1.activeId,
    clip: (r1.clip || []).slice().sort(),
    allCount: r1.collections.length,
    posterWorkspace: (r1.posterWorkspace || []).slice().sort(),
    idempotent: JSON.stringify(r1) === JSON.stringify(r2),
    legacyEmpty: (legacy.folders || []).length === 0 && (legacy.workspace || []).length === 0,
  };
})()`;

function runCase(captures, foldersJson) {
  return new Promise<Record<string, any>>((resolve) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-migr-'));
    const configDir = path.join(tmp, 'Corpus');
    const saveFolder = path.join(tmp, 'saves');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(saveFolder, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));
    for (const c of captures) {
      fs.writeFileSync(path.join(saveFolder, c.id + '.jpg'), jpeg);
      fs.writeFileSync(
        path.join(saveFolder, c.id + '.json'),
        JSON.stringify(
          {
            captureId: c.id,
            image: c.id + '.jpg',
            url: 'https://www.pixiv.net/artworks/' + c.art,
            platform: 'pixiv',
            userId: c.userId,
            title: 'T' + c.id,
            displayName: 'D' + c.userId,
            screenName: c.userId,
            likes: 1,
            capturedAt: '2026-04-01T12:00:00Z',
            date: '2026-04-01T10:00:00Z',
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
    fs.writeFileSync(path.join(saveFolder, 'folders.json'), JSON.stringify(foldersJson, null, 2));

    const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'), CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
    const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
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
      r._foldersJsonGone = !fs.existsSync(path.join(saveFolder, 'folders.json'));
      r._collectionsJsonExists = fs.existsSync(path.join(saveFolder, 'collections.json'));
      fs.rmSync(tmp, { recursive: true, force: true });
      resolve(r);
    });
  });
}

(async () => {
  let pass = true;
  const fail = (msg) => {
    pass = false;
    console.log('  FAIL: ' + msg);
  };

  // --- Case A: folders + non-empty workspace + posterWorkspace ---
  // The workspace tray is DROPPED on migration (clip starts empty); only the two
  // folders survive as static collections. posterWorkspace rides along.
  const a = await runCase(
    [
      { id: 'cid0', art: 200, userId: '80000' },
      { id: 'cid1', art: 201, userId: '80001' },
      { id: 'cid2', art: 202, userId: '80002' },
    ],
    {
      folders: [
        { id: 'f-aaa', name: '資料A', items: ['cid0'] },
        { id: 'f-bbb', name: '資料B', items: ['cid1', 'cid2'] },
      ],
      workspace: ['cid2'],
      posterWorkspace: ['pixiv:80001'],
    },
  );
  console.log('Case A (workspace dropped):', JSON.stringify(a));
  const fA = (id) => a.collections.find((c) => c.id === id);
  if (!fA('f-aaa') || JSON.stringify(fA('f-aaa').items) !== JSON.stringify(['cid0'])) fail('f-aaa not preserved with [cid0]');
  if (!fA('f-bbb') || JSON.stringify(fA('f-bbb').items) !== JSON.stringify(['cid1', 'cid2'])) fail('f-bbb not preserved with [cid1,cid2]');
  if ((a.collections || []).length !== 2) fail('expected 2 collections (workspace dropped, not migrated)');
  if (a.activeId !== null) fail('activeId should be null (legacy key, never set)');
  if (JSON.stringify(a.clip) !== JSON.stringify([])) fail('clip should start empty (workspace not migrated)');
  if (a.allCount !== 2) fail('all() should list both folders (expected 2)');
  if (JSON.stringify(a.posterWorkspace) !== JSON.stringify(['pixiv:80001'])) fail('posterWorkspace not migrated');
  if (!a.idempotent) fail('get-collections not idempotent');
  if (!a.legacyEmpty) fail('getFolders() should be empty after migration');
  if (!a._foldersJsonGone) fail('folders.json should be deleted');
  if (!a._collectionsJsonExists) fail('collections.json should exist');

  // --- Case B: single folder, no workspace / posterWorkspace → minimal migration ---
  const b = await runCase([{ id: 'cid9', art: 300, userId: '90000' }], { folders: [{ id: 'f-x', name: '資料X', items: ['cid9'] }], workspace: [], posterWorkspace: [] });
  console.log('Case B (folder only):', JSON.stringify(b));
  if ((b.collections || []).length !== 1) fail('B: expected 1 collection (folder only)');
  if (b.activeId !== null) fail('B: activeId should be null');
  if (JSON.stringify(b.clip) !== JSON.stringify([])) fail('B: clip should be empty');
  if (b.allCount !== 1) fail('B: all() should be 1');
  if (!b._foldersJsonGone) fail('B: folders.json should be deleted');

  console.log(pass ? 'MIGRATE_TEST_PASS' : 'MIGRATE_TEST_FAIL');
  process.exit(pass ? 0 : 1);
})();
