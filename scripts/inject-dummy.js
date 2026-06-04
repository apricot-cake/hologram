'use strict';

// Populate a save folder with dummy <id>.jpg + <id>.json pairs for testing the
// desktop viewer (filters, scrolling, layout).
//
//   node scripts/inject-dummy.js                 # write to the configured save folder
//   node scripts/inject-dummy.js "D:\\PostSnap"  # write to a specific folder

const fs = require('fs');
const os = require('os');
const path = require('path');

const { configDir } = require('../native-host/paths');

// A tiny solid JPEG used as a placeholder thumbnail for every dummy post.
const PLACEHOLDER_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==',
  'base64'
);

function resolveFolder() {
  const arg = process.argv[2];
  if (arg) return arg;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg.saveFolder) return cfg.saveFolder;
  } catch { /* no config */ }
  return path.join(os.homedir(), 'PostSnap');
}

const POSTS = [
  { platform: 'x', url: 'https://x.com/testuser1/status/100000001', displayName: 'てすと太郎', screenName: 'testuser1', userId: '111111',
    text: 'TypeScriptの型パズル、解けた時の快感がすごい。再帰型テンプレートリテラル最高 #typescript', likes: 24853, reposts: 3210, replies: 142, bookmarks: 891, views: 580000,
    mediaType: 'image', lang: 'ja', tags: ['TypeScript', 'プログラミング'] },
  { platform: 'x', url: 'https://x.com/testuser2/status/100000002', displayName: 'Dev Jane', screenName: 'testuser2', userId: '222222',
    text: 'Good morning! Starting the day with coffee and code.', likes: 5, reposts: 0, replies: 1, bookmarks: 0, views: 230,
    mediaType: 'none', lang: 'en', isReply: true },
  { platform: 'x', url: 'https://x.com/testuser3/status/100000003', displayName: 'サンプル花子', screenName: 'testuser3', userId: '333333',
    text: 'これは面白い視点。引用元の投稿も見てほしい', likes: 48, reposts: 12, replies: 3, bookmarks: 5, views: 8900,
    mediaType: 'none', lang: 'ja', isQuote: true, quotedUrl: 'https://x.com/someone/status/99999999' },
  { platform: 'x', url: 'https://x.com/testuser1/status/100000004', displayName: 'てすと太郎', screenName: 'testuser1', userId: '111111',
    text: 'スレッドの続き。MV3のService Workerはタイムアウトに注意。', likes: 320, reposts: 40, replies: 8, bookmarks: 22, views: 41000,
    mediaType: 'video', lang: 'ja', isThread: true },
  { platform: 'bluesky', url: 'https://bsky.app/profile/alice.bsky.social/post/3kabc', displayName: 'Alice', screenName: 'alice.bsky.social', userId: 'did:plc:alice',
    text: 'AT Protocol is fun to build on. Custom feeds are powerful.', likes: 152, reposts: 33, replies: 11,
    mediaType: 'image', lang: 'en', tags: ['atproto'] },
  { platform: 'bluesky', url: 'https://bsky.app/profile/bob.bsky.social/post/3kdef', displayName: 'ぼぶ', screenName: 'bob.bsky.social', userId: 'did:plc:bob',
    text: '日本語の投稿テスト。Blueskyも日本語ユーザー増えてきた', likes: 89, reposts: 5, replies: 2,
    mediaType: 'none', lang: 'ja', isReply: true },
  { platform: 'misskey', url: 'https://misskey.io/notes/dummy001', displayName: 'みすきー民', screenName: 'mkuser', userId: 'mk001',
    text: 'カスタム絵文字とMFMが楽しい :blobcat:', likes: 230, reposts: 18, replies: 7,
    mediaType: 'image', lang: 'ja', tags: ['Misskey'] },
  { platform: 'misskey', url: 'https://nijimiss.moe/notes/dummy002', displayName: 'にじみす民', screenName: 'nijifan', userId: 'nj001',
    text: 'にじみすのテーマ変更手順を動画にしました', likes: 45, reposts: 8, replies: 3,
    mediaType: 'video', lang: 'ja', isQuote: true, quotedUrl: 'https://misskey.io/notes/dummy004', tags: ['にじみす'] },
];

function main() {
  const folder = resolveFolder();
  fs.mkdirSync(folder, { recursive: true });
  const now = Date.now();

  POSTS.forEach((p, i) => {
    const captureId = `dummy-${String(i + 1).padStart(4, '0')}`;
    const capturedAt = new Date(now - i * 3600_000).toISOString();
    const date = new Date(now - (i + 1) * 86400_000).toISOString();
    const record = {
      captureId,
      image: `${captureId}.jpg`,
      url: p.url,
      platform: p.platform,
      text: p.text,
      displayName: p.displayName,
      screenName: p.screenName,
      userId: p.userId,
      likes: p.likes ?? null,
      reposts: p.reposts ?? null,
      replies: p.replies ?? null,
      bookmarks: p.bookmarks ?? null,
      views: p.views ?? null,
      date,
      capturedAt,
      mediaType: p.mediaType ?? null,
      lang: p.lang ?? null,
      isReply: p.isReply ?? null,
      isQuote: p.isQuote ?? null,
      isThread: p.isThread ?? null,
      quotedUrl: p.quotedUrl ?? null,
      tags: p.tags ?? []
    };
    fs.writeFileSync(path.join(folder, `${captureId}.jpg`), PLACEHOLDER_JPEG);
    fs.writeFileSync(path.join(folder, `${captureId}.json`), JSON.stringify(record, null, 2), 'utf8');
  });

  console.log(`Wrote ${POSTS.length} dummy posts to ${folder}`);
}

main();
