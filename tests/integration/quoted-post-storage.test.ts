import { expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { openDatabase } from '../../app/src/main/lib-db.ts';
import { makeTagResolver, preparePostStmts, writePost } from '../../app/src/main/lib-db-record-writer.ts';
import { postsFromDb, postsByIds, posterProfilesFromDb } from '../../app/src/main/lib-db-query.ts';
import { createDbWriter } from '../../app/src/main/lib-db-write.ts';
import { buildSavedIndex } from '../../app/src/main/lib-saved-index.ts';
import { writeCompleteZip, importCompleteZipToDb } from '../../app/src/main/lib-archive.ts';
import { quotedCaptureId } from '../../native-host/quoted-id.mts';
import { collectUnreferencedQuotes } from '../../app/src/main/lib-quoted-posts.ts';

const url = 'https://x.com/quoted/status/123';
const quoteId = quotedCaptureId(url);
const file = `quoted-media/${quoteId}/media.jpg`;
const quote = { url, text: '引用元だけの検索語', screenName: 'quoted', media: [{ url: 'https://pbs.twimg.com/media/a.jpg', file, type: 'image' }] };

test('引用元は共有され、通常一覧・保存済み・全文検索・投稿者に混ざらない。単独保存後も参照が続く', async () => {
  const { sqlite } = openDatabase(':memory:');
  try {
    const stmts = preparePostStmts(sqlite),
      tags = makeTagResolver(sqlite);
    const write = (captureId: string) => writePost(stmts, tags, { captureId, url: `https://x.com/parent/status/${captureId}`, platform: 'x', text: '本文', quotedPost: quote });
    write('1');
    write('2');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: 3 });
    expect((await postsFromDb(sqlite)).map((p) => p.captureId).sort()).toEqual(['1', '2']);
    expect(await postsByIds(sqlite, [quoteId])).toEqual([]);
    expect(posterProfilesFromDb(sqlite)).toEqual([]);
    expect(JSON.stringify(buildSavedIndex(sqlite).entries)).not.toContain('quoted/status/123');
    const parent = (await postsByIds(sqlite, ['1']))[0];
    expect(parent.quotedPost?.media[0].file).toBe(file);
    expect(parent.quotedPost?.captureId).toBe(quoteId);
    writePost(stmts, tags, { captureId: 'standalone', ...quote, platform: 'x' });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: 3 });
    expect((await postsByIds(sqlite, ['1']))[0].quotedPost?.captureId).toBe('standalone');
    expect((await postsFromDb(sqlite)).length).toBe(3);
    createDbWriter(sqlite).deletePost('standalone');
    expect((await postsFromDb(sqlite)).length).toBe(2);
    expect((await postsByIds(sqlite, ['2']))[0].quotedPost?.media[0].file).toBe(file);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    sqlite.close();
  }
});

test('過去の取得失敗を補完し、後の失敗で保存済み画像を失わない。返信先はメタデータのまま', async () => {
  const { sqlite } = openDatabase(':memory:');
  try {
    const stmts = preparePostStmts(sqlite),
      tags = makeTagResolver(sqlite);
    writePost(stmts, tags, { captureId: '1', quotedPost: { ...quote, media: [] }, replyToPost: quote });
    writePost(stmts, tags, { captureId: '2', quotedPost: quote });
    writePost(stmts, tags, { captureId: '3', quotedPost: { ...quote, media: [{ url: quote.media[0].url }] } });
    const posts = await postsFromDb(sqlite);
    expect(posts.every((p) => p.quotedPost?.media[0].file === file)).toBe(true);
    expect(posts.find((p) => p.captureId === '1')?.replyToPost?.captureId).toBeUndefined();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM posts WHERE isContext = 1').get()).toEqual({ n: 1 });
  } finally {
    sqlite.close();
  }
});

test('完全書き出しは引用画像と参照情報を運び、引用元を独立した一覧項目にしない', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-quote-'));
  const { sqlite } = openDatabase(':memory:');
  const { sqlite: imported } = openDatabase(':memory:');
  try {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    fs.writeFileSync(path.join(folder, file), 'image');
    writePost(preparePostStmts(sqlite), makeTagResolver(sqlite), { captureId: 'parent', quotedPost: quote });
    const output = path.join(folder, 'export.zip');
    await writeCompleteZip(sqlite, folder, null, output);
    const zip = await JSZip.loadAsync(fs.readFileSync(output));
    expect(await zip.file(`library/${file}`)?.async('string')).toBe('image');
    expect(zip.file(`library/${quoteId}.json`)).toBeNull();
    const dest = path.join(folder, 'imported');
    fs.mkdirSync(dest);
    await importCompleteZipToDb(imported, output, dest);
    expect(fs.readFileSync(path.join(dest, file), 'utf8')).toBe('image');
    expect((await postsFromDb(imported)).length).toBe(1);
    expect((await postsFromDb(imported))[0].quotedPost?.media[0].file).toBe(file);
  } finally {
    sqlite.close();
    imported.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('参照されなくなった引用元の共有メディアを完全削除する', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-quote-cleanup-'));
  const trashDir = path.join(folder, '.trash');
  const { sqlite } = openDatabase(':memory:');
  try {
    const mediaPath = path.join(folder, file);
    fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
    fs.mkdirSync(trashDir);
    fs.writeFileSync(mediaPath, 'image');
    writePost(preparePostStmts(sqlite), makeTagResolver(sqlite), { captureId: 'parent', quotedPost: quote });
    createDbWriter(sqlite).deletePost('parent');

    await collectUnreferencedQuotes(sqlite, trashDir);

    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: 0 });
    expect(fs.existsSync(path.dirname(mediaPath))).toBe(false);
  } finally {
    sqlite.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test.each(['media', 'poster', 'image', 'video', 'trash', 'promoted', 'parent-first'])('引用画像の参照と回収を守る: %s', async (mode) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-quote-shared-'));
  const trashDir = path.join(folder, '.trash');
  const { sqlite } = openDatabase(':memory:');
  try {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    fs.mkdirSync(trashDir);
    fs.writeFileSync(path.join(folder, file), 'KEEP');
    const stmts = preparePostStmts(sqlite),
      tags = makeTagResolver(sqlite);
    writePost(stmts, tags, { captureId: 'parent', quotedPost: quote });
    if (mode === 'promoted' || mode === 'parent-first') {
      writePost(stmts, tags, { captureId: 'standalone', ...quote });
      if (mode === 'parent-first') createDbWriter(sqlite).deletePost('parent');
      createDbWriter(sqlite).deletePost('standalone');
    } else if (mode === 'trash') {
      fs.writeFileSync(path.join(trashDir, 'other.json'), JSON.stringify({ captureId: 'other', media: [{ file, type: 'image' }] }));
    } else {
      writePost(stmts, tags, { captureId: 'other', ...(mode === 'media' ? { media: [{ file, type: 'image' }] } : mode === 'poster' ? { media: [{ posterFile: file, type: 'video' }] } : { [mode]: file }) });
    }
    createDbWriter(sqlite).deletePost('parent');
    await collectUnreferencedQuotes(sqlite, trashDir);
    if (mode !== 'promoted' && mode !== 'parent-first') {
      expect(fs.readFileSync(path.join(folder, file), 'utf8')).toBe('KEEP');
      if (mode === 'trash') fs.unlinkSync(path.join(trashDir, 'other.json'));
      else createDbWriter(sqlite).deletePost('other');
      await collectUnreferencedQuotes(sqlite, trashDir);
    }
    expect(fs.existsSync(path.join(folder, file))).toBe(false);
  } finally {
    sqlite.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
