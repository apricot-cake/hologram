'use strict';

// #37（保存フォルダの欠落パス検出）を、実際のElectron
// mainプロセスを通して行き来させる。各シナリオは隔離されたHOLOGRAM_CONFIG_DIR
// （test-app-taggroups.ctsと同じ形）に対して新規プロセスを起動するので、ここの
// 何一つとして実ライブラリに触れられない。
//
//   node e2e/harness/cases/test-app-library-missing.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');

const electronPath = resolveElectron();
const { evalSource } = require('../../../scripts/lib-wait.cts');

function launch(configDir: string, evalJs: string, extraEnv: Record<string, string> = {}): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, {
      HOLOGRAM_CONFIG_DIR: configDir,
      HOLOGRAM_SMOKE: '1',
      HOLOGRAM_SMOKE_EVAL: evalJs,
      ...extraEnv,
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
          /* 無視 */
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
  // --- シナリオA: 起動時、明示したsaveFolderがディスク上に存在しない -------
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-libmissing-a-'));
    const configDir = path.join(tmp, 'Hologram');
    const missingFolder = path.join(tmp, 'gone-library'); // 決して作られない
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: missingFolder }));

    const evalJs = evalSource(async (_waits, _args) => {
      const status = await (window as any).hologram.getLibraryStatus();
      const clear = await (window as any).hologram.clearAll();
      const move = await (window as any).hologram.pickSaveFolder();
      return { status, clear, move };
    }, {});
    // 製品の renderer が移動先を指定する旧 API は使わない。隔離 SMOKE プロセスの
    // main picker だけに一時ディレクトリを注入し、本番と同じ missing guard へ通す。
    const r = await launch(configDir, evalJs, { HOLOGRAM_SMOKE_PICK_SAVE_FOLDER: path.join(tmp, 'elsewhere') });

    check('A1: 起動時に、明示した保存フォルダの欠落を検出する', !!(r.status && r.status.missing === true && r.status.path === missingFolder), JSON.stringify(r.status));
    check('A2: 欠落したフォルダは黙って再作成されない（mkdirしない）', !fs.existsSync(missingFolder), `existsSync(missingFolder)=${fs.existsSync(missingFolder)}`);
    check('A3: clear-allはblocked="missing"で拒否される', !!(r.clear && r.clear.ok === false && r.clear.blocked === 'missing'), JSON.stringify(r.clear));
    check('A4: move-save-folder（移動）は拒否され、空のsrcから黙って始まらない', !!(r.move && r.move.ok === false && r.move.error === 'library-missing'), JSON.stringify(r.move));

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- シナリオB: 既にライブラリを保持するフォルダへ向け直す。コピー無し --
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-libmissing-b-'));
    const configDir = path.join(tmp, 'Hologram');
    const missingFolder = path.join(tmp, 'gone-library');
    const movedLibrary = path.join(tmp, 'moved-library'); // 「ユーザーがフォルダを手で別ドライブへ移動した」ことを模す
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(path.join(movedLibrary, '.trash'), { recursive: true }); // 向け直しの「証拠」
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

    check('B1: apply-repointは既存の（空でない）フォルダに対して成功する', !!(r.apply && r.apply.ok === true && r.apply.saveFolder === movedLibrary), JSON.stringify(r.apply));
    check('B2: 向け直しはコピーを伴わない＝古い（欠落した）フォルダは依然として無い', !fs.existsSync(missingFolder), `existsSync(missingFolder)=${fs.existsSync(missingFolder)}`);
    check('B3: 向け直しは送り先に既にあるファイルに触れなかった', fs.existsSync(path.join(movedLibrary, 'abcd1234.jpg')) && fs.existsSync(path.join(movedLibrary, '.trash')), '送り先の中身はそのまま');
    check('B4: 向け直し後、get-library-statusは解決済みと報告する', !!(r.after && r.after.missing === false && r.after.path === movedLibrary), JSON.stringify(r.after));
    check('B5: config.jsonが実際に書き換わった（get-configに反映される）', !!(r.cfg && r.cfg.saveFolder === movedLibrary), JSON.stringify(r.cfg));

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const ok = results.every((r) => r.ok);
  console.log(ok ? 'LIBRARY_MISSING_TEST_PASS' : 'LIBRARY_MISSING_TEST_FAIL');
  process.exit(ok ? 0 : 1);
})();
