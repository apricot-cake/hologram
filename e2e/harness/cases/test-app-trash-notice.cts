'use strict';

// #158: ゴミ箱通知を、実際のアプリ起動を通してエンドツーエンドで検証する。
//
// ここで証明する2つのことは、どちらも純粋関数ではなく配線の側に住んでいる
// ので、単体テストでは検証できない:
//
//   1. 投稿を削除すると bridge-saved-index.json が「書き換わる」。#158 以前は
//      ipc-trash.ts の何もそれに触れていなかった（scheduleSavedIndexWrite の
//      呼び出し元は起動時のプライミング、取込キューの drain、ZIP インポート、
//      孤立回復だけだった）ので、削除した投稿は「保存済み」のエントリを
//      持ち続けていた — タイムラインのバッジは点灯したままで、重複保存の
//      警告もゴミ箱にあるキャプチャを名指し続けていた。
//   2. 投稿は `entries` から `trashed` へ移り、復元でまた戻る。ファイルだけ
//      でなくブリッジに問い合わせるのは、拡張機能が実際に動作の根拠にする
//      答えが handleQuery のものだからで、読み手が使えないスナップショット
//      は何も証明しない。
//
// すべての検証は、1回の起動の中で「同じ」サンドボックスライブラリに対して、
// 利用者が実際に行う順序で走る: 削除 -> 復元 -> 削除 -> ゴミ箱を空にする。
//
//   node e2e/harness/cases/test-app-trash-notice.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-trashnotice-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const POST_URL = 'https://x.com/trashnotice/status/158158158';
const CAPTURE_ID = 'dummy-158';
const IMAGE = `${CAPTURE_ID}.jpg`;
const SNAPSHOT_FILE = path.join(configDir, 'bridge-saved-index.json');

// 本物のメディアファイルが実在しなければならない: delete-post はこの
// キャプチャのファイルを .trash/ へ移し、restore-post はそれを戻す。ディスク
// に何も無くてもレコードは往復してしまうが、それだと通知の生存期間が結び
// 付いているファイル側を、このハーネスは運動させていないことになる。
fs.writeFileSync(path.join(saveFolder, IMAGE), Buffer.from('89504e470d0a1a0a', 'hex'));

seedLibrary(configDir, [
  {
    captureId: CAPTURE_ID,
    image: IMAGE,
    url: POST_URL,
    platform: 'x',
    text: 'trash notice fixture',
    tags: ['tag-a'],
    media: [{ url: 'https://pbs.twimg.com/media/TRASH?format=jpg&name=orig', file: IMAGE }],
    capturedAt: '2026-01-01T00:00:00.000Z',
    date: '2026-01-01T00:00:00.000Z',
  },
]);

process.env.HOLOGRAM_CONFIG_DIR = configDir;
const bridge = require(path.join(__dirname, '../../../native-host/bridge.mts'));

// 「拡張機能は今何を見ているか」を1回読む。まずキャッシュを捨てるのは、
// このプロセスがポートの生存期間ずっと索引を保持しており、アプリがその
// 下でファイルをちょうど書き換えたばかりだから。
function ask() {
  bridge._resetSavedIndex();
  const ack = bridge.handleQuery({ type: 'query', urls: [POST_URL] });
  return { saved: ack.results[POST_URL] || null, trashed: (ack.trashed || {})[POST_URL] || null };
}

