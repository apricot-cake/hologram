'use strict';

// clear-all が現行の項目フォルダーと移行前の直下ファイルを同じ操作で消すことを、
// Electron の IPC 境界まで通して確認する。

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-clear-all-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const currentId = 'clear-current';
const legacyId = '1755907200000-a1b2c3d4';
const currentDir = path.join(saveFolder, 'items', currentId);
fs.mkdirSync(currentDir, { recursive: true });
fs.writeFileSync(path.join(currentDir, `${currentId}.jpg`), 'image');
fs.writeFileSync(path.join(currentDir, `${currentId}-linkcard.png`), 'card');
fs.writeFileSync(path.join(saveFolder, `${legacyId}.jpg`), 'legacy');
fs.writeFileSync(path.join(saveFolder, `${legacyId}.json`), JSON.stringify({ captureId: legacyId, text: 'private legacy metadata', tags: ['private'] }));
fs.writeFileSync(path.join(saveFolder, 'unrelated.json'), JSON.stringify({ keep: true }));
seedLibrary(configDir, [
  {
    captureId: currentId,
    image: `items/${currentId}/${currentId}.jpg`,
    linkCard: { url: 'https://example.com', thumbnailFile: `items/${currentId}/${currentId}-linkcard.png` },
    capturedAt: '2026-08-23T00:00:00.000Z',
  },
  { captureId: legacyId, image: `${legacyId}.jpg`, capturedAt: '2026-08-23T00:00:00.000Z' },
]);

const evalJs = evalSource(async () => {
  const h = (window as any).hologram;
  const cleared = await h.clearAll();
  const listed = await h.listPosts();
  return { cleared, posts: listed.posts.length };
});
const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir, HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });
const child = spawn(resolveElectron(), ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (data: Buffer) => {
  out += data.toString();
  process.stdout.write(data);
});

child.on('close', () => {
  const match = out.match(/EVAL_RESULT (.+)/);
  let result: any = null;
  try {
    result = JSON.parse(match?.[1] || 'null');
  } catch {}
  const itemsGone = !fs.existsSync(path.join(saveFolder, 'items'));
  const legacyGone = !fs.existsSync(path.join(saveFolder, `${legacyId}.jpg`));
  const sidecarGone = !fs.existsSync(path.join(saveFolder, `${legacyId}.json`));
  const unrelatedKept = fs.existsSync(path.join(saveFolder, 'unrelated.json'));
  const ok = result?.cleared?.ok === true && result.cleared.count === 4 && result.posts === 0 && itemsGone && legacyGone && sidecarGone && unrelatedKept;
  console.log(`clear=${JSON.stringify(result)} itemsGone=${itemsGone} legacyGone=${legacyGone} sidecarGone=${sidecarGone} unrelatedKept=${unrelatedKept}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(ok ? 'CLEAR_ALL_TEST_PASS' : 'CLEAR_ALL_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
