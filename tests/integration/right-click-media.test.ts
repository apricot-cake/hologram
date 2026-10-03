// native host の右クリックメディア保存のテスト。fetch は差し替えるので
// ネットワークは要らない。handleSaveMedia が、選ばれた画像や動画を主メディア
// として落とすこと、media[] をその1件にすること、API 由来のメタ
// データを保つこと、pixiv の Referer を送ること、失敗時に孤児を残さないことを見る。

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

// bridge.mts は読み込み時に configDir を解決するので、先に config.json を置いてから動的に
// import する（setup が用意した HOLOGRAM_CONFIG_DIR のサンドボックスを使う）。
let handleSaveMedia: any;
let saveFolder: string;

beforeAll(async () => {
  const configDir = process.env.HOLOGRAM_CONFIG_DIR as string;
  saveFolder = path.join(configDir, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

  ({ handleSaveMedia } = await import('../../native-host/bridge.mts'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('成功時', () => {
  let sentHeaders: any;
  let res: any;

  beforeAll(async () => {
    // 本物の Response を返す＝取得は本文をそのままディスクへ流す (#389)
    vi.stubGlobal('fetch', async (_url: string, opts: any) => {
      sentHeaders = opts?.headers;
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    });

    res = await handleSaveMedia({
      captureId: '1717500000000-ab01',
      mediaUrl: 'https://i.pximg.net/img-original/x/555_p0.png',
      mediaReferer: 'https://www.pixiv.net/',
      metadata: {
        url: 'https://www.pixiv.net/artworks/555',
        platform: 'pixiv',
        title: 'T',
        screenName: '77',
        hashtags: ['a'],
        tags: [],
        likes: 5,
        media: [{ url: 'should-be-overridden' }],
      },
    });
  });

  test('ack が返る', () => {
    expect(res.ok).toBe(true);
  });

  test('主画像は <base>.png（JPEG 以外でも）', () => {
    expect(res.file).toBe('items/1717500000000-ab01/1717500000000-ab01.png');
  });

  test('png と inbox エンベロープがディスクに書かれる（sidecar は書かれない）', () => {
    expect(fs.existsSync(path.join(saveFolder, 'items', '1717500000000-ab01', '1717500000000-ab01.png'))).toBe(true);
    expect(fs.existsSync(path.join(saveFolder, '1717500000000-ab01.json'))).toBe(false);
    expect(fs.existsSync(path.join(saveFolder, '.hologram-inbox', 'new', '1717500000000-ab01.json'))).toBe(true);
  });

  // media は「落とした1枚」＝このレコードがどの絵を持っているかの記録 (#334)。呼び出し側が
  // 名乗った media[] を上書きする＝この保存が実際に持つのは、投稿全体ではなく指された1枚だけ。
  // ライトボックスは media があればそれを読み、無ければ image へ落ちる（records.ts の
  // artworkFile/groupFilesOf）ので、両者が同じ1枚を指していても重複は生まれない。
  test('レコードは image と、落とした1枚だけの media を持つ', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(saveFolder, '.hologram-inbox', 'new', '1717500000000-ab01.json'), 'utf8'));
    expect(envelope.record.image).toBe('items/1717500000000-ab01/1717500000000-ab01.png');
    expect(envelope.record.media).toHaveLength(1);
    expect(envelope.record.media[0]).toMatchObject({
      url: 'https://i.pximg.net/img-original/x/555_p0.png',
      file: 'items/1717500000000-ab01/1717500000000-ab01.png',
    });
  });

  test('ack はその絵の URL を返す（保存直後のバッジが絵単位で答えられる）', () => {
    expect(res.media).toEqual(['https://i.pximg.net/img-original/x/555_p0.png']);
  });

  test('API 由来のメタデータが保たれる', () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(saveFolder, '.hologram-inbox', 'new', '1717500000000-ab01.json'), 'utf8'));
    expect(envelope.record).toMatchObject({ platform: 'pixiv', title: 'T', screenName: '77', likes: 5 });
  });

  test('主画像のダウンロードに pixiv の Referer を付ける', () => {
    expect(sentHeaders.Referer).toBe('https://www.pixiv.net/');
  });

  test('ack 消失後の同一 captureId 再送は再取得せず同じ保存結果を返す', async () => {
    const fetchAgain = vi.fn(async () => {
      throw new Error('同一要求で再取得してはいけない');
    });
    vi.stubGlobal('fetch', fetchAgain);
    const retried = await handleSaveMedia({
      captureId: '1717500000000-ab01',
      mediaUrl: 'https://i.pximg.net/img-original/x/555_p0.png',
      mediaReferer: 'https://www.pixiv.net/',
      metadata: { url: 'https://www.pixiv.net/artworks/555', platform: 'pixiv', title: 'T', screenName: '77', hashtags: ['a'], tags: [], likes: 5, media: [{ url: 'should-be-overridden' }] },
    });
    expect(fetchAgain).not.toHaveBeenCalled();
    expect(retried).toEqual(res);
    expect(fs.existsSync(path.join(saveFolder, 'items', '1717500000000-ab01-2'))).toBe(false);
  });
});

