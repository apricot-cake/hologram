'use strict';

// Seed a sandbox library for the app harnesses: media files in the save folder,
// records in the database the app will open.
//
// The app reads posts from SQLite (#5) and, since #302, never scans the save
// folder — so writing per-post JSON there seeds nothing. Records go through the
// same writePost every real producer uses, which keeps a harness fixture from
// drifting away from the shape the app actually stores.
//
// Stamping truthSource='db' is what tells the app this library needs no legacy
// migration (lib-legacy-import.ts). A harness that deliberately exercises that
// migration should seed the old on-disk format instead and NOT call this.
//
//   const { seedLibrary } = require('./lib-seed-library.cts');
//   seedLibrary(configDir, [{ captureId: 'a1', image: 'a1.jpg', ... }]);

const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
const { makeTagResolver, preparePostStmts, writePost } = require(path.join(appDir, 'src', 'main', 'lib-db-record-writer.ts'));

// Returns the open handle so a caller can keep seeding (folders, tag types) with
// createDbWriter before closing it. Pass `close: false` to keep it open.
function seedLibrary(configDir: string, records: any[], opts: { close?: boolean } = {}) {
  const handle = openDatabase(path.join(configDir, 'hologram.db'));
  const stmts = preparePostStmts(handle.sqlite);
  const resolveTagId = makeTagResolver(handle.sqlite);
  for (const rec of records) writePost(stmts, resolveTagId, rec);
  handle.sqlite.prepare("INSERT INTO store_state (key, value) VALUES ('truthSource', 'db') ON CONFLICT(key) DO UPDATE SET value = 'db'").run();
  if (opts.close !== false) handle.sqlite.close();
  return handle;
}

module.exports = { seedLibrary };
