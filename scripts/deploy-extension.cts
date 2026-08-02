'use strict';

// `npm run deploy:ext` — put a VERIFIED release build into the folder the daily
// Chrome has loaded, and tell the extension it happened (#732).
//
// This is the only writer of extension/.output/chrome-mv3. The daily browser
// carries release builds and nothing else: development happens in a separate
// Chrome profile against a separate output (extension/wxt.config.ts), so the
// daily extension no longer depends on a dev server being alive, and a build
// that fails verification simply never reaches it.
//
// WHO CALLS THIS. The post-merge hook (.githooks/post-merge) after main is
// pulled into the MAIN working tree, so what the author browses with is
// whatever last landed on main. It is also safe to run by hand.
//
// HOW THE BROWSER FINDS OUT. Chrome does not re-read an unpacked extension when
// its files change, so the swap alone would still cost a click in
// chrome://extensions. It doesn't, because of #650: this script publishes the
// deployed build's token to native-host/paths.cts's extensionBuildStampPath, the
// native host puts that token on every reply, and the extension — which already
// talks to the host on every save and every badge query — notices the folder it
// came from now holds a different build and calls chrome.runtime.reload() on
// itself, waiting first for any save, bulk intake or capture UI to finish
// (extension/utils/dev-reload.ts).
//
// ORDER MATTERS: swap first, announce second. Announcing a build that is not on
// disk yet is the DISABLE_RELOAD failure scripts/build-extension.cts exists to
// prevent.

const fs = require('node:fs');
const path = require('node:path');

const { configDir, extensionBuildStampPath } = require('../native-host/paths.cts');
const { buildId, releaseDir } = require('./build-extension.cts');

const ROOT = path.join(__dirname, '..');
const DAILY = path.join(ROOT, 'extension', '.output', 'chrome-mv3');

// Publish only where the announcement can be TRUE. The stamp says "the folder
// your extension was loaded from now holds this build", and only the main
// working tree's output is a folder any browser has loaded — a linked worktree
// deploys into its own .output that nothing reads, and announcing from there
// would make the daily extension reload for a build it will never see.
//
// `.git` is a directory in the main working tree and a FILE in a linked one,
// which is git's own way of saying the same thing.
//
// An explicit HOLOGRAM_CONFIG_DIR overrides it: the caller has already pointed
// the whole system at a sandbox, so there is no real installation to disturb and
// a test that wants to exercise this path can.
function shouldPublish(): boolean {
  if (process.env.HOLOGRAM_CONFIG_DIR) return true;
  try {
    return fs.statSync(path.join(ROOT, '.git')).isDirectory();
  } catch {
    return true; // not a git checkout at all (a tarball, CI oddities) — nothing to protect
  }
}

// Replaced IN PLACE, file by file, rather than by renaming a staged folder
// into position. Renaming is the usual way to make a swap atomic and it CANNOT
// be used here: the daily Chrome holds an open handle on this directory for as
// long as the unpacked extension is loaded, so Windows fails the rename with
// EPERM (measured 2026-08-02). Un-loading the extension to free the handle would
// cost exactly the click this whole path exists to remove.
//
// In-place is safe because nothing reads this folder until it is told to. Chrome
// does not watch an unpacked extension for changes; it re-reads it only on
// chrome.runtime.reload(), and the only thing that asks for one is the
// announcement below — published after the copy has finished. The window where
// the folder is inconsistent is a window in which no reader exists.
//
// Files that the previous build had and this one does not are removed, so a
// renamed entrypoint cannot linger and be injected by name.
function listFiles(root: string, base = root): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(absolute, base));
    else files.push(path.relative(base, absolute));
  }
  return files;
}

function swapIn(source: string): void {
  fs.mkdirSync(DAILY, { recursive: true });
  const wanted = new Set(listFiles(source));
  for (const stale of listFiles(DAILY)) {
    if (!wanted.has(stale)) fs.rmSync(path.join(DAILY, stale), { force: true });
  }
  fs.cpSync(source, DAILY, { recursive: true, force: true });
  // Directories the previous layout had and this one does not (CRXJS put the
  // entrypoints under their own folders); harmless to leave, confusing to keep.
  for (const entry of fs.readdirSync(DAILY, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const absolute = path.join(DAILY, entry.name);
    if (!listFiles(absolute, DAILY).length) fs.rmSync(absolute, { recursive: true, force: true });
  }
}

// Temp file plus rename, so a reader never sees a half-written stamp: the bridge
// reads this on every reply, and a torn read would simply publish nothing, but a
// TRUNCATED-then-filled file could publish the wrong token for an instant.
function publish(): string {
  const file = extensionBuildStampPath();
  fs.mkdirSync(configDir(), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ build: buildId, outDir: DAILY, builtAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
  return file;
}

swapIn(releaseDir('chrome'));
console.log(`[hologram] deployed verified Chrome release to ${DAILY}`);

if (shouldPublish()) {
  console.log(`[hologram] extension build ${buildId} announced in ${publish()}`);
} else {
  console.log(`[hologram] extension build ${buildId} was NOT announced — this is a linked worktree, and no browser has loaded its output`);
}
