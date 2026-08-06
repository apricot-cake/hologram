'use strict';

// Round-trips #176 (multiple libraries — switching, DB-into-library-folder
// migration, classification) through the real Electron main process. Same
// shape as test-app-library-missing.cts: each scenario launches a fresh
// process against an isolated HOLOGRAM_CONFIG_DIR so nothing here can touch a
// real library.
//
//   node scripts/test-app-library-switch.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { seedLibrary } = require('./lib-seed-library.cts');
const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
const { makeTagResolver, preparePostStmts, writePost } = require(path.join(appDir, 'src', 'main', 'lib-db-record-writer.ts'));
const { evalSource } = require('./lib-wait.cts');

const electronPath = resolveElectron();

function launch(configDir: string, evalJs: string): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, {
      HOLOGRAM_CONFIG_DIR: configDir,
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
      resolve(r);
    });
  });
}

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}: ${detail}`);
}

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

// Seeds one library at `libDir` with one post — a throwaway seed-config
// directory funnels lib-seed-library.cts's saveFolder lookup, independent of
// whichever configDir a scenario ultimately launches Electron against.
function seedOneLibrary(root: string, name: string, libDir: string, captureId: string, text: string) {
  fs.mkdirSync(libDir, { recursive: true });
  fs.writeFileSync(path.join(libDir, `${captureId}.jpg`), jpeg);
  const seedCfg = path.join(root, `seedcfg-${name}`);
  fs.mkdirSync(seedCfg, { recursive: true });
  fs.writeFileSync(path.join(seedCfg, 'config.json'), JSON.stringify({ saveFolder: libDir }));
  seedLibrary(seedCfg, [
    {
      captureId,
      image: `${captureId}.jpg`,
      url: `https://x.com/u/status/${captureId}`,
      platform: 'x',
      text,
      capturedAt: '2026-01-01T00:00:00.000Z',
      date: '2026-01-01T00:00:00.000Z',
    },
  ]);
}

