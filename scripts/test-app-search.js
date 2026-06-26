'use strict';

// Verifies the search-mode toggle (ぴったり / おおまか) end-to-end in the (unified
// post-view) app, including the おおまか enhancements:
//   ぴったり: query "ねこ" does NOT substring-match the katakana body "ネコかわいい" → 0
//   おおまか(B 正規化): "ねこ" matches "ネコかわいい" (カナ統一) → 1
//   おおまか(C 編集距離): typo "こんにとは" matches "こんにちは世界" → 1
//   方式は macOS 風セグメント（#searchModeSeg の #searchModeExact/#searchModeFuzzy）で切替。
//   両オプション常時表示＝状態 (is-on) と切替手段がひと目で分かる UI もここで検証。
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
const texts = ['ネコかわいい', 'こんにちは世界', 'いぬのおさんぽ'];
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
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const cards = () => document.querySelectorAll('#postGrid .post-card').length;
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  await waitFor(() => cards() >= 3);   // post view loads async
  const sb = document.getElementById('searchBox');
  const seg = document.getElementById('searchModeSeg');
  const exactBtn = document.getElementById('searchModeExact');
  const fuzzyBtn = document.getElementById('searchModeFuzzy');
  const defaultMode = window.corpusSearch.getMode();      // 既定 = normal
  const exactOnByDefault = exactBtn.classList.contains('is-on') && !seg.classList.contains('is-fuzzy');
  // ぴったり（既定）: カタカナ本文にひらがなクエリは部分一致しない → 0
  sb.value = 'ねこ'; sb.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(220);
  const normalKana = cards();
  // セグメントの「おおまか」をクリックで切替（B 正規化）: 'ねこ' が 'ネコかわいい' に一致 → 1
  fuzzyBtn.click();
  await wait(220);
  const fuzzyKana = cards();
  const selValue = window.corpusSearch.getMode();          // fuzzy
  const fuzzyOn = fuzzyBtn.classList.contains('is-on') && seg.classList.contains('is-fuzzy');
  // C 編集距離: 'こんにとは'（ち→と 置換ミス）が 'こんにちは世界' に一致 → 1
  sb.value = 'こんにとは'; sb.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(220);
  const fuzzyTypo = cards();
  return { normalKana, fuzzyKana, fuzzyTypo, defaultMode, selValue, exactOnByDefault, fuzzyOn };
})()`;

const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'), CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.normalKana === 0 && r.fuzzyKana === 1 && r.fuzzyTypo === 1 &&
    r.defaultMode === 'normal' && r.selValue === 'fuzzy' &&
    r.exactOnByDefault === true && r.fuzzyOn === true;
  console.log(`normalKana=${r.normalKana} fuzzyKana=${r.fuzzyKana} fuzzyTypo=${r.fuzzyTypo} default=${r.defaultMode} mode=${r.selValue} exactOn=${r.exactOnByDefault} fuzzyOn=${r.fuzzyOn}`);
  console.log(ok ? 'SEARCH_TEST_PASS' : 'SEARCH_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
