'use strict';
// サンドボックス検証インスタンスがどのツリーに属すか（#640）。
//
// サンドボックスの CDP ポートは、かつて「9333から最初に空いているポート」で
// あり、起動元のツリー自身の .sandbox/instance.json に記録されていた。ポート
// をツリーに結び付けるものは何も無かったので、サンドボックスを動かす2つの
// worktree は9333を交互に握り合う — そして自分自身のインスタンスが消えた後に
// CDP_PORT=9333 で再接続したセッションは、「別の」ツリーのアプリを駆動して
// しまう。呼び出しはどれも成功するので、誰も気付かない: これがこのモジュールが
// 存在する理由となる失敗であり、番人を明示的にしなければならない理由でもある。
//
// 仕組みは2つあり、番人として機能するのは2つ目だけ:
//   1. 基準ポートはツリーのパスから導出されるので、あるツリーは常に同じポート
//      へ戻り、2つのツリーが同じ番号から始まることはない。これは便宜上のもの
//      でしかない — ハッシュの衝突や使用中のポートは、それでも起こり得る。
//   2. そのポートを実際に「listen している」プロセスを、このツリーが自分の
//      インスタンスを起動した時に記録した pid と比較する。
//      scripts/cdp-verify.cts は、他の誰かが握っているサンドボックスポートを
//      拒む。
//
// 仕組み2は、かつて CDP のページターゲットの URL から識別を読み取っていた:
// レンダラーは <tree>/app/out/renderer/index.html から読み込まれていたので、
// file:// の URL がそのツリーを名指していた。#7 はレンダラーを
// app://bundle/index.html へ移した。これはどのツリーでも同じ文字列になる —
// その識別は静かに盲目になっていたはずで、それこそが #640 の扱う失敗モード
// そのもの。listen している pid はアプリが何を読み込むかから一切導出されない
// ので、この移行を生き延びる（そして URL には決して答えられなかった
// `electron-vite dev` のインスタンスにも答えられる）。
//
// Windows 限定の検索。これはこのモジュールにこれまで負っていなかった代償を
// 課すわけではない: それを取り巻く検証ハーネスはすでに user32 へシェルアウト
// している（cdp-verify.cts）。それ以外の場所ではこの検索は null を返す＝
// 「分からない」であり、呼び出し元は null を、メッセージでその理由を言わずに
// 「問題なし」と読んではならない。

const crypto = require('node:crypto');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// :9222 は本物のアプリ（docs/開発ガイド.md の「デスクトップアプリを起動する」節）なので、サンドボックスはそれより上に住む。
const PORT_MIN = 9333;
const PORT_SPAN = 100;

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
  return Number.isInteger(port) && port >= PORT_MIN && port < PORT_MIN + PORT_SPAN;
}

// 同じツリー → 常に同じポート。違うツリー → （ほぼ常に）違うポート。Windows
// は同じパスをいくつもの綴りで書けるので、ハッシュ化の前にキーを正規化する —
// そうしないと `C:\x` と `c:/x` が2つのツリーとして扱われてしまう。
function sandboxPortBase(tree: string): number {
  const key = path.resolve(tree).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const digest = crypto.createHash('sha256').update(key).digest();
  return PORT_MIN + (digest.readUInt16BE(0) % PORT_SPAN);
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
  PORT_MIN,
  PORT_SPAN,
  isSandboxPort,
  sandboxPortBase,
  sandboxRoot,
  instanceFile,
  readInstance,
  writeInstance,
  clearInstance,
  listeningPid,
  foreignSandboxAt,
};
