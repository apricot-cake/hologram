'use strict';

// 保存項目の実体を、移行前のライブラリ直下から items/<captureId>/ へ移す。SQLite の
// スキーマ変更ではないため lib-db.ts の user_version には入れない。完全 ZIP の取り込みでも
// 古い平坦な形式が後から加わり得るので、DB を開いた時と完全インポート後に冪等に実行する。

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { itemDirectoryAbsolute, itemFileRelative, parseItemFilePath } from '../../../native-host/item-storage.mts';
import type { PostRecordShape } from '../../../native-host/post-record.mts';

interface PostRow {
  captureId: string;
  image: string | null;
  video: string | null;
  file: string | null;
  linkCard: string | null;
}

interface MediaRow {
  id: number;
  postId: string;
  file: string;
  posterFile: string | null;
}

interface MoveResult {
  relative: string;
  undo: (() => void) | null;
}

function isRootFile(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value) && value !== '.' && value !== '..' && path.basename(value) === value && !value.includes('/') && !value.includes('\\');
}

function filesEqual(left: string, right: string): boolean {
  const a = fs.statSync(left);
  const b = fs.statSync(right);
  if (!a.isFile() || !b.isFile() || a.size !== b.size) return false;
  const af = fs.openSync(left, 'r');
  const bf = fs.openSync(right, 'r');
  try {
    const ab = Buffer.allocUnsafe(64 * 1024);
    const bb = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const an = fs.readSync(af, ab, 0, ab.length, null);
      const bn = fs.readSync(bf, bb, 0, bb.length, null);
      if (an !== bn) return false;
      if (!an) return true;
      if (!ab.subarray(0, an).equals(bb.subarray(0, bn))) return false;
    }
  } finally {
    fs.closeSync(af);
    fs.closeSync(bf);
  }
}

function moveRootFile(saveFolder: string, captureId: string, file: string): MoveResult | null {
  const source = path.join(saveFolder, file);
  const itemDir = itemDirectoryAbsolute(saveFolder, captureId);
  const destination = path.join(itemDir, file);
  const relative = itemFileRelative(captureId, file);
  const sourceExists = fs.existsSync(source);
  const destinationExists = fs.existsSync(destination);

  // 前回、ファイルの移動後かつ DB の更新前に終了した状態。参照だけを追いつかせる。
  if (!sourceExists && destinationExists) return { relative, undo: null };
  // どちらにも無ければ、欠損を別の場所へ付け替えない。後からルートへ復元されたときに
  // 整合性修復が見つけられるよう、古い参照を保つ。
  if (!sourceExists) return null;

  fs.mkdirSync(itemDir, { recursive: true });
  if (!destinationExists) {
    fs.renameSync(source, destination);
    return {
      relative,
      undo: () => {
        if (fs.existsSync(destination) && !fs.existsSync(source)) fs.renameSync(destination, source);
      },
    };
  }

  // 同じ場所に同名の別内容がある場合は、どちらかを黙って捨てない。この参照だけ古い場所に
  // 残し、整合性検査で利用者に見える状態を保つ。
  if (!filesEqual(source, destination)) return null;
  fs.rmSync(source, { force: true });
  return {
    relative,
    undo: () => {
      if (!fs.existsSync(source) && fs.existsSync(destination)) fs.copyFileSync(destination, source);
    },
  };
}

