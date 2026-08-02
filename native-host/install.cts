'use strict';

// Registers (or removes) the Hologram native messaging host so Chrome/Edge
// can launch the bridge.
//
// Used two ways:
//   - dev CLI:        node native-host/install.cts  [uninstall]
//                     (launcher runs the bridge with this Node binary)
//   - Electron app:   require('.../native-host/install.cts').install({ exe, runAsNode:true })
//                     (launcher runs the bridge with the Electron binary in
//                      ELECTRON_RUN_AS_NODE mode, so no system Node is needed)

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const { configDir } = require('./paths.cts');

// The registered host name. Environment-driven for exactly the same reason
// configDir() is (paths.cts): the DEVELOPMENT registration (#732) is this same
// installer pointed at a different name and a different config dir, and the
// manifest path, the registry key and allowed_origins all have to move together
// or the pair silently half-registers. Native messaging routes on this name, so
// it — not a second extension id — is what keeps a capture made while developing
// out of the real library.
const DEFAULT_HOST_NAME = 'com.hologram.host';
const HOST_NAME = process.env.HOLOGRAM_NATIVE_HOST_NAME || DEFAULT_HOST_NAME;
// The bundle (bridge.cts + its local modules in one file), not the sources —
// built by app/build-native-host-bridge.mjs. See deployBridge().
const BRIDGE_PATH = path.join(__dirname, 'dist', 'bridge.js');
const DEPLOYED_BRIDGE = 'bridge.js';

// Copy the bridge into the (ASCII) config dir and run it from there. The repo
// may live under a non-ASCII path (e.g. Japanese folders); cmd.exe reads .bat
// files in the OEM code page and would mangle a non-ASCII path, so the launcher
// must reference an ASCII location only.
//
// What gets deployed is the BUNDLE: one file with no runtime module resolution
// left. Deploying the raw sources instead meant listing every module bridge.cts
// require()s here, and a module added upstream but missed in that list crashed
// the spawned host on startup ("Error when communicating with the native
// messaging host") with no further hint. One file has no list to fall out of
// sync, and lets the host use npm deps (nothing outside node builtins could be
// copied by hand). Re-run the build, then install, after editing any host source.
function deployBridge(): string {
  if (!fs.existsSync(BRIDGE_PATH)) {
    // Loud and actionable: a missing bundle otherwise surfaces much later as the
    // same opaque Chrome-side error this bundling was meant to retire.
    throw new Error(`native-host bundle not built: ${BRIDGE_PATH}\nRun "npm run build:native-host-bridge" in app/ first.`);
  }
  fs.mkdirSync(configDir(), { recursive: true });
  const destBridge = path.join(configDir(), DEPLOYED_BRIDGE);
  fs.copyFileSync(BRIDGE_PATH, destBridge);
  return destBridge;
}

// Chrome extension ids are exactly 32 chars of a\u2013p. Everything flowing into the
// manifest's allowed_origins (IPC arg, CLI arg, config value) passes this gate;
// invalid ids degrade to null, which writeManifest/updateAllowedOrigin already
// handle (preserve or clear origins \u2014 never emit a malformed origin).
const VALID_EXT_ID = /^[a-p]{32}$/;
function sanitizeExtensionId(id: unknown): string | null {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  return VALID_EXT_ID.test(trimmed) ? trimmed : null;
}

// The unpacked extension's ID (path-derived, shown in chrome://extensions).
// Stored in config.json by the app so we never commit a key to the repo.
function readExtensionId(): string | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
    if (cfg) return sanitizeExtensionId(cfg.extensionId);
  } catch {
    // No config yet.
  }
  return null;
}

function launcherPath(): string {
  return path.join(configDir(), process.platform === 'win32' ? 'hologram-host.bat' : 'hologram-host.sh');
}

function manifestPath(): string {
  return path.join(configDir(), `${HOST_NAME}.json`);
}

