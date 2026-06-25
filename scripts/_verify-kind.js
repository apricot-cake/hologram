'use strict';
// Throwaway: 取得元フィルタが url の有無で切り分けるか（SNS投稿=url有 / 取り込み画像=url無）
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-kind-'));
const configDir = path.join(tmp, 'Corpus'); const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true }); fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
// 2 with url (SNS投稿), 1 without url (取り込み画像)
const recs = [
  { captureId: 'k0', image: 'k0.jpg', url: 'https://x.com/u/status/1', platform: 'x', text: 'a', date: '2026-04-01T00:00:00Z' },
  { captureId: 'k1', image: 'k1.jpg', url: 'https://bsky.app/p/2', platform: 'bluesky', text: 'b', date: '2026-04-02T00:00:00Z' },
  { captureId: 'k2', image: 'k2.jpg', source: 'eagle-migration', text: 'imported', title: 'IMG_1', date: '2026-04-03T00:00:00Z' }
];
for (const r of recs) { fs.writeFileSync(path.join(saveFolder, r.captureId + '.jpg'), jpeg); fs.writeFileSync(path.join(saveFolder, r.captureId + '.json'), JSON.stringify(Object.assign({ media: [], tags: [], hashtags: [], capturedAt: r.date }, r), null, 2)); }
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms=4000) => { const t0=Date.now(); while(Date.now()-t0<ms){ if(fn())return true; await wait(40);} return false; };
  const grid = document.getElementById('postGrid');
  await waitFor(() => grid.querySelectorAll('.post-card').length >= 3);
  const all = grid.querySelectorAll('.post-card').length;
  const row = document.querySelector('#filterRows [data-qfrow="kind"]');
  row.click(); await wait(60);
  const opts = [...document.querySelectorAll('.qf-pop .fm-row[data-qfval]')];
  const noHeading = !document.querySelector('.qf-pop .qf-back');   // 見出し行が無い
  // SNS投稿 (post)
  opts.find(o => o.dataset.qfval === 'post').click(); await wait(80);
  const snsCount = grid.querySelectorAll('.post-card').length;
  opts2 = [...document.querySelectorAll('.qf-pop .fm-row[data-qfval]')];
  opts2.find(o => o.dataset.qfval === 'post').click(); await wait(60); // 解除
  // 取り込み画像 (image)
  [...document.querySelectorAll('.qf-pop .fm-row[data-qfval]')].find(o => o.dataset.qfval === 'image').click(); await wait(80);
  const impCount = grid.querySelectorAll('.post-card').length;
  return { all, snsCount, impCount, noHeading };
})()`;
const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'), CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = ''; child.stdout.on('data', d => { out += d.toString(); process.stdout.write(d); });
child.on('close', () => {
  let r = {}; const m = out.match(/EVAL_RESULT (.+)/); if (m) { try { r = JSON.parse(m[1]); } catch {} }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.all === 3 && r.snsCount === 2 && r.impCount === 1 && r.noHeading === true;
  console.log('all='+r.all+' sns='+r.snsCount+' imp='+r.impCount+' noHeading='+r.noHeading);
  console.log(ok ? 'KIND_VERIFY_PASS' : 'KIND_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