// scheduleSavedIndexWrite は1500msデバウンスするので、各ステップは次のもの
// がライブラリをさらに動かす前にそれを超えて待つ。この待ちがあるおかげで、
// 下の読み取りは競合状態ではなく落ち着いた状態についての答えになる。
const evalJs = evalSource(
  async ({ sleep }, args) => {
    const w = window as any;
    // このデバウンス自体が仕様: scheduleSavedIndexWrite は1500ms待ち、それが
    // 経過するまでは、レンダラーから観測できるもので「このステップの分の
    // スナップショットが書かれた」と言えるものが何も無い。各ステップは
    // それを超えて座ることで、ハーネスのポーリングが競合状態ではなく落ち着いた
    // 状態をサンプルするようにする。
    // biome-ignore lint/plugin: the 1500ms saved-index debounce is the spec — nothing is observable until it elapses.
    const settle = () => sleep(1900);
    await w.hologram.listPosts();
    await settle();
    await w.hologram.deletePost(args.image);
    await settle();
    w.__afterDelete = (await w.hologram.listTrash()).length;
    await w.hologram.restorePost(args.image);
    await settle();
    await w.hologram.deletePost(args.image);
    await settle();
    await w.hologram.emptyTrash();
    await settle();
    return 'done ' + w.__afterDelete;
  },
  { image: IMAGE },
);

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: configDir,
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_EVAL: evalJs,
});

// 各段階は、アプリがそこに達した時に採取される: ハーネスは eval をステップ
// 実行できないので、代わりにスナップショット自身の mtime をポーリングし、
// 書き換わるたびにブリッジが何と答えるかを記録する。答えの並び自体が主張。
const readings: Array<{ saved: string | null; trashed: string | null }> = [];
let lastMtime = -1;
const poll = setInterval(() => {
  let mtime: number;
  try {
    mtime = fs.statSync(SNAPSHOT_FILE).mtimeMs;
  } catch {
    return; // まだ書かれていない
  }
  if (mtime === lastMtime) return;
  lastMtime = mtime;
  const a = ask();
  readings.push({ saved: a.saved ? a.saved.id : null, trashed: a.trashed ? a.trashed.id : null });
}, 150);

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', () => {
  clearInterval(poll);
  const evalOk = /EVAL_RESULT "done 1"/.test(out);

  // 最終状態はアプリが去った「後」に読む。だから読み取りと検証の間に、誰も
  // ファイルを書き換えられない。
  const final = ask();

  // 連続して同じ読み取りは1つに畳む: デバウンスは1回のライブラリ変更に
  // 対して複数回発火し得る（通り道の listPosts がそれを再プライムする）ので、
  // このテストが問うているのは、各遷移が何回の書き換えを要したかではなく、
  // 異なる状態の「順序」。
  const states: string[] = [];
  for (const r of readings) {
    const state = r.saved ? 'saved' : r.trashed ? 'trashed' : 'none';
    if (states[states.length - 1] !== state) states.push(state);
  }

  // saved（シードされたライブラリ）-> trashed（削除）-> saved（復元）->
  // trashed（再削除）-> none（ゴミ箱を空にする）。2つの 'saved' の間に
  // 'trashed' が無いのは #158 以前の振る舞い: 削除が索引に一度も届かな
  // かった。
  const sequenceOk = states.join(',') === 'saved,trashed,saved,trashed,none';
  const finalOk = final.saved === null && final.trashed === null;

  // ゴミ箱通知は保存済みエントリとして到達可能であってはならない: バッジと
  // ホバーの保存ボタンはどのエントリも「ライブラリがこれを持っている」と
  // 読むので、`entries` に載ったままのゴミ箱投稿は、もう無い投稿に対して
  // バッジを点灯させてしまう。
  let trashedIsNotSaved = true;
  try {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    trashedIsNotSaved = Object.keys(snap.entries || {}).every((k) => !(snap.trashed || {})[k]);
  } catch {
    trashedIsNotSaved = false;
  }

  fs.rmSync(tmp, { recursive: true, force: true });

  const pass = evalOk && sequenceOk && finalOk && trashedIsNotSaved;
  console.log(`eval=${evalOk} states=${states.join(',')} final=${JSON.stringify(final)} trashedDisjointFromSaved=${trashedIsNotSaved}`);
  console.log(pass ? 'TRASH_NOTICE_PASS' : 'TRASH_NOTICE_FAIL');
  process.exit(pass ? 0 : 1);
});
