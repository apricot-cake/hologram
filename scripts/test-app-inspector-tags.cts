'use strict';

// Verifies inline tag editing in the inspector (redesign P2⑦) in a real renderer:
//
//   - selecting a card shows its tags as chips in the inspector's tag field
//   - typing a new tag + Enter adds it (free text — not in the vocabulary yet)
//     and PERSISTS it to the record's sidecar json
//   - the chip's × removes the tag again, and that persists too
//   - a source hashtag can be adopted by picking it from the field's popup
//   - the vocabulary popup offers tags already used elsewhere in the library
//   - the card context menu's タグを編集 opens the panel with the caret in the field
//
// Editing used to live in a popover anchored to a ✎ button (tag-pop, Issue #22);
// this suite is the behavioural contract for its replacement. Assertions are on
// observable state (chips present, json on disk), not on internals — the field is
// a Base UI Combobox and its inner markup is not ours to depend on.
//
//   node scripts/test-app-inspector-tags.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-insptags-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

// tag-a is the card under test: no tags of its own, one un-adopted source hashtag.
// tag-b already carries a tag, so the vocabulary popup has something to offer.
const seed = [
  { id: 'tag-a', tags: [], hashtags: ['ソースタグ'] },
  { id: 'tag-b', tags: ['既存タグ'], hashtags: [] },
];
seed.forEach((s, i) => {
  fs.writeFileSync(path.join(saveFolder, `${s.id}.jpg`), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, `${s.id}.json`),
    JSON.stringify(
      {
        captureId: s.id,
        image: `${s.id}.jpg`,
        url: `https://x.com/u${i}/status/${800 + i}`,
        platform: 'x',
        text: `本文${i}`,
        displayName: `人${i}`,
        screenName: `u${i}`,
        capturedAt: `2026-05-0${i + 1}T12:00:00Z`,
        date: `2026-04-0${i + 1}T10:00:00Z`,
        media: [{ file: `${s.id}-orig.jpg`, url: 'https://x.com/i/1.jpg' }],
        tags: s.tags,
        hashtags: s.hashtags,
      },
      null,
      2,
    ),
  );
});

