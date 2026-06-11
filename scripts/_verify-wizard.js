'use strict';
// Throwaway: tagging wizard — walks UNTAGGED posts, shows tag-group chips,
// toggles tags + a plain/media flag, saves to the sidecar and advances.
// Seeds 3 posts: 2 untagged (p0,p1), 1 already tagged (p2 → excluded from queue).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-tw-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
fs.writeFileSync(path.join(saveFolder, 'tag-groups.json'), JSON.stringify({
  groups: [{ id: 'g1', name: 'ポーズ', tags: ['立ち', '座り'] }, { id: 'g2', name: '構図', tags: ['俯瞰', 'あおり'] }]
}));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-tw' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://x.com/u/status/' + (800 + i),
    platform: 'x', text: '本文' + i, displayName: '人' + i, screenName: 'u' + i,
    likes: i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [],
    tags: i === 2 ? ['既存'] : [], hashtags: []
  }, null, 2));
}
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  await waitFor(() => document.querySelectorAll('#postGrid .post-card').length >= 3);
  const view = document.getElementById('tagWizard');
  const body = document.getElementById('twBody');
  const click = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  // launch from the sidebar tag-section link
  click(document.getElementById('tagWizardBtn'));
  await waitFor(() => !view.hidden && /1 \\/ 2/.test(document.getElementById('twProgress').textContent));
  const opened = !view.hidden;
  const queueIs2 = document.getElementById('twProgress').textContent.trim() === '1 / 2';   // 2 untagged only
  const bigImg = !!body.querySelector('img.tw-big');   // image shown large
  // groups are y/n gates: headers present, tag chips hidden until expanded
  const gateCollapsed = body.querySelectorAll('.tw-grp-head[data-grp]').length === 2
    && body.querySelectorAll('.tw-chip[data-tag]').length === 0;
  // expand ポーズ (g1) → its tags appear
  click(body.querySelector('.tw-grp-head[data-grp="g1"]')); await wait(40);
  const expandWorks = body.querySelectorAll('.tw-chip[data-tag]').length >= 2;

  // pick a tag + a kind
  click([...body.querySelectorAll('.tw-chip[data-tag]')].find(c => c.dataset.tag === '立ち')); await wait(40);
  click(body.querySelector('.tw-chip[data-kind="media"]')); await wait(40);
  const tagOn = [...body.querySelectorAll('.tw-chip[data-tag]')].find(c => c.dataset.tag === '立ち').classList.contains('on');
  const kindOn = body.querySelector('.tw-chip[data-kind="media"]').classList.contains('on');
  const badgeShown = (body.querySelector('.tw-grp .tw-grp-badge') || {}).textContent === '1';
  // new tag INTO A NEW GROUP (group creation)
  document.getElementById('twAddInput').value = '自作タグ';
  const gsel = document.getElementById('twAddGroup'); gsel.value = '__new'; gsel.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(30);
  const newGroupInputShown = document.getElementById('twNewGroupName').style.display !== 'none';
  document.getElementById('twNewGroupName').value = '自作群';
  click(document.getElementById('twAddBtn'));
  await wait(80);
  const customOn = [...body.querySelectorAll('.tw-chip[data-tag]')].some(c => c.dataset.tag === '自作タグ' && c.classList.contains('on'));
  const newGroupAppears = [...body.querySelectorAll('.tw-grp-head')].some(h => h.textContent.includes('自作群'));

  click(document.getElementById('twSave'));
  await waitFor(() => document.getElementById('twProgress').textContent.trim() === '2 / 2', 4000);
  const advanced = document.getElementById('twProgress').textContent.trim() === '2 / 2';

  // second post: skip
  click(document.getElementById('twSkip'));
  await wait(150);
  const doneShown = /お疲れ|done|ありません/i.test(body.textContent) && document.getElementById('twSave').style.display === 'none';
  click(document.getElementById('twFinish'));
  await wait(150);
  const closed = view.hidden;
  return { opened, queueIs2, bigImg, gateCollapsed, expandWorks, tagOn, kindOn, badgeShown, newGroupInputShown, customOn, newGroupAppears, advanced, doneShown, closed };
})()`;
const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  // verify the sidecar was written (tags + userKind). queue[0] is the NEWEST
  // untagged post (default date-desc sort) — could be tw0 or tw1, so scan both.
  let saved = false;
  for (const id of ['1700000000000-tw0', '1700000000001-tw1']) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(saveFolder, id + '.json'), 'utf8'));
      if (Array.isArray(rec.tags) && rec.tags.includes('立ち') && rec.tags.includes('自作タグ') && rec.userKind === 'media') saved = true;
    } catch { /* next */ }
  }
  // the new group must have been persisted to tag-groups.json
  let newGroupSaved = false;
  try {
    const tg = JSON.parse(fs.readFileSync(path.join(saveFolder, 'tag-groups.json'), 'utf8'));
    newGroupSaved = (tg.groups || []).some((g) => g.name === '自作群' && (g.tags || []).includes('自作タグ'));
  } catch { /* stays false */ }
  fs.rmSync(tmp, { recursive: true, force: true });
  const keys = ['opened', 'queueIs2', 'bigImg', 'gateCollapsed', 'expandWorks', 'tagOn', 'kindOn', 'badgeShown', 'newGroupInputShown', 'customOn', 'newGroupAppears', 'advanced', 'doneShown', 'closed'];
  const ok = keys.every((k) => r[k] === true) && saved && newGroupSaved;
  console.log(keys.map((k) => k + '=' + r[k]).join(' ') + ' savedSidecar=' + saved + ' newGroupSaved=' + newGroupSaved);
  console.log(ok ? 'WIZARD_VERIFY_PASS' : 'WIZARD_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
