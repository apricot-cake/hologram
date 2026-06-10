'use strict';

// Verifies the 定期エクスポート (scheduled complete-ZIP export) plumbing:
//  - set-backup rejects an output dir that overlaps the save folder
//  - run-backup writes ONE corpus-export-*.zip inside <dir>/Corpus-export/
//  - a second run adds a second generation (retention keeps both at default 5)
//
//   node scripts/test-app-backup.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-bk-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
const outDir = path.join(tmp, 'out');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
for (let i = 0; i < 2; i++) {
  const id = '170000000000' + i + '-bk' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://x.com/u/status/' + (800 + i),
    platform: 'x', text: '本文' + i, displayName: '人' + i, screenName: 'u' + i,
    likes: 1 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: [], hashtags: []
  }, null, 2));
}

const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  await wait(400);
  // output dir nested inside the save folder must be rejected (overlap)
  const bad = await window.corpus.setBackup({ dir: ${JSON.stringify(path.join(saveFolder, 'nested'))} });
  const overlapRejected = !!(bad && bad.ok === false && bad.error === 'overlap');
  const good = await window.corpus.setBackup({ dir: ${JSON.stringify(outDir)} });
  const dirSet = !!(good && good.backup && good.backup.dir);
  const r1 = await window.corpus.runBackup();
  const run1 = !!(r1 && r1.ok && r1.written && r1.fileCount === 4);   // 2 jpg + 2 json
  await wait(1100);                                                   // distinct timestamp name
  const r2 = await window.corpus.runBackup();
  const run2 = !!(r2 && r2.ok && r2.written && r2.written !== r1.written);
  return { overlapRejected, dirSet, run1, run2 };
})()`;

const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });

child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  // filesystem-side verification: Corpus-export/ holds the two generations
  const dest = path.join(outDir, 'Corpus-export');
  let zips = [];
  try { zips = fs.readdirSync(dest).filter((n) => /^corpus-export-.*\.zip$/i.test(n)); } catch { zips = []; }
  const zipOk = zips.length === 2 && zips.every((n) => fs.statSync(path.join(dest, n)).size > 0);
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.overlapRejected === true && r.dirSet === true && r.run1 === true && r.run2 === true && zipOk;
  console.log(`overlap=${r.overlapRejected} dirSet=${r.dirSet} run1=${r.run1} run2=${r.run2} zips=${zips.length}/${zipOk}`);
  console.log(ok ? 'BACKUP_TEST_PASS' : 'BACKUP_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
