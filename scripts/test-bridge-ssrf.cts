'use strict';

// SSRF / size-cap guard test for native-host/bridge.cts#fetchStillImage.
// Runs in-process with a stubbed global.fetch (no network). Asserts that:
//   - IP-literal private/reserved targets (loopback, link-local/cloud-metadata,
//     RFC1918, ULA, IPv6 ::1, and IPv4-mapped IPv6 in both dotted and hex form)
//     are refused BEFORE any fetch is issued,
//   - a redirect from a public host to a private one is refused at the next hop
//     (manual redirect re-validation), and that private hop is never fetched,
//   - DNS resolution refuses private-only and mixed public/private answers while
//     returning the exact verified public A/AAAA set to the connector,
//   - a body exceeding the size cap (no content-length) is aborted mid-stream,
//   - legitimate public https images still download.
//
//   node scripts/test-bridge-ssrf.cts

const assert = require('node:assert');
const { Agent } = require('undici');
const { fetchStillImage } = require('../native-host/bridge.cts');
const { createGuardedLookup } = require('../native-host/media-download.cts');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const realFetch = global.fetch;
const fetched: any[] = []; // every URL actually passed to fetch
global.fetch = async (url, options) => {
  const u = String(url);
  fetched.push(u);
  assert.ok(options?.dispatcher, 'public fetches must use the DNS-guarded dispatcher');
  if (u === 'https://evil.test/redir') {
    return new Response('', { status: 302, headers: { location: 'https://127.0.0.1/secret.png' } });
  }
  if (u === 'https://cdn.test/ok.png') {
    return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
  }
  // Public IPv4-mapped IPv6 literal: hex form 8.8.8.8 -> ::ffff:808:808. Must be
  // ALLOWED (regression: the mapped-hex fix must not over-block public targets).
  if (u === 'https://[::ffff:808:808]/ok.png') {
    return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
  }
  if (u === 'https://cdn.test/huge.png') {
    let sent = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (sent >= 40) {
          controller.close();
          return;
        } // up to 40 MiB if unchecked
        sent++;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'image/png' } });
  }
  return new Response('nope', { status: 404 });
};

function runLookup(lookup, hostname = 'cdn.test') {
  return new Promise((resolve, reject) => {
    lookup(hostname, { family: 0, hints: 0 }, (err, addresses) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(addresses);
    });
  });
}

