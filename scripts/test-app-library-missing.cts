'use strict';

// Round-trips #37 (save-folder / backup-dest missing-path detection) through the
// real Electron main process. Each scenario launches a fresh process against an
// isolated HOLOGRAM_CONFIG_DIR (same shape as test-app-tagtypes.cts) so nothing
// here can touch a real library.
//
//   node scripts/test-app-library-missing.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { evalSource } = require('./lib-wait.cts');

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

(async () => {
  // --- Scenario A: explicit saveFolder does not exist on disk at launch -------
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-libmissing-a-'));
    const configDir = path.join(tmp, 'Hologram');
    const missingFolder = path.join(tmp, 'gone-library'); // never created
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: missingFolder }));

    const evalJs = evalSource(
      async (_waits, args) => {
        const status = await (window as any).hologram.getLibraryStatus();
        const clear = await (window as any).hologram.clearAll();
        const move = await (window as any).hologram.moveSaveFolder(args.elsewhere);
        return { status, clear, move };
      },
      { elsewhere: path.join(tmp, 'elsewhere') },
    );
    const r = await launch(configDir, evalJs);

    check('A1: startup detects the missing explicit save folder', !!(r.status && r.status.missing === true && r.status.path === missingFolder), JSON.stringify(r.status));
    check('A2: the missing folder was NOT silently recreated (no mkdir)', !fs.existsSync(missingFolder), `existsSync(missingFolder)=${fs.existsSync(missingFolder)}`);
    check('A3: clear-all is refused with blocked="missing"', !!(r.clear && r.clear.ok === false && r.clear.blocked === 'missing'), JSON.stringify(r.clear));
    check('A4: move-save-folder (relocation) is refused, not silently started from an empty src', !!(r.move && r.move.ok === false && r.move.error === 'library-missing'), JSON.stringify(r.move));

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- Scenario B: repoint to a folder that already holds a library, no copy --
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-libmissing-b-'));
    const configDir = path.join(tmp, 'Hologram');
    const missingFolder = path.join(tmp, 'gone-library');
    const movedLibrary = path.join(tmp, 'moved-library'); // simulates "the user moved the folder to another drive by hand"
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(path.join(movedLibrary, '.trash'), { recursive: true }); // repoint "evidence"
    fs.writeFileSync(path.join(movedLibrary, 'abcd1234.jpg'), 'not a real jpeg, existence is what matters');
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: missingFolder }));

    const evalJs = evalSource(
      async (_waits, args) => {
        const before = await (window as any).hologram.getLibraryStatus();
        const apply = await (window as any).hologram.applyRepoint(args.movedLibrary);
        const after = await (window as any).hologram.getLibraryStatus();
        const cfg = await (window as any).hologram.getConfig();
        return { before, apply, after, cfg };
      },
      { movedLibrary },
    );
    const r = await launch(configDir, evalJs);

    check('B1: apply-repoint succeeds against an existing (non-empty) folder', !!(r.apply && r.apply.ok === true && r.apply.saveFolder === movedLibrary), JSON.stringify(r.apply));
    check('B2: repoint is copy-free — the OLD (missing) folder is still absent', !fs.existsSync(missingFolder), `existsSync(missingFolder)=${fs.existsSync(missingFolder)}`);
    check('B3: repoint did not touch the files already at the destination', fs.existsSync(path.join(movedLibrary, 'abcd1234.jpg')) && fs.existsSync(path.join(movedLibrary, '.trash')), 'destination contents intact');
    check('B4: after repoint, get-library-status reports resolved', !!(r.after && r.after.missing === false && r.after.path === movedLibrary), JSON.stringify(r.after));
    check('B5: config.json was actually rewritten (get-config reflects it)', !!(r.cfg && r.cfg.saveFolder === movedLibrary), JSON.stringify(r.cfg));

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- Scenario C: backup destination's PARENT is missing ---------------------
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-libmissing-c-'));
    const configDir = path.join(tmp, 'Hologram');
    const saveFolder = path.join(tmp, 'library');
    const missingBackupDir = path.join(tmp, 'unplugged-drive', 'backups'); // parent never created
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(saveFolder, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, backup: { dir: missingBackupDir } }));

    const evalJs = evalSource(async () => {
      return await (window as any).hologram.runBackup();
    });
    const r = await launch(configDir, evalJs);

    check('C1: runBackup refuses with error="dest-missing"', !!(r && r.ok === false && r.error === 'dest-missing'), JSON.stringify(r));
    check('C2: the missing backup dir was NOT silently recreated', !fs.existsSync(missingBackupDir), `existsSync(missingBackupDir)=${fs.existsSync(missingBackupDir)}`);

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- Scenario D: backup source (save folder) is missing, dest exists --------
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-libmissing-d-'));
    const configDir = path.join(tmp, 'Hologram');
    const missingFolder = path.join(tmp, 'gone-library');
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: missingFolder, backup: { dir: backupDir } }));

    const evalJs = evalSource(async () => {
      return await (window as any).hologram.runBackup();
    });
    const r = await launch(configDir, evalJs);

    check('D1: runBackup refuses with error="src-missing" rather than reporting an empty-but-ok backup', !!(r && r.ok === false && r.error === 'src-missing'), JSON.stringify(r));

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const ok = results.every((r) => r.ok);
  console.log(ok ? 'LIBRARY_MISSING_TEST_PASS' : 'LIBRARY_MISSING_TEST_FAIL');
  process.exit(ok ? 0 : 1);
})();
