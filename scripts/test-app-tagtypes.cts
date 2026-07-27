'use strict';

// Round-trips the tag 用語帳 IPC (get/set-tag-types) through the real Electron main
// process. Two-launch check: launch 1 sets the types, launch 2 (fresh process,
// same configDir/DB) reads them back — proving the write actually persisted to
// SQLite (the #298/St5 truth-source flip's write path; see lib-db-write.ts)
// rather than just living in the first process's memory.
//
//   node scripts/test-app-tagtypes.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-tagtypes-ipc-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

function launch(evalJs): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, {
      APPDATA: tmp,
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

// set kinds + renamed 種別 labels, then read both maps back in the SAME process
// first (the rename UI persists via the same setTagTypes(types, labels) path).
const setEvalJs = `(async () => {
  await window.hologram.setTagTypes({ 'ブルアカ': 'work', 'アロナ': 'character' }, { work: 'シリーズ', character: '登場人物' });
  const r = await window.hologram.getTagTypes();
  return { types: r.types['ブルアカ'] + ',' + r.types['アロナ'], labels: r.labels.work + ',' + r.labels.character };
})()`;

// launch 2 opens a fresh Electron process against the same configDir/DB and
// reads types back with zero writes of its own — a stale in-memory value from
// launch 1 can't leak here, so a match proves real persistence.
const getEvalJs = `(async () => {
  const r = await window.hologram.getTagTypes();
  return { types: r.types['ブルアカ'] + ',' + r.types['アロナ'], labels: (r.labels && r.labels.work + ',' + r.labels.character) || null };
})()`;

(async () => {
  const r1 = await launch(setEvalJs);
  const ipcRoundTrip = !!(r1 && r1.types === 'work,character' && r1.labels === 'シリーズ,登場人物');

  const r2 = await launch(getEvalJs);
  const persisted = !!(r2 && r2.types === 'work,character' && r2.labels === 'シリーズ,登場人物');

  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = ipcRoundTrip && persisted;
  console.log(`ipcRoundTrip=${ipcRoundTrip} persisted=${persisted}`);
  console.log(ok ? 'TAGTYPES_TEST_PASS' : 'TAGTYPES_TEST_FAIL');
  process.exit(ok ? 0 : 1);
})();
