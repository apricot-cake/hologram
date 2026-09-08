// native-host/bridge.mts#saveStillImage の SSRF・容量上限の防ぎのテスト。
// global.fetch を差し替えてプロセス内で走る(ネットワークは要らない)。見るのは:
//   - 私設・予約の IP リテラル宛て(ループバック、リンクローカル/クラウドのメタデータ、
//     RFC1918、ULA、IPv6 の ::1、ドット表記と16進表記の両方の IPv4 射影 IPv6)を、
//     fetch を出す前に拒む
//   - 公開ホストから私設アドレスへのリダイレクトを次のホップで拒み、その私設ホップは
//     一度も fetch しない(手動リダイレクトでの再検証)
//   - 名前解決は「全部が私設」も「公開と私設の混在」も拒み、検証を通った公開の
//     A/AAAA レコードの集合はそのままコネクタへ渡す
//   - content-length が無く上限を超える本文は、ストリームの途中で中断する
//   - 正当な公開 https 画像は今までどおり通る

import fs from 'node:fs';
import path from 'node:path';
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { saveStillImage } from '../../native-host/bridge.mts';
import { createGuardedLookup } from '../../native-host/media-download.mts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const realFetch = global.fetch;
const fetched: string[] = []; // 実際に fetch へ渡された URL

// 取得はディスクへ流し込むので、着地先のサンドボックスのディレクトリを1つ用意する(#389)。
// 書かれたファイルと書かれていないファイルを取り違えないよう、stem はケースごとに変える。
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
    // 公開の IPv4 射影 IPv6 リテラル(8.8.8.8 の16進表記 → ::ffff:808:808)は通すこと
    // (16進表記への対処が公開宛てまで塞いでいないかを見る退行テスト)
    if (u === 'https://[::ffff:808:808]/ok.png') return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    if (u === 'https://cdn.test/huge.png') {
      let sent = 0;
      const body = new ReadableStream({
        pull(controller) {
          if (sent >= 40) return controller.close(); // 防ぎが無ければ 40 MiB まで届いてしまう
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
    // IPv4 射影 IPv6 のドット表記(攻撃側が書く形)
    'https://[::ffff:127.0.0.1]/x.png',
    'https://[::ffff:169.254.169.254]/latest/meta-data/',
    'https://[::ffff:192.168.0.1]/x.png',
    // IPv4 射影 IPv6 の16進表記(上のものを WHATWG の URL パーサが正規化した形＝
    // checkMediaUrl/isPrivateIp が実際に見るホスト名)
    'https://[::ffff:7f00:1]/x.png', // 127.0.0.1
    'https://[::ffff:a9fe:a9fe]/x.png', // 169.254.169.254 (クラウドのメタデータ)
    'https://[::ffff:c0a8:0001]/x.png', // 192.168.0.1
    'https://localhost/x.png',
    'https://box.local/x.png',
    'https://svc.internal/x.png',
    'http://cdn.test/ok.png', // https でなければホストによらず拒む
  ])('%s', async (url) => {
    expect(await fetchStill(url)).toBeNull();
    expect(fetched).not.toContain(url);
  });
});

describe('公開ホスト → 私設アドレスのリダイレクト', () => {
  test('拒否され、私設ホップは fetch されない', async () => {
    expect(await fetchStill('https://evil.test/redir')).toBeNull();
    expect(fetched).toContain('https://evil.test/redir'); // 1つ目のホップ(公開)は fetch される
    expect(fetched).not.toContain('https://127.0.0.1/secret.png');
  });
});

test('content-length の無い上限超えの本文はストリーム途中で中断する', async () => {
  const before = fs.readdirSync(dir);

  expect(await fetchStill('https://cdn.test/huge.png')).toBeNull();
  // 中断した一時ファイルも、「完了」扱いのファイルも残さない(#389)
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

  // A/AAAA レコードを全部要求し、検証を通った集合をそのまま net.connect へ返す＝
  // Happy Eyeballs が見に行く先を、検査済みの IP だけに固定する
  test('検証済みの A/AAAA レコードをそのまま返し、全アドレスを要求する', async () => {
    let lookupOptions: { all?: boolean } = {};
    const publicLookup = createGuardedLookup((_hostname: string, options: any, callback: any) => {
      lookupOptions = options;
      callback(null, publicRecords);
    });

    expect(await runLookup(publicLookup)).toEqual(publicRecords);
    expect(lookupOptions.all).toBe(true);
  });

  // 集合に私設アドレスが1つでもあれば全体を拒む(1つでも私設なら通さない厳しい方針)
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

  // 名前解決の失敗はそのまま素通しする＝fetch 側は今までどおり、できる範囲での null として扱う
  test('リゾルバのエラーは同一性を保ったまま伝わる', async () => {
    const dnsError = Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' });
    const failingLookup = createGuardedLookup((_h: string, _o: any, callback: any) => callback(dnsError));

    await expect(runLookup(failingLookup)).rejects.toBe(dnsError);
  });
});

// 実装そのものの「配線」に対する退行テスト。上の createGuardedLookup のテストは防ぎの
// 論理しか見ないし、下の setGlobalDispatcher のテストは自前のテスト用 Agent を登録して
// undici の経路を見るだけ＝どちらも「media-download.mts が本当に防ぎをプロセス既定として
// 登録しているか」を見ていない。#431 で呼び出しごとの dispatcher のアサーションが不要に
// なって取り除かれた後は、実装から setGlobalDispatcher をまるごと消してもこのファイルは
// 全部緑のままだった(＝防ぎが素通しになっても誰も気づかない)。その穴を塞ぐ。
//
// 判定は実 fetch の失敗の原因で行う(localhost は必ずループバックへ解決するので、
// ネットワークは要らない):
//   EHOSTUNREACH＝防ぎが名前解決の時点で拒んだ＝配線が生きている
//   ECONNREFUSED＝防ぎが無いままループバックへ実際に接続した＝素通し
test('media-download.mts を読み込むとガード付き dispatcher がプロセス既定になる', async () => {
  const err: any = await realFetch('https://localhost:59237/x.png', { redirect: 'manual' } as any).then(
    () => null,
    (e: unknown) => e,
  );

  expect(err, 'ループバック宛ての fetch は成功してはならない').not.toBeNull();
  expect(err.cause?.code, 'ガードは名前解決の時点で拒むこと（ECONNREFUSED＝実際に接続した＝配線が外れている）').toBe('EHOSTUNREACH');
});

// スタブは公開に見えるホスト名をループバックへ解決するので、ソケットも外部通信も
// 起きる前に失敗しなければならない。
//
// Node 組み込みの fetch は、自分が同梱する(世代の古い)undici でハンドラを組み立てる。
// npm の undici(v8 以降)の Agent を呼び出しごとの `dispatcher` 指定で渡すと、コネクタ
// (＝createGuardedLookup)へ届く前に弾かれる。古い形のハンドラには、v8 の Request が
// 要求する v2 だけのメソッドが無いから("invalid onRequestStart method")。
// setGlobalDispatcher でプロセス既定として登録し、呼び出しごとの指定なしで呼ぶのが
// native-host/media-download.mts の実装と同じ配線＝このテストはそれに合わせている。
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