(async () => {
  // 1. Direct IP-literal private/reserved targets are refused before any fetch.
  const blocked = [
    'https://127.0.0.1/x.png',
    'https://169.254.169.254/latest/meta-data/',
    'https://10.0.0.5/x.png',
    'https://172.16.5.4/x.png',
    'https://192.168.1.1/x.png',
    'https://100.64.0.1/x.png',
    'https://[::1]/x.png',
    'https://[fe80::1]/x.png',
    'https://[fc00::1]/x.png',
    // IPv4-mapped IPv6, dotted form (as authored by an attacker).
    'https://[::ffff:127.0.0.1]/x.png',
    'https://[::ffff:169.254.169.254]/latest/meta-data/',
    'https://[::ffff:192.168.0.1]/x.png',
    // IPv4-mapped IPv6, hex form (what the WHATWG URL parser normalizes the above
    // to — the actual hostname checkMediaUrl/isPrivateIp see).
    'https://[::ffff:7f00:1]/x.png', // 127.0.0.1
    'https://[::ffff:a9fe:a9fe]/x.png', // 169.254.169.254 (cloud metadata)
    'https://[::ffff:c0a8:0001]/x.png', // 192.168.0.1
    'https://localhost/x.png',
    'https://box.local/x.png',
    'https://svc.internal/x.png',
    'http://cdn.test/ok.png', // non-https refused regardless of host
  ];
  for (const url of blocked) {
    const got = await fetchStillImage(url);
    assert.strictEqual(got, null, 'must refuse: ' + url);
    assert.ok(!fetched.includes(url), 'must NOT fetch blocked target: ' + url);
  }

  // 2. Redirect from a public host to a private IP is refused, and the private
  //    hop is never fetched.
  const r = await fetchStillImage('https://evil.test/redir');
  assert.strictEqual(r, null, 'redirect-to-private must be refused');
  assert.ok(fetched.includes('https://evil.test/redir'), 'first (public) hop is fetched');
  assert.ok(!fetched.includes('https://127.0.0.1/secret.png'), 'private redirect target must NOT be fetched');

  // 3. Over-cap body (no content-length) is aborted mid-stream.
  const big = await fetchStillImage('https://cdn.test/huge.png');
  assert.strictEqual(big, null, 'over-cap streamed body must be refused');

  // 4. Legitimate public https image still downloads.
  const ok = await fetchStillImage('https://cdn.test/ok.png');
  assert.ok(ok && ok.ext === 'png' && Buffer.isBuffer(ok.buf) && ok.buf.length === PNG.length, 'public image should download');

  // 5. A public IPv4-mapped IPv6 literal (hex form) is not over-blocked.
  const okMapped = await fetchStillImage('https://[::ffff:808:808]/ok.png');
  assert.ok(okMapped && okMapped.ext === 'png' && okMapped.buf.length === PNG.length, 'public IPv4-mapped IPv6 literal should download');

  // 6. The guarded lookup asks for every A/AAAA record and returns that exact
  //    verified set to net.connect, which pins Happy Eyeballs to checked IPs.
  const publicRecords = [
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ];
  let lookupOptions: { all?: boolean } = {};
  const publicLookup = createGuardedLookup((_hostname, options, callback) => {
    lookupOptions = options;
    callback(null, publicRecords);
  });
  assert.deepStrictEqual(await runLookup(publicLookup), publicRecords, 'verified A/AAAA records must be returned unchanged');
  assert.strictEqual(lookupOptions.all, true, 'underlying DNS lookup must request every address');

  // 7. One private result poisons the whole set (strict any-private policy).
  for (const records of [
    [{ address: '127.0.0.1', family: 4 }],
    [
      { address: '8.8.8.8', family: 4 },
      { address: '::1', family: 6 },
    ],
  ]) {
    const guarded = createGuardedLookup((_hostname, _options, callback) => callback(null, records));
    await assert.rejects(runLookup(guarded), (err) => err?.code === 'EHOSTUNREACH', 'private DNS answers must be refused');
  }

  // 8. Resolver failures are passed through unchanged; fetch still handles them
  //    via its existing best-effort null result.
  const dnsError = Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' });
  const failingLookup = createGuardedLookup((_hostname, _options, callback) => callback(dnsError));
  await assert.rejects(runLookup(failingLookup), (err) => err === dnsError, 'DNS errors must preserve their existing identity');

  // 9. Node's real fetch invokes the guarded lookup through an Undici Agent.
  //    The stub resolves a public-looking hostname to loopback, so the request
  //    must fail before any socket or external network access is attempted.
  let dispatcherLookupCalled = false;
  const blockedDispatcher = new Agent({
    connect: {
      autoSelectFamily: true,
      lookup: createGuardedLookup((_hostname, _options, callback) => {
        dispatcherLookupCalled = true;
        callback(null, [{ address: '127.0.0.1', family: 4 }]);
      }),
    },
  });
  try {
    const request = { redirect: 'manual' as const, dispatcher: blockedDispatcher };
    await assert.rejects(realFetch('https://public-name.test/image.png', request), 'real fetch must honor the guarded dispatcher');
    assert.strictEqual(dispatcherLookupCalled, true, 'real fetch must invoke the guarded lookup');
  } finally {
    await blockedDispatcher.close();
  }

  console.log('PASS test-bridge-ssrf: literal/DNS/redirect/over-cap refused, public A/AAAA pinned');
})().catch((e) => {
  console.error('FAIL test-bridge-ssrf:', e && e.message ? e.message : e);
  process.exit(1);
});
