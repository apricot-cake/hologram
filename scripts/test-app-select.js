'use strict';

// Verifies the image-view ○ (select circle) wiring: clicking a tile's bottom-right
// ○ enters selection mode and selects that tile; a subsequent Shift+click on the
// ○ of a later tile range-selects everything in between; a plain ○ click toggles a
// single tile off. Seeds 4 image-view-eligible records (eagle-migration shape) so
// there are enough tiles for a meaningful range.
//
//   node scripts/test-app-select.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-sel-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

// 4 standalone illustration records (eagle-migration shape: image IS the artwork,
// distinct pixiv posts so each is its own tile — no auto-grouping collapses them).
for (let i = 0; i < 4; i++) {
  const id = '170000000000' + i + '-s0' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://www.pixiv.net/artworks/' + (100 + i),
    platform: 'pixiv', title: '作品' + i, displayName: '絵師' + i, screenName: '90000' + i,
    likes: 1000 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: [], hashtags: [], source: 'eagle-migration'
  }, null, 2));
}

const evalJs = `(async () => {
  document.getElementById('modeImageBtn').click();
  await new Promise(r => setTimeout(r, 700));
  const grid = document.getElementById('ivGrid');
  const tileAt = (i) => grid.querySelector('.iv-card[data-idx="' + i + '"]');
  const circleAt = (i) => tileAt(i) && tileAt(i).querySelector('.iv-selcircle');
  const click = (el, shift) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: !!shift }));
  const selCount = () => grid.querySelectorAll('.iv-card.selected').length;

  const total = grid.querySelectorAll('.iv-card').length;
  // 1) click ○ on tile 0 → enters select mode, selects tile 0
  click(circleAt(0), false);
  const enteredMode = grid.classList.contains('selecting');
  const afterFirst = selCount();
  const btnText = document.getElementById('ivSelectBtn').textContent;
  // 2) Shift+click ○ on tile 2 → range-selects 0,1,2
  click(circleAt(2), true);
  const afterRange = selCount();
  const countLabel = document.getElementById('ivSelCount').textContent;
  // 3) plain click ○ on tile 1 → toggles it off (2 remain)
  click(circleAt(1), false);
  const afterToggle = selCount();
  const tile1Selected = tileAt(1).classList.contains('selected');
  return { total, enteredMode, afterFirst, btnText, afterRange, countLabel, afterToggle, tile1Selected };
})()`;

const env = Object.assign({}, process.env, {
  APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });

child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.total === 4 && r.enteredMode === true && r.afterFirst === 1 &&
    r.btnText === '選択終了' && r.afterRange === 3 && /3/.test(r.countLabel || '') &&
    r.afterToggle === 2 && r.tile1Selected === false;
  console.log(`total=${r.total} enter=${r.enteredMode} first=${r.afterFirst} btn=${r.btnText} range=${r.afterRange} label=${r.countLabel} toggle=${r.afterToggle} tile1=${r.tile1Selected}`);
  console.log(ok ? 'SELECT_TEST_PASS' : 'SELECT_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
