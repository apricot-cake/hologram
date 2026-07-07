'use strict';

// Drag-save (illustration record) test for the native host. Mocks fetch so no
// network is needed. Verifies handleSaveDragged downloads the dragged image as
// the primary <base>.<ext> (non-JPEG ok), leaves media[] empty, preserves the
// API metadata, sends the pixiv Referer, and writes no orphan on failure.
//
//   node scripts/test-drag.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-drag-'));
process.env.APPDATA = tmp;
process.env.CORPUS_CONFIG_DIR = path.join(tmp, 'Corpus'); // isolate configDir to the sandbox
const configDir = path.join(tmp, 'Corpus');
fs.mkdirSync(configDir, { recursive: true });
const saveFolder = path.join(tmp, 'saves');
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

const { handleSaveDragged } = require('../native-host/bridge.cts');

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
let sentHeaders = null;

let pass = 0,
  fail = 0;
const ok = (c, m) => {
  if (c) {
    pass++;
    console.log('PASS', m);
  } else {
    fail++;
    console.log('FAIL', m);
  }
};

(async () => {
  global.fetch = async (_url, opts) => {
    sentHeaders = opts && opts.headers;
    return { ok: true, headers: new Map([['content-type', 'image/png']]), arrayBuffer: async () => png };
  };

  const res = await handleSaveDragged({
    captureId: '1717500000000-ab01',
    imageUrl: 'https://i.pximg.net/img-original/x/555_p0.png',
    imageReferer: 'https://www.pixiv.net/',
    metadata: { url: 'https://www.pixiv.net/artworks/555', platform: 'pixiv', title: 'T', screenName: '77', hashtags: ['a'], tags: [], likes: 5, media: [{ url: 'should-be-overridden' }] },
  });
  ok(res.ok === true, 'ack ok');
  ok(res.file === '1717500000000-ab01.png', 'primary image is <base>.png (non-JPEG)');

  const img = path.join(saveFolder, '1717500000000-ab01.png');
  const json = path.join(saveFolder, '1717500000000-ab01.json');
  ok(fs.existsSync(img), 'png written to disk');
  ok(fs.existsSync(json), 'sidecar json written');
  const rec = JSON.parse(fs.readFileSync(json, 'utf8'));
  ok(rec.image === '1717500000000-ab01.png', 'rec.image = <base>.png');
  ok(Array.isArray(rec.media) && rec.media.length === 0, 'rec.media = [] (no lightbox duplicate)');
  ok(rec.platform === 'pixiv' && rec.title === 'T' && rec.screenName === '77' && rec.likes === 5, 'API metadata preserved');
  ok(sentHeaders && sentHeaders.Referer === 'https://www.pixiv.net/', 'pixiv Referer sent on primary download');

  // failure: unsupported content-type → throw, leave no orphan sidecar/image
  global.fetch = async () => ({ ok: true, headers: new Map([['content-type', 'text/html']]), arrayBuffer: async () => Buffer.from('x') });
  let threw = false;
  try {
    await handleSaveDragged({ captureId: '1717500000001-ab02', imageUrl: 'https://x/y', metadata: {} });
  } catch {
    threw = true;
  }
  ok(threw, 'unsupported type throws');
  ok(!fs.existsSync(path.join(saveFolder, '1717500000001-ab02.json')), 'no orphan sidecar on download failure');

  console.log(fail ? '\nDRAG_TEST_FAIL' : '\nDRAG_TEST_PASS');
  process.exit(fail ? 1 : 0);
})();