// A linked Git worktree has a .git FILE (pointing into the main repository),
// whereas the main working tree has a .git DIRECTORY. Electron lives several
// levels below that marker, so walk upward from the runtime rather than relying
// on a worktree naming convention.
function isLinkedWorktreeRuntime(exe: string): boolean {
  let dir = path.dirname(path.resolve(exe));
  while (true) {
    try {
      if (fs.statSync(path.join(dir, '.git')).isFile()) return true;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

interface PreserveSharedRegistrationArgs {
  exe: string;
  runAsNode: boolean;
  configDirOverride?: string;
}

// A development worktree is intentionally disposable. Persisting its Electron
// path into the user's real launcher makes every browser save fail as soon as
// that worktree is removed. An explicit config override is an isolated test
// environment, so registration there remains allowed.
function shouldPreserveSharedRegistration({ exe, runAsNode, configDirOverride = process.env.HOLOGRAM_CONFIG_DIR }: PreserveSharedRegistrationArgs): boolean {
  return runAsNode && !configDirOverride && isLinkedWorktreeRuntime(exe);
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: \x00-\x7F is the deliberate full-ASCII range check
const isAscii = (s: string): boolean => /^[\x00-\x7F]*$/.test(s);

// cmd.exe reads a .bat in the console's OEM code page, so a launcher that
// references a non-ASCII path (e.g. a repo under C:\…\ローカル\開発\) gets the
// path mangled and the host fails to start with "Error when communicating with
// the native messaging host" — capture silently never works. Point the .bat at
// an ASCII-only directory junction (no admin needed) instead of the raw exe.
function asciiExeRef(exe: string): string {
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

interface WriteLauncherArgs {
  exe: string;
  runAsNode: boolean;
  bridgePath: string;
}

function writeLauncher({ exe, runAsNode, bridgePath }: WriteLauncherArgs): string {
  fs.mkdirSync(configDir(), { recursive: true });
  const p = launcherPath();

  if (process.platform === 'win32') {
    const exeRef = asciiExeRef(exe);
    const lines = ['@echo off'];
    // Chrome spawns this launcher with the browser's environment, not the one
    // the installer ran in, so an isolated installation has to BAKE its config
    // dir in — otherwise the development host would start a bridge that resolves
    // the real ~/.hologram and writes into the real library (#732).
    if (process.env.HOLOGRAM_CONFIG_DIR) lines.push(`set "HOLOGRAM_CONFIG_DIR=${configDir()}"`);
    if (runAsNode) lines.push('set ELECTRON_RUN_AS_NODE=1');
    lines.push(`"${exeRef}" "${bridgePath}" %*`);
    fs.writeFileSync(p, lines.join('\r\n') + '\r\n', 'utf8');
  } else {
    const lines = ['#!/bin/sh'];
    if (process.env.HOLOGRAM_CONFIG_DIR) lines.push(`export HOLOGRAM_CONFIG_DIR="${configDir()}"`);
    if (runAsNode) lines.push('export ELECTRON_RUN_AS_NODE=1');
    lines.push(`exec "${exe}" "${bridgePath}" "$@"`);
    fs.writeFileSync(p, lines.join('\n') + '\n', { mode: 0o755 });
  }
  return p;
}

function writeManifest(launcher: string, extensionId: string | null): string {
  // When no extensionId is known (e.g. the app re-registers on every launch but
  // config has none yet), PRESERVE any existing allowed_origins instead of wiping
  // it to []. An empty allowed_origins silently forbids the extension and breaks
  // every save until the id is re-set — the exact failure this whole episode was.
  // Self-healing: a launch without an id never downgrades a working manifest.
  let allowedOrigins: string[] = extensionId ? [`chrome-extension://${extensionId}/`] : [];
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
    description: 'Hologram native messaging host',
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
function persistExtensionId(id: string | null): void {
  if (!id) return;
  try {
    const p = path.join(configDir(), 'config.json');
    let cfg: Record<string, unknown> = {};
    let raw: string | null = null;
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
function windowsRegistryKeys(): string[] {
  return [`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`, `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`, `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`];
}

function unixManifestDirs(): string[] {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [path.join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts'), path.join(home, 'Library/Application Support/Microsoft Edge/NativeMessagingHosts'), path.join(home, 'Library/Application Support/Chromium/NativeMessagingHosts')];
  }
  return [path.join(home, '.config/google-chrome/NativeMessagingHosts'), path.join(home, '.config/microsoft-edge/NativeMessagingHosts'), path.join(home, '.config/chromium/NativeMessagingHosts')];
}

interface InstallOptions {
  exe?: string;
  runAsNode?: boolean;
  extensionId?: unknown;
}

function install({ exe = process.execPath, runAsNode = false, extensionId }: InstallOptions = {}) {
  if (shouldPreserveSharedRegistration({ exe, runAsNode })) {
    const launcher = launcherPath();
    const manifest = manifestPath();
    if (!fs.existsSync(launcher) || !fs.existsSync(manifest)) {
      throw new Error('Refusing to register the real native messaging host with a disposable Git worktree runtime. Run "node native-host/install.cts" from the main working tree first.');
    }
    return { launcher, manifest, configDir: configDir(), extensionId: readExtensionId(), preserved: true };
  }

  const extId = sanitizeExtensionId(extensionId);
  if (extId) persistExtensionId(extId); // explicit id (CLI/app) → make it durable
  const id = extId || readExtensionId();
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
function updateAllowedOrigin(extensionId: unknown) {
  const extId = sanitizeExtensionId(extensionId);
  const mp = manifestPath();
  let manifest: any;
  try {
    manifest = JSON.parse(fs.readFileSync(mp, 'utf8'));
  } catch {
    return install({ extensionId: extId });
  }
  manifest.allowed_origins = extId ? [`chrome-extension://${extId}/`] : [];
  fs.writeFileSync(mp, JSON.stringify(manifest, null, 2), 'utf8');
  return { manifest: mp, extensionId: extId };
}

function uninstall(): void {
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
  // uninstall. Clearing the stale manifest also matters because app/src/main/index.ts
  // gates registration on existsSync(manifestPath()); a leftover manifest would
  // make a later launch skip re-registering with stale allowed_origins.
  const leftovers = [path.join(configDir(), DEPLOYED_BRIDGE), launcherPath(), manifestPath()];
  for (const f of leftovers) {
    try {
      fs.unlinkSync(f);
    } catch {
      // Not present — fine.
    }
  }
}

// Where deployBridge() puts the bundle. Exported so diagnostics (scripts/self-test)
// check the file the launcher actually runs, not a path they spell out themselves.
function deployedBridgePath(): string {
  return path.join(configDir(), DEPLOYED_BRIDGE);
}

module.exports = {
  install,
  DEFAULT_HOST_NAME,
  uninstall,
  updateAllowedOrigin,
  readExtensionId,
  HOST_NAME,
  BRIDGE_PATH,
  deployedBridgePath,
  launcherPath,
  manifestPath,
  isLinkedWorktreeRuntime,
  shouldPreserveSharedRegistration,
};

if (require.main === module) {
  if (process.argv[2] === 'uninstall') {
    uninstall();
    console.log(`Removed native messaging host "${HOST_NAME}".`);
  } else {
    // Optional: `node install.cts <extensionId>` to set the allowed extension.
    const argId = process.argv[2];
    const result = install(argId ? { extensionId: argId } : {});
    console.log(`Installed native messaging host "${HOST_NAME}".`);
    console.log(`  extensionId: ${result.extensionId || '(not set — set it in the app, then re-register)'}`);
    console.log(`  launcher: ${result.launcher}`);
    console.log(`  manifest: ${result.manifest}`);
    console.log(`  config:   ${path.join(result.configDir, 'config.json')}`);
  }
}
