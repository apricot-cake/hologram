'use strict';

// V2 — bridge original-media download: validation, on-disk write, best-effort
// drops, and sidecar `media[]`. Runs IN-PROCESS with a stubbed global.fetch
// (no network, no TLS); the bridge exports its internals when require()'d.
//
//   node scripts/test-media.cts

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-media-'));
process.env.APPDATA = tmp;
process.env.HOLOGRAM_CONFIG_DIR = path.join(tmp, 'Hologram'); // isolate configDir to the sandbox
const configDir = path.join(tmp, 'Hologram');
fs.mkdirSync(configDir, { recursive: true });
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(saveFolder, { recursive: true }); // handleSave mkdir's this; the direct downloadMedia call needs it too
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

const { handleSave, downloadMedia, downloadAvatar } = require('../native-host/bridge.cts');

// A valid 1x1 PNG (only the content-type matters to the bridge).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

// Stub fetch: map test URLs to Responses. No real network. lastFetch records the
// most recent request so a test can assert the bridge forwarded a Referer (pixiv).
let lastFetch: any = null;
(global as any).fetch = async (url, opts) => {
  const u = String(url);
  lastFetch = { url: u, headers: (opts && opts.headers) || null };
  if (u.endsWith('/img.png')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
  if (u.endsWith('/photo.jpg')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  if (u.endsWith('/page.html')) return new Response('<html>no</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  if (u.endsWith('/big.png')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(99 * 1024 * 1024) } });
  if (u.endsWith('/clip.mp4')) return new Response(Buffer.from('fake-mp4-bytes'), { status: 200, headers: { 'content-type': 'video/mp4' } });
  if (u.endsWith('/huge.mp4')) return new Response(Buffer.from('fake-mp4-bytes'), { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(300 * 1024 * 1024) } });
  if (u.endsWith('/poster.jpg')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/jpeg' } }); // bytes don't matter, only content-type
  if (u.endsWith('/missing')) return new Response('nope', { status: 404 });
  return new Response('nope', { status: 500 });
};

const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' + 'AAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';

let ok = true;
const check = (label, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) ok = false;
};

(async () => {
  // --- downloadMedia: only the two valid images land ---
  const base = '1717500000000-aaaa';
  const list = [
    { url: 'https://h/img.png', alt: 'pic', width: 1, height: 1 },
    { url: 'https://h/page.html', alt: null }, // wrong content-type -> drop
    { url: 'https://h/photo.jpg', alt: null, width: 2, height: 3 },
    { url: 'https://h/big.png', alt: null }, // oversized (declared) -> drop
    { url: 'https://h/missing', alt: null }, // 404 -> drop
    { url: 'http://h/img.png', alt: null }, // non-https -> drop (no fetch)
  ];
  const saved = await downloadMedia(list, saveFolder, base);
  check('downloadMedia keeps only the 2 valid images', saved.length === 2);
  check('media-0 png written', fs.existsSync(path.join(saveFolder, base + '-media-0.png')));
  check('media-2 jpg written', fs.existsSync(path.join(saveFolder, base + '-media-2.jpg')));
  check(
    'html/big/404/http wrote no files',
    !fs.existsSync(path.join(saveFolder, base + '-media-1.html')) &&
      !fs.existsSync(path.join(saveFolder, base + '-media-1.png')) &&
      !fs.existsSync(path.join(saveFolder, base + '-media-3.png')) &&
      !fs.existsSync(path.join(saveFolder, base + '-media-4.png')) &&
      !fs.existsSync(path.join(saveFolder, base + '-media-5.png')),
  );
  check('descriptor carries file + alt + dims', saved[0].file === base + '-media-0.png' && saved[0].alt === 'pic' && saved[0].width === 1);

  // --- video/gif entries (#119 St1): success, size-cap downgrade, double failure ---
  // At most one video item per post on X/Misskey/Mastodon → each case gets its
  // own base (a shared base would collide on the unindexed <base>-poster.<ext>).
  const vbase1 = '1717500000000-vid1';
  const savedVideo = await downloadMedia([{ url: 'https://h/clip.mp4', alt: 'clip', width: 100, height: 200, type: 'video', poster: 'https://h/poster.jpg' }], saveFolder, vbase1);
  check(
    'video: media file + poster both written, type/posterFile recorded',
    savedVideo.length === 1 && savedVideo[0].file === vbase1 + '-media-0.mp4' && savedVideo[0].type === 'video' && savedVideo[0].posterFile === vbase1 + '-poster.jpg' && fs.existsSync(path.join(saveFolder, savedVideo[0].file)) && fs.existsSync(path.join(saveFolder, savedVideo[0].posterFile)),
  );

  const vbase2 = '1717500000000-vid2';
  const savedOversized = await downloadMedia([{ url: 'https://h/huge.mp4', alt: null, type: 'video', poster: 'https://h/poster.jpg' }], saveFolder, vbase2);
  check('oversized video downgrades to a still (poster becomes `file`, type unset)', savedOversized.length === 1 && savedOversized[0].file === vbase2 + '-poster.jpg' && savedOversized[0].type === undefined && fs.existsSync(path.join(saveFolder, savedOversized[0].file)));

  const vbase3 = '1717500000000-vid3';
  const savedNoPoster = await downloadMedia([{ url: 'https://h/clip.mp4', alt: null, type: 'gif' }], saveFolder, vbase3);
  check('gif without a poster URL: video saved, posterFile stays unset', savedNoPoster.length === 1 && savedNoPoster[0].file === vbase3 + '-media-0.mp4' && savedNoPoster[0].type === 'gif' && savedNoPoster[0].posterFile === undefined);

  const vbase4 = '1717500000000-vid4';
  const savedDoubleFail = await downloadMedia([{ url: 'https://h/missing', alt: null, type: 'video', poster: 'https://h/missing' }], saveFolder, vbase4);
  check('video+poster both failing drops the item entirely', savedDoubleFail.length === 0);

  // --- downloadAvatar: shared store avatars/<urlhash>.<ext>; bad/empty → null;
  //     same URL reuses the existing file WITHOUT a fetch; Referer forwarded ---
  const avHash = (u) => require('node:crypto').createHash('sha1').update(u).digest('hex').slice(0, 16);
  const avFile = await downloadAvatar('https://h/photo.jpg', undefined, saveFolder);
  check('downloadAvatar writes avatars/<urlhash>.jpg', avFile === `avatars/${avHash('https://h/photo.jpg')}.jpg` && fs.existsSync(path.join(saveFolder, avFile)));
  check('downloadAvatar(null) → null', (await downloadAvatar(null, undefined, saveFolder)) === null);
  check('downloadAvatar(404) → null', (await downloadAvatar('https://h/missing', undefined, saveFolder)) === null);
  lastFetch = null;
  const avFile2 = await downloadAvatar('https://h/photo.jpg', undefined, saveFolder);
  check('downloadAvatar reuses existing file (no fetch)', avFile2 === avFile && lastFetch === null);
  await downloadAvatar('https://h/img.png', 'https://www.pixiv.net/', saveFolder);
  check('downloadAvatar forwards pixiv Referer', !!(lastFetch && lastFetch.headers && lastFetch.headers.Referer === 'https://www.pixiv.net/'));

  // --- handleSave end-to-end: sidecar media reflects what landed; ack ok ---
  const ack = await handleSave({
    type: 'save',
    captureId: '1717500000000-bbbb',
    image: jpegB64,
    metadata: {
      url: 'https://x.com/u/status/1',
      platform: 'x',
      text: 'hi',
      avatar: 'https://h/img.png',
      media: [
        { url: 'https://h/img.png', alt: 'pic', width: 1, height: 1 },
        { url: 'https://h/missing', alt: null }, // dropped, must not fail the save
      ],
    },
  });
  check('handleSave ack ok despite 1 failed media', ack.ok === true);
  check('handleSave mediaCount = 1', ack.mediaCount === 1);
  const rec = JSON.parse(fs.readFileSync(path.join(saveFolder, ack.file.replace(/\.jpg$/, '.json')), 'utf8'));
  check('sidecar media.length = 1', Array.isArray(rec.media) && rec.media.length === 1);
  check('sidecar media[0].file on disk', rec.media[0] && rec.media[0].file && fs.existsSync(path.join(saveFolder, rec.media[0].file)));
  check('screenshot jpg still written', fs.existsSync(path.join(saveFolder, ack.file)));
  check('sidecar avatarFile on disk', !!(rec.avatarFile && fs.existsSync(path.join(saveFolder, rec.avatarFile))));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + (ok ? 'MEDIA_TEST_PASS' : 'MEDIA_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.log('ERR', e.message);
  process.exit(1);
});
