'use strict';

// Verifies the backup / incremental folder export:
//  - meta  : copies images + media + .json
//  - media : copies images + media only (no .json)
//  - idempotent: a 2nd run copies 0 (all skipped by size+mtime)
//  - overlap: choosing the save folder itself is rejected
//  - explicit UI delete (deletePost) propagates removal to the configured output
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
const backupMeta = path.join(tmp, 'out-meta');
const backupMedia = path.join(tmp, 'out-media');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const ids = ['bk0', 'bk1', 'bk2'];
ids.forEach((id, i) => {
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://x.com/u/status/' + (500 + i),
    platform: 'x', text: 'post' + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: [], hashtags: []
  }, null, 2));
});
// 投稿bk0 だけ原寸メディアを持たせる（メディアコピー＆削除伝播の確認用）
fs.writeFileSync(path.join(saveFolder, 'bk0-media-0.png'), jpeg);

const evalJs = `(async () => {
  // メタデータ込み
  await window.corpus.setBackup({ dir: ${JSON.stringify(backupMeta)}, content: 'meta' });
  const rMeta = await window.corpus.runBackup();
  // メディアのみ（別フォルダ）
  await window.corpus.setBackup({ dir: ${JSON.stringify(backupMedia)}, content: 'media' });
  const rMedia = await window.corpus.runBackup();
  // 冪等: meta フォルダへ戻して再実行 → コピー0・全件据置
  await window.corpus.setBackup({ dir: ${JSON.stringify(backupMeta)}, content: 'meta' });
  const rAgain = await window.corpus.runBackup();
  // 重複(保存先と同一)は拒否
  const rOverlap = await window.corpus.setBackup({ dir: ${JSON.stringify(saveFolder)} });
  const overlapRejected = !!(rOverlap && rOverlap.ok === false && rOverlap.error === 'overlap');
  // UI明示削除 → 現在の出力先(meta)へ伝播
  await window.corpus.deletePost('bk0.jpg');
  await new Promise(r => setTimeout(r, 150));
  return {
    metaCopied: rMeta.copied, metaTotal: rMeta.total,
    mediaCopied: rMedia.copied, mediaTotal: rMedia.total,
    againCopied: rAgain.copied, againSkipped: rAgain.skipped,
    overlapRejected
  };
})()`;

const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }

  const ls = (dir) => { try { return fs.readdirSync(dir).filter((f) => !f.includes('.tmp-')); } catch { return []; } };
  const metaFiles = ls(backupMeta);
  const mediaFiles = ls(backupMedia);
  fs.rmSync(tmp, { recursive: true, force: true });

  const has = (arr, n) => arr.includes(n);
  // meta: 初回は jpg3 + json3 + png1 = 7
  const metaCountOk = r.metaCopied === 7 && r.metaTotal === 7;
  // media: jpg3 + png1 = 4（json含まず）
  const mediaCountOk = r.mediaCopied === 4 && r.mediaTotal === 4;
  const mediaNoJson = !mediaFiles.some((f) => f.endsWith('.json'));
  // 冪等
  const idempotentOk = r.againCopied === 0 && r.againSkipped === 7;
  // 削除伝播: meta 出力先から bk0 の3ファイルが消え、bk1/bk2 は残る
  const deletePropagated = !has(metaFiles, 'bk0.jpg') && !has(metaFiles, 'bk0.json') &&
    !has(metaFiles, 'bk0-media-0.png') && has(metaFiles, 'bk1.jpg') && has(metaFiles, 'bk2.json');
  // media 出力先は削除の影響を受けない（削除時の出力先は meta だった）
  const mediaUntouched = has(mediaFiles, 'bk0.jpg') && has(mediaFiles, 'bk0-media-0.png');

  const ok = metaCountOk && mediaCountOk && mediaNoJson && idempotentOk &&
    r.overlapRejected === true && deletePropagated && mediaUntouched;
  console.log(`meta=${r.metaCopied}/${r.metaTotal} media=${r.mediaCopied}/${r.mediaTotal} mediaNoJson=${mediaNoJson} again=${r.againCopied}/${r.againSkipped} overlap=${r.overlapRejected} delProp=${deletePropagated} mediaUntouched=${mediaUntouched}`);
  console.log(`metaFiles=[${metaFiles.sort().join(',')}] mediaFiles=[${mediaFiles.sort().join(',')}]`);
  console.log(ok ? 'BACKUP_TEST_PASS' : 'BACKUP_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
