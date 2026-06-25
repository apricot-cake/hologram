'use strict';
// Throwaway: tagging wizard — one image LARGE + ONE group per step:
//  - stepper lists every visible group (+未分類 +非表示チップ), clickable jump
//  - only the current group's tags render; selecting shows a stepper badge
//  - per-step "このグループを今後表示しない" hides the group (persisted),
//    the 非表示 panel un-hides it
//  - 未分類 step: ungrouped library tags as chips + adder with group creation
//  - 次へ/←→ walk; last step's 次へ and Ctrl+Enter save & go to next image
// Seeds 3 posts: 2 untagged (p0,p1), 1 already tagged (p2 → excluded).
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
// one pre-existing UNGROUPED tag in the library (must appear on the 未分類 step)
fs.writeFileSync(path.join(saveFolder, '1700000000003-tw3.jpg'), jpeg);
fs.writeFileSync(path.join(saveFolder, '1700000000003-tw3.json'), JSON.stringify({
  captureId: '1700000000003-tw3', image: '1700000000003-tw3.jpg', url: 'https://x.com/u/status/803',
  platform: 'x', text: '本文3', displayName: '人3', screenName: 'u3', likes: 3,
  capturedAt: '2026-03-01T12:00:00Z', date: '2026-03-01T10:00:00Z', media: [],
  tags: ['野良タグ'], hashtags: []
}, null, 2));
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  await waitFor(() => document.querySelectorAll('#postGrid .post-card').length >= 3);
  const view = document.getElementById('tagWizard');
  const body = document.getElementById('twBody');
  const click = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  // launch from the sidebar feature button
  click(document.getElementById('tagWizardBtn'));
  await waitFor(() => !view.hidden && /1 \\/ 2/.test(document.getElementById('twProgress').textContent));
  const opened = !view.hidden;
  const queueIs2 = document.getElementById('twProgress').textContent.trim() === '1 / 2';   // 2 untagged only
  const bigImg = !!body.querySelector('img.tw-big');
  // stepper: ポーズ・構図・未分類 + 非表示チップ; only group 1's tags render
  const stepBtns = () => [...body.querySelectorAll('.tw-step[data-step]')];
  const stepperOk = stepBtns().length === 3 && !!document.getElementById('twHiddenChip');
  const onlyOneGroup = body.querySelectorAll('.tw-chip[data-tag]').length === 2 &&
    [...body.querySelectorAll('.tw-chip[data-tag]')].every(c => ['立ち', '座り'].includes(c.dataset.tag));

  // pick a tag on step 1 (the メディア/ポスト kind chooser was removed — tags
  // alone carry that distinction now)
  click([...body.querySelectorAll('.tw-chip[data-tag]')].find(c => c.dataset.tag === '立ち')); await wait(40);
  const tagOn = [...body.querySelectorAll('.tw-chip[data-tag]')].find(c => c.dataset.tag === '立ち').classList.contains('on');
  const noKindChooser = !body.querySelector('.tw-chip[data-kind]') && !document.getElementById('twKindInfo');
  const badgeOn = (stepBtns()[0].querySelector('.tw-step-badge') || {}).textContent === '1';

  // 次へ → step 2 (構図); selection persists across steps (badge on step 1)
  click(document.getElementById('twNext')); await wait(50);
  const step2 = stepBtns()[1].classList.contains('on') &&
    [...body.querySelectorAll('.tw-chip[data-tag]')].every(c => ['俯瞰', 'あおり'].includes(c.dataset.tag));
  const badgeKept = (stepBtns()[0].querySelector('.tw-step-badge') || {}).textContent === '1';

  // stepper JUMP to 未分類 (index 2): existing ungrouped library tag appears
  click(stepBtns()[2]); await wait(50);
  const otherHasStray = [...body.querySelectorAll('.tw-chip[data-tag]')].some(c => c.dataset.tag === '野良タグ');
  // create a NEW group from the 未分類 adder
  document.getElementById('twAddInput').value = '自作タグ';
  const gsel = document.getElementById('twAddGroup'); gsel.value = '__new'; gsel.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(30);
  document.getElementById('twNewGroupName').value = '自作群';
  click(document.getElementById('twAddBtn'));
  await wait(80);
  const newGroupStep = stepBtns().some(b => b.textContent.includes('自作群'));

  // hide 構図 from this step's panel? (the link is only on group steps) —
  // jump to 構図 and hide it; the stepper loses it, the 非表示 chip counts 1
  click(stepBtns().find(b => b.textContent.includes('構図'))); await wait(50);
  click(body.querySelector('.tw-hide-link')); await wait(50);
  const hiddenWorks = !stepBtns().some(b => b.textContent.includes('構図')) &&
    document.getElementById('twHiddenChip').textContent.includes('1');
  // the 非表示 panel can bring it back
  click(document.getElementById('twHiddenChip')); await wait(50);
  const visBox = body.querySelector('input[data-vis="g2"]');
  const panelShows = !!visBox && !visBox.checked;
  visBox.checked = true; visBox.dispatchEvent(new Event('change', { bubbles: true })); await wait(50);
  const unhideWorks = stepBtns().some(b => b.textContent.includes('構図'));

  // Ctrl+Enter = save & next image
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  await waitFor(() => document.getElementById('twProgress').textContent.trim() === '2 / 2', 4000);
  const advanced = document.getElementById('twProgress').textContent.trim() === '2 / 2';

  // second post: save WITHOUT tags → marks reviewed (no スキップ button)
  const noSkipBtn = !document.getElementById('twSkip');
  click(document.getElementById('twSave'));
  await wait(200);
  const doneShown = /お疲れ|done|ありません/i.test(body.textContent) && document.getElementById('twSave').style.display === 'none';
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(150);
  const closed = view.hidden;
  // re-open: both posts are now handled (one tagged, one reviewed-no-tags) →
  // the queue is empty, proving reviewed posts don't resurface
  click(document.getElementById('tagWizardBtn'));
  await wait(250);
  const queueEmptied = /お疲れ|done|ありません/i.test(body.textContent);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return { opened, queueIs2, bigImg, stepperOk, onlyOneGroup, tagOn, noKindChooser, badgeOn, step2, badgeKept,
    otherHasStray, newGroupStep, hiddenWorks, panelShows, unhideWorks, advanced, noSkipBtn, doneShown, closed, queueEmptied };
})()`;
const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'), CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  // verify the sidecar was written (tags only — userKind was removed). queue[0]
  // is the NEWEST untagged post (default date-desc sort) — tw0 or tw1, scan both.
  let saved = false;
  for (const id of ['1700000000000-tw0', '1700000000001-tw1']) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(saveFolder, id + '.json'), 'utf8'));
      if (Array.isArray(rec.tags) && rec.tags.includes('立ち') && rec.tags.includes('自作タグ')) saved = true;
    } catch { /* next */ }
  }
  // the new group must have been persisted to tag-groups.json
  let newGroupSaved = false;
  try {
    const tg = JSON.parse(fs.readFileSync(path.join(saveFolder, 'tag-groups.json'), 'utf8'));
    newGroupSaved = (tg.groups || []).some((g) => g.name === '自作群' && (g.tags || []).includes('自作タグ'));
  } catch { /* stays false */ }
  fs.rmSync(tmp, { recursive: true, force: true });
  const keys = ['opened', 'queueIs2', 'bigImg', 'stepperOk', 'onlyOneGroup', 'tagOn', 'noKindChooser', 'badgeOn', 'step2', 'badgeKept',
    'otherHasStray', 'newGroupStep', 'hiddenWorks', 'panelShows', 'unhideWorks', 'advanced', 'noSkipBtn', 'doneShown', 'closed', 'queueEmptied'];
  const ok = keys.every((k) => r[k] === true) && saved && newGroupSaved;
  console.log(keys.map((k) => k + '=' + r[k]).join(' ') + ' savedSidecar=' + saved + ' newGroupSaved=' + newGroupSaved);
  console.log(ok ? 'WIZARD_VERIFY_PASS' : 'WIZARD_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
