'use strict';

// Pure-unit guard for native-host/install.cts. A linked worktree's Electron is
// disposable and must never become the runtime persisted in the user's shared
// Native Messaging launcher. The main worktree and an explicitly isolated
// config directory remain valid registration sources.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isLinkedWorktreeRuntime, shouldPreserveSharedRegistration } = require('../native-host/install.cts');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-host-install-'));
let failed = 0;
const check = (label, value) => {
  if (value) return;
  failed++;
  console.error(`FAIL ${label}`);
};

try {
  const main = path.join(root, 'main');
  const linked = path.join(root, 'linked');
  const packaged = path.join(root, 'installed');
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  fs.mkdirSync(linked, { recursive: true });
  fs.writeFileSync(path.join(linked, '.git'), 'gitdir: ../main/.git/worktrees/linked\n');

  const mainExe = path.join(main, 'app', 'node_modules', 'electron', 'dist', 'electron.exe');
  const linkedExe = path.join(linked, 'app', 'node_modules', 'electron', 'dist', 'electron.exe');
  const packagedExe = path.join(packaged, 'Hologram.exe');

  check('main working tree is not disposable', !isLinkedWorktreeRuntime(mainExe));
  check('linked worktree is detected from its .git file', isLinkedWorktreeRuntime(linkedExe));
  check('packaged runtime outside Git is not disposable', !isLinkedWorktreeRuntime(packagedExe));
  check('shared registration is protected from linked-worktree Electron', shouldPreserveSharedRegistration({ exe: linkedExe, runAsNode: true, configDirOverride: '' }));
  check('explicitly isolated config remains writable from a linked worktree', !shouldPreserveSharedRegistration({ exe: linkedExe, runAsNode: true, configDirOverride: path.join(root, 'sandbox') }));
  check('plain Node CLI registration remains allowed', !shouldPreserveSharedRegistration({ exe: linkedExe, runAsNode: false }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log('PASS test-native-host-install: linked-worktree registration guard');
