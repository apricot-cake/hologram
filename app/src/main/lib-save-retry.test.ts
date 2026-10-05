import { expect, test } from 'vitest';
import { normalizePostRecord } from '../../../native-host/post-record.mts';
import { mergeSaveRetry } from './lib-save-retry.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from './lib-db';
import { drainInbox } from './lib-db-inbox';
import { postsByIds } from './lib-db-query';
import { buildEnvelope, writeInboxEvent } from '../../../native-host/inbox.mts';

test('再試行の画像順を使い、保存済みの画像と編集状態を重複させず保持する', () => {
  const previous = normalizePostRecord({ captureId: 'old', saveIncomplete: true, media: [{ url: 'https://example.com/2.jpg', file: 'old/2.jpg', rotation: 90 }] });
  const incoming = normalizePostRecord({
    captureId: 'new',
    media: [
      { url: 'https://example.com/1.jpg', file: 'new/1.jpg' },
      { url: 'https://example.com/2.jpg', file: 'new/2.jpg' },
    ],
  });
  const merged = mergeSaveRetry(previous, incoming);
  expect(merged.captureId).toBe('old');
  expect(merged.media.map((item) => item.file)).toEqual(['new/1.jpg', 'old/2.jpg']);
  expect(merged.media[1].rotation).toBe(90);
  expect(merged.saveIncomplete).toBe(false);
});

test('再試行で取得できなくなった画像も消さない', () => {
  const previous = normalizePostRecord({ captureId: 'old', saveIncomplete: true, media: [{ url: 'https://example.com/1.jpg', file: 'old/1.jpg' }] });
  const incoming = normalizePostRecord({ captureId: 'new', saveIncomplete: true });
  expect(mergeSaveRetry(previous, incoming).media).toEqual(previous.media);
});

test('別 URL のリンクカード・引用・返信には以前の情報を混ぜない', () => {
  const previous = normalizePostRecord({
    captureId: 'old',
    linkCard: { url: 'https://example.com/old', title: '古いカード', thumbnailFile: 'old.png' },
    quotedPost: { url: 'https://x.com/a/status/1', text: '古い引用', media: [{ url: 'https://example.com/old.png', file: 'old.png' }] },
    replyToPost: { url: 'https://x.com/a/status/2', text: '古い返信' },
  });
  const incoming = normalizePostRecord({ captureId: 'new', linkCard: { url: 'https://example.com/new' }, quotedPost: { url: 'https://x.com/a/status/3' }, replyToPost: { url: 'https://x.com/a/status/4' } });
  const merged = mergeSaveRetry(previous, incoming);
  expect(merged.linkCard).toEqual(incoming.linkCard);
  expect(merged.quotedPost).toEqual(incoming.quotedPost);
  expect(merged.replyToPost).toEqual(incoming.replyToPost);
});

test('同 URL の引用・返信は画像の編集状態を維持し、未保存だった画像を補う', () => {
  const previous = normalizePostRecord({ captureId: 'old', quotedPost: { url: 'https://x.com/a/status/1', media: [{ url: 'https://example.com/1.png', file: 'old.png', rotation: 90, flipped: true }, { url: 'https://example.com/2.png' }] }, replyToPost: { url: 'https://x.com/a/status/2', text: '保存した返信' } });
  const incoming = normalizePostRecord({
    captureId: 'new',
    quotedPost: {
      url: 'https://x.com/a/status/1',
      media: [
        { url: 'https://example.com/2.png', file: 'new-2.png' },
        { url: 'https://example.com/1.png', file: 'new-1.png' },
      ],
    },
    replyToPost: { url: 'https://x.com/a/status/2' },
  });
  const merged = mergeSaveRetry(previous, incoming);
  expect(merged.quotedPost?.media.map((item) => item.file)).toEqual(['new-2.png', 'old.png']);
  expect(merged.quotedPost?.media[1]).toEqual(previous.quotedPost?.media[0]);
  expect(merged.replyToPost).toEqual(previous.replyToPost);
});

test('一部保存の再試行でリンクカードと引用の保存済み情報を消さない', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-retry-nested-'));
  const db = openDatabase(path.join(folder, 'library.db'));
  try {
    for (const file of ['card.png', 'quote-1.png', 'quote-2.png']) fs.writeFileSync(path.join(folder, file), 'saved');
    const previous = normalizePostRecord({
      captureId: '1700000000990-af01',
      url: 'https://x.com/a/status/990',
      saveIncomplete: true,
      linkCard: { url: 'https://example.com/article', title: '保存した題名', description: '保存した説明', thumbnailFile: 'card.png' },
      quotedPost: {
        url: 'https://x.com/b/status/991',
        text: '保存した引用本文',
        displayName: '引用の投稿者',
        media: [
          { url: 'https://example.com/quote-1.png', file: 'quote-1.png' },
          { url: 'https://example.com/quote-2.png', file: 'quote-2.png' },
        ],
      },
    });
    await writeInboxEvent(folder, buildEnvelope(previous));
    expect(drainInbox(folder, db.sqlite).skipped).toEqual([]);
    const before = (await postsByIds(db.sqlite, [previous.captureId]))[0];
    const incoming = normalizePostRecord({
      captureId: '1700000000991-af02',
      retryOf: previous.captureId,
      url: previous.url,
      saveIncomplete: true,
      linkCard: { url: previous.linkCard!.url, title: '再取得した題名', thumbnailFile: null },
      quotedPost: { url: previous.quotedPost!.url, media: [{ url: 'https://example.com/quote-1.png' }] },
    });
    await writeInboxEvent(folder, buildEnvelope(incoming));
    expect(drainInbox(folder, db.sqlite).skipped).toEqual([]);
    const after = (await postsByIds(db.sqlite, [previous.captureId]))[0];
    expect.soft(after.linkCard?.thumbnailFile).toBe(before.linkCard?.thumbnailFile);
    expect.soft(after.linkCard?.description).toBe(before.linkCard?.description);
    expect.soft(after.quotedPost?.text).toBe(before.quotedPost?.text);
    expect.soft(after.quotedPost?.displayName).toBe(before.quotedPost?.displayName);
    expect.soft(after.quotedPost?.media).toEqual(before.quotedPost?.media);
    for (const file of ['card.png', 'quote-1.png', 'quote-2.png']) expect(fs.readFileSync(path.join(folder, file), 'utf8')).toBe('saved');
  } finally {
    db.sqlite.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
