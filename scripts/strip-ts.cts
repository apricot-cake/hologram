'use strict';
// Type-strip a TypeScript source string to plain JS for the eval-shim unit tests.
//
// A few renderer services (query.ts / search.ts) and i18n.ts are loaded by their tests
// by EXECUTING their source text — either via (0, eval) with a global.window shim (the
// service is a window-IIFE with no CommonJS export) or by extracting a closure-private
// table (i18n's MESSAGES). Now that those files are .ts, the raw source can't be eval'd as
// JS, so strip the type annotations first. Uses Node's built-in stripTypeScriptTypes
// (erase-only, no compiler, preserves line numbers); the one-time ExperimentalWarning it
// emits is silenced so it doesn't clutter the test tail.
const _emit = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  const type = args[0] && typeof args[0] === 'object' ? args[0].type : args[0];
  if (type === 'ExperimentalWarning') return;
  return _emit(warning, ...args);
};
const { stripTypeScriptTypes } = require('node:module');

module.exports = (code) => stripTypeScriptTypes(code, { mode: 'strip' });
