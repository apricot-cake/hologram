'use strict';

// Smoke test for the native messaging bridge. Frames a 'save' message, pipes it
// to bridge.js with a temporary save folder (via an overridden config dir), and
// verifies the JPEG + sidecar are written and the ack is well-formed.
//
//   node scripts/test-bridge.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-test-'));
// Isolate configDir to the sandbox via CORPUS_CONFIG_DIR (set in env below).
const configDir = path.join(tmp, 'Corpus');
fs.mkdirSync(configDir, { recursive: true });
const saveFolder = path.join(tmp, 'saves');
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

// Minimal valid 1x1 JPEG.
const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' + 'AAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';

const captureId = '1717500000000-abcd';
const payload = {
  type: 'save',
  captureId,
  image: jpegB64,
  metadata: { url: 'https://x.com/u/status/1', platform: 'x', text: 'hi', tags: ['t'] },
};

const msg = Buffer.from(JSON.stringify(payload), 'utf8');
const header = Buffer.alloc(4);
header.writeUInt32LE(msg.length, 0);

const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus') });
const child = spawn(process.execPath, [path.join(__dirname, '..', 'native-host', 'bridge.cts')], {
  env,
  stdio: ['pipe', 'pipe', 'inherit'],
});

let out = Buffer.alloc(0);
child.stdout.on('data', (d) => {
  out = Buffer.concat([out, d]);
});

child.on('close', () => {
  let resp: any = null;
  try {
    const len = out.readUInt32LE(0);
    resp = JSON.parse(out.subarray(4, 4 + len).toString('utf8'));
  } catch (e) {
    console.error('Failed to parse response frame:', e.message);
  }

  const jpg = path.join(saveFolder, `${captureId}.jpg`);
  const json = path.join(saveFolder, `${captureId}.json`);
  const okJpg = fs.existsSync(jpg);
  const okJson = fs.existsSync(json);
  const rec = okJson ? JSON.parse(fs.readFileSync(json, 'utf8')) : null;

  console.log('response   :', JSON.stringify(resp));
  console.log('jpg/json   :', okJpg, okJson);
  console.log('record     :', rec && { captureId: rec.captureId, image: rec.image, url: rec.url, tags: rec.tags });

  const pass = !!resp && resp.ok && okJpg && okJson && rec.captureId === captureId && rec.image === `${captureId}.jpg` && rec.url === 'https://x.com/u/status/1';

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(pass ? 'BRIDGE_TEST_PASS' : 'BRIDGE_TEST_FAIL');
  process.exit(pass ? 0 : 1);
});

child.stdin.write(Buffer.concat([header, msg]));
child.stdin.end();
