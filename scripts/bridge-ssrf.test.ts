// native-host/bridge.cts#saveStillImage の SSRF／サイズ上限ガードのテスト。
// global.fetch を差し替えてプロセス内で走る（ネットワーク不要）。見るのは:
//   - IP リテラルの私設/予約アドレス（ループバック・リンクローカル/クラウドメタデータ・
//     RFC1918・ULA・IPv6 ::1・IPv4 射影 IPv6 のドット表記と16進表記）は fetch を出す前に拒む
//   - 公開ホストから私設アドレスへのリダイレクトは次ホップで拒み、その私設ホップは
//     決して fetch しない（手動リダイレクトの再検証）
//   - DNS 解決は「私設のみ」も「公開と私設の混在」も拒み、検証済みの公開 A/AAAA 集合を
//     そのままコネクタへ返す
//   - content-length の無い上限超えの本文はストリーム途中で中断する
//   - 正当な公開 https 画像は従来どおり落ちてくる

import fs from 'node:fs';
import path from 'node:path';
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { saveStillImage } from '../native-host/bridge.cts';
import { createGuardedLookup } from '../native-host/media-download.cts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const realFetch = global.fetch;
const fetched: string[] = []; // 実際に fetch へ渡った URL

// 取得はディスクへのストリームなので、落とし先の砂場を1つ用意する（#389）。
// stem はケースごとに変えて、書かれた／書かれなかったを取り違えないようにする。
const dir = path.join(process.env.HOLOGRAM_CONFIG_DIR as string, 'ssrf');
let stemSeq = 0;
const fetchStill = (url: string, referer?: unknown) => saveStillImage(url, referer, dir, `img-${stemSeq++}`);

