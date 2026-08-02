'use strict';
// THROWAWAY verification script for #365 — deletes itself from git history (never
// committed). Seeds a handful of genuinely text-only posts (no image/video/media
// at all) into the already-running sandbox library, at varying text lengths so
// every textPlateAspect step is exercised.
const path = require('node:path');
const { seedLibrary } = require('./lib-seed-library.cts');

const repoRoot = path.join(__dirname, '..');
const configDir = path.join(repoRoot, '.sandbox', 'config');

const short = 'コーヒー淹れた。';
const medium = 'x'.repeat(150) + ' 今日はいい天気だった。散歩に出かけて、途中で見つけたカフェで一息ついた。窓際の席は日差しが強くて、少し眩しかったけれど気持ちよかった。';
const long = 'y'.repeat(300) + ' 長い長い投稿本文のテスト。'.repeat(6);
const veryLong = 'z'.repeat(500) + ' さらに長い投稿本文のテスト。'.repeat(10);

const base = Date.parse('2026-08-01T09:00:00Z');
const posts = [
  { captureId: 'txt-short', url: 'https://x.com/tester/status/9001', platform: 'x', text: short, displayName: 'テキスト太郎', screenName: 'txt_taro', userId: '9001', mediaType: null, date: new Date(base).toISOString(), capturedAt: new Date(base + 60000).toISOString(), tags: [] },
  { captureId: 'txt-medium', url: 'https://x.com/tester/status/9002', platform: 'x', text: medium, displayName: 'テキスト太郎', screenName: 'txt_taro', userId: '9001', mediaType: null, date: new Date(base - 86400000).toISOString(), capturedAt: new Date(base - 86400000 + 60000).toISOString(), tags: [] },
  {
    captureId: 'txt-long',
    url: 'https://bsky.app/profile/tester.bsky.social/post/txt003',
    platform: 'bluesky',
    text: long,
    displayName: 'ながぶん',
    screenName: 'nagabun.bsky.social',
    userId: 'did:plc:txt003',
    mediaType: null,
    date: new Date(base - 2 * 86400000).toISOString(),
    capturedAt: new Date(base - 2 * 86400000 + 60000).toISOString(),
    tags: [],
  },
  { captureId: 'txt-verylong', url: 'https://misskey.io/notes/txt004', platform: 'misskey', text: veryLong, displayName: 'まいまい', screenName: 'maimai', userId: 'txt004', mediaType: null, date: new Date(base - 3 * 86400000).toISOString(), capturedAt: new Date(base - 3 * 86400000 + 60000).toISOString(), tags: [] },
];

seedLibrary(configDir, posts);
console.log(`seeded ${posts.length} text-only posts (no image/video/media) for #365 visual pass`);
