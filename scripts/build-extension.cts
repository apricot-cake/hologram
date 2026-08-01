'use strict';

// `npm run build:ext` — build the extension AND announce the result (#650).
//
// WHY THERE IS A SCRIPT HERE AT ALL. The daily Chrome loads
// extension/.output/chrome-mv3 straight off disk, so every build replaces the
// extension the author is browsing with. Until #650 that replacement only took
// effect when a human pressed reload in chrome://extensions. Now the extension
// reloads itself — it learns that the folder it came from holds a different
// build from the token this script publishes (native-host/paths.cts's
// extensionBuildStampPath), which the native host puts on every reply.
//
// THE FAILURE THIS SCRIPT EXISTS TO PREVENT is the one measured on #650: if the
// extension reloads while the output folder is INCOMPLETE — a half-written
// manifest, or a manifest naming a file that is not there yet — Chrome disables
// it with DISABLE_RELOAD and it does not come back when the files do. Recovering
// needs the very click this whole issue is removing, so "probably fine" is not
// good enough. Two properties make it safe:
//
//   1. The token is published by THIS script, after the build process has
//      exited successfully — never by a file watcher, which is what would see
//      the folder mid-write.
//   2. Before publishing, the output is checked against the manifest: it parses,
//      every file it names exists and is non-empty, its locale table is there,
//      the entrypoints the code injects by name are there, and the two bundles
//      that have to carry the token actually carry it. A build that exits 0 with
//      an output that cannot be loaded fails HERE, and nothing is published — so
//      the extension in the browser keeps running the last build that could.
//
// Verified, not assumed: the check reads the files that were just written.

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { configDir, extensionBuildStampPath } = require('../native-host/paths.cts');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'extension', '.output', 'chrome-mv3');

// Entrypoints named by STRING in code rather than by the manifest, so nothing
// else would notice them disappearing: background.ts injects capture.js on every
// activation (`files: ['capture.js']`), and the diagnostics page is what a
// failure sends the user to.
const NAMED_BY_CODE = ['capture.js', 'diag.html'];

// The worker is the one bundle that has to hold the token as a VALUE: it
// compares it with what the host reports on every reply.
const CARRIES_TOKEN = 'background.js';

function mintBuildId(): string {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// Files the manifest points at. Kept to the fields this extension actually uses:
// a generic walk over every string in the manifest would start "checking" match
// patterns and locale keys.
function manifestFiles(manifest: Record<string, any>): string[] {
  const files: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === 'string' && value) files.push(value);
  };
  add(manifest.background?.service_worker);
  add(manifest.options_ui?.page);
  for (const script of manifest.content_scripts || []) {
    for (const js of script.js || []) add(js);
    for (const css of script.css || []) add(css);
  }
  for (const icon of Object.values(manifest.icons || {})) add(icon);
  for (const icon of Object.values(manifest.action?.default_icon || {})) add(icon);
  if (manifest.default_locale) files.push(path.join('_locales', manifest.default_locale, 'messages.json'));
  return files;
}

// Everything that has to be true before the token may be published. Throws with
// the first thing that is not, because the point is to stop, not to survey.
function verifyOutput(buildId: string): void {
  const manifestPath = path.join(OUT, 'manifest.json');
  let manifest: Record<string, any>;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/, ''));
  } catch (error: any) {
    throw new Error(`manifest.json is not readable JSON (${error?.message}) — the output folder cannot be loaded, so no build was announced`);
  }
  if (manifest.manifest_version !== 3) throw new Error(`manifest.json parsed but is not an MV3 manifest (manifest_version=${JSON.stringify(manifest.manifest_version)})`);

  for (const relative of [...manifestFiles(manifest), ...NAMED_BY_CODE]) {
    const file = path.join(OUT, relative);
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      throw new Error(`the build names ${relative} but the output does not contain it — loading this folder would disable the extension`);
    }
    if (!size) throw new Error(`${relative} is empty in the output — loading this folder would disable the extension`);
  }

  // The token has to have reached the worker, or the extension would ask for a
  // reload it can never satisfy: it would come back still not carrying the token
  // the host reports. (One reload is all it would cost — see
  // DevReloadState.attempted — but "one wasted reload per build" is exactly the
  // noise this feature must not make.)
  if (!fs.readFileSync(path.join(OUT, CARRIES_TOKEN), 'utf8').includes(buildId)) {
    throw new Error(`${CARRIES_TOKEN} does not carry this build's token (${buildId}) — the define in extension/wxt.config.ts did not reach it`);
  }
}

// Publish only where the announcement can be TRUE. The stamp says "the folder
// your extension was loaded from now holds this build", and only the main
// working tree's output is the folder any browser has loaded — a linked worktree
// builds into its own .output that nothing reads, and announcing from there
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

// Temp file plus rename, so a reader never sees a half-written stamp: the bridge
// reads this on every reply, and a torn read would simply publish nothing, but a
// TRUNCATED-then-filled file could publish the wrong token for an instant.
function publish(buildId: string): string {
  const file = extensionBuildStampPath();
  fs.mkdirSync(configDir(), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ build: buildId, outDir: OUT, builtAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
  return file;
}

const buildId = mintBuildId();
// Windows: npm.cmd spawned without a shell is EINVAL (skill windows-scripting).
execFileSync('npm --prefix extension run build:ext', {
  cwd: ROOT,
  shell: true,
  stdio: 'inherit',
  env: Object.assign({}, process.env, { HOLOGRAM_EXT_BUILD_ID: buildId }),
});
verifyOutput(buildId);

if (shouldPublish()) {
  console.log(`[hologram] extension build ${buildId} announced in ${publish(buildId)}`);
} else {
  console.log(`[hologram] extension build ${buildId} was NOT announced — this is a linked worktree, and no browser has loaded its output`);
}