const evalJs = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  const byId = (id) => document.getElementById(id);
  const field = () => document.querySelector('#postDetail [data-slot="inspector-tags"]');
  const chips = () => [...document.querySelectorAll('#postDetail [data-slot="tag-chip"]')].map(c => c.getAttribute('data-tag'));
  const input = () => document.querySelector('#postDetail [data-slot="tag-input"]');
  const cardOf = (key) => document.querySelector('#postGrid .post-card[data-key*="' + key + '"]');
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  const out = {};

  // React owns the input's value, so a plain .value assignment is invisible to it —
  // go through the native setter the way React's own test utils do.
  const setInput = (el, v) => {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

  await waitFor(() => document.querySelectorAll('#postGrid .post-card').length >= 2);

  // A. タグを編集 in the card context menu is the route from a card into tagging
  // since the hover 🏷 (and the popover it opened) went away in P2⑦. It opens the
  // panel for that card AND puts the caret in the field — otherwise it would just be
  // an alias for 詳細 and the user would still have to go find the input.
  cardOf('tag-b').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
  const menuItems = () => [...document.querySelectorAll('[data-slot="dropdown-menu-item"]')];
  out.menuOpened = await waitFor(() => menuItems().some(r => r.textContent.includes('タグを編集')));
  const tagItem = menuItems().find(r => r.textContent.includes('タグを編集'));
  if (tagItem) tagItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  out.menuOpenedPanel = await waitFor(() => !!field() && chips().includes('既存タグ'));
  await sleep(150);
  out.tagInputFocused = !!input() && document.activeElement === input();
  key(document.body, 'Escape'); // dismiss the menu before the rest of the flow

  // B. selecting a card puts its tags in the field (tag-b already has one)
  cardOf('tag-b').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  out.fieldShown = await waitFor(() => !!field());
  out.chipsForB = chips().join(',');

  // C. free text + Enter adds a tag to the inspected card
  cardOf('tag-a').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await waitFor(() => !!field() && chips().length === 0);
  const el = input();
  out.hasInput = !!el;
  el.focus();
  setInput(el, '新規タグ');
  await sleep(80);
  key(el, 'Enter');
  out.chipAdded = await waitFor(() => chips().includes('新規タグ'));
  out.chipsAfterAdd = chips().join(',');
  // the typed text is consumed, not left in the field
  await sleep(120);
  out.inputCleared = (input() || {}).value === '';

  // D. the popup offers the un-adopted source hashtag and the library vocabulary
  const el2 = input();
  el2.focus();
  el2.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  el2.click();
  await sleep(300);
  const itemTexts = () => [...document.querySelectorAll('[role="option"]')].map(n => n.textContent.trim());
  out.popupItems = itemTexts().join('|');
  out.offersSourceTag = itemTexts().some(t => t.includes('ソースタグ'));
  out.offersVocab = itemTexts().some(t => t.includes('既存タグ'));

  // E. picking the source hashtag adopts it
  const srcItem = [...document.querySelectorAll('[role="option"]')].find(n => n.textContent.trim().includes('ソースタグ'));
  if (srcItem) srcItem.click();
  out.adopted = await waitFor(() => chips().includes('ソースタグ'));

  // F. Esc with the tag popup open must NOT take the inspector with it. The panel's
  // Esc handler (inspector-builder) defers while a popup is registered as open; the
  // field registers itself for exactly this. Before it did, this Esc closed the whole
  // panel out from under the open popup.
  //
  // Only the deferral is asserted. Whether the popup itself then closes is Base UI's
  // own dismissal, which a synthetic KeyboardEvent does not drive — the same limit
  // already recorded for Base UI Select, whose popup likewise only responds to real
  // input. That half is a real-key check, not a harness one.
  out.popupOpenBeforeEsc = !!document.querySelector('[role="option"]');
  key(input(), 'Escape');
  await sleep(250);
  out.inspectorSurvivedEsc = !!field();

  // F. the chip's × removes a tag
  out.chipsBeforeRemove = chips().join(',');
  const chipEl = [...document.querySelectorAll('#postDetail [data-slot="tag-chip"]')].find(c => c.getAttribute('data-tag') === '新規タグ');
  const removeBtn = chipEl && chipEl.querySelector('button');
  out.hasRemoveBtn = !!removeBtn;
  if (removeBtn) removeBtn.click();
  out.chipRemoved = await waitFor(() => chips().length > 0 && !chips().includes('新規タグ'));
  out.chipsFinal = chips().join(',');

  await sleep(300); // let the sidecar write land before the harness reads it
  out.errors = errors;
  return JSON.stringify(out);
})()`;

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: configDir,
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_EVAL: evalJs,
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', () => {
  // Persistence is the point of the feature, so read the sidecar back from disk
  // rather than trusting the in-page chips.
  let persisted: string[] = [];
  try {
    persisted = JSON.parse(fs.readFileSync(path.join(saveFolder, 'tag-a.json'), 'utf8')).tags || [];
  } catch {
    /* reported as a failed check below */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const m = /EVAL_RESULT "(.+?)"\s*$/m.exec(out);
  let r = null;
  try {
    r = JSON.parse(JSON.parse('"' + (m ? m[1] : '') + '"'));
  } catch {
    /* fall through to the null report below */
  }
  if (!r) {
    console.log('INSPECTOR_TAGS_TEST_FAIL (no eval result)');
    process.exit(1);
  }
  const checks = [
    ['the inspector shows a tag field', r.fieldShown === true && r.hasInput === true],
    ['an already-tagged card shows its tag as a chip', r.chipsForB === '既存タグ'],
    ['typing a new tag + Enter adds it', r.chipAdded === true],
    ['the typed text is cleared after adding', r.inputCleared === true],
    ['the popup offers the un-adopted source hashtag', r.offersSourceTag === true],
    ['the popup offers vocabulary from elsewhere in the library', r.offersVocab === true],
    ['picking a source hashtag adopts it', r.adopted === true],
    ['Esc with the tag popup open leaves the inspector open', r.popupOpenBeforeEsc === true && r.inspectorSurvivedEsc === true],
    ['the card context menu offers タグを編集', r.menuOpened === true],
    ['タグを編集 opens the panel for that card with the caret in the field', r.menuOpenedPanel === true && r.tagInputFocused === true],
    ["the chip's × removes the tag", r.hasRemoveBtn === true && r.chipRemoved === true],
    ['the surviving tag was persisted to the sidecar', persisted.includes('ソースタグ')],
    ['the removed tag is gone from the sidecar', !persisted.includes('新規タグ')],
    ['no handler threw', Array.isArray(r.errors) && r.errors.length === 0],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  if (failed) console.log('  got: ' + JSON.stringify(r) + '\n  persisted: ' + JSON.stringify(persisted));
  console.log(failed ? 'INSPECTOR_TAGS_TEST_FAIL' : 'INSPECTOR_TAGS_TEST_PASS');
  process.exit(failed ? 1 : 0);
});
