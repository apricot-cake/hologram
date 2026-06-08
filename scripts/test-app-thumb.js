'use strict';

// Verifies thumbnails are resized by the SHORT edge so a wide (e.g. 1920x1080) image
// fills a square tile cleanly instead of being upscaled vertically (the blur bug).
// Copies one real full-HD image from the live save folder into a temp folder; skips
// gracefully (PASS) if that file isn't present.
//
//   node scripts/test-app-thumb.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const SRC = path.join(os.homedir(), 'Corpus', 'eagle-MPHS1F6TJGE6Q.png');   // known 1920x1080

if (!fs.existsSync(SRC)) {
  console.log('source full-HD image not found, skipping');
  console.log('THUMB_TEST_PASS');
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-thumb-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const id = 'eagle-thumbtest';
fs.copyFileSync(SRC, path.join(saveFolder, id + '.png'));
fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
  captureId: id, image: id + '.png', url: null, platform: null, title: 'wide test',
  mediaType: 'image', media: [], tags: [], hashtags: [],
  capturedAt: '2026-05-23T03:16:29.095Z', date: '2026-05-23T03:16:29.095Z', source: 'eagle-migration'
}, null, 2));

const evalJs = `(async () => {
  document.getElementById('modeImageBtn').click();
  await new Promise(r => setTimeout(r, 800));
  const img = document.querySelector('#ivGrid .iv-card img');
  if (!img) return { err: 'no tile' };
  await new Promise((res) => { if (img.complete && img.naturalWidth) return res(); img.onload = res; img.onerror = res; setTimeout(res, 2000); });
  return { w: img.naturalWidth, h: img.naturalHeight, src: img.getAttribute('src') };
})()`;

const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
  // Wide source → thumbnail must be landscape (w>h) and the short edge (h) must be the
  // requested tile size band (~120-260, i.e. tile×dpr), NOT collapsed to ~101.
  const ok = r.w > r.h && r.h >= 120 && r.h <= 300 && (r.w / r.h) > 1.5;
  console.log(`thumb ${r.w}x${r.h} ratio=${r.w && r.h ? (r.w / r.h).toFixed(2) : '?'} src=${r.src}`);
  console.log(ok ? 'THUMB_TEST_PASS' : 'THUMB_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
