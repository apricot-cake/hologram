'use strict';

// SSRF / size-cap guard test for native-host/bridge.js#fetchStillImage.
// Runs in-process with a stubbed global.fetch (no network). Asserts that:
//   - IP-literal private/reserved targets (loopback, link-local/cloud-metadata,
//     RFC1918, ULA, IPv6 ::1) are refused BEFORE any fetch is issued,
//   - a redirect from a public host to a private one is refused at the next hop
//     (manual redirect re-validation), and that private hop is never fetched,
//   - a body exceeding the size cap (no content-length) is aborted mid-stream,
//   - legitimate public https images still download.
//
//   node scripts/test-bridge-ssrf.js

const assert = require('assert');
const { fetchStillImage } = require('../native-host/bridge');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const fetched = [];   // every URL actually passed to fetch
global.fetch = async (url) => {
  const u = String(url);
  fetched.push(u);
  if (u === 'https://evil.test/redir') {
    return new Response('', { status: 302, headers: { location: 'https://127.0.0.1/secret.png' } });
  }
  if (u === 'https://cdn.test/ok.png') {
    return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
  }
  if (u === 'https://cdn.test/huge.png') {
    let sent = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (sent >= 40) { controller.close(); return; }   // up to 40 MiB if unchecked
        sent++;
        controller.enqueue(new Uint8Array(1024 * 1024));
      }
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'image/png' } });
  }
  return new Response('nope', { status: 404 });
};

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
    'https://localhost/x.png',
    'https://box.local/x.png',
    'https://svc.internal/x.png',
    'http://cdn.test/ok.png'   // non-https refused regardless of host
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
  assert.ok(ok && ok.ext === 'png' && Buffer.isBuffer(ok.buf) && ok.buf.length === PNG.length,
    'public image should download');

  console.log('PASS test-bridge-ssrf: private/redirect/over-cap refused, public ok');
})().catch((e) => { console.error('FAIL test-bridge-ssrf:', e && e.message ? e.message : e); process.exit(1); });
