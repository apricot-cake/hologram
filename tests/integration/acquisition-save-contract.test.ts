import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db';
import { drainInbox } from '../../app/src/main/lib-db-inbox';
import { postsByIds } from '../../app/src/main/lib-db-query';
import { buildSavedIndex } from '../../app/src/main/lib-saved-index';
import { inboxNewDir, parseInboxEnvelope } from '../../native-host/inbox.mts';
import type { SavePostRequest } from '../../native-host/protocol.mts';

// HTTP だけを置き換え、ホストの保存処理、Inbox、DB と実ファイルは本物を使う。
// 実 API の契約確認や、配備後のブラウザ検証とは別の保存統合テスト。
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9QAAAABJRU5ErkJggg==', 'base64');
const mediaUrl = 'https://pbs.twimg.com/media/acquisition-contract.png';
const avatarUrl = 'https://pbs.twimg.com/profile_images/acquisition-contract.png';
let folder: string;
let dbFile: string;
let bridge: typeof import('../../native-host/bridge.mts');

beforeAll(async () => {
  const configDir = process.env.HOLOGRAM_CONFIG_DIR!;
  folder = path.join(configDir, 'acquisition-save-contract');
  dbFile = path.join(folder, 'hologram.db');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: folder }));
  bridge = await import('../../native-host/bridge.mts');
});

afterEach(() => vi.unstubAllGlobals());

function successfulDownloads() {
  vi.stubGlobal('fetch', async () => new Response(image, { headers: { 'content-type': 'image/png' } }));
}

function envelope(id: string) {
  const parsed = parseInboxEnvelope(fs.readFileSync(path.join(inboxNewDir(folder), `${id}.json`), 'utf8'));
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.envelope.record;
}

async function persistAndReopen(id: string) {
  const writer = openDatabase(dbFile);
  try {
    expect(drainInbox(folder, writer.sqlite).skipped).toEqual([]);
  } finally {
    writer.sqlite.close();
  }
  const reader = openDatabase(dbFile);
  try {
    return (await postsByIds(reader.sqlite, [id]))[0];
  } finally {
    reader.sqlite.close();
  }
}

function profileBio(platform: string, userId: string) {
  const reader = openDatabase(dbFile);
  try {
    return reader.sqlite.prepare('SELECT bio FROM poster_profiles WHERE platform = ? AND userId = ?').get(platform, userId);
  } finally {
    reader.sqlite.close();
  }
}

function profileSnapshot(platform: string, userId: string) {
  const reader = openDatabase(dbFile);
  try {
    return reader.sqlite.prepare('SELECT displayName, screenName, bio, avatar, avatarFile, banner, bannerFile, followers, following, authorCreatedAt FROM poster_profiles WHERE platform = ? AND userId = ?').get(platform, userId);
  } finally {
    reader.sqlite.close();
  }
}

