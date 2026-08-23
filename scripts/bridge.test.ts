// Native Messaging ブリッジのスモークテスト。'save' のメッセージをフレームに包んで
// bridge.mts へ流し込み（config ディレクトリを差し替えて一時の保存フォルダを使わせる）、
// JPEG と inbox のエンベロープ（#5 St6 / #299＝サイドカーを直に書く方式の後継）が
// 書かれること、ack の形が正しいことを見る。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PROTOCOL_VERSION } from '../native-host/protocol.mts';
import { unpackRawPayload } from '../native-host/raw-payload.mts';

// 最小の 1x1 JPEG
const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';

const captureId = '1717500000000-abcd';
const RAW_BODY = '{"text":"hi","unknown_future_field":42}';

let tmp: string;
let saveFolder: string;
let resp: any;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-test-'));
  const configDir = path.join(tmp, 'Hologram');
  saveFolder = path.join(tmp, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

  const msg = Buffer.from(
    JSON.stringify({
      type: 'save',
      captureId,
      image: jpegB64,
      metadata: {
        url: 'https://x.com/u/status/1',
        platform: 'x',
        text: 'hi',
        tags: ['t'],
        // 拡張機能は応答の本文をそのまま素通しするだけ＝圧縮・ハッシュ・上限はブリッジ側 (#292)
        rawPayloads: [{ sourceKind: 'api:x/tweet-result', acquiredAt: '2026-07-28T00:00:00.000Z', contentType: 'application/json', body: RAW_BODY }],
      },
    }),
    'utf8',
  );
  const header = Buffer.alloc(4);
  header.writeUInt32LE(msg.length, 0);

  const child = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'native-host', 'bridge.mts')], {
    env: { ...process.env, APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir },
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

  resp = JSON.parse(out.subarray(4, 4 + out.readUInt32LE(0)).toString('utf8'));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('ack が ok で返る', () => {
  expect(resp.ok).toBe(true);
});

// #205: 拡張機能が「アプリと拡張機能の版が合っているか」を判断する材料は、この数字だけ。
// 単体で見るなら stampProtocol を見れば足りるが、それが実際に通信路上へ出ているかどうかは、
// プロセスを起こしてみないと分からない（印が付くのは返信の出口であって、ハンドラの中ではない）。
test('ack は自分のプロトコル版を名乗る（#205）', () => {
  expect(resp.protocolVersion).toBe(PROTOCOL_VERSION);
});

// 成功のときだけではなく、失敗の返信にも ping の返信にも印は乗らなければいけない。保存を
// 断るほど古いホストこそ、版を知りたい相手そのもの。ここで落とすと、いちばん要る場面で
// 検知が効かなくなる。
describe('返信は種類を問わず版を名乗る（#205）', () => {
  let replies: any[];

  beforeAll(async () => {
    replies = await askHost(tmp, [{ type: 'ping' }, { type: 'nonsense' }, { type: 'log', entry: { stage: 'select', phase: 'fail' } }]);
  });

  test('3件とも返り、すべてに版が乗る', () => {
    expect(replies).toHaveLength(3);
    for (const reply of replies) expect(reply.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  test('未知の type は失敗として返る＝版だけ乗せて黙る形にはしない', () => {
    expect(replies[1]).toMatchObject({ ok: false, code: 'unknown-type' });
  });
});

// 1つの接続に複数のフレームを流し込み、返ってきたフレームを全部読み取る。
// bridge.mts は stdin を読み終えれば自然に終了するので、close を待てば取りこぼさない。
async function askHost(configRoot: string, messages: unknown[]): Promise<any[]> {
  const configDir = path.join(configRoot, 'Hologram');
  const frames = messages.map((m) => {
    const body = Buffer.from(JSON.stringify(m), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    return Buffer.concat([header, body]);
  });
  const child = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'native-host', 'bridge.mts')], {
    env: { ...process.env, APPDATA: configRoot, HOLOGRAM_CONFIG_DIR: configDir },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  let out = Buffer.alloc(0);
  child.stdout.on('data', (d) => {
    out = Buffer.concat([out, d]);
  });
  const closed = new Promise((r) => child.on('close', r));
  child.stdin.write(Buffer.concat(frames));
  child.stdin.end();
  await closed;

  const parsed: any[] = [];
  let offset = 0;
  while (offset + 4 <= out.length) {
    const len = out.readUInt32LE(offset);
    if (offset + 4 + len > out.length) break;
    parsed.push(JSON.parse(out.subarray(offset + 4, offset + 4 + len).toString('utf8')));
    offset += 4 + len;
  }
  return parsed;
}

// #650:「いまディスクにあるローカルビルド」がどの返信にも乗る＝拡張機能はこれを見て自分を
// 読み込み直す。これを実プロセスを起こして見る理由は、版の印と同じ（印が付くのは返信の出口の
// 1か所だけで、ハンドラを読んでも実際に出ているかは分からない）。加えてこれはファイルの有無で
// 挙動が変わるので、無いときに何も言わないことがなお重要になる＝拡張機能を一度もビルドして
// いない利用者は、全員その状態にいる。
describe('ローカルビルドの印（#650）', () => {
  test('印のファイルが無ければ、返信は何も言わない', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-nostamp-'));
    try {
      fs.mkdirSync(path.join(bare, 'Hologram'), { recursive: true });
      const [reply] = await askHost(bare, [{ type: 'ping' }]);
      expect(reply).toMatchObject({ ok: true, pong: true });
      expect(reply.extBuild).toBeUndefined();
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  test('印のファイルがあれば、成功にも失敗にも同じトークンが乗る', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-stamp-'));
    try {
      const dir = path.join(root, 'Hologram');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'extension-build.json'), JSON.stringify({ build: '1785000000000-feedface' }));
      const replies = await askHost(root, [{ type: 'ping' }, { type: 'nonsense' }]);
      expect(replies).toHaveLength(2);
      for (const reply of replies) expect(reply.extBuild).toBe('1785000000000-feedface');
      expect(replies[1]).toMatchObject({ ok: false, code: 'unknown-type' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('壊れた印（JSON でない・build が無い）は「無い」と同じ＝ホストは黙る', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-badstamp-'));
    try {
      const dir = path.join(root, 'Hologram');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'extension-build.json'), '{"build":');
      expect((await askHost(root, [{ type: 'ping' }]))[0].extBuild).toBeUndefined();
      fs.writeFileSync(path.join(dir, 'extension-build.json'), JSON.stringify({ builtAt: 'x' }));
      expect((await askHost(root, [{ type: 'ping' }]))[0].extBuild).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('保存されたもの', () => {
  test('JPEG と inbox エンベロープが書かれる（sidecar は書かれない）', () => {
    expect(fs.existsSync(path.join(saveFolder, 'items', captureId, `${captureId}.jpg`))).toBe(true);
    expect(fs.existsSync(path.join(saveFolder, `${captureId}.json`))).toBe(false);
    expect(fs.existsSync(path.join(saveFolder, '.hologram-inbox', 'new', `${captureId}.json`))).toBe(true);
  });

  test('エンベロープの record が captureId / image / url を持つ', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(saveFolder, '.hologram-inbox', 'new', `${captureId}.json`), 'utf8'));
    expect(envelope).toMatchObject({ format: 'hologram-inbox', version: 1, eventId: captureId, kind: 'post.capture' });
    expect(envelope.record).toMatchObject({ captureId, image: `items/${captureId}/${captureId}.jpg`, url: 'https://x.com/u/status/1' });
  });

  // #292: 拡張機能が渡した応答の本文は、ブリッジが圧縮してハッシュを取り、エンベロープへ
  // 載せる＝あとでアプリが送り出すとき、そのまま raw_payloads へ届くようにしてある。
  test('取得原本が畳まれてエンベロープに載る（本文へ復元できる）', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(saveFolder, '.hologram-inbox', 'new', `${captureId}.json`), 'utf8'));
    expect(envelope.record.raw).toHaveLength(1);
    expect(envelope.record.raw[0]).toMatchObject({ sourceKind: 'api:x/tweet-result', acquiredAt: '2026-07-28T00:00:00.000Z', contentType: 'application/json', encoding: 'gzip', byteLength: Buffer.byteLength(RAW_BODY, 'utf8') });
    expect(unpackRawPayload({ encoding: 'gzip', sha256: envelope.record.raw[0].sha256, payload: Buffer.from(envelope.record.raw[0].payloadBase64, 'base64') })).toBe(RAW_BODY);
  });
});

// #290: 実際のブリッジのプロセスを通した end-to-end の配線＝拡張機能が名乗った
// customEmojis[]（URL だけ）が handleSave へ届き、それに対して downloadCustomEmojis が走り、
// エンベロープの record が結果を運ぶ。fetch は差し替えない。example.invalid (RFC 2606) は
// 決して解決しないので、本番で絵文字のホストが死んでいるときと同じ、できる範囲での失敗の
// 経路をそのまま通る（ok:true・file は null・保存自体は無事）。生きたサーバーには依存しない。
describe('customEmojis のダウンロードが往復する（#290）', () => {
  const emojiCaptureId = '1717500000000-e001';
  let emojiTmp: string;
  let emojiSaveFolder: string;
  let emojiResp: any;

  beforeAll(async () => {
    emojiTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-test-emoji-'));
    const configDir = path.join(emojiTmp, 'Hologram');
    emojiSaveFolder = path.join(emojiTmp, 'saves');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: emojiSaveFolder }));

    const msg = Buffer.from(
      JSON.stringify({
        type: 'save',
        captureId: emojiCaptureId,
        image: jpegB64,
        metadata: {
          url: 'https://misskey.io/notes/n1',
          platform: 'misskey',
          text: ':ha_to:',
          customEmojis: [{ shortcode: 'ha_to', url: 'https://emoji.example.invalid/ha_to.png' }],
        },
      }),
      'utf8',
    );
    const header = Buffer.alloc(4);
    header.writeUInt32LE(msg.length, 0);

    const child = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'native-host', 'bridge.mts')], {
      env: { ...process.env, APPDATA: emojiTmp, HOLOGRAM_CONFIG_DIR: configDir },
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
    emojiResp = JSON.parse(out.subarray(4, 4 + out.readUInt32LE(0)).toString('utf8'));
  });

  afterAll(() => {
    fs.rmSync(emojiTmp, { recursive: true, force: true });
  });

  test('取得できない絵文字ホストでも保存自体は成功する（ベストエフォート）', () => {
    expect(emojiResp.ok).toBe(true);
  });

  test('エンベロープの record.customEmojis に shortcode/url は残り、file はダウンロード失敗で null', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(emojiSaveFolder, '.hologram-inbox', 'new', `${emojiCaptureId}.json`), 'utf8'));
    expect(envelope.record.customEmojis).toEqual([{ shortcode: 'ha_to', url: 'https://emoji.example.invalid/ha_to.png', file: null }]);
  });

  test('emoji/ 共有ストアは作られない（1件も落ちてこなかったため）', () => {
    expect(fs.existsSync(path.join(emojiSaveFolder, 'emoji'))).toBe(false);
  });
});
