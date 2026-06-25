'use strict';

// Round-trips the tag 用語帳 IPC (get/set-tag-types) through the real Electron main
// process and checks tag-types.json on disk. Mirrors test-app-ipc.js's headless
// CORPUS_SMOKE harness.
//
//   node scripts/test-app-tagtypes.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-tagtypes-ipc-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

// set kinds + renamed 種別 labels, then read both maps back (the rename UI persists
// via the same setTagTypes(types, labels) path).
const evalJs = `(async () => {
  await window.corpus.setTagTypes({ 'ブルアカ': 'work', 'アロナ': 'character' }, { work: 'シリーズ', character: '登場人物' });
  const r = await window.corpus.getTagTypes();
  return r.types['ブルアカ'] + ',' + r.types['アロナ'] + ',' + r.labels.work + ',' + r.labels.character;
})()`;

const env = Object.assign({}, process.env, {
  APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'), CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });

child.on('close', () => {
  const evalOk = /EVAL_RESULT "work,character,シリーズ,登場人物"/.test(out);
  let fileOk = false;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(saveFolder, 'tag-types.json'), 'utf8'));
    fileOk = j.types['ブルアカ'] === 'work' && j.types['アロナ'] === 'character'
      && j.labels.work === 'シリーズ' && j.labels.character === '登場人物';
  } catch { /* fileOk stays false */ }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`ipcRoundTrip=${evalOk} fileWritten=${fileOk}`);
  console.log(evalOk && fileOk ? 'TAGTYPES_TEST_PASS' : 'TAGTYPES_TEST_FAIL');
  process.exit(evalOk && fileOk ? 0 : 1);
});