test.each([
  ['x', 'https://x.com/contract/status/901', '1717500000001-ca01', '1717500000002-ca01'],
  ['bluesky', 'https://bsky.app/profile/contract.bsky.social/post/contract1', '1717500000003-ca02', '1717500000004-ca02'],
  ['pixiv', 'https://www.pixiv.net/artworks/901', '1717500000005-ca03', '1717500000006-ca03'],
])('%s: 再取得の通信失敗でも既存の本文・プロフィール・画像ファイルを消さない', async (platform, url, originalId, retryId) => {
  successfulDownloads();
  const metadata: SavePostRequest['metadata'] = {
    platform,
    url,
    text: '保存済みの本文',
    displayName: '保存済みの投稿者',
    screenName: 'contract',
    userId: `${platform}-author`,
    bio: '保存済みのプロフィール',
    avatar: avatarUrl,
    media: [{ url: mediaUrl }],
    saveIncomplete: true,
  };
  await bridge.handleSavePost({ type: 'savePost', captureId: originalId, metadata });
  const before = await persistAndReopen(originalId);
  expect(before.avatarFile).toBeTruthy();
  expect(before.media).toHaveLength(1);
  const mediaFile = path.join(folder, before.media[0].file);
  const avatarFile = path.join(folder, before.avatarFile!);
  expect(fs.readFileSync(mediaFile)).toEqual(image);
  expect(fs.readFileSync(avatarFile)).toEqual(image);

  vi.stubGlobal('fetch', async () => new Response('unavailable', { status: 503 }));
  await expect(bridge.handleSavePost({ type: 'savePost', captureId: retryId, metadata: { platform, url, retryOf: originalId, text: null, displayName: null, bio: null, avatar: avatarUrl, media: [{ url: mediaUrl }], saveIncomplete: true } })).rejects.toThrow(/Post unavailable/);
  expect(fs.existsSync(path.join(inboxNewDir(folder), `${retryId}.json`))).toBe(false);
  const after = await persistAndReopen(originalId);
  expect(after).toMatchObject({ text: before.text, displayName: before.displayName, avatarFile: before.avatarFile, saveIncomplete: true });
  expect(profileBio(platform, `${platform}-author`)).toEqual({ bio: '保存済みのプロフィール' });
  expect(after.media).toEqual(before.media);
  expect(fs.readFileSync(mediaFile)).toEqual(image);
  expect(fs.readFileSync(avatarFile)).toEqual(image);
});

test('再取得で新しい画像だけが届いても欠けた本文・プロフィールと既存画像を維持する', async () => {
  const id = '1717500000009-ca06';
  const retryId = '1717500000010-ca06';
  const url = 'https://x.com/contract/status/906';
  successfulDownloads();
  await bridge.handleSavePost({
    type: 'savePost',
    captureId: id,
    metadata: {
      platform: 'x',
      url,
      userId: 'partial-contract-author',
      screenName: 'contract',
      text: '元の本文',
      displayName: '元の投稿者',
      bio: '元のプロフィール',
      avatar: avatarUrl,
      banner: 'https://pbs.twimg.com/profile_banners/contract.png',
      followers: 42,
      following: 4,
      authorCreatedAt: '2024-01-01T00:00:00.000Z',
      media: [{ url: mediaUrl }],
      saveIncomplete: true,
    },
  });
  const before = await persistAndReopen(id);
  const beforeProfile = profileSnapshot('x', 'partial-contract-author');
  await bridge.handleSavePost({ type: 'savePost', captureId: retryId, metadata: { platform: 'x', url, retryOf: id, text: null, displayName: null, bio: null, media: [{ url: 'https://pbs.twimg.com/media/new-contract.png' }], saveIncomplete: true } });
  expect(envelope(retryId)).toMatchObject({ retryOf: id, saveIncomplete: true, text: null, displayName: null });
  const after = await persistAndReopen(id);
  expect(after).toMatchObject({ text: before.text, displayName: before.displayName, avatarFile: before.avatarFile, saveIncomplete: true });
  expect(profileBio('x', 'partial-contract-author')).toEqual({ bio: '元のプロフィール' });
  expect(profileSnapshot('x', 'partial-contract-author')).toEqual(beforeProfile);
  expect(after.media).toHaveLength(2);
  expect(after.media.find((item) => item.url === mediaUrl)).toEqual(before.media[0]);
  for (const item of after.media) expect(fs.readFileSync(path.join(folder, item.file))).toEqual(image);
  expect(fs.readFileSync(path.join(folder, after.avatarFile!))).toEqual(image);
});

