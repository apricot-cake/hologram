'use strict';

// Unit tests for save-folder recovery + destructive-op gating
// (native-host/config-recovery.js), added after the 2026-06-23 library-loss
// incident. Pure logic → no Electron needed.
//
//   node scripts/test-config-recovery.js

const assert = require('node:assert');
const { resolveSaveFolder, clearAllBlockReason } = require('../native-host/config-recovery');

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log('  ok  ' + name);
}

const DEFAULT = 'C:/default/lib';

// --- resolveSaveFolder --------------------------------------------------------

check('explicit config folder wins', () => {
  const r = resolveSaveFolder({ configSaveFolder: 'D:/mine', pointer: 'E:/old', pointerExists: true, defaultDir: DEFAULT });
  assert.deepStrictEqual(r, { folder: 'D:/mine', source: 'config' });
});

check('lost config recovers from pointer when it exists', () => {
  const r = resolveSaveFolder({ configSaveFolder: undefined, pointer: 'E:/lib', pointerExists: true, defaultDir: DEFAULT });
  assert.deepStrictEqual(r, { folder: 'E:/lib', source: 'pointer' });
});

check('pointer ignored when its directory is gone', () => {
  const r = resolveSaveFolder({ configSaveFolder: '', pointer: 'E:/lib', pointerExists: false, defaultDir: DEFAULT });
  assert.deepStrictEqual(r, { folder: DEFAULT, source: 'default' });
});

check('fresh install (no config, no pointer) → default', () => {
  const r = resolveSaveFolder({ configSaveFolder: null, pointer: null, pointerExists: false, defaultDir: DEFAULT });
  assert.deepStrictEqual(r, { folder: DEFAULT, source: 'default' });
});

check('whitespace-only config folder is treated as empty', () => {
  const r = resolveSaveFolder({ configSaveFolder: '   ', pointer: 'E:/lib', pointerExists: true, defaultDir: DEFAULT });
  assert.strictEqual(r.source, 'pointer');
});

// --- clearAllBlockReason ------------------------------------------------------

check('healthy explicit folder allows clear-all', () => {
  assert.strictEqual(clearAllBlockReason({ configCorrupt: false, hasExplicitSaveFolder: true, hasPointer: true }), null);
});

check('corrupt config blocks clear-all', () => {
  assert.strictEqual(clearAllBlockReason({ configCorrupt: true, hasExplicitSaveFolder: false, hasPointer: true }), 'corrupt');
});

check('lost saveFolder (pointer proves one existed) blocks clear-all', () => {
  assert.strictEqual(clearAllBlockReason({ configCorrupt: false, hasExplicitSaveFolder: false, hasPointer: true }), 'lost');
});

check('fresh install (no folder, no pointer) allows clear-all', () => {
  assert.strictEqual(clearAllBlockReason({ configCorrupt: false, hasExplicitSaveFolder: false, hasPointer: false }), null);
});

check('corruption takes precedence over an explicit folder', () => {
  assert.strictEqual(clearAllBlockReason({ configCorrupt: true, hasExplicitSaveFolder: true, hasPointer: true }), 'corrupt');
});

console.log(`\nRECOVERY_TEST_PASS (${pass} checks)`);
