'use strict';

// Registers (or removes) the Post Snap native messaging host so Chrome/Edge
// can launch the bridge.
//
// Used two ways:
//   - dev CLI:        node native-host/install.js  [uninstall]
//                     (launcher runs the bridge with this Node binary)
//   - Electron app:   require('.../native-host/install').install({ exe, runAsNode:true })
//                     (launcher runs the bridge with the Electron binary in
//                      ELECTRON_RUN_AS_NODE mode, so no system Node is needed)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const { configDir } = require('./paths');

const HOST_NAME = 'com.postsnap.host';
const BRIDGE_PATH = path.join(__dirname, 'bridge.js');
const PATHS_PATH = path.join(__dirname, 'paths.js');

// Copy the bridge into the (ASCII) config dir and run it from there. The repo
// may live under a non-ASCII path (e.g. Japanese folders); cmd.exe reads .bat
// files in the OEM code page and would mangle a non-ASCII path, so the launcher
// must reference an ASCII location only. Re-run install after editing bridge.js.
function deployBridge() {
  fs.mkdirSync(configDir(), { recursive: true });
  const destBridge = path.join(configDir(), 'bridge.js');
  fs.copyFileSync(BRIDGE_PATH, destBridge);
  fs.copyFileSync(PATHS_PATH, path.join(configDir(), 'paths.js'));
  return destBridge;
}

// The unpacked extension's ID (path-derived, shown in chrome://extensions).
// Stored in config.json by the app so we never commit a key to the repo.
function readExtensionId() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg && typeof cfg.extensionId === 'string' && cfg.extensionId.trim()) {
      return cfg.extensionId.trim();
    }
  } catch {
    // No config yet.
  }
  return null;
}

function launcherPath() {
  return path.join(configDir(), process.platform === 'win32' ? 'post-snap-host.bat' : 'post-snap-host.sh');
}

function manifestPath() {
  return path.join(configDir(), `${HOST_NAME}.json`);
}

function writeLauncher({ exe, runAsNode, bridgePath }) {
  fs.mkdirSync(configDir(), { recursive: true });
  const p = launcherPath();

  if (process.platform === 'win32') {
    const lines = ['@echo off'];
    if (runAsNode) lines.push('set ELECTRON_RUN_AS_NODE=1');
    lines.push(`"${exe}" "${bridgePath}" %*`);
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
  const manifest = {
    name: HOST_NAME,
    description: 'Post Snap native messaging host',
    path: launcher,
    type: 'stdio',
    allowed_origins: extensionId ? [`chrome-extension://${extensionId}/`] : []
  };
  const p = manifestPath();
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2), 'utf8');
  return p;
}

// Browsers that read native messaging host manifests.
function windowsRegistryKeys() {
  return [
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
    `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
    `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`
  ];
}

function unixManifestDirs() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
      path.join(home, 'Library/Application Support/Microsoft Edge/NativeMessagingHosts'),
      path.join(home, 'Library/Application Support/Chromium/NativeMessagingHosts')
    ];
  }
  return [
    path.join(home, '.config/google-chrome/NativeMessagingHosts'),
    path.join(home, '.config/microsoft-edge/NativeMessagingHosts'),
    path.join(home, '.config/chromium/NativeMessagingHosts')
  ];
}

function install({ exe = process.execPath, runAsNode = false, extensionId } = {}) {
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

  for (const f of ['bridge.js', 'paths.js']) {
    try {
      fs.unlinkSync(path.join(configDir(), f));
    } catch {
      // Not present — fine.
    }
  }
}

module.exports = { install, uninstall, readExtensionId, HOST_NAME, BRIDGE_PATH, launcherPath, manifestPath };

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
