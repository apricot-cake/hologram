'use strict';

// 共有ストアが導入される前の <captureId>-avatar.<ext> / -banner.<ext> を、
// ライブラリ直下から avatars/ へ移す。投稿媒体の items/ 移行とは所有者が違うため分ける。
// URL が残るものは現行の URL ハッシュを使う。URL が無い旧データは、元のファイル名から
// 決まる legacy キーを使い、ファイル移動後に終了しても次回同じ宛先を導出できるようにする。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { posterAppearanceHash } from './lib-poster-profile.ts';
import { AVATAR_SUBDIR } from './lib-save-folder-path.ts';

interface AssetRef {
  file: string;
  url: string | null;
}

interface ProfileAppearanceRow {
  id?: number;
  posterKey: string;
  observedAt?: string;
  displayName: string | null;
  screenName: string | null;
  bio: string | null;
  links: string | null;
  avatar: string | null;
  avatarFile: string | null;
  banner: string | null;
  bannerFile: string | null;
  contentHash: string;
}

function isRootFile(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value) && value !== '.' && value !== '..' && path.basename(value) === value && !value.includes('/') && !value.includes('\\');
}

function digest(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
}

function filesEqual(left: string, right: string): boolean {
  const a = fs.statSync(left);
  const b = fs.statSync(right);
  if (!a.isFile() || !b.isFile() || a.size !== b.size) return false;
  return fs.readFileSync(left).equals(fs.readFileSync(right));
}

function legacyRefs(sqlite: Database.Database): AssetRef[] {
  const refs: AssetRef[] = [];
  const add = (rows: AssetRef[]) => {
    for (const row of rows) if (isRootFile(row.file)) refs.push(row);
  };
  add(sqlite.prepare('SELECT avatarFile AS file, avatar AS url FROM posts WHERE avatarFile IS NOT NULL').all() as AssetRef[]);
  add(sqlite.prepare('SELECT avatarFile AS file, avatar AS url FROM poster_profiles WHERE avatarFile IS NOT NULL').all() as AssetRef[]);
  add(sqlite.prepare('SELECT bannerFile AS file, banner AS url FROM poster_profiles WHERE bannerFile IS NOT NULL').all() as AssetRef[]);
  add(sqlite.prepare('SELECT avatarFile AS file, avatar AS url FROM poster_profile_snapshots WHERE avatarFile IS NOT NULL').all() as AssetRef[]);
  add(sqlite.prepare('SELECT bannerFile AS file, banner AS url FROM poster_profile_snapshots WHERE bannerFile IS NOT NULL').all() as AssetRef[]);
  return refs;
}

function relativeDestination(file: string, urls: Set<string>): string {
  const url = [...urls].sort()[0] || null;
  const stem = url ? digest(url) : `legacy-${digest(file)}`;
  return `${AVATAR_SUBDIR}/${stem}${path.extname(file).toLowerCase()}`;
}

function appearanceHash(row: ProfileAppearanceRow): string {
  return posterAppearanceHash({
    displayName: row.displayName,
    screenName: row.screenName,
    bio: row.bio,
    links: row.links,
    avatar: row.avatar,
    avatarFile: row.avatarFile,
    banner: row.banner,
    bannerFile: row.bannerFile,
  });
}

export interface SharedAssetMigrationResult {
  references: number;
  files: number;
}

export function migrateLegacySharedAssets(sqlite: Database.Database, saveFolder: string): SharedAssetMigrationResult {
  const grouped = new Map<string, Set<string>>();
  for (const ref of legacyRefs(sqlite)) {
    const urls = grouped.get(ref.file) || new Set<string>();
    if (typeof ref.url === 'string' && ref.url) urls.add(ref.url);
    grouped.set(ref.file, urls);
  }

  const moved = new Map<string, string>();
  const undo: Array<() => void> = [];
  let movedFiles = 0;
  for (const [file, urls] of grouped) {
    const source = path.join(saveFolder, file);
    let relative = relativeDestination(file, urls);
    let destination = path.join(saveFolder, ...relative.split('/'));
    const fallbackRelative = `${AVATAR_SUBDIR}/legacy-${digest(file)}${path.extname(file).toLowerCase()}`;
    const fallbackDestination = path.join(saveFolder, ...fallbackRelative.split('/'));
    const sourceExists = fs.existsSync(source);
    if (sourceExists && fs.existsSync(destination) && !filesEqual(source, destination)) {
      relative = fallbackRelative;
      destination = fallbackDestination;
    }
    if (!sourceExists) {
      if (fs.existsSync(fallbackDestination)) moved.set(file, fallbackRelative);
      else if (fs.existsSync(destination)) moved.set(file, relative);
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (!fs.existsSync(destination)) {
      fs.renameSync(source, destination);
      undo.push(() => {
        if (fs.existsSync(destination) && !fs.existsSync(source)) fs.renameSync(destination, source);
      });
    } else if (filesEqual(source, destination)) {
      fs.rmSync(source, { force: true });
      undo.push(() => {
        if (!fs.existsSync(source) && fs.existsSync(destination)) fs.copyFileSync(destination, source);
      });
    } else {
      continue;
    }
    moved.set(file, relative);
    movedFiles++;
  }
  if (!moved.size) return { references: 0, files: 0 };

  let changedReferences = 0;
  sqlite.exec('BEGIN');
  try {
    const targets = [
      ['posts', 'avatarFile'],
      ['poster_profiles', 'avatarFile'],
      ['poster_profiles', 'bannerFile'],
      ['poster_profile_snapshots', 'avatarFile'],
      ['poster_profile_snapshots', 'bannerFile'],
    ] as const;
    for (const [file, relative] of moved) {
      for (const [table, column] of targets) changedReferences += sqlite.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(relative, file).changes;
    }

    const currentRows = sqlite.prepare('SELECT posterKey, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, contentHash FROM poster_profiles').all() as ProfileAppearanceRow[];
    const updateCurrent = sqlite.prepare('UPDATE poster_profiles SET contentHash = ? WHERE posterKey = ?');
    for (const row of currentRows) {
      const hash = appearanceHash(row);
      if (hash !== row.contentHash) updateCurrent.run(hash, row.posterKey);
    }

    const snapshotRows = sqlite.prepare('SELECT id, posterKey, observedAt, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, contentHash FROM poster_profile_snapshots ORDER BY id').all() as ProfileAppearanceRow[];
    const updateSnapshot = sqlite.prepare('UPDATE OR IGNORE poster_profile_snapshots SET contentHash = ? WHERE id = ?');
    const duplicateSnapshot = sqlite.prepare('SELECT id FROM poster_profile_snapshots WHERE posterKey = ? AND contentHash = ? AND observedAt = ? AND id <> ?');
    const deleteSnapshot = sqlite.prepare('DELETE FROM poster_profile_snapshots WHERE id = ?');
    for (const row of snapshotRows) {
      const hash = appearanceHash(row);
      if (hash === row.contentHash) continue;
      const result = updateSnapshot.run(hash, row.id);
      if (result.changes) continue;
      const duplicate = duplicateSnapshot.get(row.posterKey, hash, row.observedAt, row.id) as { id: number } | undefined;
      if (!duplicate) throw new Error(`Could not update poster profile snapshot ${row.id}`);
      deleteSnapshot.run(row.id);
    }
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    for (let index = undo.length - 1; index >= 0; index--) {
      try {
        undo[index]();
      } catch {
        // 次回、移動済みの宛先から同じ対応を再構成できる。
      }
    }
    throw error;
  }
  return { references: changedReferences, files: movedFiles };
}
