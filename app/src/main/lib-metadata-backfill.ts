import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { normalizePostRecord } from '../../../native-host/post-record.mts';
import { postKeyOf } from '../../../native-host/post-key.mts';
import { postsByIdsSync } from './lib-db-query.ts';
import { POST_COLUMNS, postParams, preparePostStmts, writePosterProfile } from './lib-db-record-writer.ts';
import { posterKeyOf } from './lib-poster-profile.ts';
import { reconcilePosterIdentity } from './lib-poster-identity.ts';

const fields = [
  'platform',
  'text',
  'title',
  'displayName',
  'screenName',
  'userId',
  'avatar',
  'followers',
  'following',
  'authorCreatedAt',
  'likes',
  'reposts',
  'replies',
  'bookmarks',
  'views',
  'date',
  'lang',
  'isReply',
  'isQuote',
  'isThread',
  'isEdited',
  'cw',
  'sensitive',
  'quotedUrl',
  'replyToId',
  'seriesId',
  'seriesTitle',
  'seriesOrder',
  'hashtags',
  'poll',
  'linkCard',
] as const;

// 画像・タグ・フォルダーは変更しない。空欄とインポート時の仮の投稿日だけを補う。
export function mergeBackfill(record: any, metadata: any, fetchedAt: string) {
  const merged = { ...record, metaSource: { ...record.metaSource }, updatedAt: fetchedAt };
  for (const field of fields) {
    const value = metadata[field];
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) continue;
    if (record[field] == null || record[field] === '' || (Array.isArray(record[field]) && !record[field].length) || (field === 'date' && record.source === 'eagle-migration')) {
      merged[field] = value;
      merged.metaSource[field] = 'api';
    }
  }
  // インポート画像は投稿全体を取得した証拠にはならない。
  if (record.source === 'eagle-migration') merged.saveScope = 'media';
  if (metadata.media?.length) merged.imageCount = metadata.media.length;
  return merged;
}

export function applyCachedMetadata(sqlite: Database.Database, folder: string, key: string) {
  const root = path.join(folder, '.hologram-metadata-backfill');
  const hash = createHash('sha256').update(key).digest('hex');
  const receiptKey = `metadata-backfill:${hash}`;
  const receipt = sqlite.prepare('SELECT value FROM store_state WHERE key = ?').get(receiptKey) as { value: string } | undefined;
  if (receipt) return JSON.parse(receipt.value) as { ok: boolean; updated: number };
  const state = JSON.parse(fs.readFileSync(path.join(root, 'progress.json'), 'utf8'));
  if (state.folder !== folder || state.version !== 1) throw Error('補完対象のライブラリが違います');
  const entry = state.entries.find((item: any) => item.key === key);
  if (!entry || entry.status !== 'fetched') throw Error('取得済みの項目ではありません');
  const { result, fetchedAt } = JSON.parse(fs.readFileSync(path.join(root, 'results', `${hash}.json`), 'utf8'));
  if (result.metaError || !(result.text != null || result.title != null || result.likes != null || result.media?.length)) throw Error('メタデータを取得できていません');
  if (postKeyOf(result.url || entry.url) !== key || !Number.isFinite(Date.parse(fetchedAt))) throw Error('取得結果が対象と一致しません');
  const columns = [...fields, 'saveScope', 'imageCount', 'metaSource', 'updatedAt'] as const;
  const update = sqlite.prepare(`UPDATE posts SET ${columns.map((column) => `${column} = ?`).join(',')} WHERE captureId = ? AND trashedAt IS NULL`);
  const stmts = preparePostStmts(sqlite);
  const assetsFile = path.join(root, 'results', `${hash}.assets.json`);
  const assets = fs.existsSync(assetsFile) ? JSON.parse(fs.readFileSync(assetsFile, 'utf8')) : {};
  const safeAsset = (value: unknown) => (typeof value === 'string' && /^avatars\/[a-zA-Z0-9._-]+$/.test(value) && fs.existsSync(path.join(folder, value)) ? value : null);
  return sqlite.transaction(() => {
    let updated = 0;
    for (const record of postsByIdsSync(sqlite, entry.ids)) {
      if (record.trashedAt || postKeyOf(record.url) !== key) continue;
      const merged = normalizePostRecord(mergeBackfill(record, result, new Date().toISOString()));
      const values = postParams(merged);
      update.run(...columns.map((column) => values[POST_COLUMNS.indexOf(column)]), record.captureId);
      if (!record.avatarFile && merged.avatar === result.avatar && safeAsset(assets.avatarFile)) {
        merged.avatarFile = assets.avatarFile;
        sqlite.prepare('UPDATE posts SET avatarFile = ? WHERE captureId = ?').run(merged.avatarFile, record.captureId);
      }
      const remoteMedia = result.media || [];
      const photo = /\/photo\/(\d+)/.exec(record.url || '');
      const position = photo ? Number(photo[1]) - 1 : remoteMedia.length === 1 ? 0 : -1;
      // URLの画像番号、または既知のメディアURLが一致するときだけ対応付ける。
      const localMedia = record.media.length ? record.media : record.image ? [{ file: record.image, url: '', alt: null }] : [];
      localMedia.forEach((local, seq) => {
        const remote = remoteMedia.find((item: any) => local.url && item.url === local.url) || (localMedia.length === 1 ? remoteMedia[position] : null);
        if (!remote) return;
        if (record.media.length) {
          sqlite.prepare("UPDATE media SET url = CASE WHEN url = '' THEN ? ELSE url END, alt = COALESCE(alt, ?) WHERE postId = ? AND seq = ?").run(remote.url || '', remote.alt || null, record.captureId, seq);
        } else {
          stmts.insertMedia.run(record.captureId, seq, remote.url || '', remote.alt || null, record.shotW, record.shotH, local.file, 'image', null, null, null, null, null, null);
        }
      });
      if (merged.platform && merged.screenName) reconcilePosterIdentity(sqlite, merged.screenName, merged.platform);
      const profile = sqlite.prepare('SELECT * FROM poster_profiles WHERE posterKey = ?').get(posterKeyOf(merged)) as any;
      const profileInput = { ...merged, ...profile, capturedAt: fetchedAt };
      // 同じ固定IDから取得できた名前は、古いプロフィールより優先する。
      if (result.userId && result.userId === merged.userId) {
        if (result.displayName) profileInput.displayName = result.displayName;
        if (result.screenName) profileInput.screenName = result.screenName;
      }
      for (const field of ['bio', 'profileLinks', 'banner', 'avatar', 'displayName', 'screenName', 'followers', 'following', 'authorCreatedAt']) {
        if (profileInput[field] == null && result[field] != null) profileInput[field] = result[field];
      }
      if (!profileInput.avatarFile && profileInput.avatar === result.avatar) profileInput.avatarFile = safeAsset(assets.avatarFile);
      if (!profileInput.bannerFile && profileInput.banner === result.banner) profileInput.bannerFile = safeAsset(assets.bannerFile);
      writePosterProfile(stmts, normalizePostRecord(profileInput));
      updated++;
    }
    const receipt = { ok: true, updated };
    sqlite.prepare('INSERT INTO store_state (key, value) VALUES (?, ?)').run(receiptKey, JSON.stringify(receipt));
    return receipt;
  })();
}