beforeAll(() => {
  fs.mkdirSync(dir, { recursive: true });
  global.fetch = (async (url: unknown) => {
    const u = String(url);
    fetched.push(u);

    if (u === 'https://evil.test/redir') return new Response('', { status: 302, headers: { location: 'https://127.0.0.1/secret.png' } });
    if (u === 'https://cdn.test/ok.png') return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    // 公開の IPv4 射影 IPv6 リテラル（16進表記の 8.8.8.8 → ::ffff:808:808）は通さねば
    // ならない（16進表記の修正が公開の宛先まで塞いでいないかの退行ガード）
    if (u === 'https://[::ffff:808:808]/ok.png') return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    if (u === 'https://cdn.test/huge.png') {
      let sent = 0;
      const body = new ReadableStream({
        pull(controller) {
          if (sent >= 40) return controller.close(); // 素通しなら 40 MiB まで来る
          sent++;
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
});

afterAll(() => {
  global.fetch = realFetch;
});

function runLookup(lookup: any, hostname = 'cdn.test') {
  return new Promise((resolve, reject) => {
    lookup(hostname, { family: 0, hints: 0 }, (err: unknown, addresses: unknown) => (err ? reject(err) : resolve(addresses)));
  });
}

describe('IP リテラルの私設/予約宛先は fetch する前に拒む', () => {
  test.each([
    'https://127.0.0.1/x.png',
    'https://169.254.169.254/latest/meta-data/',
    'https://10.0.0.5/x.png',
    'https://172.16.5.4/x.png',
    'https://192.168.1.1/x.png',
    'https://100.64.0.1/x.png',
    'https://[::1]/x.png',
    'https://[fe80::1]/x.png',
    'https://[fc00::1]/x.png',
    // IPv4 射影 IPv6・ドット表記（攻撃者が書く形）
    'https://[::ffff:127.0.0.1]/x.png',
    'https://[::ffff:169.254.169.254]/latest/meta-data/',
    'https://[::ffff:192.168.0.1]/x.png',
    // IPv4 射影 IPv6・16進表記（WHATWG URL パーサが上を正規化した形＝
    // checkMediaUrl/isPrivateIp が実際に見るホスト名）
    'https://[::ffff:7f00:1]/x.png', // 127.0.0.1
    'https://[::ffff:a9fe:a9fe]/x.png', // 169.254.169.254（クラウドメタデータ）
    'https://[::ffff:c0a8:0001]/x.png', // 192.168.0.1
    'https://localhost/x.png',
    'https://box.local/x.png',
    'https://svc.internal/x.png',
    'http://cdn.test/ok.png', // https でなければホストを問わず拒む
  ])('%s', async (url) => {
    expect(await fetchStill(url)).toBeNull();
    expect(fetched).not.toContain(url);
  });
});

describe('公開ホスト → 私設アドレスのリダイレクト', () => {
  test('拒否され、私設ホップは fetch されない', async () => {
    expect(await fetchStill('https://evil.test/redir')).toBeNull();
    expect(fetched).toContain('https://evil.test/redir'); // 1ホップ目（公開）は取りに行く
    expect(fetched).not.toContain('https://127.0.0.1/secret.png');
  });
});

test('content-length の無い上限超えの本文はストリーム途中で中断する', async () => {
  const before = fs.readdirSync(dir);

  expect(await fetchStill('https://cdn.test/huge.png')).toBeNull();
  // 打ち切った分の一時ファイルも「完成扱い」のファイルも残さない（#389）
  expect(fs.readdirSync(dir)).toEqual(before);
});

describe('正当な公開 https 画像', () => {
  test('通常のホストから落ちてくる', async () => {
    const ok = await fetchStill('https://cdn.test/ok.png');
    expect(ok.ext).toBe('png');
    expect(fs.readFileSync(path.join(dir, ok.file))).toHaveLength(PNG.length);
  });

  test('公開の IPv4 射影 IPv6 リテラル（16進表記）を塞ぎすぎない', async () => {
    const ok = await fetchStill('https://[::ffff:808:808]/ok.png');
    expect(ok.ext).toBe('png');
    expect(fs.readFileSync(path.join(dir, ok.file))).toHaveLength(PNG.length);
  });
});

describe('createGuardedLookup', () => {
  const publicRecords = [
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ];

  // A/AAAA を全部要求し、検証済みの集合をそのまま net.connect へ返す＝
  // Happy Eyeballs を検査済み IP に固定する
  test('検証済みの A/AAAA レコードをそのまま返し、全アドレスを要求する', async () => {
    let lookupOptions: { all?: boolean } = {};
    const publicLookup = createGuardedLookup((_hostname: string, options: any, callback: any) => {
      lookupOptions = options;
      callback(null, publicRecords);
    });

    expect(await runLookup(publicLookup)).toEqual(publicRecords);
    expect(lookupOptions.all).toBe(true);
  });

  // 私設が1件でも混ざれば集合ごと拒む（厳格な any-private ポリシー）
  test.each([
    [[{ address: '127.0.0.1', family: 4 }]],
    [
      [
        { address: '8.8.8.8', family: 4 },
        { address: '::1', family: 6 },
      ],
    ],
  ])('私設を含む DNS 応答は拒む: %j', async (records) => {
    const guarded = createGuardedLookup((_h: string, _o: any, callback: any) => callback(null, records));

    await expect(runLookup(guarded)).rejects.toMatchObject({ code: 'EHOSTUNREACH' });
  });

  // 解決失敗はそのまま通す＝fetch 側は従来どおり best-effort の null で扱う
  test('リゾルバのエラーは同一性を保ったまま伝わる', async () => {
    const dnsError = Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' });
    const failingLookup = createGuardedLookup((_h: string, _o: any, callback: any) => callback(dnsError));

    await expect(runLookup(failingLookup)).rejects.toBe(dnsError);
  });
});

// 実装側の「配線」そのものの退行ガード。上の createGuardedLookup のテストはガードの
// ロジックだけを見ており、下の setGlobalDispatcher のテストはテスト自前の Agent を
// 登録して undici の経路を見ている＝どちらも「media-download.cts が実際にガードを
// プロセス既定として登録しているか」は見ていない。#431 で per-call の dispatcher
// アサーションが不要になって外れた結果、実装から setGlobalDispatcher を丸ごと消しても
// このファイルは全部緑のままだった（＝ガードが素通しでも気付けない）ので、ここで塞ぐ。
//
// 判定は実 fetch の failure cause で行う（localhost は必ずループバックへ解決するので
// ネットワーク不要）:
//   EHOSTUNREACH = ガードが名前解決の時点で拒んだ＝配線が生きている
//   ECONNREFUSED = ガード不在のままループバックへ実際に接続しにいった＝素通し
test('media-download.cts を読み込むとガード付き dispatcher がプロセス既定になる', async () => {
  const err: any = await realFetch('https://localhost:59237/x.png', { redirect: 'manual' } as any).then(
    () => null,
    (e: unknown) => e,
  );

  expect(err, 'ループバック宛ての fetch は成功してはならない').not.toBeNull();
  expect(err.cause?.code, 'ガードは名前解決の時点で拒むこと（ECONNREFUSED＝実際に接続した＝配線が外れている）').toBe('EHOSTUNREACH');
});

// 公開に見えるホスト名をループバックへ解決させるスタブなので、ソケットも外部通信も
// 起きる前に失敗しなければならない。
//
// Node の組み込み fetch は自前の（内蔵・旧世代の）undici でハンドラを組み立てる。この
// npm undici（v8+）の Agent を per-call の `dispatcher` オプションで渡すと、その旧形の
// ハンドラは v8 の Request が要求する v2 専用メソッドを欠くため connector（＝
// createGuardedLookup）へ届く前に拒否される（"invalid onRequestStart method"）。
// setGlobalDispatcher でプロセス既定へ登録し、per-call オプションなしで呼ぶのが
// native-host/media-download.cts の実装と同じ配線＝このテストもそれに合わせる。
test('Node の実 fetch が setGlobalDispatcher 経由でガード付き lookup を呼ぶ', async () => {
  let dispatcherLookupCalled = false;
  const blockedDispatcher = new Agent({
    connect: {
      autoSelectFamily: true,
      lookup: createGuardedLookup((_h: string, _o: any, callback: any) => {
        dispatcherLookupCalled = true;
        callback(null, [{ address: '127.0.0.1', family: 4 }]);
      }),
    },
  });

  const originalDispatcher = getGlobalDispatcher();
  setGlobalDispatcher(blockedDispatcher);
  try {
    await expect(realFetch('https://public-name.test/image.png', { redirect: 'manual' } as any)).rejects.toThrow();
    expect(dispatcherLookupCalled).toBe(true);
  } finally {
    setGlobalDispatcher(originalDispatcher);
    await blockedDispatcher.close();
  }
});
