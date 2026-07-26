'use strict';

// Unit tests for native-host/post-record.mts — the shared post-record shape +
// normalization builder (#5 St2 / #295). Plain node, no Electron (see that
// file's header for why it is the one .mts sibling of native-host's .cts
// files and how require() resolves it — same mechanics as post-key.mts).
//
//   node scripts/test-post-record.cts

const assert = require('node:assert');
const { normalizePostRecord } = require('../native-host/post-record.mts');

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
}

const FIXED_NOW = '2026-07-24T00:00:00.000Z';
const fixedNow = () => FIXED_NOW;

// --- defaults -----------------------------------------------------------

{
  const rec = normalizePostRecord({ captureId: 'cap-1' }, fixedNow);
  assert.strictEqual(rec.captureId, 'cap-1', 'carries the one field every producer supplies itself');
  assert.strictEqual(rec.assetClass, 'media', "defaults assetClass to 'media' (#236 confirmed default)");
  assert.strictEqual(rec.capturedAt, FIXED_NOW, 'capturedAt falls back to now() when absent');
  assert.strictEqual(rec.updatedAt, FIXED_NOW, 'updatedAt falls back to capturedAt when absent (mirrors buildRecord in extension/background.ts)');
  ok(Array.isArray(rec.hashtags) && rec.hashtags.length === 0, 'hashtags defaults to []');
  ok(Array.isArray(rec.tags) && rec.tags.length === 0, 'tags defaults to []');
  ok(Array.isArray(rec.media) && rec.media.length === 0, 'media defaults to []');
  for (const k of ['mediaType', 'image', 'url', 'platform', 'text', 'title', 'displayName', 'screenName', 'userId', 'avatar', 'avatarFile', 'authorCreatedAt', 'date', 'capturedVia', 'lang', 'quotedUrl', 'replyToId', 'eagleName', 'description', 'source', 'trashedAt']) {
    assert.strictEqual(rec[k], null, `${k} defaults to null`);
  }
  for (const k of ['followers', 'likes', 'reposts', 'replies', 'bookmarks', 'views', 'shotW', 'shotH']) {
    assert.strictEqual(rec[k], null, `${k} defaults to null`);
  }
  for (const k of ['isReply', 'isQuote', 'isThread']) {
    assert.strictEqual(rec[k], null, `${k} defaults to null (tri-state, not false)`);
  }
  passed += 2 + 18 + 8 + 3;
}

// --- pass-through + coercion --------------------------------------------

{
  const rec = normalizePostRecord(
    {
      captureId: 'cap-2',
      url: 'https://bsky.app/profile/a/post/b',
      likes: 42,
      isReply: true,
      hashtags: ['a', 'b', 3, null],
      media: [{ url: 'https://x/1.jpg', width: 10, height: 20, file: '1.jpg' }, { file: '2.jpg' }, null, { url: 'https://x/2.mp4', file: '2.mp4', type: 'video', posterFile: 'poster.jpg' }],
      capturedAt: '2026-01-01T00:00:00.000Z',
      capturedVia: 'x-bookmarks',
    },
    fixedNow,
  );
  assert.strictEqual(rec.url, 'https://bsky.app/profile/a/post/b', 'explicit fields pass through unchanged');
  assert.strictEqual(rec.likes, 42, 'numeric fields pass through');
  assert.strictEqual(rec.isReply, true, 'boolean fields pass through');
  assert.deepStrictEqual(rec.hashtags, ['a', 'b'], 'non-string hashtag entries are dropped, not coerced');
  assert.strictEqual(rec.media.length, 3, 'a null media entry is dropped, not kept as a hole');
  assert.deepStrictEqual(rec.media[0], { url: 'https://x/1.jpg', alt: null, width: 10, height: 20, file: '1.jpg', type: null, posterFile: null }, 'media items are normalized field-by-field, not passed through raw');
  assert.deepStrictEqual(rec.media[1], { url: '', alt: null, width: null, height: null, file: '2.jpg', type: null, posterFile: null }, 'a media item missing url still gets every field');
  assert.deepStrictEqual(rec.media[2], { url: 'https://x/2.mp4', alt: null, width: null, height: null, file: '2.mp4', type: 'video', posterFile: 'poster.jpg' }, 'a video media item carries type + posterFile through (#119 St1)');
  assert.strictEqual(rec.capturedAt, '2026-01-01T00:00:00.000Z', 'an explicit capturedAt is kept, not overwritten by now()');
  assert.strictEqual(rec.updatedAt, '2026-01-01T00:00:00.000Z', 'updatedAt falls back to the explicit capturedAt, not now()');
  assert.strictEqual(rec.capturedVia, 'x-bookmarks', 'capturedVia passes through (#362 bulk-intake route marker)');
  passed += 10;
}

// --- the exact bug this builder exists to prevent (#5 2026-07-18 comment) --

{
  // ipc-transfer.mts's import-posts hand-lists ~30 fields and was found to
  // silently drop media[] and replyToId. A shared builder cannot drop a field
  // any producer supplies — it can only default one a producer omits.
  const rec = normalizePostRecord(
    {
      captureId: 'cap-3',
      media: [{ url: 'https://x/1.jpg', file: '1.jpg' }],
      replyToId: 'parent-123',
    },
    fixedNow,
  );
  assert.strictEqual(rec.media.length, 1, 'media supplied by the producer survives normalization');
  assert.strictEqual(rec.replyToId, 'parent-123', 'replyToId supplied by the producer survives normalization');
  passed += 2;
}

console.log(`PASS test-post-record: ${passed} assertions`);
