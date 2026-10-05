import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { openDatabase } from './lib-db';
import { prepareZipIntoEmptyDatabase, mergeFolders, mergeUngrouped, mergeManualGroups, mergePosterFolders, mergePosterTags, mergePosterProfiles, mergeTagGroups } from './lib-archive';
import { createDbWriter } from './lib-db-write';
import { preparePostStmts, makeTagResolver, writePost } from './lib-db-record-writer';
import { importClassifiedTagVocabulary } from './lib-tag-classification';
import { PostRecordInputSchema } from '../../../native-host/post-schemas.mts';
import { PostFlagsSchema } from '../shared/data-schemas';
import { createArchiveFilePublisher } from './archive-file-publisher';
import { fillCardDims } from './lib-card-dims';
import { fillMediaDimsAsync, MediaMeasurementCache } from './lib-media-dims';
import { readArchiveStageManifest } from './archive-stage-ownership';

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
    const nextPost = prepared.prepare('SELECT captureId,json FROM archive_records WHERE (? IS NULL OR captureId>?) ORDER BY captureId LIMIT 1');
    const updateRecord = prepared.prepare('UPDATE archive_records SET json=? WHERE captureId=?');
    let cursor: string | null = null;
    for (;;) {
      const row = nextPost.get(cursor, cursor) as { captureId: string; json: string } | undefined;
      if (!row) break;
      cursor = row.captureId;
      const rec = parseImportRecord(row.json);
      const measured = await fillMediaDimsAsync(destination, fillCardDims(destination, rec), measurements);
      const normalized = writePost(stagedStmts, stagedTags, { ...measured, tags: rec.tagClassification?.generalTags ?? rec.tags });
      updateRecord.run(JSON.stringify({ ...normalized, ...PostFlagsSchema.parse(rec), replaces: null }), row.captureId);
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
      const existingProfiles = target.getPosterProfiles();
      prepared.exec('UPDATE archive_records SET applied=0');
      const markApplied = prepared.prepare('UPDATE archive_records SET applied=1 WHERE captureId=?');
      importClassifiedTagVocabulary(sqlite, prepared.prepare("SELECT t.name,t.category,w.name AS workName FROM tags t LEFT JOIN tags w ON w.id=t.workId WHERE t.category!='general'").all() as Array<{ name: string; category: 'character' | 'work'; workName: string | null }>);
      let appliedCursor: string | null = null;
      for (;;) {
        const row = nextPost.get(appliedCursor, appliedCursor) as { captureId: string; json: string } | undefined;
        if (!row) break;
        appliedCursor = row.captureId;
        if (exists.get(row.captureId)) {
          skipped++;
          continue;
        }
        const rec = parseImportRecord(row.json);
        writePost(stmts, tags, { ...rec, tags: rec.tagClassification?.generalTags ?? rec.tags });
        // 既存グループの数値 ID は、整理情報の統合で再採番される前に参照する。
        target.restorePostFlags(row.captureId, rec);
        markApplied.run(row.captureId);
        imported++;
        progress();
      }
      target.setFolders(mergeFolders(target.getFolders(), incoming('folders', source.getFolders)));
      target.setUngrouped(mergeUngrouped(target.getUngrouped(), incoming('ungrouped', source.getUngrouped)).keys);
      target.setManualGroups(mergeManualGroups(target.getManualGroups(), incoming('manual-groups', source.getManualGroups)).groups);
      target.setPosterFolders(mergePosterFolders(target.getPosterFolders(), incoming('poster-folders', source.getPosterFolders)));
      target.setPosterTags(mergePosterTags(target.getPosterTagNames(), incoming('poster-tags', source.getPosterTagNames)));
      // 投稿から今回生成された空の作者情報は、書庫の正規プロフィールを遮らない。
      // 取り込み前からあるローカルプロフィールは従来どおり優先する。
      const archivedProfiles = mergePosterProfiles(incoming('poster-profiles', source.getPosterProfiles), target.getPosterProfiles());
      target.setPosterProfiles(mergePosterProfiles(existingProfiles, archivedProfiles));
      const groups = mergeTagGroups(target.getTagGroupNames(), incoming('tag-groups', source.getTagGroupNames));
      target.fillTagGroupsByName(groups.memberships, groups.labels ?? null);
      // 新たなフォルダーは統合後に参照する。再採番される手動グループ ID は再適用しない。
      for (const row of prepared.prepare('SELECT captureId,json FROM archive_records WHERE applied=1').iterate() as Iterable<{ captureId: string; json: string }>) target.restorePostFlags(row.captureId, { folders: parseImportRecord(row.json).folders });
    })();
    return { ok: true as const, notComplete: false as const, imported, skipped };
  } finally {
    prepared.close();
    await publisher.close();
  }
}

function parseImportRecord(json: string) {
  const raw = JSON.parse(json);
  return { ...PostRecordInputSchema.parse(raw), ...PostFlagsSchema.parse(raw), replaces: null };
}

