'use strict';

// Seed a sandbox library for the app harnesses: media files in the save folder,
// records in the database the app will open.
//
// The app reads posts from SQLite (#5) and, since #302, never scans the save
// folder — so writing per-post JSON there seeds nothing. Records go through the
// same writePost + fillCardDims pair every real producer uses (the inbox
// consumer, the importers, orphan recovery), which keeps a harness fixture from
// drifting away from the shape the app actually stores. The save folder is read
// out of the config the harness has already written, so a caller never has to
// name it twice.
//
//   const { seedLibrary } = require('./lib-seed-library.cts');
//   seedLibrary(configDir, [{ captureId: 'a1', image: 'a1.jpg', ... }]);

const fs = require('node:fs');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
const { makeTagResolver, preparePostStmts, writePost } = require(path.join(appDir, 'src', 'main', 'lib-db-record-writer.ts'));
const { fillCardDims } = require(path.join(appDir, 'src', 'main', 'lib-card-dims.ts'));
const { fillMediaDims } = require(path.join(appDir, 'src', 'main', 'lib-media-dims.ts'));

function saveFolderOf(configDir: string): string | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
    return typeof cfg.saveFolder === 'string' && cfg.saveFolder ? cfg.saveFolder : null;
  } catch {
    return null; // no config yet — records are written unmeasured
  }
}

// Returns the open handle so a caller can keep seeding (folders, tag types) with
// createDbWriter before closing it. Pass `close: false` to keep it open.
//
// #176: hologram.db lives INSIDE the save folder now, not configDir (ADR 0024)
// — the app's own dbFile() resolves off config.saveFolder, so a harness that
// wrote to configDir/hologram.db here would seed a file the app never opens.
// Callers must therefore write config.json (with an explicit saveFolder) BEFORE
// calling this — every existing harness already does, for the media files.
function seedLibrary(configDir: string, records: any[], opts: { close?: boolean } = {}) {
  const saveFolder = saveFolderOf(configDir);
  if (!saveFolder) throw new Error('seedLibrary: config.json has no saveFolder yet — write it first (the harness needs a folder to put hologram.db in)');
  const handle = openDatabase(path.join(saveFolder, 'hologram.db'));
  const stmts = preparePostStmts(handle.sqlite);
  const resolveTagId = makeTagResolver(handle.sqlite);
  for (const rec of records) writePost(stmts, resolveTagId, fillMediaDims(saveFolder, fillCardDims(saveFolder, rec)));
  if (opts.close !== false) handle.sqlite.close();
  return handle;
}

module.exports = { seedLibrary };