describe('動画', () => {
  test('動画は video と media[] に保存し、image へ入れない', async () => {
    vi.stubGlobal('fetch', async () => new Response(Buffer.from('video'), { status: 200, headers: { 'content-type': 'video/mp4' } }));

    const res = await handleSaveMedia({
      captureId: '1717500000002-ab03',
      mediaUrl: 'https://cdn.example.com/clip.mp4',
      mediaReferer: 'https://example.com/article',
      mediaAlt: '動画の説明',
      mediaType: 'video',
      metadata: { url: 'https://example.com/article', title: 'Clip', source: 'web' },
    });

    expect(res.file).toBe('items/1717500000002-ab03/1717500000002-ab03-media-0.mp4');
    expect(fs.existsSync(path.join(saveFolder, 'items', '1717500000002-ab03', '1717500000002-ab03-media-0.mp4'))).toBe(true);
    const envelope = JSON.parse(fs.readFileSync(path.join(saveFolder, '.hologram-inbox', 'new', '1717500000002-ab03.json'), 'utf8'));
    expect(envelope.record.image).toBeNull();
    expect(envelope.record.video).toBe('items/1717500000002-ab03/1717500000002-ab03-media-0.mp4');
    expect(envelope.record.mediaType).toBe('video');
    expect(envelope.record.media).toHaveLength(1);
    expect(envelope.record.media[0]).toMatchObject({
      url: 'https://cdn.example.com/clip.mp4',
      file: 'items/1717500000002-ab03/1717500000002-ab03-media-0.mp4',
      type: 'video',
      alt: '動画の説明',
    });
  });
});

