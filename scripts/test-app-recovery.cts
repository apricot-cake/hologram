'use strict';

// 保存フォルダの冗長化/復旧に対する2回起動の統合テスト（2026-06-23 の
// インシデント）。
//  1回目の起動: 健全な設定 → アプリが冗長な saveFolder.path ポインタを書く
//  2回目の起動: config.json が壊れている → アプリはポインタから saveFolder
//            を復旧し、config.json を修復する（そうしないと、config を
//            独立して読むネイティブホストが、空のデフォルトへ静かにずれて
//            しまう）
//
//   node scripts/test-app-recovery.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-rec-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'lib');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
const CONFIG = path.join(configDir, 'config.json');
const POINTER = path.join(configDir, 'saveFolder.path');
fs.writeFileSync(CONFIG, JSON.stringify({ saveFolder, extensionId: 'x' }));

function launch(evalJs) {
  return new Promise<any>((resolve) => {
    const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'), HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });
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
      resolve(r);
    });
  });
}

const getCfgEval = evalSource(async ({ waitFor }) => {
  // 復旧は main の中で、config が答えられるようになる前に起きる。フォルダを
  // 名指す config こそが、それが観測可能な終わり方。当てずっぽうの400msの後に
  // そこにあるものを読むのは、負けたと言う手段の無い同じ賭けでしかなかった。
  const cfg = () => (window as any).hologram.getConfig();
  await waitFor('復旧した config が保存フォルダを名指すこと', async () => !!(await cfg())?.saveFolder);
  const c = await cfg();
  return { saveFolder: c && c.saveFolder };
});

(async () => {
  // 1回目の起動: 健全な設定 → 起動時に冗長なポインタが書かれるはず
  const r1 = await launch(getCfgEval);
  const cfg1Ok = r1.saveFolder === saveFolder;
  const pointerWritten = fs.existsSync(POINTER) && fs.readFileSync(POINTER, 'utf8').trim() === saveFolder;

  // 起動の間に config.json を壊す（終端されない切り詰め。実際に起きた障害）
  fs.writeFileSync(CONFIG, '{ "saveFolder": "broken');

  // 2回目の起動: アプリはポインタから saveFolder を復旧し「かつ」
  // config.json を修復しなければならない
  const r2 = await launch(getCfgEval);
  const recovered = r2.saveFolder === saveFolder;
  let repaired = false,
    corruptBackup = false;
  try {
    repaired = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).saveFolder === saveFolder;
  } catch {
    /* まだ壊れている */
  }
  try {
    corruptBackup = fs.readdirSync(configDir).some((n) => /^config\.json\.corrupt-/.test(n));
  } catch {
    /* 無視 */
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = cfg1Ok && pointerWritten && recovered && repaired && corruptBackup;
  console.log(`cfg1=${cfg1Ok} pointer=${pointerWritten} recovered=${recovered} repaired=${repaired} backup=${corruptBackup}`);
  console.log(ok ? 'RECOVERY_E2E_PASS' : 'RECOVERY_E2E_FAIL');
  process.exit(ok ? 0 : 1);
})();