test('投稿画像が保存されてもアイコン取得失敗は取得不足として残る', async () => {
  const id = '1717500000011-ca07';
  const missingAvatar = 'https://pbs.twimg.com/profile_images/unavailable-contract.png';
  vi.stubGlobal('fetch', async (url: string | URL | Request) => (String(url) === missingAvatar ? new Response('unavailable', { status: 403 }) : new Response(image, { headers: { 'content-type': 'image/png' } })));
  const ack = await bridge.handleSavePost({ type: 'savePost', captureId: id, metadata: { platform: 'x', url: 'https://x.com/contract/status/907', text: '本文', avatar: missingAvatar, media: [{ url: mediaUrl }] } });
  expect(ack).toMatchObject({ ok: true, saveIncomplete: true, profileMissing: true });
  expect(envelope(id)).toMatchObject({ saveIncomplete: true, avatarFile: null });
  const after = await persistAndReopen(id);
  expect(after).toMatchObject({ saveIncomplete: true, avatarFile: null, text: '本文' });
  expect(after.media).toHaveLength(1);
  expect(fs.readFileSync(path.join(folder, after.media[0].file))).toEqual(image);
});

test('再取得が別の投稿者 ID を名乗ったときは既存投稿とプロフィールを変更しない', async () => {
  const id = '1717500000012-ca08';
  const retryId = '1717500000013-ca08';
  const url = 'https://x.com/contract/status/908';
  await bridge.handleSavePost({ type: 'savePost', captureId: id, metadata: { platform: 'x', url, userId: 'original-author', text: '元の本文', displayName: '元の投稿者', bio: '元のプロフィール', saveIncomplete: true } });
  const before = await persistAndReopen(id);
  const beforeProfile = profileSnapshot('x', 'original-author');
  await bridge.handleSavePost({ type: 'savePost', captureId: retryId, metadata: { platform: 'x', url, retryOf: id, userId: 'different-author', text: '別の本文', displayName: '別の投稿者', bio: '別のプロフィール' } });
  const db = openDatabase(dbFile);
  try {
    expect(drainInbox(folder, db.sqlite).skipped).toContainEqual(expect.objectContaining({ reason: 'retry-target-mismatch' }));
    expect((await postsByIds(db.sqlite, [id]))[0]).toEqual(before);
  } finally {
    db.sqlite.close();
  }
  expect(profileSnapshot('x', 'original-author')).toEqual(beforeProfile);
  expect(profileSnapshot('x', 'different-author')).toBeUndefined();
  fs.unlinkSync(path.join(inboxNewDir(folder), `${retryId}.json`));
});

test('取得不足の本文だけを保存しても再起動後に投稿全体の保存済みとは扱わない', async () => {
  const id = '1717500000007-ca04';
  const url = 'https://x.com/contract/status/904';
  await bridge.handleSavePost({ type: 'savePost', captureId: id, metadata: { platform: 'x', url, text: '取得できた本文', media: [], saveIncomplete: true } });
  expect(envelope(id).saveIncomplete).toBe(true);
  expect(await persistAndReopen(id)).toMatchObject({ text: '取得できた本文', saveIncomplete: true });
  const reader = openDatabase(dbFile);
  try {
    expect(buildSavedIndex(reader.sqlite).entries['x:904']).toMatchObject({ post: false });
  } finally {
    reader.sqlite.close();
  }
});

test('画像の一部が HTTP エラーでも成功した実ファイルと取得不足を永続化する', async () => {
  const id = '1717500000008-ca05';
  vi.stubGlobal('fetch', async (url: string | URL | Request) => (String(url).includes('missing') ? new Response('unavailable', { status: 403 }) : new Response(image, { headers: { 'content-type': 'image/png' } })));
  await bridge.handleSavePost({ type: 'savePost', captureId: id, metadata: { platform: 'x', url: 'https://x.com/contract/status/905', text: '画像つきの本文', media: [{ url: mediaUrl }, { url: 'https://pbs.twimg.com/media/missing.png' }], imageCount: 2 } });
  expect(envelope(id)).toMatchObject({ saveIncomplete: true });
  const post = await persistAndReopen(id);
  expect(post.saveIncomplete).toBe(true);
  expect(post.media).toHaveLength(1);
  expect(fs.readFileSync(path.join(folder, post.media[0].file))).toEqual(image);
});
