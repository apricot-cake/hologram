'use strict';

// Unit tests for the shared library-file boundary (app/library-files.mts, #132):
// the bare-basename gate every window/shell IPC handler runs its input through,
// and the batch path resolution behind drag-out. Pure logic → no Electron needed.
// The stakes are the two failure modes the design called out: a name that escapes
// the save folder must never reach the OS, and a missing path must never reach
// startDrag (Windows aborts the WHOLE drag when one path doesn't resolve).
//
//   node scripts/test-library-files.cts

const assert = require('node:assert');
const path = require('node:path');
const { isLibraryFileName, libraryFilePaths } = require('../app/src/main/library-files.ts');

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log('  ok  ' + name);
}

const save = path.resolve(path.sep === '\\' ? 'C:\\Hologram\\library' : '/home/alice/Hologram/library');
const at = (f) => path.join(save, f);

// --- isLibraryFileName: the gate ---
check('accepts a plain sidecar image name', () => {
  assert.strictEqual(isLibraryFileName('abc123.jpg'), true);
  assert.strictEqual(isLibraryFileName('dummy-x_1.png'), true);
});
check('rejects traversal', () => {
  assert.strictEqual(isLibraryFileName('../config.json'), false);
  assert.strictEqual(isLibraryFileName('a/../../b.jpg'), false);
  assert.strictEqual(isLibraryFileName('..'), false);
});
check('rejects any separator (posix AND windows, on every platform)', () => {
  assert.strictEqual(isLibraryFileName('sub/a.jpg'), false);
  assert.strictEqual(isLibraryFileName('sub\\a.jpg'), false);
  assert.strictEqual(isLibraryFileName('C:\\Windows\\system32\\calc.exe'), false);
  assert.strictEqual(isLibraryFileName('/etc/passwd'), false);
});
check('rejects non-strings and empties', () => {
  for (const v of ['', null, undefined, 0, 42, {}, [], true]) assert.strictEqual(isLibraryFileName(v), false, String(v));
});

// --- libraryFilePaths: batch resolution for drag-out ---
const existsAll = () => true;
check('resolves names against the save folder', () => {
  assert.deepStrictEqual(libraryFilePaths(['a.jpg', 'b.png'], save, existsAll), [at('a.jpg'), at('b.png')]);
});
check('drops names the gate rejects, keeps the rest', () => {
  assert.deepStrictEqual(libraryFilePaths(['a.jpg', '../secret.json', 'sub/b.png', 'c.webp'], save, existsAll), [at('a.jpg'), at('c.webp')]);
});
check('drops files that are gone (a deleted sibling must not abort the drag)', () => {
  const exists = (p) => p !== at('gone.jpg');
  assert.deepStrictEqual(libraryFilePaths(['a.jpg', 'gone.jpg', 'b.jpg'], save, exists), [at('a.jpg'), at('b.jpg')]);
});
check('all-missing resolves to empty (caller no-ops instead of calling startDrag)', () => {
  assert.deepStrictEqual(
    libraryFilePaths(['gone.jpg'], save, () => false),
    [],
  );
});
check('de-duplicates: one file listed twice is dragged once', () => {
  assert.deepStrictEqual(libraryFilePaths(['a.jpg', 'a.jpg', 'b.jpg'], save, existsAll), [at('a.jpg'), at('b.jpg')]);
});
check('non-array input resolves to empty (renderer sent junk)', () => {
  for (const v of [null, undefined, 'a.jpg', 42, {}]) assert.deepStrictEqual(libraryFilePaths(v, save, existsAll), []);
});
check('preserves the order the renderer sent (drop target ordering follows selection)', () => {
  assert.deepStrictEqual(libraryFilePaths(['z.jpg', 'a.jpg'], save, existsAll), [at('z.jpg'), at('a.jpg')]);
});

console.log(`\nall library-files unit tests passed (${pass})`);
