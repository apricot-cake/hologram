'use strict';

// Verifies the image-view active-filter bar:
//  - selecting a platform shows #ivActiveBar with one pill in #ivActiveChips
//  - clicking the pill (or リセット) clears it and hides the bar again
//
//   node scripts/test-app-imgfilter.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-if-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-if' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://www.pixiv.net/artworks/' + (800 + i),
    platform: 'pixiv', title: '作品' + i, displayName: '絵師' + i, screenName: '50' + i,
    likes: 1000 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: [], hashtags: [], source: 'eagle-migration'
  }, null, 2));
}

const evalJs = `(async () => {
  document.getElementById('modeImageBtn').click();
  await new Promise(r => setTimeout(r, 700));
  const bar = document.getElementById('ivActiveBar');
  const before = bar.style.display !== 'none';
  document.querySelector('#ivPlatformChips .sb-chip[data-pf="pixiv"]').click();
  await new Promise(r => setTimeout(r, 50));
  const shown = bar.style.display !== 'none';
  const pills = document.querySelectorAll('#ivActiveChips .sb-active-chip').length;
  // remove the single pill → bar hides
  document.querySelector('#ivActiveChips .sb-active-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 50));
  const afterPill = bar.style.display === 'none';
  // re-add then test リセット
  document.querySelector('#ivPlatformChips .sb-chip[data-pf="pixiv"]').click();
  await new Promise(r => setTimeout(r, 30));
  document.getElementById('ivReset').click();
  await new Promise(r => setTimeout(r, 30));
  const afterReset = bar.style.display === 'none';
  // 値が入っているフィルタ欄のハイライト（検索）
  const sb = document.getElementById('ivSearch');
  sb.value = 'x'; sb.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  const searchHl = sb.classList.contains('has-value');
  return { before, shown, pills, afterPill, afterReset, searchHl };
})()`;

const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.before === false && r.shown === true && r.pills === 1 && r.afterPill === true && r.afterReset === true && r.searchHl === true;
  console.log(`before=${r.before} shown=${r.shown} pills=${r.pills} afterPill=${r.afterPill} afterReset=${r.afterReset} searchHl=${r.searchHl}`);
  console.log(ok ? 'IMGFILTER_TEST_PASS' : 'IMGFILTER_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
