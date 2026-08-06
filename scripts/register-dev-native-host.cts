'use strict';

// Registers the DEVELOPMENT native messaging host (#732).
//
// WHAT IT BUYS. The development Chrome profile runs the same extension id as the
// daily one — the signing key is fixed, deliberately. Isolation therefore cannot
// come from the id; it comes from the HOST NAME. Development builds ask for
// `com.hologram.host.dev` (extension/utils/native-host.ts), which resolves to
// this registration, whose launcher pins HOLOGRAM_CONFIG_DIR at ~/.hologram-dev.
// Everything downstream — config.json, the library, bridge.log, capture.log —
// follows that one path, so a capture made while developing cannot land in the
// real library even if it tries.
//
//   npm run ext:dev:register                             register
//   npm run ext:dev:register -- uninstall                remove it again
//   node scripts/register-dev-native-host.cts [uninstall]  same thing, no npm
//
// Registration is an HKCU write, and this used to be routed through a one-shot
// scheduled task to escape the MSIX container the packaged desktop app put its
// children in: a write from inside went to a per-package hive that the real
// Chrome never reads, so the registration looked successful and did nothing.
// That reason expired 2026-08-06 (#1003) — this shell writes the real hive, so
// the detour is gone (#1006) and, for the same reason, reading the keys back
// here now means something. It is what the registry report below does.
//
// A green report still only proves Chrome will FIND the host. End-to-end proof
// is a capture from the development profile plus ~/.hologram-dev/bridge.log.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The one extension id, shared by development and release builds (the signing
// key in extension/wxt.config.ts). Spelled out rather than derived, so the
// registration fails loudly if the key ever changes underneath it.
const EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh';
const DEV_HOST_NAME = 'com.hologram.host.dev';
const DEV_CONFIG_DIR = process.env.HOLOGRAM_DEV_CONFIG_DIR || path.join(os.homedir(), '.hologram-dev');

// Set BEFORE requiring the installer: both the host name and the config dir are
// read at module load, exactly like paths.cts reads HOLOGRAM_CONFIG_DIR.
process.env.HOLOGRAM_CONFIG_DIR = DEV_CONFIG_DIR;
process.env.HOLOGRAM_NATIVE_HOST_NAME = DEV_HOST_NAME;

const installer = require('../native-host/install.cts');

function seedConfig(): void {
  fs.mkdirSync(DEV_CONFIG_DIR, { recursive: true });
  const library = path.join(DEV_CONFIG_DIR, 'library');
  fs.mkdirSync(library, { recursive: true });
  const file = path.join(DEV_CONFIG_DIR, 'config.json');
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) || {};
  } catch {
    /* fresh sandbox */
  }
  // Written BEFORE registering: an unconfigured bridge falls back to the real
  // default library dir, which is the one outcome this whole file exists to stop.
  if (config.saveFolder !== library) {
    config.saveFolder = library;
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  }
}

// The default value of one NativeMessagingHosts key, or null if the key is not
// there. Native messaging resolves a host name through exactly these keys, and
// a missing or stale one surfaces on the browser side as "Specified native
// messaging host not found" — with nothing on this side to say why.
function registeredManifest(key: string): string | null {
  try {
    // `reg` rather than PowerShell: this runs on every registration, and
    // starting a shell costs more than the whole install does. The value is a
    // path (ASCII by construction — configDir is), so decoding the surrounding
    // console output as utf8 cannot corrupt the part being read.
    const out = execFileSync('reg', ['query', key, '/ve'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return /REG_SZ\s+(.+)/.exec(out)?.[1].trim() ?? null;
  } catch {
    return null; // key absent — `reg query` exits non-zero
  }
}

// Read back what was just written and print it. `expected` is the manifest path
// every key should carry, or null when the keys are supposed to be gone.
function reportRegistry(expected: string | null): void {
  if (process.platform !== 'win32') return;
  const rows = installer.windowsRegistryKeys().map((key: string) => {
    const value = registeredManifest(key);
    if (expected === null) return { key, ok: value === null, state: value === null ? 'removed' : `STILL PRESENT → ${value}` };
    if (value === null) return { key, ok: false, state: 'MISSING' };
    return { key, ok: value === expected, state: value === expected ? 'ok' : `points elsewhere → ${value}` };
  });
  console.log('  registry (HKCU, read back):');
  for (const row of rows) console.log(`    ${row.state.padEnd(9)} ${row.key}`);
  if (rows.some((row: { ok: boolean }) => !row.ok)) {
    console.error('Registry does not match what was written. Chrome resolves the host name through these keys, so saving from the development profile will fail.');
    process.exitCode = 1;
  }
}

if (process.argv[2] === 'uninstall') {
  installer.uninstall();
  console.log(`Removed development native messaging host "${DEV_HOST_NAME}".`);
  reportRegistry(null);
} else {
  seedConfig();
  const result = installer.install({ extensionId: EXTENSION_ID });
  console.log(`Installed development native messaging host "${DEV_HOST_NAME}".`);
  console.log(`  extensionId: ${result.extensionId}`);
  console.log(`  launcher:    ${result.launcher}`);
  console.log(`  manifest:    ${result.manifest}`);
  console.log(`  config:      ${path.join(DEV_CONFIG_DIR, 'config.json')}`);
  console.log(`  library:     ${path.join(DEV_CONFIG_DIR, 'library')}`);
  reportRegistry(result.manifest);
  console.log('  end-to-end: capture from the development profile, then read ~/.hologram-dev/bridge.log.');
}
