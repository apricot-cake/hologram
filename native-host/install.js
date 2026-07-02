'use strict';

// Registers (or removes) the Corpus native messaging host so Chrome/Edge
// can launch the bridge.
//
// Used two ways:
//   - dev CLI:        node native-host/install.js  [uninstall]
//                     (launcher runs the bridge with this Node binary)
//   - Electron app:   require('.../native-host/install').install({ exe, runAsNode:true })
//                     (launcher runs the bridge with the Electron binary in
//                      ELECTRON_RUN_AS_NODE mode, so no system Node is needed)

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const { configDir } = require('./paths');

const HOST_NAME = 'com.corpus.host';
const BRIDGE_PATH = path.join(__dirname, 'bridge.js');
const PATHS_PATH = path.join(__dirname, 'paths.js');
const MEDIA_DOWNLOAD_PATH = path.join(__dirname, 'media-download.js');
// Shared save-folder resolution (config → redundant pointer → default), required
// by bridge.js so the host and app resolve the save folder identically. Deployed
// alongside the bridge — see deployBridge().
const CONFIG_RECOVERY_PATH = path.join(__dirname, 'config-recovery.js');

// Copy the bridge into the (ASCII) config dir and run it from there. The repo
// may live under a non-ASCII path (e.g. Japanese folders); cmd.exe reads .bat
// files in the OEM code page and would mangle a non-ASCII path, so the launcher
// must reference an ASCII location only. Re-run install after editing bridge.js.
function deployBridge() {
  fs.mkdirSync(configDir(), { recursive: true });
  const destBridge = path.join(configDir(), 'bridge.js');
  fs.copyFileSync(BRIDGE_PATH, destBridge);
  fs.copyFileSync(PATHS_PATH, path.join(configDir(), 'paths.js'));
  // bridge.js runs from the ASCII config dir, so EVERY local module it require()s
  // must be deployed alongside it — a missing one makes the spawned host crash on
  // startup ("Error when communicating with the native messaging host"), with no
  // hint. Keep this in lockstep with bridge.js's require()s: paths, media-download,
  // config-recovery (the last lets the bridge recover the save folder from the
  // redundant pointer exactly like the app, instead of silently defaulting).
  fs.copyFileSync(MEDIA_DOWNLOAD_PATH, path.join(configDir(), 'media-download.js'));
  fs.copyFileSync(CONFIG_RECOVERY_PATH, path.join(configDir(), 'config-recovery.js'));
  return destBridge;
}

// Chrome extension ids are exactly 32 chars of a\u2013p. Everything flowing into the
// manifest's allowed_origins (IPC arg, CLI arg, config value) passes this gate;
// invalid ids degrade to null, which writeManifest/updateAllowedOrigin already
// handle (preserve or clear origins \u2014 never emit a malformed origin).
const VALID_EXT_ID = /^[a-p]{32}$/;
function sanitizeExtensionId(id) {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  return VALID_EXT_ID.test(trimmed) ? trimmed : null;
}

// The unpacked extension's ID (path-derived, shown in chrome://extensions).
// Stored in config.json by the app so we never commit a key to the repo.
function readExtensionId() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
    if (cfg) return sanitizeExtensionId(cfg.extensionId);
  } catch {
    // No config yet.
  }
  return null;
}

function launcherPath() {
  return path.join(configDir(), process.platform === 'win32' ? 'corpus-host.bat' : 'corpus-host.sh');
}