(async () => {
  // --- Scenario A: startup migration moves a pre-#176 hologram.db from ------
  // configDir INTO the save folder, without losing the record it holds.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-libswitch-a-'));
    const configDir = path.join(tmp, 'Hologram');
    const saveFolder = path.join(tmp, 'library');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(saveFolder, { recursive: true });
    fs.writeFileSync(path.join(saveFolder, 'legacy1.jpg'), jpeg);
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

    // Simulate a pre-#176 install: hologram.db sitting in configDir (the OLD
    // location), holding one record whose media is already in saveFolder.
    const legacyDb = openDatabase(path.join(configDir, 'hologram.db'));
    const stmts = preparePostStmts(legacyDb.sqlite);
    const resolveTagId = makeTagResolver(legacyDb.sqlite);
    writePost(stmts, resolveTagId, {
      captureId: 'legacy1',
      image: 'legacy1.jpg',
      url: 'https://x.com/u/status/legacy1',
      platform: 'x',
      text: 'pre-#176 record',
      capturedAt: '2026-01-01T00:00:00.000Z',
      date: '2026-01-01T00:00:00.000Z',
    });
    legacyDb.sqlite.close();

    const evalJs = evalSource(async () => {
      return await (window as any).hologram.getConfig();
    });
    await launch(configDir, evalJs);

    check('A1: the old configDir/hologram.db is gone after launch', !fs.existsSync(path.join(configDir, 'hologram.db')), `existsSync=${fs.existsSync(path.join(configDir, 'hologram.db'))}`);
    check('A2: hologram.db now lives inside the save folder', fs.existsSync(path.join(saveFolder, 'hologram.db')), `existsSync=${fs.existsSync(path.join(saveFolder, 'hologram.db'))}`);
    if (fs.existsSync(path.join(saveFolder, 'hologram.db'))) {
      const migrated = openDatabase(path.join(saveFolder, 'hologram.db'), { readonly: true });
      const row = migrated.sqlite.prepare('SELECT captureId, text FROM posts WHERE captureId = ?').get('legacy1') as any;
      check('A3: the pre-existing record survived the migration', !!(row && row.text === 'pre-#176 record'), JSON.stringify(row));
      migrated.sqlite.close();
    } else {
      check('A3: the pre-existing record survived the migration', false, 'migrated DB not found, cannot check');
    }

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- Scenario B: switching between two fully independent libraries --------
  // (has-db branch) totally replaces the posts, and both appear in the recent list.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-libswitch-b-'));
    const configDir = path.join(tmp, 'Hologram');
    const libA = path.join(tmp, 'lib-a');
    const libB = path.join(tmp, 'lib-b');
    fs.mkdirSync(configDir, { recursive: true });
    seedOneLibrary(tmp, 'a', libA, 'a1', 'library A post');
    seedOneLibrary(tmp, 'b', libB, 'b1', 'library B post');
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: libA }));

    const evalJs = evalSource(
      async (_waits, args) => {
        const before = await (window as any).hologram.listPosts();
        const sw = await (window as any).hologram.switchLibrary(args.libB);
        const after = await (window as any).hologram.listPosts();
        const cfg = await (window as any).hologram.getConfig();
        const recent = await (window as any).hologram.getRecentLibraries();
        return { before, sw, after, cfg, recent };
      },
      { libB },
    );
    const r = await launch(configDir, evalJs);

    const beforeIds = ((r.before && r.before.posts) || []).map((p: any) => p.captureId);
    const afterIds = ((r.after && r.after.posts) || []).map((p: any) => p.captureId);
    check("B1: before switching, only library A's post is visible", beforeIds.includes('a1') && !beforeIds.includes('b1'), JSON.stringify(beforeIds));
    check('B2: switch-library reports ok with the new saveFolder', !!(r.sw && r.sw.ok === true && r.sw.saveFolder === libB), JSON.stringify(r.sw));
    check("B3: after switching, only library B's post is visible — none of A's rows carried over", afterIds.includes('b1') && !afterIds.includes('a1'), JSON.stringify(afterIds));
    check('B4: config.saveFolder now points at library B', !!(r.cfg && r.cfg.saveFolder === libB), JSON.stringify(r.cfg));
    const recentPaths = ((r.recent as any[]) || []).map((e) => e.path);
    check('B5: both libraries appear in the recent list', recentPaths.includes(libA) && recentPaths.includes(libB), JSON.stringify(recentPaths));

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- Scenario C: switching to an empty folder starts a brand-new library --
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-libswitch-c-'));
    const configDir = path.join(tmp, 'Hologram');
    const libA = path.join(tmp, 'lib-a');
    const emptyDir = path.join(tmp, 'brand-new');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(emptyDir, { recursive: true });
    seedOneLibrary(tmp, 'a', libA, 'a1', 'library A post');
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: libA }));

    const evalJs = evalSource(
      async (_waits, args) => {
        const sw = await (window as any).hologram.switchLibrary(args.emptyDir);
        const after = await (window as any).hologram.listPosts();
        return { sw, after };
      },
      { emptyDir },
    );
    const r = await launch(configDir, evalJs);

    check('C1: switch-library succeeds against an empty folder', !!(r.sw && r.sw.ok === true), JSON.stringify(r.sw));
    check('C2: the new library starts with zero posts', !!(r.after && Array.isArray(r.after.posts) && r.after.posts.length === 0), JSON.stringify(r.after));
    check('C3: a fresh hologram.db was created in the empty folder', fs.existsSync(path.join(emptyDir, 'hologram.db')), `existsSync=${fs.existsSync(path.join(emptyDir, 'hologram.db'))}`);

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- Scenario D: a non-empty folder with no library evidence is rejected --
  // outright — nothing is written there, and the current library is untouched.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-libswitch-d-'));
    const configDir = path.join(tmp, 'Hologram');
    const libA = path.join(tmp, 'lib-a');
    const junkDir = path.join(tmp, 'someone-elses-folder');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(junkDir, { recursive: true });
    fs.writeFileSync(path.join(junkDir, 'readme.txt'), 'not a Hologram library');
    seedOneLibrary(tmp, 'a', libA, 'a1', 'library A post');
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: libA }));

    const evalJs = evalSource(
      async (_waits, args) => {
        const sw = await (window as any).hologram.switchLibrary(args.junkDir);
        const cfg = await (window as any).hologram.getConfig();
        return { sw, cfg };
      },
      { junkDir },
    );
    const r = await launch(configDir, evalJs);

    check('D1: switch-library refuses with error="not-a-library"', !!(r.sw && r.sw.ok === false && r.sw.error === 'not-a-library'), JSON.stringify(r.sw));
    check('D2: config.saveFolder is unchanged (still library A)', !!(r.cfg && r.cfg.saveFolder === libA), JSON.stringify(r.cfg));
    check('D3: nothing was written into the rejected folder', fs.readdirSync(junkDir).length === 1, `readdir=${JSON.stringify(fs.readdirSync(junkDir))}`); // only readme.txt

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- Scenario E: a folder with evidence but no database (moved by hand, ---
  // DB lost) opens rather than being rejected — the existing recovery path
  // (ensureDb's snapshot-restore-or-create) takes over, no new machinery.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-libswitch-e-'));
    const configDir = path.join(tmp, 'Hologram');
    const libA = path.join(tmp, 'lib-a');
    const recoverDir = path.join(tmp, 'db-lost-but-trash-present');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(path.join(recoverDir, '.trash'), { recursive: true });
    seedOneLibrary(tmp, 'a', libA, 'a1', 'library A post');
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: libA }));

    const evalJs = evalSource(
      async (_waits, args) => {
        const sw = await (window as any).hologram.switchLibrary(args.recoverDir);
        const after = await (window as any).hologram.listPosts();
        return { sw, after };
      },
      { recoverDir },
    );
    const r = await launch(configDir, evalJs);

    check('E1: switch-library succeeds against an evidence-but-no-db folder (recovery path)', !!(r.sw && r.sw.ok === true), JSON.stringify(r.sw));
    check('E2: a database now exists there (created, since there was no generation to restore from)', fs.existsSync(path.join(recoverDir, 'hologram.db')), `existsSync=${fs.existsSync(path.join(recoverDir, 'hologram.db'))}`);
    check('E3: the pre-existing .trash folder is untouched', fs.existsSync(path.join(recoverDir, '.trash')), `existsSync=${fs.existsSync(path.join(recoverDir, '.trash'))}`);

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const ok = results.every((r) => r.ok);
  console.log(ok ? 'LIBRARY_SWITCH_TEST_PASS' : 'LIBRARY_SWITCH_TEST_FAIL');
  process.exit(ok ? 0 : 1);
})();
