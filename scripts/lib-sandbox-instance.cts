'use strict';
// 単一の隔離検証アプリの記録と、CDP 接続先の PID 照合。
// ポートは固定し、主作業ツリーから起動する。古い記録による誤操作を防ぐ。

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX_PORT = 9333;

interface Instance {
  pid: number;
  // HMR を起動する electron-vite の pid。CDP を listen する browser pid と分ける
  // ことで、所有者照合は browser に、停止は watcher を含む起動木に行える。
  launcherPid?: number;
  port: number;
  tree?: string;
  startedAt?: string;
}

function isSandboxPort(port: number): boolean {
  return port === SANDBOX_PORT;
}

// .git がファイルのリンク worktree から共有の検証環境を操作しない。
function assertMainWorkingTree(tree: string): void {
  if (!fs.statSync(path.join(tree, '.git')).isDirectory()) {
    throw new Error('開発・実機検証は主作業ツリーで一件ずつ行ってください。');
  }
}

function sandboxRoot(tree: string): string {
  return path.join(tree, '.sandbox');
}

function instanceFile(tree: string): string {
  return path.join(sandboxRoot(tree), 'instance.json');
}

function readInstance(tree: string): Instance | null {
  try {
    const r = JSON.parse(fs.readFileSync(instanceFile(tree), 'utf8'));
    return Number.isInteger(r.pid) && Number.isInteger(r.port) ? r : null;
  } catch {
    return null;
  }
}

function writeInstance(tree: string, inst: Instance): void {
  fs.mkdirSync(sandboxRoot(tree), { recursive: true });
  fs.writeFileSync(instanceFile(tree), JSON.stringify({ ...inst, tree, startedAt: inst.startedAt || new Date().toISOString() }, null, 2));
}

function clearInstance(tree: string): void {
  try {
    fs.unlinkSync(instanceFile(tree));
  } catch {
    /* すでに消えている */
  }
}

// `port` で listen している TCP ソケットを持つ pid。無ければ（あるいは
// プラットフォームが検索を提供しなければ）null。PowerShell ではなく netstat
// を使うのは、これがサンドボックスの起動/停止/接続のたびに走り、pwsh の起動
// はその半分近い時間を食うから。state 列はゆるく照合する — リモート側が
// null アドレスである行は、OS がその状態を何と呼ぼうと listener である。
function listeningPid(port: number): number | null {
  if (process.platform !== 'win32') return null;
  let out: string;
  try {
    out = cp.execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  } catch {
    return null;
  }
  for (const line of out.split(/\r?\n/)) {
    const m = line.trim().match(/^TCP\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)$/);
    if (!m) continue;
    const [, local, remote, state, pid] = m;
    if (!/^LISTEN/i.test(state) && !/:0$/.test(remote) && !/\*$/.test(remote)) continue;
    if (Number(local.slice(local.lastIndexOf(':') + 1)) !== port) continue;
    return Number(pid);
  }
  return null;
}

// `port` を握っている pid が、このツリーが記録したインスタンスでは「ない」
// 場合のその pid。null は「拒む理由が無い」を意味する: このツリーに記録が
// 無い、何も listen していない、検索が使えない、あるいは握っているのが
// 自分たち自身のいずれか。
//
// `lookup` は差し替え可能にしてある。これにより、実際のソケット無しに
// （そして listeningPid が常に null を返すプラットフォームでも）この比較を
// 単体テストできる。
function foreignSandboxAt(port: number, tree: string, lookup: (p: number) => number | null = listeningPid): number | null {
  const inst = readInstance(tree);
  if (!inst) return null;
  const pid = lookup(port);
  if (pid === null || pid === inst.pid) return null;
  return pid;
}

module.exports = {
  SANDBOX_PORT,
  assertMainWorkingTree,
  isSandboxPort,
  sandboxRoot,
  instanceFile,
  readInstance,
  writeInstance,
  clearInstance,
  listeningPid,
  foreignSandboxAt,
};
