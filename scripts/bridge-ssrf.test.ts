// Tests for the SSRF/size-limit guard in native-host/bridge.mts#saveStillImage.
// Runs in-process by swapping out global.fetch (no network needed). What's checked:
//   - private/reserved IP literal addresses (loopback, link-local/cloud metadata, RFC1918, ULA,
//     IPv6 ::1, IPv4-mapped IPv6 in both dotted and hex notation) are rejected before fetch is
//     ever issued
//   - a redirect from a public host to a private address is rejected at the next hop, and that
//     private hop is never fetched (manual-redirect re-validation)
//   - DNS resolution rejects both "all private" and "mixed public and private", and passes the
//     validated set of public A/AAAA records through to the connector unchanged
//   - a body over the size limit with no content-length is aborted mid-stream
//   - a legitimate public https image still comes through as before

import fs from 'node:fs';
import path from 'node:path';
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { saveStillImage } from '../native-host/bridge.mts';
import { createGuardedLookup } from '../native-host/media-download.mts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const realFetch = global.fetch;
const fetched: string[] = []; // URLs that were actually passed to fetch

// Fetching streams to disk, so set up one sandbox directory to land in (#389).
// The stem is varied per case so a written vs. not-written file can't be mixed up.
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
    // A public IPv4-mapped IPv6 literal (hex notation of 8.8.8.8 -> ::ffff:808:808) must be let
    // through (a regression guard checking the hex-notation fix didn't also block public destinations)
    if (u === 'https://[::ffff:808:808]/ok.png') return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    if (u === 'https://cdn.test/huge.png') {
      let sent = 0;
      const body = new ReadableStream({
        pull(controller) {
          if (sent >= 40) return controller.close(); // Would reach 40 MiB if let through unguarded
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
    // IPv4-mapped IPv6, dotted notation (the form an attacker would write)
    'https://[::ffff:127.0.0.1]/x.png',
    'https://[::ffff:169.254.169.254]/latest/meta-data/',
    'https://[::ffff:192.168.0.1]/x.png',
    // IPv4-mapped IPv6, hex notation (the form the WHATWG URL parser normalizes the above to =
    // the actual hostname checkMediaUrl/isPrivateIp sees)
    'https://[::ffff:7f00:1]/x.png', // 127.0.0.1
    'https://[::ffff:a9fe:a9fe]/x.png', // 169.254.169.254 (cloud metadata)
    'https://[::ffff:c0a8:0001]/x.png', // 192.168.0.1
    'https://localhost/x.png',
    'https://box.local/x.png',
    'https://svc.internal/x.png',
    'http://cdn.test/ok.png', // Rejected regardless of host unless it's https
  ])('%s', async (url) => {
    expect(await fetchStill(url)).toBeNull();
    expect(fetched).not.toContain(url);
  });
});

describe('公開ホスト → 私設アドレスのリダイレクト', () => {
  test('拒否され、私設ホップは fetch されない', async () => {
    expect(await fetchStill('https://evil.test/redir')).toBeNull();
    expect(fetched).toContain('https://evil.test/redir'); // The 1st hop (public) is still fetched
    expect(fetched).not.toContain('https://127.0.0.1/secret.png');
  });
});

test('content-length の無い上限超えの本文はストリーム途中で中断する', async () => {
  const before = fs.readdirSync(dir);

  expect(await fetchStill('https://cdn.test/huge.png')).toBeNull();
  // Leaves behind neither the aborted temp file nor a file treated as "complete" (#389)
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

  // Requests all A/AAAA records and returns the validated set unchanged to net.connect =
  // pins Happy Eyeballs to only inspected IPs
  test('検証済みの A/AAAA レコードをそのまま返し、全アドレスを要求する', async () => {
    let lookupOptions: { all?: boolean } = {};
    const publicLookup = createGuardedLookup((_hostname: string, options: any, callback: any) => {
      lookupOptions = options;
      callback(null, publicRecords);
    });

    expect(await runLookup(publicLookup)).toEqual(publicRecords);
    expect(lookupOptions.all).toBe(true);
  });

  // Even one private address in the set rejects the whole set (a strict any-private policy)
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

  // A resolution failure passes through unchanged = the fetch side still treats it as a best-effort null, as before
  test('リゾルバのエラーは同一性を保ったまま伝わる', async () => {
    const dnsError = Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' });
    const failingLookup = createGuardedLookup((_h: string, _o: any, callback: any) => callback(dnsError));

    await expect(runLookup(failingLookup)).rejects.toBe(dnsError);
  });
});

// A regression guard for the "wiring" of the implementation itself. The createGuardedLookup
// tests above only check the guard's logic, and the setGlobalDispatcher test below registers
// its own test Agent and checks undici's path = neither actually checks "does
// media-download.mts really register the guard as the process default". After #431 made the
// per-call dispatcher assertion unnecessary and it was removed, deleting setGlobalDispatcher
// from the implementation entirely still left this whole file green (= the guard could be a
// pass-through and nothing would notice), so this closes that gap.
//
// Judged by the real fetch's failure cause (localhost always resolves to loopback, so no
// network is needed):
//   EHOSTUNREACH = the guard rejected it at resolution time = the wiring is live
//   ECONNREFUSED = it actually connected to loopback with no guard in place = a pass-through
test('media-download.mts を読み込むとガード付き dispatcher がプロセス既定になる', async () => {
  const err: any = await realFetch('https://localhost:59237/x.png', { redirect: 'manual' } as any).then(
    () => null,
    (e: unknown) => e,
  );

  expect(err, 'ループバック宛ての fetch は成功してはならない').not.toBeNull();
  expect(err.cause?.code, 'ガードは名前解決の時点で拒むこと（ECONNREFUSED＝実際に接続した＝配線が外れている）').toBe('EHOSTUNREACH');
});

// The stub resolves a host name that looks public to loopback, so this must fail before any
// socket or external communication happens.
//
// Node's built-in fetch builds its handler with its own (bundled, older-generation) undici.
// Passing this npm undici's (v8+) Agent via the per-call `dispatcher` option gets rejected
// before it ever reaches the connector (= createGuardedLookup), because that older-shape
// handler is missing the v2-only method the v8 Request requires ("invalid onRequestStart
// method"). Registering it as the process default via setGlobalDispatcher and calling with no
// per-call option is the same wiring as native-host/media-download.mts's implementation = this
// test matches that.
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
