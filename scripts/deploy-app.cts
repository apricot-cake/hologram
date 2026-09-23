'use strict';

// npm run app:deploy。成功したビルドだけを配備し、アプリ自身へ再起動を通知する。
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'app');
const id = randomUUID();
const stage = path.join(appDir, `.deploy-stage-${id}`);
const previous = path.join(appDir, `.deploy-previous-${id}`);
const output = path.join(appDir, 'out');
const lock = path.join(appDir, '.deploy-lock');
const marker = path.join(appDir, '.deployed-build.json');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm run app:deploy から実行してください');
// 自分が取得したロックだけを最後に削除する。
const fd = fs.openSync(lock, 'wx');
let movedPrevious = false;
let published = false;
try {
  execFileSync(process.execPath, [npmCli, 'run', '_build', '--workspace', 'app'], {
    cwd: root,
    env: { ...process.env, HOLOGRAM_APP_BUILD_OUT: stage },
    stdio: 'inherit',
    windowsHide: true,
  });
  for (const name of ['main/index.js', 'preload/index.js', 'renderer/index.html']) {
    if (!fs.statSync(path.join(stage, name)).isFile()) throw new Error(`ビルド出力がありません: ${name}`);
  }
  // 再起動を待つ旧画面が参照するハッシュ付きアセットも残す。
  const oldAssets = path.join(output, 'renderer', 'assets');
  if (fs.existsSync(oldAssets)) fs.cpSync(oldAssets, path.join(stage, 'renderer', 'assets'), { recursive: true, force: false });
  if (fs.existsSync(output)) {
    fs.renameSync(output, previous);
    movedPrevious = true;
  }
  try {
    fs.renameSync(stage, output);
    fs.writeFileSync(`${marker}.tmp`, JSON.stringify({ build: id }), 'utf8');
    fs.renameSync(`${marker}.tmp`, marker);
    published = true;
  } catch (error) {
    if (fs.existsSync(output)) fs.renameSync(output, stage);
    if (movedPrevious) {
      fs.renameSync(previous, output);
      movedPrevious = false;
    }
    throw error;
  }
  console.log('アプリを配備しました。起動中のアプリは処理の終了後に自動で再起動します。');
} finally {
  // stage/previous は、この実行が app 内に UUID 付きで作ったパスに限る。
  if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
  if (published && movedPrevious) fs.rmSync(previous, { recursive: true, force: true });
  fs.closeSync(fd);
  fs.unlinkSync(lock);
}