function manifestPath() {
  return path.join(configDir(), `${HOST_NAME}.json`);
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: \x00-\x7F is the deliberate full-ASCII range check
const isAscii = (s) => /^[\x00-\x7F]*$/.test(s);

// cmd.exe reads a .bat in the console's OEM code page, so a launcher that
// references a non-ASCII path (e.g. a repo under C:\…\ローカル\開発\) gets the
// path mangled and the host fails to start with "Error when communicating with
// the native messaging host" — capture silently never works. Point the .bat at
// an ASCII-only directory junction (no admin needed) instead of the raw exe.
function asciiExeRef(exe) {
  if (isAscii(exe)) return exe;
  const exeDir = path.dirname(exe);
  const link = path.join(configDir(), 'runtime'); // configDir is ASCII
  try {
    let good = false;
    if (fs.existsSync(link)) {
      try {
        const st = fs.lstatSync(link);
        if (st.isSymbolicLink()) good = path.resolve(fs.readlinkSync(link)) === path.resolve(exeDir);
      } catch {
        good = false;
      }
      if (!good) fs.rmSync(link, { recursive: true, force: true });
    }
    if (!good) fs.symlinkSync(exeDir, link, 'junction');
    // %~dp0 = the .bat's own (ASCII) dir, with a trailing backslash.
    return `%~dp0runtime\\${path.basename(exe)}`;
  } catch {
    return exe; // junction unavailable — fall back to the raw path
  }
}

function writeLauncher({ exe, runAsNode, bridgePath }) {
  fs.mkdirSync(configDir(), { recursive: true });
  const p = launcherPath();

  if (process.platform === 'win32') {
    const exeRef = asciiExeRef(exe);
    const lines = ['@echo off'];
    if (runAsNode) lines.push('set ELECTRON_RUN_AS_NODE=1');
    lines.push(`"${exeRef}" "${bridgePath}" %*`);
    fs.writeFileSync(p, lines.join('\r\n') + '\r\n', 'utf8');
  } else {
    const lines = ['#!/bin/sh'];
    if (runAsNode) lines.push('export ELECTRON_RUN_AS_NODE=1');
    lines.push(`exec "${exe}" "${bridgePath}" "$@"`);
    fs.writeFileSync(p, lines.join('\n') + '\n', { mode: 0o755 });
  }
  return p;
}

function writeManifest(launcher, extensionId) {
  // When no extensionId is known (e.g. the app re-registers on every launch but
  // config has none yet), PRESERVE any existing allowed_origins instead of wiping
  // it to []. An empty allowed_origins silently forbids the extension and breaks
  // every save until the id is re-set — the exact failure this whole episode was.
  // Self-healing: a launch without an id never downgrades a working manifest.
  let allowedOrigins = extensionId ? [`chrome-extension://${extensionId}/`] : [];
  if (!extensionId) {
    try {
      const prev = JSON.parse(fs.readFileSync(manifestPath(), 'utf8'));
      if (Array.isArray(prev.allowed_origins) && prev.allowed_origins.length) allowedOrigins = prev.allowed_origins;
    } catch {
      /* no prior manifest — leave empty */
    }
  }
  const manifest = {
    name: HOST_NAME,
    description: 'Corpus native messaging host',
    path: launcher,
    type: 'stdio',
    allowed_origins: allowedOrigins,
  };
  const p = manifestPath();
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2), 'utf8');
  return p;
}

// Persist an explicitly-provided extension id into config.json (preserving the
// app's other settings), so a later app launch — which reads the id from config
// to register allowed_origins — keeps the correct origin instead of wiping it.
function persistExtensionId(id) {
  if (!id) return;
  try {
    const p = path.join(configDir(), 'config.json');
    let cfg = {};
    let raw = null;
    try {
      raw = fs.readFileSync(p, 'utf8');
    } catch {
      /* fresh config — write from scratch below */
    }
    if (raw !== null) {
      try {
        cfg = JSON.parse(raw.replace(/^\uFEFF/, '')) || {};
      } catch {
        // Present but unparseable (torn write / bad hand edit): bail instead of
        // rewriting the file as {extensionId} only — that would wipe saveFolder
        // and backup in one stroke (same preserve-don't-clobber rule as the
        // app's readConfig). Registration proceeds; the id persists next run.
        return;
      }
    }
    if (cfg.extensionId !== id) {
      cfg.extensionId = id;
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
    }
  } catch {
    /* best-effort — never block registration */
  }
}

// Browsers that read native messaging host manifests.
function windowsRegistryKeys() {
  return [`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`, `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`, `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`];
}

