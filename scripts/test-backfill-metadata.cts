'use strict';

// backfill --all: a re-fetch that FAILS must not null-destroy the stored record.
// X/Bluesky set screenName/handle from the post URL before the network call, so a
// failed fetch still carries a screenName — the skip guard must gate on API-only
// fields (text/likes/date), not screenName. Spawns the REAL script with a
// preloaded fetch stub (the SSRF guard refuses localhost, so we stub global.fetch
// via `node -r`, same approach as test-avatar-fill.cts). Cases:
//   F  X, fetch fails (syndication 404)  → stored meta preserved, skipped as no-data
//   S  X, fetch succeeds                 → updated with fresh meta
//   P  X, partial (no likes in response) → existing likes survive via `?? rec`
//   BF Bluesky, getPostThread fails      → stored meta preserved, skipped
//
//   node scripts/test-backfill-metadata.cts

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let ok = true;
const check = (label, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) ok = false;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-backfill-'));
const configDir = path.join(tmp, 'Hologram');
fs.mkdirSync(configDir, { recursive: true });
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

// Stored record stub with full metadata that must NOT be destroyed on a failed
// re-fetch. Reuses the same author/text for the "preserve" assertions.
const storedX = (id, screenName, extra?) =>
  Object.assign(
    {
      captureId: id,
      url: `https://x.com/${screenName}/status/${id}`,
      platform: 'x',
      text: 'stored body text',
      displayName: 'Stored Name',
      screenName,
      userId: '999',
      likes: 42,
      replies: 3,
      date: '2024-01-01T00:00:00.000Z',
      lang: 'ja',
    },
    extra || {},
  );

// F: X, fetch will fail. S: X, fetch will succeed. P: X, fetch returns no likes.
const F = '100-fail';
fs.writeFileSync(path.join(saveFolder, F + '.json'), JSON.stringify(storedX('100', 'failuser')));
const S = '200-ok';
fs.writeFileSync(path.join(saveFolder, S + '.json'), JSON.stringify(storedX('200', 'okuser')));
const P = '300-partial';
fs.writeFileSync(path.join(saveFolder, P + '.json'), JSON.stringify(storedX('300', 'partialuser')));

// BF: Bluesky, getPostThread will fail (handle resolves but thread 404s) — the
// stored record must survive (handle is URL-derived, not proof of a good fetch).
const BF = '400-bskyfail';
fs.writeFileSync(
  path.join(saveFolder, BF + '.json'),
  JSON.stringify({
    captureId: BF,
    url: 'https://bsky.app/profile/failhandle.bsky.social/post/abc123',
    platform: 'bluesky',
    text: 'bsky stored text',
    displayName: 'Bsky Stored',
    screenName: 'failhandle.bsky.social',
    userId: 'did:plc:stored',
    likes: 7,
    reposts: 2,
    replies: 1,
    date: '2024-02-02T00:00:00.000Z',
    lang: 'en',
  }),
);

// fetch stub: route by URL. id=200 → success JSON; id=300 → success JSON without
// favorite_count (partial); any other syndication id → 404 (failure). Bluesky:
// resolveHandle succeeds, getPostThread 404s (failure path).
const stub = path.join(tmp, 'stub-fetch.js');
fs.writeFileSync(
  stub,
  [
    'global.fetch = async (url) => {',
    '  const u = String(url);',
    '  if (u.includes("cdn.syndication.twimg.com")) {',
    '    if (u.includes("id=200")) {',
    '      const j = { text: "fresh tweet body", user: { name: "Fresh Name", screen_name: "okuser", id_str: "555" }, favorite_count: 99, conversation_count: 5, created_at: "2025-05-05T00:00:00.000Z", lang: "en" };',
    '      return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });',
    '    }',
    '    if (u.includes("id=300")) {',
    '      const j = { text: "partial body", user: { name: "Partial Name", screen_name: "partialuser", id_str: "777" }, created_at: "2025-06-06T00:00:00.000Z", lang: "en" };', // no favorite_count
    '      return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });',
    '    }',
    '    return new Response("nope", { status: 404 });', // id=100 → failure
    '  }',
    '  if (u.includes("com.atproto.identity.resolveHandle")) {',
    '    return new Response(JSON.stringify({ did: "did:plc:resolved" }), { status: 200, headers: { "content-type": "application/json" } });',
    '  }',
    '  if (u.includes("app.bsky.feed.getPostThread")) {',
    '    return new Response("down", { status: 404 });', // BF → failure
    '  }',
    '  return new Response("no", { status: 404 });',
    '}',
  ].join('\n'),
);

const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir });
const res = spawnSync(process.execPath, ['-r', stub, path.join(__dirname, 'backfill-metadata.cts'), '--all'], { env, encoding: 'utf8' });

check('script exited 0', res.status === 0);
if (res.status !== 0) {
  console.log(res.stdout, res.stderr);
}

const read = (id) => JSON.parse(fs.readFileSync(path.join(saveFolder, id + '.json'), 'utf8'));

// F: X fetch failed → stored meta fully preserved (NOT null-destroyed), skipped.
const recF = read(F);
check('F: text preserved on failed re-fetch', recF.text === 'stored body text');
check('F: displayName preserved', recF.displayName === 'Stored Name');
check('F: userId preserved', recF.userId === '999');
check('F: likes preserved', recF.likes === 42);
check('F: date preserved', recF.date === '2024-01-01T00:00:00.000Z');
check('F: lang preserved', recF.lang === 'ja');

// S: X fetch succeeded → updated with fresh meta.
const recS = read(S);
check('S: text updated', recS.text === 'fresh tweet body');
check('S: displayName updated', recS.displayName === 'Fresh Name');
check('S: userId updated', recS.userId === '555');
check('S: likes updated', recS.likes === 99);
check('S: date updated', recS.date === '2025-05-05T00:00:00.000Z');

// P: X partial (response lacked favorite_count) → fresh fields applied, but the
// missing likes falls back to the stored value via `m.likes ?? rec.likes`.
const recP = read(P);
check('P: text updated to partial body', recP.text === 'partial body');
check('P: missing likes kept from stored record (?? merge)', recP.likes === 42);
check('P: userId updated', recP.userId === '777');

// BF: Bluesky thread fetch failed → stored meta preserved (handle is URL-derived).
const recBF = read(BF);
check('BF: text preserved on failed bsky re-fetch', recBF.text === 'bsky stored text');
check('BF: displayName preserved', recBF.displayName === 'Bsky Stored');
check('BF: likes preserved', recBF.likes === 7);
check('BF: date preserved', recBF.date === '2024-02-02T00:00:00.000Z');

// stdout summary: 2 updated (S,P), 2 no-data (F,BF).
check('stdout reports 2 updated', /backfilled 2\b/.test(res.stdout || ''));
check('stdout reports 2 no-data', /no-data 2\b/.test(res.stdout || ''));

// No leftover .tmp files (atomic write cleaned up).
check('no leftover .tmp sidecars', !fs.readdirSync(saveFolder).some((f) => f.endsWith('.tmp')));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (ok ? 'BACKFILL_METADATA_TEST_PASS' : 'BACKFILL_METADATA_TEST_FAIL'));
process.exit(ok ? 0 : 1);
