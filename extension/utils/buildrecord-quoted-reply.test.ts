// #751: buildRecord() (extension/utils/background.ts) は、返すオブジェクトに
// quotedPost/replyToPost のキーを一切持っていなかった。そのため extractor が作る #180 の
// サイドカーのサブレコードが CaptureMetadata まで届かない＝既存のどのテストも捕まえて
// いなかった黙った欠落。extractor-quoted.test.ts / post-record.test.ts /
// db-query.test.ts のどれもが buildRecord の1層手前で止まっているため（extractor の
// ユニット／normalizePostRecord のユニット／DB の往復）。このテストは拡張機能が実際に呼ぶ
// buildRecord() を通り、その先で本物の bridge.mts のプロセスまで行く（bridge.test.ts と
// 同じ spawn とフレーム分けの型）。どちらの結線が壊れても、また黙って通るのではなくここで
// 落ちる。
//
// #179 のアンケートがここに相乗りしているのは、まったく同じ理由。これも extractor が
// 組み立てるサブ構造で、レコードへ至る唯一の道が buildRecord の1行しかない。その1行が
// 抜けても、周りの層ごとの単体テストは全部緑のままになる。
//
// bridge.test.ts 自体からは外し、tsconfig.test.json で隔離してある
// （background-unit.test.ts と同じ理由）。extension/utils/background.ts を import すると、
// その chrome.* の参照がこの Node 向けの Vitest プロジェクトへ引き込まれるが、こちらには
// 環境の chrome 型が無い。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildRecord } from './background';

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
  // #179: extractor が作るアンケートの形。
  const poll = {
    choices: [
      { text: 'きのこ', votes: 12 },
      { text: 'たけのこ', votes: 34 },
    ],
    multiple: false,
    expiresAt: '2026-01-03T00:00:00.000Z',
  };
  // #181: extractor が作る、投稿が告知するリンクカードの形 (bluesky.ts / x.ts)。
  // thumbnail は null のままにして、このテストが実際の通信を一度も使わないように
  // する＝downloadSavedLinkCard 自身のできる範囲で済ませる分岐が、取りにいく先が無ければ
  // ダウンロードそのものを飛ばす。このテストが既に通している media 無し・アバター無しの
  // 場合と同じ。
  const linkCard = { url: 'https://example.com/article', title: 'A great article', description: 'It explains things.', thumbnail: null };

  beforeAll(async () => {
    quoteTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-test-quote-'));
    const configDir = path.join(quoteTmp, 'Hologram');
    quoteSaveFolder = path.join(quoteTmp, 'saves');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: quoteSaveFolder }));

    // extractor が buildRecord へ渡すのと同じ形＝url/platform/text に、#180 の
    // サイドカー2つ。通信路上のメッセージを手で打つのではなく、本物の buildRecord() を
    // 通している。それがこのテストを、bridge.mts の詰め替えだけでなく buildRecord 自体の
    // 退行にも効かせている。
    const meta = { url: 'https://x.com/alice/status/1', platform: 'x', text: 'hi, quoting and replying', quotedPost, replyToPost, poll, linkCard };
    const metadata = buildRecord(meta, { captureId: quoteCaptureId, capturedAt: '2026-08-02T00:00:00.000Z', postUrl: meta.url, sendPlatform: 'x', extra: {} });

    const msg = Buffer.from(JSON.stringify({ type: 'savePost', captureId: quoteCaptureId, metaOk: true, metadata }), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(msg.length, 0);

    const child = spawn(process.execPath, [path.join(import.meta.dirname, '../../native-host/bridge.mts')], {
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

  test('エンベロープの record.quotedPost/replyToPost に抽出器のサブレコードがそのまま乗る', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(quoteSaveFolder, '.hologram-inbox', 'new', `${quoteCaptureId}.json`), 'utf8'));
    expect(envelope.record.quotedPost).toMatchObject(quotedPost);
    expect(envelope.record.replyToPost).toMatchObject(replyToPost);
  });

  test('エンベロープの record.poll に抽出器のアンケートがそのまま乗る（#179）', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(quoteSaveFolder, '.hologram-inbox', 'new', `${quoteCaptureId}.json`), 'utf8'));
    expect(envelope.record.poll).toEqual(poll);
  });

  test('エンベロープの record.linkCard に抽出器のリンクカードが url/title/description ごと乗る（#181）', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(quoteSaveFolder, '.hologram-inbox', 'new', `${quoteCaptureId}.json`), 'utf8'));
    expect(envelope.record.linkCard).toEqual({ url: linkCard.url, title: linkCard.title, description: linkCard.description, thumbnailFile: null });
  });
});