function unixManifestDirs() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [path.join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts'), path.join(home, 'Library/Application Support/Microsoft Edge/NativeMessagingHosts'), path.join(home, 'Library/Application Support/Chromium/NativeMessagingHosts')];
  }
  return [path.join(home, '.config/google-chrome/NativeMessagingHosts'), path.join(home, '.config/microsoft-edge/NativeMessagingHosts'), path.join(home, '.config/chromium/NativeMessagingHosts')];
}

function install({ exe = process.execPath, runAsNode = false, extensionId } = {}) {
  extensionId = sanitizeExtensionId(extensionId);
  if (extensionId) persistExtensionId(extensionId); // explicit id (CLI/app) → make it durable
  const id = extensionId || readExtensionId();
  const bridgePath = deployBridge();
  const launcher = writeLauncher({ exe, runAsNode, bridgePath });
  const manifest = writeManifest(launcher, id);

  if (process.platform === 'win32') {
    for (const key of windowsRegistryKeys()) {
      execFileSync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifest, '/f'], { stdio: 'ignore' });
    }
  } else {
    for (const dir of unixManifestDirs()) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(manifest, path.join(dir, `${HOST_NAME}.json`));
      } catch {
        // Browser not installed — skip.
      }
    }
  }

  return { launcher, manifest, configDir: configDir(), extensionId: id };
}

// Rewrite only the manifest's allowed_origins, preserving the existing launcher
// (so we never clobber a working launcher with one that points at a non-ASCII
// exe path). Falls back to a full install if no manifest exists yet.
function updateAllowedOrigin(extensionId) {
  extensionId = sanitizeExtensionId(extensionId);
  const mp = manifestPath();
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(mp, 'utf8'));
  } catch {
    return install({ extensionId });
  }
  manifest.allowed_origins = extensionId ? [`chrome-extension://${extensionId}/`] : [];
  fs.writeFileSync(mp, JSON.stringify(manifest, null, 2), 'utf8');
  return { manifest: mp, extensionId };
}

function uninstall() {
  if (process.platform === 'win32') {
    for (const key of windowsRegistryKeys()) {
      try {
        execFileSync('reg', ['delete', key, '/f'], { stdio: 'ignore' });
      } catch {
        // Key not present — fine.
      }
    }
  } else {
    for (const dir of unixManifestDirs()) {
      try {
        fs.unlinkSync(path.join(dir, `${HOST_NAME}.json`));
      } catch {
        // Not present — fine.
      }
    }
  }

  // Remove the deployed bridge, the launcher, and the generated host manifest.
  // Leave config.json (extensionId / saveFolder) so user settings survive an
  // uninstall. Clearing the stale manifest also matters because app/main.js
  // gates registration on existsSync(manifestPath()); a leftover manifest would
  // make a later launch skip re-registering with stale allowed_origins.
  const leftovers = [path.join(configDir(), 'bridge.js'), path.join(configDir(), 'paths.js'), path.join(configDir(), 'media-download.js'), path.join(configDir(), 'config-recovery.js'), launcherPath(), manifestPath()];
  for (const f of leftovers) {
    try {
      fs.unlinkSync(f);
    } catch {
      // Not present — fine.
    }
  }
}

module.exports = { install, uninstall, updateAllowedOrigin, readExtensionId, HOST_NAME, BRIDGE_PATH, launcherPath, manifestPath };

if (require.main === module) {
  if (process.argv[2] === 'uninstall') {
    uninstall();
    console.log(`Removed native messaging host "${HOST_NAME}".`);
  } else {
    // Optional: `node install.js <extensionId>` to set the allowed extension.
    const argId = process.argv[2];
    const result = install(argId ? { extensionId: argId } : {});
    console.log(`Installed native messaging host "${HOST_NAME}".`);
    console.log(`  extensionId: ${result.extensionId || '(not set — set it in the app, then re-register)'}`);
    console.log(`  launcher: ${result.launcher}`);
    console.log(`  manifest: ${result.manifest}`);
    console.log(`  config:   ${path.join(result.configDir, 'config.json')}`);
  }
}
