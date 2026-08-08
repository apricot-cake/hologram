// #751: buildRecord() (extension/utils/background.ts) had no quotedPost/replyToPost
// keys in its returned object at all, so the extractors' #180 sidecar sub-records
// never reached CaptureMetadata -- a silent drop no existing test caught, because
// extractor-quoted.test.ts / post-record.test.ts / db-query.test.ts each stop one
// layer short of buildRecord (extractor unit / normalizePostRecord unit / DB
// round-trip). This test goes through the actual buildRecord() the extension
// calls, then the real bridge.mts process (same spawn-and-frame pattern as
// bridge.test.ts), so a regression in either wiring point fails here rather than
// passing silently again.
//
// #179's poll rides along here for exactly the same reason: it is another
// extractor-built sub-structure whose only route to the record is one line in
// buildRecord, and the per-layer unit tests around it would all stay green if
// that line were missing.
//
// Kept out of bridge.test.ts itself and quarantined in tsconfig.test.json (same
// reason as background-unit.test.ts): importing extension/utils/background.ts
// pulls its chrome.* references into this Node-oriented Vitest project, which has
// no ambient chrome types.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildRecord } from '../extension/utils/background';

// Minimal 1x1 JPEG (same fixture bridge.test.ts uses).
const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';

describe('quotedPost/replyToPost/poll が buildRecord から bridge.mts まで往復する（#751 / #179）', () => {
  const quoteCaptureId = '1717500000000-a001';
  let quoteTmp: string;
  let quoteSaveFolder: string;
  let quoteResp: any;

  const quotedPost = {
    url: 'https://x.com/bob/status/2',
    displayName: 'Bob',
    screenName: 'bob',
    userId: 'u2',
    avatar: null,
    text: 'the original post',
    date: '2026-01-01T00:00:00.000Z',
    cw: null,
    media: [],
  };
  const replyToPost = {
    url: 'https://x.com/carol/status/3',
    displayName: 'Carol',
    screenName: 'carol',
    userId: 'u3',
    avatar: null,
    text: 'the post being replied to',
    date: '2026-01-02T00:00:00.000Z',
    cw: null,
    media: [],
  };
  // #179: the poll shape an extractor produces (x.ts / misskey.ts / mastodon.ts).
  const poll = {
    choices: [
      { text: 'きのこ', votes: 12 },
      { text: 'たけのこ', votes: 34 },
    ],
    multiple: false,
    expiresAt: '2026-01-03T00:00:00.000Z',
    votersCount: null,
  };
  // #181: the announced link-card shape an extractor produces (bluesky.ts /
  // mastodon.ts / x.ts). thumbnail stays null so this test never spends a
  // real network fetch — downloadSavedLinkCard's own best-effort branch skips
  // the download entirely when there is nothing to fetch, same as the
  // no-media/no-avatar case this test already exercises.
  const linkCard = { url: 'https://example.com/article', title: 'A great article', description: 'It explains things.', thumbnail: null };

  beforeAll(async () => {
    quoteTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-test-quote-'));
    const configDir = path.join(quoteTmp, 'Hologram');
    quoteSaveFolder = path.join(quoteTmp, 'saves');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: quoteSaveFolder }));

    // Same shape an extractor hands buildRecord: url/platform/text plus the two
    // #180 sidecars. Routed through the real buildRecord(), not hand-typed as the
    // wire message — that's what makes this catch a regression in buildRecord
    // itself rather than only in bridge.mts's marshalling.
    const meta = { url: 'https://x.com/alice/status/1', platform: 'x', text: 'hi, quoting and replying', quotedPost, replyToPost, poll, linkCard };
    const metadata = buildRecord(meta, { captureId: quoteCaptureId, capturedAt: '2026-08-02T00:00:00.000Z', postUrl: meta.url, sendPlatform: 'x', extra: { image: `${quoteCaptureId}.jpg` } });

    const msg = Buffer.from(JSON.stringify({ type: 'save', captureId: quoteCaptureId, image: jpegB64, metadata }), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(msg.length, 0);

    const child = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'native-host', 'bridge.mts')], {
      env: { ...process.env, APPDATA: quoteTmp, HOLOGRAM_CONFIG_DIR: configDir },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let out = Buffer.alloc(0);
    child.stdout.on('data', (d) => {
      out = Buffer.concat([out, d]);
    });
    const closed = new Promise((r) => child.on('close', r));
    child.stdin.write(Buffer.concat([header, msg]));
    child.stdin.end();
    await closed;
    quoteResp = JSON.parse(out.subarray(4, 4 + out.readUInt32LE(0)).toString('utf8'));
  });

  afterAll(() => {
    fs.rmSync(quoteTmp, { recursive: true, force: true });
  });

  test('ack が ok で返る', () => {
    expect(quoteResp.ok).toBe(true);
  });

  test('封筒の record.quotedPost/replyToPost に抽出器のサブレコードがそのまま乗る', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(quoteSaveFolder, '.hologram-inbox', 'new', `${quoteCaptureId}.json`), 'utf8'));
    expect(envelope.record.quotedPost).toMatchObject(quotedPost);
    expect(envelope.record.replyToPost).toMatchObject(replyToPost);
  });

  test('封筒の record.poll に抽出器のアンケートがそのまま乗る（#179）', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(quoteSaveFolder, '.hologram-inbox', 'new', `${quoteCaptureId}.json`), 'utf8'));
    expect(envelope.record.poll).toEqual(poll);
  });

  test('封筒の record.linkCard に抽出器のリンクカードが url/title/description ごと乗る（#181）', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(quoteSaveFolder, '.hologram-inbox', 'new', `${quoteCaptureId}.json`), 'utf8'));
    expect(envelope.record.linkCard).toEqual({ url: linkCard.url, title: linkCard.title, description: linkCard.description, thumbnailFile: null });
  });
});
