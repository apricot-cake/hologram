'use strict';
// Which tree a sandbox verify instance belongs to (#640).
//
// The sandbox CDP port used to be "the first free port from 9333", recorded in
// the starting tree's own .sandbox/instance.json. Nothing tied a port to a tree,
// so two worktrees running sandboxes take turns holding 9333 — and a session
// that reconnects with CDP_PORT=9333 after its own instance is gone then drives
// the OTHER tree's app. Every call succeeds, so nobody finds out: that is the
// failure this module exists for, and why the guard has to be explicit.
//
// Two mechanisms, and only the second one is a guard:
//   1. the base port is derived from the tree's path, so a tree comes back to
//      the same port and two trees do not start from the same number. This is
//      convenience only — a hash collision or a busy port still walks.
//   2. the process actually LISTENING on the port is compared with the pid this
//      tree recorded when it started its instance. scripts/cdp-verify.cts
//      refuses a sandbox port held by anyone else.
//
// Mechanism 2 used to read the identity out of the CDP page target's URL: the
// renderer was loaded from <tree>/app/out/renderer/index.html, so a file:// URL
// named its tree. #7 moved the renderer onto app://bundle/index.html, which is
// the same string in every tree — that identification would have gone silently
// blind, which is exactly the failure mode #640 is about. The listening pid is
// not derived from what the app loads at all, so it survives the move (and it
// answers for an `electron-vite dev` instance too, which the URL never could).
//
// Windows-only lookup, which costs this module nothing it did not already owe:
// the verify harness around it already shells out to user32 (cdp-verify.cts).
// Everywhere else the lookup returns null = "cannot tell", and callers must not
// read null as "fine" without saying why in their message.

const crypto = require('node:crypto');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// :9222 is the real app (docs/build.md, "Verification Rules" section), so sandboxes live above it.
const PORT_MIN = 9333;
const PORT_SPAN = 100;

interface Instance {
  pid: number;
  port: number;
  tree?: string;
  startedAt?: string;
}

function isSandboxPort(port: number): boolean {
  return Number.isInteger(port) && port >= PORT_MIN && port < PORT_MIN + PORT_SPAN;
}

// Same tree → same port, every time; different trees → (almost always)
// different ports. Windows spells the same path several ways, so the key is
// normalized before hashing — otherwise `C:\x` and `c:/x` would be two trees.
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
    /* already gone */
  }
}

// The pid holding a LISTENING TCP socket on `port`, or null when there is none
// (or the platform offers no lookup). netstat rather than PowerShell because
// this runs on every sandbox start/stop/connect and a pwsh launch is ~half a
// second of it. The state column is matched loosely — a row whose remote end is
// the null address is a listener whatever the OS calls that state.
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

// The pid holding `port` when it is NOT the instance this tree recorded. null
// means "no reason to refuse": this tree has no record, nothing is listening,
// the lookup is unavailable, or the holder is ours.
//
// `lookup` is injectable so the comparison can be unit-tested without a live
// socket (and on a platform where listeningPid always answers null).
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
