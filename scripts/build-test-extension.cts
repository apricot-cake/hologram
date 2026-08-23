'use strict';

// Vitest と拡張機能 E2E が読む Chrome バンドルを作る。ストア提出用の成果物や、
// 日常用プロファイルが読むフォルダには触れない。
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'extension', '.output', 'chrome-mv3-test');
const REQUIRED = ['manifest.json', 'background.js', 'capture.js', 'read-meta.js', path.join('content-scripts', 'resident.js')];

execFileSync('npm --prefix extension run build:chrome', {
  cwd: ROOT,
  shell: true,
  stdio: 'inherit',
  env: Object.assign({}, process.env, { HOLOGRAM_EXTENSION_TEST_OUTPUT: OUTPUT }),
});

const missing = REQUIRED.filter((name) => {
  const file = path.join(OUTPUT, name);
  return !fs.existsSync(file) || !fs.statSync(file).size;
});
if (missing.length) throw new Error(`Chrome テスト用出力が揃っていません: ${missing.join(', ')}`);

console.log(`[hologram] Chrome テスト用拡張機能を作成しました: ${OUTPUT}`);
