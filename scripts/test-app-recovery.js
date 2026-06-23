'use strict';

// Two-launch integration test for save-folder redundancy/recovery (2026-06-23 incident).
//  launch 1: healthy config → app writes the redundant saveFolder.path pointer
//  launch 2: config.json corrupted → app recovers saveFolder from the pointer and
//            repairs config.json (so the native host, reading config independently,
//            never diverges onto the empty default)
//
//   node scripts/test-app-recovery.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-rec-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'lib');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
const CONFIG = path.join(configDir, 'config.json');
const POINTER = path.join(configDir, 'saveFolder.path');
fs.writeFileSync(CONFIG, JSON.stringify({ saveFolder, extensionId: 'x' }));

function launch(evalJs) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
    const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('close', () => {
      let r = {};
      const m = out.match(/EVAL_RESULT (.+)/);
      if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
      resolve(r);
    });
  });
}

const getCfgEval = `(async () => {
  await new Promise(r => setTimeout(r, 400));
  const c = await window.corpus.getConfig();
  return { saveFolder: c && c.saveFolder };
})()`;

(async () => {
  // launch 1: healthy config → the redundant pointer should be written on startup
  const r1 = await launch(getCfgEval);
  const cfg1Ok = r1.saveFolder === saveFolder;
  const pointerWritten = fs.existsSync(POINTER) && fs.readFileSync(POINTER, 'utf8').trim() === saveFolder;

  // corrupt config.json between launches (an unterminated truncation, the real failure)
  fs.writeFileSync(CONFIG, '{ "saveFolder": "broken');

  // launch 2: app must recover saveFolder from the pointer AND repair config.json
  const r2 = await launch(getCfgEval);
  const recovered = r2.saveFolder === saveFolder;
  let repaired = false, corruptBackup = false;
  try { repaired = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).saveFolder === saveFolder; } catch { /* still broken */ }
  try { corruptBackup = fs.readdirSync(configDir).some(n => /^config\.json\.corrupt-/.test(n)); } catch { /* ignore */ }

  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = cfg1Ok && pointerWritten && recovered && repaired && corruptBackup;
  console.log(`cfg1=${cfg1Ok} pointer=${pointerWritten} recovered=${recovered} repaired=${repaired} backup=${corruptBackup}`);
  console.log(ok ? 'RECOVERY_E2E_PASS' : 'RECOVERY_E2E_FAIL');
  process.exit(ok ? 0 : 1);
})();
