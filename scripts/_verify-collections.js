'use strict';
// Throwaway: verify the COLLECTION view (第3の閲覧モード). Seeds posts + a pre-written
// collections.json (one static collection holding 2 of them, marked active), then:
//   switch to collection mode      -> 1 collection card (+ the ＋new card) , active ★ shown
//   click the card                 -> drills into the post view (folder filter, 2 posts)
//   click the コレクション toggle   -> back to the collection grid (reliable return)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-col-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const ids = [];
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-col' + i;
  ids.push(id);
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://x.com/u' + i + '/status/' + (600 + i),
    platform: 'x', text: '本文' + i, displayName: '人' + i, screenName: 'u' + i,
    likes: 10 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: [], hashtags: []
  }, null, 2));
}
// Pre-write collections.json (main.js reads <saveFolder>/collections.json; no folders.json
// present so it's used directly). One static collection holding the first 2 posts, active.
fs.writeFileSync(path.join(saveFolder, 'collections.json'), JSON.stringify({
  collections: [{ id: 'f-test', name: 'テスト資料', kind: 'static', created: Date.now(), items: [ids[0], ids[1]] }],
  activeId: 'f-test', posterWorkspace: []
}, null, 2));
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(40); } return null; };
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const colCards = () => document.querySelectorAll('#collectionGrid .collection-card:not(.new)').length;
  const postCards = () => document.querySelectorAll('#postGrid .post-card').length;
  const log = [];
  try {
    await waitFor(() => postCards() >= 3);
    // switch to collection mode
    click(document.querySelector('#browseToggle [data-mode="collections"]')); await wait(150);
    await waitFor(() => document.body.classList.contains('browse-collections'));
    const colCardCount = await waitFor(() => colCards() || null) ? colCards() : 0;   // 1 collection
    const hasActive = !!document.querySelector('#collectionGrid .collection-card.active');   // ★ on active
    const hasNewCard = !!document.querySelector('#collectionGrid .collection-card.new');
    const thumbImgs = document.querySelectorAll('#collectionGrid .collection-card:not(.new) .collection-thumbs img').length;   // 2 thumbs
    // open the collection (drill into posts via folder filter)
    click(document.querySelector('#collectionGrid .collection-card:not(.new)')); await wait(160);
    const inPosts = !document.body.classList.contains('browse-collections') && !document.body.classList.contains('browse-posters');
    const folderPills = document.querySelectorAll('#queryChips .qb-pill').length;   // 1 folder pill
    const drillPosts = postCards();   // 2 posts in the collection
    // reliable return: the always-present コレクション toggle
    click(document.querySelector('#browseToggle [data-mode="collections"]')); await wait(150);
    const backToColl = document.body.classList.contains('browse-collections');
    return { ok: true, log, colCardCount, hasActive, hasNewCard, thumbImgs, inPosts, folderPills, drillPosts, backToColl };
  } catch (e) { return { ok: false, log, err: e.message }; }
})()`;
const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'), CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.ok === true && r.colCardCount === 1 && r.hasActive === true && r.hasNewCard === true &&
    r.thumbImgs === 2 && r.inPosts === true && r.folderPills === 1 && r.drillPosts === 2 && r.backToColl === true;
  console.log(`log=${JSON.stringify(r.log)} err=${r.err || '-'} colCards=${r.colCardCount} active=${r.hasActive} newCard=${r.hasNewCard}` +
    ` thumbs=${r.thumbImgs} inPosts=${r.inPosts} folderPills=${r.folderPills} drillPosts=${r.drillPosts} backToColl=${r.backToColl}`);
  console.log(ok ? 'COLLECTIONS_VERIFY_PASS' : 'COLLECTIONS_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
