'use strict';

// Verifies image-view tag groups can be folded per group: each tag group renders as an
// .iv-taggroup, and clicking the group subtitle (.iv-tagfold) collapses just that group.
//
//   node scripts/test-app-tagfold.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-tf-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));
// one named group ('色') containing tag A; tag B falls into 「その他」 → 2 .iv-taggroup
fs.writeFileSync(path.join(saveFolder, 'tag-groups.json'), JSON.stringify({ groups: [{ id: 'g1', name: '色', tags: ['A'] }] }, null, 2));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const tagsFor = [['A'], ['B']];
for (let i = 0; i < 2; i++) {
  const id = '170000000000' + i + '-tf' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://www.pixiv.net/artworks/' + (900 + i),
    platform: 'pixiv', title: '作品' + i, screenName: '4' + i, likes: 100 + i,
    capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z', date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [], tags: tagsFor[i], hashtags: [], source: 'eagle-migration'
  }, null, 2));
}

const evalJs = `(async () => {
  document.getElementById('modeImageBtn').click();
  await new Promise(r => setTimeout(r, 800));
  const groups = document.querySelectorAll('#ivTagGroups .iv-taggroup').length;
  const fold0 = document.querySelector('#ivTagGroups .iv-tagfold');
  if (!fold0) return { groups, err: 'no fold' };
  const grp = fold0.closest('.iv-taggroup');
  const chipsBefore = grp.querySelector('.sb-chips').offsetParent !== null;   // visible?
  fold0.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  const collapsed = grp.classList.contains('collapsed');
  const chipsAfter = grp.querySelector('.sb-chips').offsetParent !== null;
  return { groups, chipsBefore, collapsed, chipsAfter };
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
  const ok = r.groups === 2 && r.chipsBefore === true && r.collapsed === true && r.chipsAfter === false;
  console.log(`groups=${r.groups} chipsBefore=${r.chipsBefore} collapsed=${r.collapsed} chipsAfter=${r.chipsAfter}`);
  console.log(ok ? 'TAGFOLD_TEST_PASS' : 'TAGFOLD_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
