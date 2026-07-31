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
//   2. the live instance says which tree it was launched from, independently of
//      any file we wrote: its page target is loaded out of <tree>/app/out, so
//      the target's file:// URL names the tree. scripts/cdp-verify.cts refuses a
//      sandbox port whose app came from somewhere else.

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

// :9222 is the real app (docs/build.md「検証ルール」), so sandboxes live above it.
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

// The local path a CDP page target was loaded from, or null when the target is
// not a file (an `electron-vite dev` renderer is served over http, and there is
// nothing in an http URL that names a tree).
function targetFilePath(url: string): string | null {
  if (typeof url !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'file:') return null;
  try {
    return path.normalize(fileURLToPath(parsed));
  } catch {
    return null;
  }
}

// true = this tree's, false = someone else's, null = cannot tell (see above).
// Callers must not read null as "fine" without saying why in their message.
function targetBelongsToTree(url: string, tree: string): boolean | null {
  const file = targetFilePath(url);
  if (!file) return null;
  const rel = path.relative(path.resolve(tree), file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function listTargets(port: number, timeout = 1500): Promise<any[] | null> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/json/list', timeout }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const list = JSON.parse(body);
          resolve(Array.isArray(list) ? list : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function pageTargetOf(targets: any[]): any | null {
  return targets.find((t) => t.type === 'page' && String(t.url).includes('index.html')) || targets.find((t) => t.type === 'page') || null;
}

// The path a sandbox on this port was launched from, when it is NOT this tree.
// null means "no reason to refuse": nothing is listening, it answers nothing we
// can identify, or it is ours.
async function foreignSandboxAt(port: number, tree: string): Promise<string | null> {
  const targets = await listTargets(port);
  if (!targets) return null;
  const page = pageTargetOf(targets);
  if (!page) return null;
  return targetBelongsToTree(page.url, tree) === false ? targetFilePath(page.url) : null;
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
  targetFilePath,
  targetBelongsToTree,
  listTargets,
  pageTargetOf,
  foreignSandboxAt,
};