function parsedLinkCard(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export interface ItemStorageMigrationResult {
  posts: number;
  files: number;
}

/**
 * 移行前の取込キューをDB喪失後に再生するときの読み替え。キューは取得時の証拠なので
 * 書き換えない。古い直下参照の実体が既に項目フォルダーへ移っている場合だけ、適用する
 * レコードのメモリ上の参照を現在位置へ向ける。
 */
export function recordWithCurrentItemPaths(saveFolder: string, record: PostRecordShape): PostRecordShape {
  const current = (value: string | null): string | null => {
    if (!isRootFile(value)) return value;
    const relative = itemFileRelative(record.captureId, value);
    return fs.existsSync(path.join(saveFolder, ...relative.split('/'))) ? relative : value;
  };
  const image = current(record.image);
  const video = current(record.video);
  const file = current(record.file);
  const media = record.media.map((entry) => ({ ...entry, file: current(entry.file) as string, posterFile: current(entry.posterFile) }));
  const linkCard = record.linkCard ? { ...record.linkCard, thumbnailFile: current(record.linkCard.thumbnailFile) } : null;
  const changed = image !== record.image || video !== record.video || file !== record.file || media.some((entry, index) => entry.file !== record.media[index].file || entry.posterFile !== record.media[index].posterFile) || linkCard?.thumbnailFile !== record.linkCard?.thumbnailFile;
  return changed ? { ...record, image, video, file, media, linkCard } : record;
}

export function migrateItemStorage(sqlite: Database.Database, saveFolder: string): ItemStorageMigrationResult {
  const posts = sqlite.prepare('SELECT captureId, image, video, file, linkCard FROM posts WHERE trashedAt IS NULL').all() as PostRow[];
  const media = sqlite.prepare('SELECT id, postId, file, posterFile FROM media').all() as MediaRow[];
  const mediaByPost = new Map<string, MediaRow[]>();
  for (const row of media) {
    const list = mediaByPost.get(row.postId) || [];
    list.push(row);
    mediaByPost.set(row.postId, list);
  }

  let changedPosts = 0;
  let movedFiles = 0;
  for (const post of posts) {
    // テキストだけの投稿にも保存単位としてのフォルダーを持たせる。以降の右クリック操作は
    // メディアの有無で分岐せず、常にこの場所を指せる。
    fs.mkdirSync(itemDirectoryAbsolute(saveFolder, post.captureId), { recursive: true });

    const undo: Array<() => void> = [];
    const moved = new Map<string, string>();
    const migrateRef = (value: string | null): string | null => {
      if (!value || parseItemFilePath(value) || !isRootFile(value)) return value;
      const cached = moved.get(value);
      if (cached) return cached;
      const result = moveRootFile(saveFolder, post.captureId, value);
      if (!result) return value;
      moved.set(value, result.relative);
      if (result.undo) undo.push(result.undo);
      movedFiles++;
      return result.relative;
    };

    const image = migrateRef(post.image);
    const video = migrateRef(post.video);
    const file = migrateRef(post.file);
    const linkCard = parsedLinkCard(post.linkCard);
    const previousLinkCardThumbnail = linkCard?.thumbnailFile;
    if (linkCard && typeof previousLinkCardThumbnail === 'string') linkCard.thumbnailFile = migrateRef(previousLinkCardThumbnail);
    const linkCardChanged = Boolean(linkCard && typeof previousLinkCardThumbnail === 'string' && linkCard.thumbnailFile !== previousLinkCardThumbnail);
    const mediaRows = mediaByPost.get(post.captureId) || [];
    const migratedMedia = mediaRows.map((row) => ({ ...row, file: migrateRef(row.file) as string, posterFile: migrateRef(row.posterFile) }));
    const postChanged = image !== post.image || video !== post.video || file !== post.file || linkCardChanged;
    const mediaChanged = migratedMedia.some((row, index) => row.file !== mediaRows[index].file || row.posterFile !== mediaRows[index].posterFile);
    if (!postChanged && !mediaChanged) continue;

    sqlite.exec('BEGIN');
    try {
      if (postChanged) {
        sqlite.prepare('UPDATE posts SET image = ?, video = ?, file = ?, linkCard = ? WHERE captureId = ?').run(image, video, file, linkCardChanged ? JSON.stringify(linkCard) : post.linkCard, post.captureId);
      }
      const updateMedia = sqlite.prepare('UPDATE media SET file = ?, posterFile = ? WHERE id = ?');
      for (const row of migratedMedia) updateMedia.run(row.file, row.posterFile, row.id);
      sqlite.exec('COMMIT');
      changedPosts++;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      for (let i = undo.length - 1; i >= 0; i--) {
        try {
          undo[i]();
        } catch {
          // 元の例外を保つ。次回の冪等な実行が、移動済みファイルと古い参照を再照合する。
        }
      }
      throw error;
    }
  }
  return { posts: changedPosts, files: movedFiles };
}
