'use strict';

// Verifies rolling the library's organization back to a DB generation (#233),
// end-to-end through IPC, because the interesting half cannot be unit-tested:
// the live database is CLOSED, replaced on disk and re-opened while the app is
// running.
//
//  - list-db-generations reports the store, saying which generations the backup
//    destination also holds ("この PC のみ／バックアップ先にもあり")
//  - rolling back restores the organization the generation held (a tag added
//    after it was taken is gone again)
//  - a post the generation predates SURVIVES the rollback, re-registered from
//    the automatic pre-rollback snapshot ("所蔵を過去に減らす操作ではない")
//  - that snapshot is itself left in the store, so the rollback can be undone
//  - the database is usable afterwards (posts read back through the normal path)
//
//   node scripts/test-app-rollback.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-rb-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
const outDir = path.join(tmp, 'out');
for (const dir of [configDir, saveFolder, outDir]) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const post = (n: number) => {
  const id = '170000000000' + n + '-rb' + n;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  return {
    captureId: id,
    image: id + '.jpg',
    url: 'https://x.com/u/status/' + (900 + n),
    platform: 'x',
    text: '本文' + n,
    displayName: '人' + n,
    screenName: 'u' + n,
    capturedAt: '2026-04-0' + (n + 1) + 'T12:00:00Z',
    media: [],
    tags: [],
    hashtags: [],
  };
};

const seeded = [post(0), post(1), post(2)];
seedLibrary(configDir, seeded);

const TAG_AFTER = 'この世代より後に付けたタグ';
const generationsOf = (root: string): string[] => {
  try {
    return fs.readdirSync(path.join(root, '.db-generations')).filter((n) => /^hologram-\d{8}-\d{6}\.db$/.test(n));
  } catch {
    return [];
  }
};

function launch(evalJs): Promise<Record<string, any>> {
  return new Promise((resolve) => {
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
      resolve(r);
    });
  });
}

(async () => {
  // launch A: a backup run writes the generation this test rolls back to, and
  // carries it to the destination (so the listing's "also at the destination"
  // has something true to report). Only AFTER that does the library gain the tag
  // the rollback is supposed to undo.
  const evalA = `(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    await wait(400);
    await window.hologram.setBackup({ dir: ${JSON.stringify(outDir)} });
    const r1 = await window.hologram.runBackup();
    await window.hologram.updateTags(${JSON.stringify(seeded[0].image)}, [${JSON.stringify(TAG_AFTER)}]);
    const posts = await window.hologram.listPosts();
    const tagged = (posts.posts.find(p => p.captureId === ${JSON.stringify(seeded[0].captureId)}) || {}).tags || [];
    return { backedUp: !!(r1 && r1.ok), taggedBefore: tagged.includes(${JSON.stringify(TAG_AFTER)}) };
  })()`;
  const rA = await launch(evalA);

  const generation = generationsOf(saveFolder)[0] || null;
  const generationAtDestination = generation ? fs.existsSync(path.join(outDir, 'Hologram-backup', '.db-generations', generation)) : false;

  // A post the generation has never heard of, written straight into the database
  // the way every real producer does. This is what the sweep has to carry across
  // the rollback — losing it would turn "go back to how things were organized"
  // into "give back the posts I have saved since".
  const late = post(3);
  seedLibrary(configDir, [late]);

  // launch B: list, roll back, and read the library out again afterwards.
  const evalB = `(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    await wait(400);
    const list = await window.hologram.listDbGenerations();
    const listed = !!(list && list.length === 1 && list[0].name === ${JSON.stringify(generation)} && list[0].atDestination === true && list[0].size > 0);

    const res = await window.hologram.rollbackDbGeneration(${JSON.stringify(generation)});
    const rolledBack = !!(res && res.ok && res.reregistered === 1);

    const posts = await window.hologram.listPosts();
    const ids = posts.posts.map(p => p.captureId).sort();
    const tagged = (posts.posts.find(p => p.captureId === ${JSON.stringify(seeded[0].captureId)}) || {}).tags || [];
    return { listed, rolledBack, ids, tagGone: !tagged.includes(${JSON.stringify(TAG_AFTER)}) };
  })()`;
  const rB = await launch(evalB);

  const expectedIds = [...seeded.map((p) => p.captureId), late.captureId].sort();
  const keptEverything = Array.isArray(rB.ids) && rB.ids.length === expectedIds.length && rB.ids.every((id: string, i: number) => id === expectedIds[i]);
  // The pre-rollback state is itself a restore point now, so the store grew.
  const stashKept = generationsOf(saveFolder).length === 2;

  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = rA.backedUp && rA.taggedBefore && !!generation && generationAtDestination && rB.listed && rB.rolledBack && rB.tagGone && keptEverything && stashKept;
  console.log(`backedUp=${rA.backedUp} taggedBefore=${rA.taggedBefore} generation=${!!generation}/${generationAtDestination} listed=${rB.listed} rolledBack=${rB.rolledBack} tagGone=${rB.tagGone} keptEverything=${keptEverything} stashKept=${stashKept}`);
  console.log(ok ? 'ROLLBACK_TEST_PASS' : 'ROLLBACK_TEST_FAIL');
  process.exit(ok ? 0 : 1);
})();
