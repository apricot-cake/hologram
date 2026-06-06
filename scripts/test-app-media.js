'use strict';

// V3 — viewer original-media display (headless). A sidecar with 2 media entries
// + matching PNG files: assert there is no separate originals button (merged into
// the single zoom button), that the zoom button opens one gallery (screenshot + 2
// originals) which pages, the originals load via the psimg:// protocol, and the
// alt text is carried into the gallery safely (DOM property, not injected).
//
//   node scripts/test-app-media.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'postsnap-media-app-'));
const configDir = path.join(tmp, 'PostSnap');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const id = 'dummy-0001';
fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
fs.writeFileSync(path.join(saveFolder, `${id}-media-0.png`), png);
fs.writeFileSync(path.join(saveFolder, `${id}-media-1.png`), png);
const ALT = '<img src=x onerror=window.__xss=1>"hostile';
fs.writeFileSync(path.join(saveFolder, `${id}.json`), JSON.stringify({
  captureId: id, image: `${id}.jpg`, url: 'https://x.com/u/status/1', platform: 'x',
  text: 'media test', displayName: 'T', screenName: 'u', mediaType: 'image',
  media: [
    { url: 'https://x/0.png', alt: ALT, width: 1, height: 1, file: `${id}-media-0.png` },
    { url: 'https://x/1.png', alt: null, width: 1, height: 1, file: `${id}-media-1.png` }
  ],
  capturedAt: '2026-01-01T00:00:00.000Z', date: '2026-01-01T00:00:00.000Z', tags: []
}, null, 2));

const evalJs = `(async () => {
  // Originals access is merged into the single zoom button; no separate button.
  const noMediaBtn = document.querySelectorAll('.post-card .media-btn').length === 0;
  // The hostile alt must not appear in the card markup.
  const injectedInCard = !!(document.querySelector('.post-card [onerror]') || window.__xss);
  // Zoom button -> one gallery: screenshot first (1 / 3).
  const zoom = document.querySelector('.post-card .zoom-btn');
  if (zoom) zoom.click();
  const lb = document.getElementById('lightbox');
  const shown = lb.classList.contains('show');
  const multi = lb.classList.contains('multi');
  const counterScreenshot = document.getElementById('lbCounter').textContent;
  // Page to the first original (2 / 3).
  document.getElementById('lbNext').click();
  const counterOriginal = document.getElementById('lbCounter').textContent;
  const img = document.getElementById('lightboxImg');
  let nat = 0; try { await img.decode(); } catch (e) {} nat = img.naturalWidth;
  const galleryAlt = img.getAttribute('alt');
  const injectedAfterOpen = !!(document.querySelector('#lightbox [onerror]') || window.__xss);
  // Page to the second original (3 / 3).
  document.getElementById('lbNext').click();
  const counter3 = document.getElementById('lbCounter').textContent;
  return { noMediaBtn, injectedInCard, shown, multi, counterScreenshot, counterOriginal, nat, galleryAlt, injectedAfterOpen, counter3 };
})()`;

const env = Object.assign({}, process.env, { APPDATA: tmp, POSTSNAP_SMOKE: '1', POSTSNAP_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });

child.on('close', () => {
  fs.rmSync(tmp, { recursive: true, force: true });
  const m = out.match(/EVAL_RESULT (\{.*\})/);
  if (!m) { console.log('\nMEDIA_APP_TEST_FAIL (no eval result)'); process.exit(1); }
  let r;
  try { r = JSON.parse(m[1]); } catch { console.log('\nMEDIA_APP_TEST_FAIL (bad json)'); process.exit(1); }

  let ok = true;
  const check = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) ok = false; };
  check('originals merged into zoom (no separate media button)', r.noMediaBtn === true);
  check('zoom opens one gallery: screenshot + 2 originals (1 / 3, multi)', r.shown === true && r.multi === true && r.counterScreenshot === '1 / 3');
  check('paging reaches the first original (2 / 3)', r.counterOriginal === '2 / 3');
  check('original loads via psimg (naturalWidth>0)', r.nat > 0);
  check('alt carried into gallery as the escaped literal; no element/handler injected', r.injectedInCard === false && r.injectedAfterOpen === false && r.galleryAlt === ALT);
  check('paging reaches the second original (3 / 3)', r.counter3 === '3 / 3');
  console.log('\n' + (ok ? 'MEDIA_APP_TEST_PASS' : 'MEDIA_APP_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
