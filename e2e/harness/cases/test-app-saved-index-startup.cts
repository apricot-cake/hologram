'use strict';

// #466のregressionテスト: 起動後、たとえensurePostsSyncedがinboxからdrainする
// ものが何も無く、orphan回復も一度も走らなかったとしても、bridge-saved-index.json
// は存在しなければならない＝この2つは以前scheduleSavedIndexWriteを呼ぶ唯一の
// 機会だった。DBへ直接シードされたライブラリ（移動/復元されたライブラリ、
// あるいは単に「しばらく何も保存していない」）はどちらの経路にも一度も当たらず、
// bridgeは既に保存済みの投稿に対する{type:'query'}に、journal + loose-inbox
// フォールバックだけから答えていた。どちらも自身の上限より古いものは全て
// 見落とす（#466の2026-07-29の再現）。
//
//   node e2e/harness/cases/test-app-saved-index-startup.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-savedidx-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const POST_URL = 'https://x.com/EGOBJ4/status/2079187119311118431';
const CAPTURE_ID = 'dummy-466';
const SNAPSHOT_FILE = path.join(configDir, 'bridge-saved-index.json');

// writePost（lib-seed-library.cts）経由でDBへ直接シードする。inboxを一度も
// 経由せず、回復すべきorphanも無い＝アプリのライフタイム全体でscheduleSavedIndexWrite
// が一度も呼ばれないまま残っていた、まさにその形（#466）。
seedLibrary(configDir, [
  {
    captureId: CAPTURE_ID,
    image: `${CAPTURE_ID}.jpg`,
    url: POST_URL,
    platform: 'x',
    text: 't',
    tags: [],
    media: [{ url: 'https://pbs.twimg.com/media/EGOBJ4?format=jpg&name=orig', file: `${CAPTURE_ID}.jpg` }],
    capturedAt: '2026-01-01T00:00:00.000Z',
    date: '2026-01-01T00:00:00.000Z',
  },
]);

process.env.HOLOGRAM_CONFIG_DIR = configDir;
const bridge = require(path.join(__dirname, '../../../native-host/bridge.mts'));

const snapshotMissingBeforeLaunch = !fs.existsSync(SNAPSHOT_FILE);
// バグの再現: スナップショットが無いと、bridgeの他の2つの情報源（journal、
// loose-inboxの再スキャン）はDBへ直接シードされた投稿について何も知らないので、
// 問い合わせはライブラリが実際に持っている投稿に対して誤って「未保存」と答える。
async function main() {
  const answerBeforeLaunch = (await bridge.handleQuery({ type: 'query', urls: [POST_URL] })).results[POST_URL];

  const evalJs = evalSource(async ({ sleep }) => {
    await (window as any).hologram.listPosts();
    // デバウンスそのものが仕様: scheduleSavedIndexWriteは1500ms待ち、それが
    // 経過するまでレンダラーから観測できるものは何も無い。だからハーネスは
    // 終了する前にそれを過ぎるまで座っていなければならない。
    // biome-ignore lint/plugin: the 1500ms saved-index debounce is the spec — nothing is observable until it elapses.
    await sleep(1800);
    return 'primed';
  });

  const env = Object.assign({}, process.env, {
    APPDATA: tmp,
    HOLOGRAM_CONFIG_DIR: configDir,
    HOLOGRAM_SMOKE: '1',
    HOLOGRAM_SMOKE_EVAL: evalJs,
  });

  const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d.toString();
    process.stdout.write(d);
  });

  child.on('close', async () => {
    const evalOk = /EVAL_RESULT "primed"/.test(out);
    const snapshotWritten = fs.existsSync(SNAPSHOT_FILE);
    let snapshotOk = false;
    if (snapshotWritten) {
      try {
        const snap = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
        const entries = Object.values(snap.entries || {}) as Array<{ id: string }>;
        snapshotOk = entries.length === 1 && entries[0].id === CAPTURE_ID;
      } catch {
        snapshotOk = false;
      }
    }

    bridge._resetSavedIndex();
    const answerAfterLaunch = (await bridge.handleQuery({ type: 'query', urls: [POST_URL] })).results[POST_URL];
    const answerAfterOk = !!answerAfterLaunch && answerAfterLaunch.id === CAPTURE_ID;

    fs.rmSync(tmp, { recursive: true, force: true });

    const pass = snapshotMissingBeforeLaunch && answerBeforeLaunch === null && evalOk && snapshotWritten && snapshotOk && answerAfterOk;
    console.log(`snapshotMissingBefore=${snapshotMissingBeforeLaunch} answerBefore=${JSON.stringify(answerBeforeLaunch)} eval=${evalOk} snapshotWritten=${snapshotWritten} snapshotOk=${snapshotOk} answerAfter=${JSON.stringify(answerAfterLaunch)}`);
    console.log(pass ? 'SAVED_INDEX_STARTUP_PASS' : 'SAVED_INDEX_STARTUP_FAIL');
    process.exit(pass ? 0 : 1);
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