export async function cleanupArchiveImport(stage: string, destination: string) {
  if (!fs.existsSync(path.join(stage, 'prepared.sqlite'))) return;
  const root = path.resolve(destination);
  await assertCleanupDirectories(path.parse(root).root, root);
  const realRoot = await fs.promises.realpath(root);
  if (canonicalPath(realRoot) !== canonicalPath(root)) throw new Error('invalid-import-cleanup-owner');
  // 製品の stage は永続 manifest にあるライブラリとだけ照合する。
  // manifest を持たない直接テストの一時 stage とは区別する。
  if (/^[0-9a-f-]{36}$/.test(path.basename(stage))) {
    const owner = await readArchiveStageManifest(stage);
    if (canonicalPath(owner.destination) !== canonicalPath(realRoot)) throw new Error('invalid-import-cleanup-owner');
    const library = path.join(root, 'hologram.db');
    const stat = await fs.promises.lstat(library);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('invalid-import-cleanup-owner');
    const current = openDatabase(library, { readonly: true }).sqlite;
    try {
      const identity = current.prepare('SELECT value FROM store_state WHERE key=?').get('libraryId') as { value: string } | undefined;
      if (identity?.value !== owner.libraryId) throw new Error('invalid-import-cleanup-owner');
    } finally {
      current.close();
    }
  }
  const stageDb = await fs.promises.lstat(path.join(stage, 'prepared.sqlite'));
  if (stageDb.isSymbolicLink() || !stageDb.isFile()) throw new Error('invalid-import-cleanup-owner');
  const db = openDatabase(path.join(stage, 'prepared.sqlite'), { readonly: true }).sqlite;
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='media_publications'").get()) return;
    for (const row of db.prepare('SELECT tmp FROM media_publications').iterate() as Iterable<{ tmp: string }>) {
      const file = path.resolve(row.tmp);
      if (!canonicalPath(file).startsWith(canonicalPath(root) + path.sep) || !/^\.hologram-import-[0-9a-f-]{36}\.tmp$/.test(path.basename(file))) throw new Error('invalid-import-cleanup-owner');
      try {
        await assertCleanupDirectories(root, path.dirname(file));
        const stat = await fs.promises.lstat(file);
        if (stat.isSymbolicLink() || !stat.isFile() || canonicalPath(await fs.promises.realpath(file)) !== canonicalPath(file)) throw new Error('invalid-import-cleanup-owner');
        await fs.promises.unlink(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  } finally {
    db.close();
  }
}

const canonicalPath = (file: string) => (process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file));
async function assertCleanupDirectories(root: string, directory: string) {
  const relative = path.relative(root, directory);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('invalid-import-cleanup-owner');
  let current = root;
  for (const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
    current = path.join(current, part);
    const stat = await fs.promises.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('invalid-import-cleanup-owner');
  }
}

// 呼び出し側が stage と全 actor の OS lease を排他取得した後に使う。
// 外部ライブラリを変更せず、再試行に必要な journal を残して展開容量を回収する。
export async function compactArchiveImportStage(stage: string) {
  await readArchiveStageManifest(stage);
  await assertCleanupDirectories(path.parse(path.resolve(stage)).root, path.resolve(stage));
  const library = path.join(stage, 'library');
  try {
    await assertNoLinksInStage(library);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const sourcePath = path.join(stage, 'prepared.sqlite');
  const compactPath = path.join(stage, 'prepared-journal.sqlite');
  const regular = async (file: string) => {
    const stat = await fs.promises.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('invalid-import-compaction-owner');
  };
  let source: Database.Database | undefined;
  try {
    await regular(sourcePath);
    for (const suffix of ['-wal', '-shm']) {
      try {
        await regular(sourcePath + suffix);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    source = openDatabase(sourcePath).sqlite;
    const checkpoint = source.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
    if (checkpoint.some((row) => row.busy !== 0) || source.pragma('journal_mode = DELETE', { simple: true }) !== 'delete') throw new Error('archive-compaction-checkpoint-busy');
  } catch (error) {
    source?.close();
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    source = undefined;
  }
  try {
    // 前回の中断で残った私有候補は、元 DB を保持したまま作り直す。
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try {
        await regular(compactPath + suffix);
        await fs.promises.unlink(compactPath + suffix);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const compact = openDatabase(compactPath).sqlite;
    try {
      if (compact.pragma('journal_mode = DELETE', { simple: true }) !== 'delete') throw new Error('archive-compaction-journal-mode');
      compact.pragma('synchronous = FULL');
      compact.exec('CREATE TABLE media_publications(tmp TEXT PRIMARY KEY)');
      if (source?.prepare("SELECT 1 FROM sqlite_master WHERE name='media_publications'").get()) {
        const next = source.prepare('SELECT tmp FROM media_publications WHERE (? IS NULL OR tmp>?) ORDER BY tmp LIMIT 1');
        const insert = compact.prepare('INSERT INTO media_publications(tmp) VALUES(?)');
        let cursor: string | null = null;
        const copyBatch = compact.transaction(() => {
          for (let count = 0; count < 100; count++) {
            const row = next.get(cursor, cursor) as { tmp: string } | undefined;
            if (!row) return false;
            cursor = row.tmp;
            insert.run(row.tmp);
          }
          return true;
        });
        while (copyBatch()) await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } finally {
      compact.close();
    }
    source?.close();
    source = undefined;
    for (const file of [sourcePath, compactPath]) {
      try {
        const handle = await fs.promises.open(file, 'r+');
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      for (const suffix of ['-wal', '-shm', '-journal']) if (fs.existsSync(file + suffix)) throw new Error('archive-compaction-sidecar-retained');
    }
    await fs.promises.rename(compactPath, sourcePath);
    const committed = await fs.promises.open(sourcePath, 'r+');
    try {
      await committed.sync();
    } finally {
      await committed.close();
    }
    await fs.promises.rm(library, { recursive: true, force: true });
    await fs.promises.rm(path.join(stage, 'prepared-stats.json'), { force: true });
  } finally {
    source?.close();
  }
}

async function assertNoLinksInStage(directory: string) {
  const stat = await fs.promises.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('invalid-import-compaction-owner');
  const entries = await fs.promises.opendir(directory);
  for await (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error('invalid-import-compaction-owner');
    if (entry.isDirectory()) await assertNoLinksInStage(path.join(directory, entry.name));
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
