'use strict';

// A disposable Native Messaging registration for browser E2E tests. The host
// name, config, library, and registry/manifest entry are all test-only, so a
// capture cannot reach the user's installed host or personal library.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const BRIDGE_SOURCE = path.join(ROOT, 'native-host', 'bridge.cts');

function registerNativeHost(hostName: string, manifestPath: string): () => void {
  if (process.platform === 'win32') {
    const key = `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${hostName}`;
    execFileSync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], { stdio: 'ignore' });
    return () => {
      try {
        execFileSync('reg', ['delete', key, '/f'], { stdio: 'ignore' });
      } catch {
        /* already removed */
      }
    };
  }

  const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts') : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'chromium', 'NativeMessagingHosts');
  fs.mkdirSync(base, { recursive: true });
  const registeredManifest = path.join(base, `${hostName}.json`);
  fs.copyFileSync(manifestPath, registeredManifest);
  return () => {
    try {
      fs.unlinkSync(registeredManifest);
    } catch {
      /* already removed */
    }
  };
}

interface NativeHostSandbox {
  root: string;
  hostName: string;
  configDir: string;
  libraryDir: string;
  close(): void;
}

function createNativeHostSandbox(extensionId: string): NativeHostSandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-native-host-e2e-'));
  const suffix = crypto.randomBytes(4).toString('hex');
  const hostName = `com.hologram.host.e2e_${process.pid}_${suffix}`;
  const configDir = path.join(root, 'config');
  const libraryDir = path.join(root, 'library');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(libraryDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: libraryDir }, null, 2), 'utf8');

  const launcherPath = path.join(root, process.platform === 'win32' ? 'hologram-e2e-host.cmd' : 'hologram-e2e-host.sh');
  if (process.platform === 'win32') {
    fs.writeFileSync(launcherPath, ['@echo off', `set "HOLOGRAM_CONFIG_DIR=${configDir}"`, `"${process.execPath}" "${BRIDGE_SOURCE}" %*`, ''].join('\r\n'), 'utf8');
  } else {
    fs.writeFileSync(launcherPath, ['#!/bin/sh', `export HOLOGRAM_CONFIG_DIR="${configDir}"`, `exec "${process.execPath}" "${BRIDGE_SOURCE}" "$@"`, ''].join('\n'), { encoding: 'utf8', mode: 0o755 });
  }

  const manifestPath = path.join(root, `${hostName}.json`);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        name: hostName,
        description: 'Hologram E2E native messaging host',
        path: launcherPath,
        type: 'stdio',
        allowed_origins: [`chrome-extension://${extensionId}/`],
      },
      null,
      2,
    ),
    'utf8',
  );

  let unregister: (() => void) | null = null;
  try {
    unregister = registerNativeHost(hostName, manifestPath);
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }

  const cleanup = () => {
    unregister?.();
    unregister = null;
    fs.rmSync(root, { recursive: true, force: true });
  };
  process.once('exit', cleanup);

  return {
    root,
    hostName,
    configDir,
    libraryDir,
    close() {
      process.off('exit', cleanup);
      cleanup();
    },
  };
}

module.exports = { createNativeHostSandbox };
