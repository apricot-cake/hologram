'use strict';

// 永続的な取込キューのアプリ側消費者をエンドツーエンドで検証する（#5 St6 / #299）:
//   - アプリが閉じている間に.hologram-inbox/newへ保存された投稿は、次回起動時にDBへ
//     drainされて描画される（sidecarは一切関与しない――「アプリが動いていない間に
//     保存されたものは次回起動で拾われる」という受け入れ条件）
//   - アプリが動いている間に.hologram-inbox/newへ保存された投稿は、再起動なしで
//     watchInboxFolderのchokidarウォッチャー（400msデバウンス）に拾われる（「アプリが
//     動いている間の保存はウォッチャー経由で反映される」という条件）
// 同じエンベロープの何度実行しても同じ再適用はユニットテスト一式（tests/integration/db-inbox.test.ts）
// がカバーしている――このハーネスは、実際のElectron起動＋chokidarウォッチャーを通して
// この2つがちゃんと繋がっていることだけを証明する。ユニットテストにはそれができない。
//
//   node e2e/harness/cases/test-app-inbox-watch.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { buildEnvelope, writeInboxEvent } = require(path.join(__dirname, '../../../native-host/inbox.mts'));
const { normalizePostRecord } = require(path.join(__dirname, '../../../native-host/post-record.mts'));

const electronPath = resolveElectron();
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-inboxwatch-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

// .hologram-inbox/new＋原本画像ファイルにだけ書き込む――sidecarは無く、
// bridge.mtsのhandleSavePostが生成するのと同じアーティファクトだ。
async function saveViaInbox(id) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  const rec = normalizePostRecord({
    captureId: id,
    image: null,
    url: `https://x.com/u/status/${id}`,
    platform: 'x',
    text: 't',
    media: [{ file: `${id}.jpg`, url: `https://x.com/i/${id}.jpg` }],
  });
  await writeInboxEvent(saveFolder, buildEnvelope(rec));
}

// レンダラーが読み込まれ（アプリが閉じている間のキャプチャを描画した）後、2件目の
// キャプチャが着地したらグリッドが自力で2枚のカードに達するのを待つ。
const evalJs = evalSource(async ({ waitFor }) => {
  const cards = () => document.querySelectorAll('[data-slot="post-card"]').length;
  await waitFor('the watched inbox capture to arrive as a second card', () => cards() >= 2);
  // ここではアサートせず報告するだけにする＝タイムアウトした場合は実際の件数を
  // Node側に残し、そこでどこまで進んだかを伝えて失敗させる。
  return cards();
});

const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir, HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });

(async () => {
  // アプリが一度も動いていない間に保存されたもの――最初の描画時点で存在していなければ
  // ならない。
  const id1 = `${Date.now()}-aaaa`;
  await saveViaInbox(id1);

  const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d.toString();
  });

  // アプリ（とそのwatchInboxFolderウォッチャー）が起動した後に保存されたもの。
  const id2 = `${Date.now() + 1}-bbbb`;
  setTimeout(() => {
    saveViaInbox(id2).catch(() => {});
  }, 2500);

  child.on('close', () => {
    const m = out.match(/EVAL_RESULT (.+)/);
    const count = m ? Number(m[1]) : -1;
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('inbox watch後に描画されたカード数:', count);
    console.log(count === 2 ? 'INBOX_WATCH_TEST_PASS' : 'INBOX_WATCH_TEST_FAIL');
    process.exit(count === 2 ? 0 : 1);
  });
})();
