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
//   node scripts/register-dev-native-host.cts            register
//   node scripts/register-dev-native-host.cts uninstall  remove it again
//
// ON THIS MACHINE, RUN IT THROUGH THE SCHEDULED TASK:
//   npm run ext:dev:register
// Native messaging registration is an HKCU write, and a process running inside
// the MSIX-packaged desktop app used to write to a virtualized hive that the real
// Chrome never reads, so the task scheduler was used to get outside that container.
//
// EXPIRED 2026-08-06 (#1003): Claude Code runs outside the package now. An HKCU
// write from this shell lands in the real hive — confirmed by the user in regedit,
// not just by reading it back. So a direct call should work and reading the
// registry back IS meaningful now. The task detour can go; kept until someone
// registers without it and confirms. Tracked separately; not a drive-by removal.
// End-to-end proof is still a capture from the development profile plus
// ~/.hologram-dev/bridge.log.

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

if (process.argv[2] === 'uninstall') {
  installer.uninstall();
  console.log(`Removed development native messaging host "${DEV_HOST_NAME}".`);
} else {
  seedConfig();
  const result = installer.install({ extensionId: EXTENSION_ID });
  console.log(`Installed development native messaging host "${DEV_HOST_NAME}".`);
  console.log(`  extensionId: ${result.extensionId}`);
  console.log(`  launcher:    ${result.launcher}`);
  console.log(`  manifest:    ${result.manifest}`);
  console.log(`  config:      ${path.join(DEV_CONFIG_DIR, 'config.json')}`);
  console.log(`  library:     ${path.join(DEV_CONFIG_DIR, 'library')}`);
}
