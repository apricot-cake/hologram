import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { openDatabase } from './lib-db';
import { prepareZipIntoEmptyDatabase, mergeFolders, mergeUngrouped, mergeManualGroups, mergePosterFolders, mergePosterTags, mergePosterProfiles, mergeTagGroups, toSidecarJson } from './lib-archive';
import { postsByIdsSync, postCapturedVia } from './lib-db-query';
import { createDbWriter } from './lib-db-write';
import { preparePostStmts, makeTagResolver, writePost } from './lib-db-record-writer';
import { exportTagClassification, importClassifiedTagVocabulary } from './lib-tag-classification';
import { createArchiveFilePublisher } from './archive-file-publisher';
import { fillCardDims } from './lib-card-dims';
import { fillMediaDimsAsync, MediaMeasurementCache } from './lib-media-dims';

export async function prepareArchiveImport(zipPath: string, stage: string) {
  await fs.promises.mkdir(path.join(stage, 'library'), { recursive: true });
  const db = openDatabase(path.join(stage, 'prepared.sqlite')).sqlite;
  try {
    const result = await prepareZipIntoEmptyDatabase(db, zipPath, path.join(stage, 'library'));
    await fs.promises.writeFile(path.join(stage, 'prepared-stats.json'), JSON.stringify({ skipped: result.skipped }));
    return result;
  } finally {
    db.close();
  }
}

// 宛先と同じ volume の私有 tmp を、置換を許さない rename で公開する。
// NativeHost が直前に公開した既存名も保持する。
export async function publishArchiveFile(source: string, destination: string, publish: (source: string, target: string) => Promise<boolean>, recordTmp: (tmp: string) => void = () => {}): Promise<boolean> {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const tmp = path.join(path.dirname(destination), `.hologram-import-${randomUUID()}.tmp`);
  recordTmp(tmp);
  try {
    await fs.promises.copyFile(source, tmp, fs.constants.COPYFILE_EXCL);
    return await publish(tmp, destination);
  } finally {
    await fs.promises.rm(tmp, { force: true });
  }
}

