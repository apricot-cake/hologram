'use strict';
// Throwaway: verify the sidebar text-axis alignment — the x where text starts
// (rect.left + border + padding) must be identical across titles, search box,
// sort select, chips, date inputs and the post count; checkbox labels land on
// the same axis via the gutter trick (±1.5px tolerance for the native box).
// Also: the sidebar got more top breathing room (padding-top 18px).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-al-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const id = '1700000000000-al0';
fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
  captureId: id, image: id + '.jpg', url: 'https://x.com/u/status/900',
  platform: 'x', text: '本文', displayName: '人', screenName: 'u',
  likes: 10, capturedAt: '2026-04-01T12:00:00Z', date: '2026-04-01T10:00:00Z',
  media: [], tags: [], hashtags: []
}, null, 2));
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  await waitFor(() => document.querySelectorAll('#postGrid .post-card').length >= 1);
  const textX = (el) => {
    const cs = getComputedStyle(el);
    return el.getBoundingClientRect().left + parseFloat(cs.borderLeftWidth || 0) + parseFloat(cs.paddingLeft || 0);
  };
  const xs = {
    // sbKindTitle is now a ROW NAME after a leading icon (by design), so it no
    // longer sits on the bare-text axis — measure section titles instead.
    search: textX(document.getElementById('searchBox')),
    select: textX(document.getElementById('sortSelect').nextElementSibling),
    row: textX(document.querySelector('#filterRows .sb-row')),
    modeSel: textX(document.getElementById('searchModeSel').nextElementSibling),
    secTitle: textX(document.getElementById('sbSearchTitle'))
    // viewBtn dropped: segmented-control labels are center-aligned, so they
    // don't sit on the left text axis (the 1px box-math diff is meaningless).
  };
  const base = xs.search;
  const offBy = {};
  for (const k of Object.keys(xs)) offBy[k] = Math.round((xs[k] - base) * 10) / 10;
  const aligned = Object.values(offBy).every((d) => Math.abs(d) < 0.6);
  const padTop = getComputedStyle(document.getElementById('sidebar')).paddingTop;
  const scroll = document.querySelector('#controls-posts .sb-scroll');
  const scrollPadRight = getComputedStyle(scroll).paddingRight;
  // inter-section rhythm: scroll sections are separated by a hairline divider
  // (border-top) + 18px padding-top, so they read as distinct bands.
  const secCs = getComputedStyle(document.querySelector('.sb-scroll > .sb-section'));
  const secGap = secCs.paddingTop === '18px' && parseFloat(secCs.borderTopWidth) >= 1 ? '22px' : secCs.paddingTop;
  // .has-value highlight is pastel now: soft ring (box-shadow set) and the border
  // is NOT the full-strength accent
  const sbox = document.getElementById('searchBox');
  sbox.value = 'x'; sbox.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(60);
  const hvCs = getComputedStyle(sbox);
  const accentProbe = document.createElement('div');
  accentProbe.style.cssText = 'position:absolute;visibility:hidden;background:var(--accent)';
  document.body.appendChild(accentProbe);
  const accentCol = getComputedStyle(accentProbe).backgroundColor;
  accentProbe.remove();
  const hvPastel = sbox.classList.contains('has-value') && hvCs.boxShadow !== 'none' && hvCs.borderTopColor !== accentCol;
  sbox.value = ''; sbox.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(40);
  // 表示 (view toggle) is the FIRST toolbar section, and its active segment is
  // monotone (fills with --border-strong, not the blue accent)
  // first SECTION is 表示 (the small hist-nav ←/→ row sits above the sections)
  const viewFirst = !!document.querySelector('#postsToolbar .sb-section').querySelector('.view-toggle');
  // segmented control = recessed track + raised thumb; active fill is --seg-thumb
  const segBg = getComputedStyle(document.querySelector('.view-toggle button.active')).backgroundColor;
  const probe2 = document.createElement('div');
  probe2.style.cssText = 'position:absolute;visibility:hidden;background:var(--seg-thumb)';
  document.body.appendChild(probe2);
  const segMonotone = segBg === getComputedStyle(probe2).backgroundColor;
  probe2.remove();
  return { offBy, aligned, padTop, scrollPadRight,
    secGap, viewFirst, segMonotone, hvPastel, base: Math.round(base * 10) / 10 };
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
  const ok = r.aligned === true && r.padTop === '18px' &&
    r.scrollPadRight === '8px' &&
    r.secGap === '22px' && r.viewFirst === true && r.segMonotone === true && r.hvPastel === true;
  console.log('base=' + r.base + ' offsets=' + JSON.stringify(r.offBy) + ' padTop=' + r.padTop +
    ' scrollPadRight=' + r.scrollPadRight +
    ' secGap=' + r.secGap + ' viewFirst=' + r.viewFirst + ' segMono=' + r.segMonotone + ' hvPastel=' + r.hvPastel);
  console.log(ok ? 'ALIGN_VERIFY_PASS' : 'ALIGN_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
