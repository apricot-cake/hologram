'use strict';

// Verifies the search-mode toggle (通常 / あいまい) in post-view:
//  - normal (default): query "ねこわ" does NOT substring-match "ねこかわいい" → 0 cards
//  - click #searchModeToggle → fuzzy: "ねこわ" subsequence-matches "ねこかわいい" → 1 card
//  - the toggle gains .active and shows the fuzzy label
// Confirms fuzzy is not matching everything (the other two posts stay filtered out).
//
//   node scripts/test-app-search.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-se-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const texts = ['ねこかわいい', 'いぬのおさんぽ', 'とりさん'];
for (let i = 0; i < texts.length; i++) {
  const id = '170000000000' + i + '-se' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://x.com/u/status/' + (900 + i),
    platform: 'x', text: texts[i], displayName: '人' + i, screenName: 'u' + i,
    likes: 10 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: [], hashtags: []
  }, null, 2));
}

const evalJs = `(async () => {
  await new Promise(r => setTimeout(r, 700));
  const sb = document.getElementById('searchBox');
  // 通常モード（既定）: 部分一致しないので0件
  sb.value = 'ねこわ'; sb.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  const normalCount = document.querySelectorAll('#postGrid .post-card').length;
  // あいまいへ切替: サブシーケンス一致で「ねこかわいい」だけヒット
  const btn = document.getElementById('searchModeToggle');
  const labelBefore = btn.textContent.trim();
  btn.click();
  await new Promise(r => setTimeout(r, 60));
  const fuzzyCount = document.querySelectorAll('#postGrid .post-card').length;
  const fuzzyActive = btn.classList.contains('active');
  const labelAfter = btn.textContent.trim();
  // 画像モードへ切替: 検索方式は両モードで共有 → 画像側トグルも「あいまい」active になる
  document.getElementById('modeImageBtn').click();
  await new Promise(r => setTimeout(r, 700));
  const ivBtn = document.getElementById('ivSearchModeToggle');
  const ivActive = ivBtn.classList.contains('active');
  const ivLabel = ivBtn.textContent.trim();
  return { normalCount, fuzzyCount, fuzzyActive, labelBefore, labelAfter, ivActive, ivLabel };
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
  const ok = r.normalCount === 0 && r.fuzzyCount === 1 && r.fuzzyActive === true &&
    r.labelBefore === '通常' && r.labelAfter === 'あいまい' &&
    r.ivActive === true && r.ivLabel === 'あいまい';
  console.log(`normalCount=${r.normalCount} fuzzyCount=${r.fuzzyCount} fuzzyActive=${r.fuzzyActive} label=${r.labelBefore}->${r.labelAfter} iv=${r.ivLabel}/${r.ivActive}`);
  console.log(ok ? 'SEARCH_TEST_PASS' : 'SEARCH_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