export async function applyArchiveImport(sqlite: Database.Database, stage: string, destination: string, progress: () => void = () => {}, executable = process.env.HOLOGRAM_ARCHIVE_PUBLISHER ?? path.resolve('app/vendor/avif/avif-validator.exe')) {
  const prepared = openDatabase(path.join(stage, 'prepared.sqlite')).sqlite;
  const publisher = createArchiveFilePublisher(executable);
  try {
    prepared.exec('CREATE TABLE IF NOT EXISTS media_publications (tmp TEXT PRIMARY KEY)');
    const journal = prepared.prepare('INSERT INTO media_publications(tmp) VALUES(?)');
    let imported = 0,
      skipped = JSON.parse(await fs.promises.readFile(path.join(stage, 'prepared-stats.json'), 'utf8')).skipped as number;
    const copy = async (relative: string) => {
      if (await publishArchiveFile(path.join(stage, 'library', relative), path.join(destination, relative), publisher.publish, (tmp) => journal.run(tmp))) imported++;
      else skipped++;
      progress();
    };
    const walk = async (relative: string, depth: number) => {
      const dir = path.join(stage, 'library', relative);
      await fs.promises.mkdir(path.join(destination, relative), { recursive: true });
      for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isFile()) await copy(name);
        else if (entry.isDirectory() && depth < 2) await walk(name, depth + 1);
      }
    };
    await walk('', 0);
    const stagedStmts = preparePostStmts(prepared),
      stagedTags = makeTagResolver(prepared),
      stagedWriter = createDbWriter(prepared);
    const measurements = new MediaMeasurementCache();
    // 同名媒体の skip も反映した宛先を測る。共有 DB の transaction へ await を持ち込まない。
    const nextPost = prepared.prepare('SELECT captureId FROM posts WHERE isContext=0 AND (? IS NULL OR captureId>?) ORDER BY captureId LIMIT 1');
    let cursor: string | null = null;
    for (;;) {
      const row = nextPost.get(cursor, cursor) as { captureId: string } | undefined;
      if (!row) break;
      cursor = row.captureId;
      const view = postsByIdsSync(prepared, [row.captureId])[0];
      const rec = { ...toSidecarJson(view, postCapturedVia(prepared, [row.captureId]).get(row.captureId) ?? null), replaces: null, tagClassification: exportTagClassification(prepared, row.captureId) };
      writePost(stagedStmts, stagedTags, await fillMediaDimsAsync(destination, fillCardDims(destination, rec), measurements));
      stagedWriter.restorePostFlags(row.captureId, rec);
      progress();
    }
    sqlite.transaction(() => {
      const stmts = preparePostStmts(sqlite),
        tags = makeTagResolver(sqlite),
        target = createDbWriter(sqlite),
        source = createDbWriter(prepared);
      const org = prepared.prepare('SELECT json FROM archive_org WHERE name=?');
      const incoming = (name: string, fallback: () => unknown) => {
        const row = org.get(name) as { json: string } | undefined;
        return row ? JSON.parse(row.json) : fallback();
      };
      const exists = sqlite.prepare('SELECT 1 FROM posts WHERE captureId=?');
      importClassifiedTagVocabulary(sqlite, prepared.prepare("SELECT t.name,t.category,w.name AS workName FROM tags t LEFT JOIN tags w ON w.id=t.workId WHERE t.category!='general'").all() as Array<{ name: string; category: 'character' | 'work'; workName: string | null }>);
      for (const row of prepared.prepare('SELECT captureId FROM posts WHERE isContext=0').iterate() as Iterable<{ captureId: string }>) {
        if (exists.get(row.captureId)) {
          skipped++;
          continue;
        }
        const view = postsByIdsSync(prepared, [row.captureId])[0];
        const rec = { ...toSidecarJson(view, postCapturedVia(prepared, [row.captureId]).get(row.captureId) ?? null), replaces: null, tagClassification: exportTagClassification(prepared, row.captureId) };
        writePost(stmts, tags, rec);
        target.restorePostFlags(row.captureId, rec);
        imported++;
        progress();
      }
      target.setFolders(mergeFolders(target.getFolders(), incoming('folders', source.getFolders)));
      target.setUngrouped(mergeUngrouped(target.getUngrouped(), incoming('ungrouped', source.getUngrouped)).keys);
      target.setManualGroups(mergeManualGroups(target.getManualGroups(), incoming('manual-groups', source.getManualGroups)).groups);
      target.setPosterFolders(mergePosterFolders(target.getPosterFolders(), incoming('poster-folders', source.getPosterFolders)));
      target.setPosterTags(mergePosterTags(target.getPosterTagNames(), incoming('poster-tags', source.getPosterTagNames)));
      target.setPosterProfiles(mergePosterProfiles(target.getPosterProfiles(), incoming('poster-profiles', source.getPosterProfiles)));
      const groups = mergeTagGroups(target.getTagGroupNames(), incoming('tag-groups', source.getTagGroupNames));
      target.fillTagGroupsByName(groups.memberships, groups.labels ?? null);
    })();
    return { ok: true as const, notComplete: false as const, imported, skipped };
  } finally {
    prepared.close();
    await publisher.close();
  }
}

export async function cleanupArchiveImport(stage: string, destination: string) {
  if (!fs.existsSync(path.join(stage, 'prepared.sqlite'))) return;
  const db = openDatabase(path.join(stage, 'prepared.sqlite'), { readonly: true }).sqlite;
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='media_publications'").get()) return;
    for (const row of db.prepare('SELECT tmp FROM media_publications').iterate() as Iterable<{ tmp: string }>) {
      const file = path.resolve(row.tmp);
      if (!file.startsWith(path.resolve(destination) + path.sep) || !/^\.hologram-import-[0-9a-f-]{36}\.tmp$/.test(path.basename(file))) throw new Error('invalid-import-cleanup-owner');
      await fs.promises.rm(file, { force: true });
    }
  } finally {
    db.close();
  }
}

// Electron 非依存テストも実製品と同じ prepare / apply を通す。
export async function importCompleteZipToDb(sqlite: Database.Database, zipPath: string, destination: string) {
  const stage = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hologram-archive-import-'));
  try {
    const result = await prepareArchiveImport(zipPath, stage);
    return result.ok ? await applyArchiveImport(sqlite, stage, destination) : result;
  } finally {
    await cleanupArchiveImport(stage, destination);
    await fs.promises.rm(stage, { recursive: true, force: true });
  }
}
