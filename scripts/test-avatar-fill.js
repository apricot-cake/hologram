'use strict';

// backfill --avatars: for sidecars that have an avatar URL but no local file,
// download into the shared store (avatars/<urlhash>.<ext>) and set avatarFile;
// skip ones already filled or with no avatar. Spawns the REAL script with a
// preloaded fetch stub (the SSRF guard refuses localhost, so a real local server
// can't stand in — we stub global.fetch via `node -r`). Also unit-tests
// pixivRefererFor.
//
//   node scripts/test-avatar-fill.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pixivRefererFor } = require('../native-host/media-download');

let ok = true;
const check = (label, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) ok = false;
};

// --- pixivRefererFor (pure) ---
check('pixivRefererFor i.pximg.net → pixiv referer', pixivRefererFor('https://i.pximg.net/img/x.jpg') === 'https://www.pixiv.net/');
check('pixivRefererFor s.pximg.net → pixiv referer', pixivRefererFor('https://s.pximg.net/x.png') === 'https://www.pixiv.net/');
check('pixivRefererFor exact pximg.net → pixiv referer', pixivRefererFor('https://pximg.net/x.png') === 'https://www.pixiv.net/');
check('pixivRefererFor other host → undefined', pixivRefererFor('https://pbs.twimg.com/x.jpg') === undefined);
check('pixivRefererFor garbage → undefined', pixivRefererFor('not a url') === undefined);
check('pixivRefererFor non-pximg lookalike → undefined', pixivRefererFor('https://notpximg.net.evil.com/x') === undefined);

// --- backfill --avatars end-to-end ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-avfill-'));
const configDir = path.join(tmp, 'Corpus');
fs.mkdirSync(configDir, { recursive: true });
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

// Sidecar A: avatar URL, no file → should fill. B: already has avatarFile → skip.
// C: no avatar → skip.
const A = '1717500000000-aaaa';
fs.writeFileSync(path.join(saveFolder, A + '.json'), JSON.stringify({ captureId: A, url: 'https://x/1', avatar: 'https://h/photo.jpg' }));
const B = '1717500000000-bbbb';
fs.writeFileSync(path.join(saveFolder, B + '.json'), JSON.stringify({ captureId: B, avatar: 'https://h/photo.jpg', avatarFile: B + '-avatar.jpg' }));
const C = '1717500000000-cccc';
fs.writeFileSync(path.join(saveFolder, C + '.json'), JSON.stringify({ captureId: C, url: 'https://x/3' }));

// Preload that stubs global.fetch before the script runs (no network, no TLS).
const stub = path.join(tmp, 'stub-fetch.js');
fs.writeFileSync(
  stub,
  [
    "const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');",
    'global.fetch = async (url) => {',
    '  const u = String(url);',
    "  if (u.endsWith('/photo.jpg')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });",
    "  return new Response('no', { status: 404 });",
    '};',
  ].join('\n'),
);

const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus') });
const res = spawnSync(process.execPath, ['-r', stub, path.join(__dirname, 'backfill-metadata.js'), '--avatars'], { env, encoding: 'utf8' });

check('script exited 0', res.status === 0);
check('stdout reports filled 1', /filled 1\b/.test(res.stdout || ''));

const avHash = require('node:crypto').createHash('sha1').update('https://h/photo.jpg').digest('hex').slice(0, 16);
const recA = JSON.parse(fs.readFileSync(path.join(saveFolder, A + '.json'), 'utf8'));
check('A: avatarFile set to avatars/<urlhash>.png', recA.avatarFile === `avatars/${avHash}.png`);
check('A: avatar image on disk', fs.existsSync(path.join(saveFolder, 'avatars', `${avHash}.png`)));

const recB = JSON.parse(fs.readFileSync(path.join(saveFolder, B + '.json'), 'utf8'));
check('B: avatarFile unchanged (already had one)', recB.avatarFile === B + '-avatar.jpg');
check('B: no new avatar downloaded', !fs.existsSync(path.join(saveFolder, B + '-avatar.png')));

const recC = JSON.parse(fs.readFileSync(path.join(saveFolder, C + '.json'), 'utf8'));
check('C: no avatarFile (no avatar URL)', recC.avatarFile == null);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (ok ? 'AVATAR_FILL_TEST_PASS' : 'AVATAR_FILL_TEST_FAIL'));
process.exit(ok ? 0 : 1);
