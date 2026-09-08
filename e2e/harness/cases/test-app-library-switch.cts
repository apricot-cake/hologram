'use strict';

// #176（複数ライブラリ — 切り替え、DB のライブラリフォルダへの移行、分類）を
// 実際の Electron メインプロセスを通して往復させる。test-app-library-
// missing.cts と同じ形: 各シナリオは隔離された HOLOGRAM_CONFIG_DIR に対して
// 新しいプロセスを起動するので、ここでは本物のライブラリに一切触れない。
//
//   node e2e/harness/cases/test-app-library-switch.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
const { makeTagResolver, preparePostStmts, writePost } = require(path.join(appDir, 'src', 'main', 'lib-db-record-writer.ts'));
const { evalSource } = require('../../../scripts/lib-wait.cts');

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

// `libDir` に投稿1件のライブラリを1つシードする — 使い捨ての seed-config
// ディレクトリが lib-seed-library.cts の saveFolder 探索を導く。シナリオが
// 最終的にどの configDir に対して Electron を起動するかとは独立している。
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
  // --- シナリオA: 起動時のマイグレーションが、#176 以前の hologram.db を ---
  // configDir から保存フォルダの「中」へ移す。持っていたレコードを失わずに。
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-libswitch-a-'));
    const configDir = path.join(tmp, 'Hologram');
    const saveFolder = path.join(tmp, 'library');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(saveFolder, { recursive: true });
    fs.writeFileSync(path.join(saveFolder, 'legacy1.jpg'), jpeg);
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

    // #176 以前のインストールを模擬する: configDir（旧来の場所）に hologram.db
    // が座っていて、そのメディアはすでに保存フォルダにあるレコードを1件持つ。
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

    check('A1: 起動後、古い configDir/hologram.db は無くなっている', !fs.existsSync(path.join(configDir, 'hologram.db')), `existsSync=${fs.existsSync(path.join(configDir, 'hologram.db'))}`);
    check('A2: hologram.db は今や保存フォルダの中にある', fs.existsSync(path.join(saveFolder, 'hologram.db')), `existsSync=${fs.existsSync(path.join(saveFolder, 'hologram.db'))}`);
    if (fs.existsSync(path.join(saveFolder, 'hologram.db'))) {
      const migrated = openDatabase(path.join(saveFolder, 'hologram.db'), { readonly: true });
      const row = migrated.sqlite.prepare('SELECT captureId, text FROM posts WHERE captureId = ?').get('legacy1') as any;
      check('A3: 既存のレコードがマイグレーションを生き延びた', !!(row && row.text === 'pre-#176 record'), JSON.stringify(row));
      migrated.sqlite.close();
    } else {
      check('A3: 既存のレコードがマイグレーションを生き延びた', false, 'マイグレーション後の DB が見つからず、検証できない');
    }

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- シナリオB: 完全に独立した2つのライブラリの切り替え --------------------
  // （has-db 分岐）は投稿を丸ごと入れ替え、両方とも最近使ったリストに現れる。
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
    check('B1: 切り替え前はライブラリAの投稿だけが見える', beforeIds.includes('a1') && !beforeIds.includes('b1'), JSON.stringify(beforeIds));
    check('B2: switch-library が新しい saveFolder とともに ok を報告する', !!(r.sw && r.sw.ok === true && r.sw.saveFolder === libB), JSON.stringify(r.sw));
    check('B3: 切り替え後はライブラリBの投稿だけが見える — Aの行は1つも引き継がれていない', afterIds.includes('b1') && !afterIds.includes('a1'), JSON.stringify(afterIds));
    check('B4: config.saveFolder が今やライブラリBを指している', !!(r.cfg && r.cfg.saveFolder === libB), JSON.stringify(r.cfg));
    const recentPaths = ((r.recent as any[]) || []).map((e) => e.path);
    check('B5: 両方のライブラリが最近使ったリストに現れる', recentPaths.includes(libA) && recentPaths.includes(libB), JSON.stringify(recentPaths));

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- シナリオC: 空のフォルダへ切り替えるとまっさらな新しいライブラリが始まる --
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

    check('C1: 空のフォルダに対して switch-library が成功する', !!(r.sw && r.sw.ok === true), JSON.stringify(r.sw));
    check('C2: 新しいライブラリは投稿0件で始まる', !!(r.after && Array.isArray(r.after.posts) && r.after.posts.length === 0), JSON.stringify(r.after));
    check('C3: 空のフォルダに新しい hologram.db が作られた', fs.existsSync(path.join(emptyDir, 'hologram.db')), `existsSync=${fs.existsSync(path.join(emptyDir, 'hologram.db'))}`);

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- シナリオD: ライブラリの痕跡が無い空でないフォルダはきっぱり拒まれる --
  // — そこには何も書かれず、現在のライブラリも触れられない。
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

    check('D1: switch-library が error="not-a-library" で拒む', !!(r.sw && r.sw.ok === false && r.sw.error === 'not-a-library'), JSON.stringify(r.sw));
    check('D2: config.saveFolder は変わっていない（まだライブラリA）', !!(r.cfg && r.cfg.saveFolder === libA), JSON.stringify(r.cfg));
    check('D3: 拒まれたフォルダには何も書かれなかった', fs.readdirSync(junkDir).length === 1, `readdir=${JSON.stringify(fs.readdirSync(junkDir))}`); // readme.txt だけ

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- シナリオE: 痕跡はあるがデータベースが無いフォルダ（手で移動されて ---
  // DB を失った）は拒まれるのではなく開く — 既存の復旧経路
  // （ensureDb のスナップショット復元・新規作成）が引き継ぐ。新しい仕組みは無い。
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

    check('E1: 痕跡はあるが DB が無いフォルダに対して switch-library が成功する（復旧経路）', !!(r.sw && r.sw.ok === true), JSON.stringify(r.sw));
    check('E2: そこに今やデータベースが存在する（復元元の世代が無かったので新規作成された）', fs.existsSync(path.join(recoverDir, 'hologram.db')), `existsSync=${fs.existsSync(path.join(recoverDir, 'hologram.db'))}`);
    check('E3: 既存の .trash フォルダは触れられていない', fs.existsSync(path.join(recoverDir, '.trash')), `existsSync=${fs.existsSync(path.join(recoverDir, '.trash'))}`);

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const ok = results.every((r) => r.ok);
  console.log(ok ? 'LIBRARY_SWITCH_TEST_PASS' : 'LIBRARY_SWITCH_TEST_FAIL');
  process.exit(ok ? 0 : 1);
})();
