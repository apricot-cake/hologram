'use strict';

// Unit tests for the save-folder cloud-sync detection (app/save-folder-guard.mts, #95).
// Pure logic → no Electron needed. The detection only drives a WARNING, so the bar is:
// catch the default install layouts, and stay quiet on ordinary folders.
//
//   node scripts/test-save-folder-guard.cts

const assert = require('node:assert');
const path = require('node:path');
const { cloudSyncProviderOf } = require('../app/save-folder-guard.mts');

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log('  ok  ' + name);
}

// Build platform-native paths so the test is meaningful on win32 and posix alike.
const home = path.resolve(path.sep === '\\' ? 'C:\\Users\\alice' : '/home/alice');
const at = (...seg) => path.join(home, ...seg);
const NO_ENV = {};

// --- detected providers ------------------------------------------------------

check('OneDrive personal (default layout)', () => {
  assert.strictEqual(cloudSyncProviderOf(at('OneDrive', 'Hologram-library'), NO_ENV), 'OneDrive');
});

check('OneDrive work/school (OneDrive - Tenant)', () => {
  assert.strictEqual(cloudSyncProviderOf(at('OneDrive - Contoso Ltd', 'pics'), NO_ENV), 'OneDrive');
});

check('Dropbox, plain and suffixed', () => {
  assert.strictEqual(cloudSyncProviderOf(at('Dropbox', 'Hologram-library'), NO_ENV), 'Dropbox');
  assert.strictEqual(cloudSyncProviderOf(at('Dropbox (Personal)', 'lib'), NO_ENV), 'Dropbox');
});

check('Google Drive incl. the My Drive mount', () => {
  assert.strictEqual(cloudSyncProviderOf(at('Google Drive', 'lib'), NO_ENV), 'Google Drive');
  assert.strictEqual(cloudSyncProviderOf(at('Google Drive', 'My Drive', 'lib'), NO_ENV), 'Google Drive');
});

check('iCloud Drive', () => {
  assert.strictEqual(cloudSyncProviderOf(at('iCloudDrive', 'lib'), NO_ENV), 'iCloud Drive');
});

check('Nextcloud / ownCloud', () => {
  assert.strictEqual(cloudSyncProviderOf(at('Nextcloud', 'lib'), NO_ENV), 'Nextcloud');
  assert.strictEqual(cloudSyncProviderOf(at('ownCloud', 'lib'), NO_ENV), 'ownCloud');
});

check('match is case-insensitive', () => {
  assert.strictEqual(cloudSyncProviderOf(at('ONEDRIVE', 'lib'), NO_ENV), 'OneDrive');
  assert.strictEqual(cloudSyncProviderOf(at('dropbox', 'lib'), NO_ENV), 'Dropbox');
});

check('a sync root anywhere up the path counts (not just the leaf)', () => {
  assert.strictEqual(cloudSyncProviderOf(at('Dropbox', 'a', 'b', 'c', 'Hologram-library'), NO_ENV), 'Dropbox');
});

// --- env-var detection (a renamed OneDrive folder still exports %OneDrive%) ---

check('env root matches even when the folder name gives nothing away', () => {
  const root = at('CloudStuff');
  assert.strictEqual(cloudSyncProviderOf(path.join(root, 'lib'), { OneDrive: root }), 'OneDrive');
});

check('env root matches the root itself', () => {
  const root = at('CloudStuff');
  assert.strictEqual(cloudSyncProviderOf(root, { OneDrive: root }), 'OneDrive');
});

check('env var pointing elsewhere does not match', () => {
  assert.strictEqual(cloudSyncProviderOf(at('Hologram', 'library'), { OneDrive: at('CloudStuff') }), null);
});

check('empty/blank env var is ignored (no match on garbage)', () => {
  assert.strictEqual(cloudSyncProviderOf(at('Hologram', 'library'), { OneDrive: '' }), null);
  assert.strictEqual(cloudSyncProviderOf(at('Hologram', 'library'), { OneDrive: '   ' }), null);
});

// --- quiet on ordinary folders (false positives are the cost here) -----------

check('the default library location is quiet', () => {
  assert.strictEqual(cloudSyncProviderOf(at('Hologram', 'library'), NO_ENV), null);
});

check('substring lookalikes do NOT trip it (segment match, not substring)', () => {
  assert.strictEqual(cloudSyncProviderOf(at('Projects', 'dropbox-clone', 'lib'), NO_ENV), null);
  assert.strictEqual(cloudSyncProviderOf(at('my-onedrive-backup', 'lib'), NO_ENV), null);
  assert.strictEqual(cloudSyncProviderOf(at('Pictures', 'GoogleDriveExports'), NO_ENV), null);
});

check('bare generic names stay quiet (Box / Sync / Mega are ordinary folder names)', () => {
  assert.strictEqual(cloudSyncProviderOf(at('Box', 'lib'), NO_ENV), null);
  assert.strictEqual(cloudSyncProviderOf(at('Sync', 'lib'), NO_ENV), null);
  assert.strictEqual(cloudSyncProviderOf(at('Mega', 'lib'), NO_ENV), null);
  // ...but their qualified forms are real sync roots.
  assert.strictEqual(cloudSyncProviderOf(at('Box Sync', 'lib'), NO_ENV), 'Box');
  assert.strictEqual(cloudSyncProviderOf(at('MEGAsync', 'lib'), NO_ENV), 'MEGA');
});

// --- degenerate input --------------------------------------------------------

check('empty / non-string input is null, never a throw', () => {
  assert.strictEqual(cloudSyncProviderOf('', NO_ENV), null);
  assert.strictEqual(cloudSyncProviderOf('   ', NO_ENV), null);
  assert.strictEqual(cloudSyncProviderOf(null, NO_ENV), null);
  assert.strictEqual(cloudSyncProviderOf(undefined, NO_ENV), null);
  assert.strictEqual(cloudSyncProviderOf(42, NO_ENV), null);
});

console.log(`\nSAVE_FOLDER_GUARD_PASS (${pass} checks)`);