describe('失敗時', () => {
  test('未対応の content-type は throw し、孤児 inbox エンベロープを残さない', async () => {
    vi.stubGlobal('fetch', async () => new Response(Buffer.from('x'), { status: 200, headers: { 'content-type': 'text/html' } }));

    await expect(handleSaveMedia({ captureId: '1717500000001-ab02', mediaUrl: 'https://x/y', metadata: {} })).rejects.toThrow();
    expect(fs.existsSync(path.join(saveFolder, '1717500000001-ab02.json'))).toBe(false);
    expect(fs.existsSync(path.join(saveFolder, '.hologram-inbox', 'new', '1717500000001-ab02.json'))).toBe(false);
    // 一時ファイルも残らない（この経路は本文を1バイトも書く前に失敗する）
    expect(fs.readdirSync(saveFolder).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('receipt の補助I/O', () => {
  test('保存commit後のcompleted receipt失敗を保存失敗へ変えない', async () => {
    vi.stubGlobal('fetch', async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
    const realRename = fs.renameSync;
    let receiptWrites = 0;
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (String(to).includes(`${path.sep}requests${path.sep}1717500000003-ab04${path.sep}result.json`) && ++receiptWrites === 2) throw new Error('receipt disk full');
      return realRename(from, to);
    }) as typeof fs.renameSync);
    const ack = await handleSaveMedia({ captureId: '1717500000003-ab04', mediaUrl: 'https://example.com/io.png', metadata: { url: 'https://example.com/io' } });
    expect(ack.ok).toBe(true);
    expect(fs.existsSync(path.join(saveFolder, '.hologram-inbox', 'new', '1717500000003-ab04.json'))).toBe(true);
    rename.mockRestore();
    const receiptFile = path.join(saveFolder, '.hologram-inbox', 'requests', '1717500000003-ab04', 'result.json');
    const processing = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
    fs.writeFileSync(receiptFile, JSON.stringify({ ...processing, ownerPid: 2147483647 }));
    await expect(handleSaveMedia({ captureId: '1717500000003-ab04', requestNonce: 'f'.repeat(32), mediaUrl: 'https://example.com/different.png', metadata: { url: 'https://example.com/different' } })).rejects.toThrow(/different save payload/);
  });

  test('期限切れcompleted receiptをbounded compactionで除去する', async () => {
    vi.stubGlobal('fetch', async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
    const oldId = '1717500000004-ab05';
    const oldDir = path.join(saveFolder, '.hologram-inbox', 'requests', oldId);
    fs.mkdirSync(oldDir, { recursive: true });
    const oldFile = path.join(oldDir, 'result.json');
    fs.writeFileSync(oldFile, JSON.stringify({ state: 'failed', error: 'old', completedAt: 1 }));
    const old = new Date(Date.now() - 31 * 24 * 60 * 60_000);
    fs.utimesSync(oldFile, old, old);
    await handleSaveMedia({ captureId: '1717500000005-ab06', mediaUrl: 'https://example.com/compact.png', metadata: { url: 'https://example.com/compact' } });
    expect(fs.existsSync(oldDir)).toBe(false);
  });

  test('mkdir直後に中断した空claimは猶予後に回収できる', async () => {
    vi.stubGlobal('fetch', async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
    const id = '1717500000006-ab07';
    const dir = path.join(saveFolder, '.hologram-inbox', 'requests', id);
    fs.mkdirSync(dir, { recursive: true });
    const old = new Date(Date.now() - 91_000);
    fs.utimesSync(dir, old, old);
    const ack = await handleSaveMedia({ captureId: id, requestNonce: '1'.repeat(32), mediaUrl: 'https://example.com/empty-claim.png', metadata: { url: 'https://example.com/empty-claim' } });
    expect(ack.ok).toBe(true);
  });

  test('owner終了後のpartial tmp receiptをclaim世代ごと回収できる', async () => {
    vi.stubGlobal('fetch', async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
    const id = '1717500000014-ab15';
    const dir = path.join(saveFolder, '.hologram-inbox', 'requests', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'result.json.tmp-999999'), '{"state":"processing"');
    const old = new Date(Date.now() - 91_000);
    fs.utimesSync(dir, old, old);
    await expect(handleSaveMedia({ captureId: id, requestNonce: '5'.repeat(32), mediaUrl: 'https://example.com/partial-receipt.png', metadata: { url: 'https://example.com/partial-receipt' } })).resolves.toMatchObject({ ok: true });
  });

  test('回収者が終了して残したstale recovery lockも期限後に回収できる', async () => {
    vi.stubGlobal('fetch', async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
    const id = '1717500000009-ab10';
    const dir = path.join(saveFolder, '.hologram-inbox', 'requests', id);
    fs.mkdirSync(dir, { recursive: true });
    const lock = path.join(dir, 'recovery.lock');
    fs.writeFileSync(lock, JSON.stringify({ ownerPid: 2147483647, startedAt: Date.now() - 91_000, token: 'dead' }));
    const old = new Date(Date.now() - 91_000);
    fs.utimesSync(dir, old, old);
    const ack = await handleSaveMedia({ captureId: id, requestNonce: '4'.repeat(32), mediaUrl: 'https://example.com/stale-lock.png', metadata: { url: 'https://example.com/stale-lock' } });
    expect(ack.ok).toBe(true);
  });

  test('10分超でもprocessing ownerが生存中ならgenerationを奪わない', async () => {
    const id = '1717500000011-ab12';
    const dir = path.join(saveFolder, '.hologram-inbox', 'requests', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ state: 'processing', ownerPid: process.pid, startedAt: Date.now() - 60 * 60_000, generation: 'live-generation', requestNonce: null, payloadHash: '' }));
    await expect(handleSaveMedia({ captureId: id, mediaUrl: 'https://example.com/live-owner.png', metadata: { url: 'https://example.com/live-owner' } })).rejects.toThrow(/still processing/);
  });

  test('90秒超でもrecovery lock ownerが生存中ならlockを奪わない', async () => {
    const id = '1717500000012-ab13';
    const dir = path.join(saveFolder, '.hologram-inbox', 'requests', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'recovery.lock'), JSON.stringify({ ownerPid: process.pid, startedAt: Date.now() - 60 * 60_000, token: 'live-lock-generation' }));
    const old = new Date(Date.now() - 91_000);
    fs.utimesSync(dir, old, old);
    await expect(handleSaveMedia({ captureId: id, mediaUrl: 'https://example.com/live-lock.png', metadata: { url: 'https://example.com/live-lock' } })).rejects.toThrow(/contended/);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'recovery.lock'), 'utf8')).token).toBe('live-lock-generation');
  });

  test('固定SQLiteロックの所有者を奪わず、要求ディレクトリにも触れない', async () => {
    vi.stubGlobal('fetch', async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
    const id = '1717500000013-ab14';
    const root = path.join(saveFolder, '.hologram-inbox', 'request-locks');
    fs.mkdirSync(root, { recursive: true });
    const lock = new DatabaseSync(path.join(root, `${id}.sqlite`));
    lock.exec('BEGIN EXCLUSIVE');
    let released = false;
    const busy = vi.spyOn(DatabaseSync.prototype, 'exec');
    try {
      const saving = handleSaveMedia({ captureId: id, mediaUrl: 'https://example.com/generation-race.png', metadata: { url: 'https://example.com/generation-race' } });
      await vi.waitFor(() => expect(busy.mock.results.some((result) => result.type === 'throw')).toBe(true));
      expect(fs.existsSync(path.join(saveFolder, '.hologram-inbox', 'requests', id))).toBe(false);
      lock.close();
      released = true;
      expect(await saving).toMatchObject({ ok: true, captureId: id });
    } finally {
      if (!released) lock.close();
      busy.mockRestore();
    }
  });

  test('300件の保存でも固定ロックは256個以内で、要求ごとの旧ファイルを増やさない', async () => {
    vi.stubGlobal('fetch', async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
    const root = path.join(saveFolder, '.hologram-inbox', 'request-locks');
    const before = fs.existsSync(root)
      ? fs
          .readdirSync(root)
          .filter((name) => !/^[a-f0-9]{2}\.sqlite$/.test(name))
          .sort()
      : [];
    for (let n = 0; n < 300; n++) {
      await handleSaveMedia({ captureId: `1717500000100-${n.toString(16).padStart(4, '0')}`, mediaUrl: 'https://example.com/bounded.png', metadata: { url: `https://example.com/bounded/${n}` } });
    }
    const names = fs.readdirSync(root);
    expect(names.filter((name) => /^[a-f0-9]{2}\.sqlite$/.test(name)).length).toBeLessThanOrEqual(256);
    expect(names.filter((name) => !/^[a-f0-9]{2}\.sqlite$/.test(name)).sort()).toEqual(before);
  }, 90000);

  test('同じcaptureIdでもpayload identityが違えば以前のackを返さない', async () => {
    const fetch = vi.fn(async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetch);
    const id = '1717500000007-ab08';
    await handleSaveMedia({ captureId: id, requestNonce: '2'.repeat(32), mediaUrl: 'https://example.com/first.png', metadata: { url: 'https://example.com/first' } });
    await expect(handleSaveMedia({ captureId: id, requestNonce: '3'.repeat(32), mediaUrl: 'https://example.com/second.png', metadata: { url: 'https://example.com/second' } })).rejects.toThrow(/different save payload/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('死亡ownerの同時回収はfresh generationを奪わず1processだけ実行する', async () => {
    const id = '1717500000008-ab09';
    const dir = path.join(saveFolder, '.hologram-inbox', 'requests', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ state: 'processing', ownerPid: 2147483647, startedAt: Date.now() - 20 * 60_000, generation: 'old', requestNonce: null, payloadHash: '' }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetch = vi.fn(async () => {
      await gate;
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    });
    vi.stubGlobal('fetch', fetch);
    const req = { captureId: id, mediaUrl: 'https://example.com/race.png', metadata: { url: 'https://example.com/race' } };
    const winner = handleSaveMedia(req);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const contender = handleSaveMedia(req);
    release();
    await expect(winner).resolves.toMatchObject({ ok: true });
    await expect(contender).resolves.toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('回収後のinterrupted cleanupがEPERMでも保存成功ackを維持する', async () => {
    const id = '1717500000010-ab11';
    const dir = path.join(saveFolder, '.hologram-inbox', 'requests', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ state: 'processing', ownerPid: 2147483647, startedAt: 1, generation: 'dead', requestNonce: null, payloadHash: '' }));
    vi.stubGlobal('fetch', async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
    const realRm = fs.rmSync;
    const rm = vi.spyOn(fs, 'rmSync').mockImplementation(((target: fs.PathLike, options?: fs.RmDirOptions) => {
      if (String(target).includes('.interrupted-')) throw Object.assign(new Error('locked by antivirus'), { code: 'EPERM' });
      return realRm(target, options);
    }) as typeof fs.rmSync);
    await expect(handleSaveMedia({ captureId: id, mediaUrl: 'https://example.com/cleanup.png', metadata: { url: 'https://example.com/cleanup' } })).resolves.toMatchObject({ ok: true });
    rm.mockRestore();
  });
});
