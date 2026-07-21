'use strict';

// Verifies bulk tagging from the selection bar (redesign P2⑦) in a real renderer:
//
//   - selecting 2+ cards and pressing タグを追加 opens a Dialog
//   - Apply is inert until something is staged
//   - staged tags are NOT written until Apply — cancelling discards them
//   - a reopened dialog starts empty (staging is per-open, not sticky)
//   - Apply merges the staged tags into every selected record's sidecar json,
//     keeping the tags each record already had (additive is the only mode)
//
// This replaces tag-pop's mode:'bulk', where the staging lived in a renderer
// module (bulk-edit.ts); it now lives in the dialog's React state. The "discard"
// and "reopened dialog is empty" checks are what that move has to keep true.
// Assertions are on chips and on disk, not on the Base UI internals.
//
//   node scripts/test-app-bulk-tag.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-bulktag-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

// bulk-b already carries a tag: the additive merge has to leave it alone.
const seed = [
  { id: 'bulk-a', tags: [] },
  { id: 'bulk-b', tags: ['既存タグ'] },
];
seed.forEach((s, i) => {
  fs.writeFileSync(path.join(saveFolder, `${s.id}.jpg`), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, `${s.id}.json`),
    JSON.stringify(
      {
        captureId: s.id,
        image: `${s.id}.jpg`,
        url: `https://x.com/u${i}/status/${900 + i}`,
        platform: 'x',
        text: `本文${i}`,
        displayName: `人${i}`,
        screenName: `u${i}`,
        capturedAt: `2026-05-0${i + 1}T12:00:00Z`,
        date: `2026-04-0${i + 1}T10:00:00Z`,
        media: [{ file: `${s.id}-orig.jpg`, url: 'https://x.com/i/1.jpg' }],
        tags: s.tags,
        hashtags: [],
      },
      null,
      2,
    ),
  );
});

const evalJs = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  const dialog = () => document.querySelector('[data-slot="dialog-content"]');
  const chips = () => [...document.querySelectorAll('[data-slot="dialog-content"] [data-slot="tag-chip"]')].map(c => c.getAttribute('data-tag'));
  const input = () => document.querySelector('[data-slot="dialog-content"] [data-slot="tag-input"]');
  const btnIn = (root, re) => [...root.querySelectorAll('button')].find(b => re.test(b.textContent.trim()));
  const applyBtn = () => dialog() && btnIn(dialog(), /件に適用/);
  const cancelBtn = () => dialog() && btnIn(dialog(), /^キャンセル$/);
  const barTagBtn = () => document.querySelector('button[aria-label="タグを追加"]');
  const cardOf = (key) => document.querySelector('#postGrid .post-card[data-key*="' + key + '"]');
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  const out = {};

  // React owns the input's value, so a plain .value assignment is invisible to it.
  const setInput = (el, v) => {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const type = async (text) => {
    const el = input();
    el.focus();
    setInput(el, text);
    await sleep(80);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  };

  await waitFor(() => document.querySelectorAll('#postGrid .post-card').length >= 2);

  // A. select both cards (plain click = single, Ctrl = add) — the bar appears
  cardOf('bulk-a').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  cardOf('bulk-b').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  out.barShown = await waitFor(() => !!barTagBtn());

  // B. タグを追加 opens the dialog, and it starts with nothing staged
  barTagBtn().click();
  out.dialogOpened = await waitFor(() => !!dialog());
  out.chipsAtOpen = chips().join(',');
  out.applyLabel = applyBtn() ? applyBtn().textContent.trim() : '';
  out.applyDisabledWhenEmpty = !!(applyBtn() && applyBtn().disabled);

  // C. staging a tag enables Apply — but writes nothing yet
  await type('すてるタグ');
  out.stagedChip = await waitFor(() => chips().includes('すてるタグ'));
  out.applyEnabledAfterStage = !!(applyBtn() && !applyBtn().disabled);

  // D. cancelling discards the staged list (asserted on disk at the end: すてるタグ
  //    must never appear in either sidecar)
  cancelBtn().click();
  out.dialogClosed = await waitFor(() => !dialog());

  // E. reopening starts clean — the staging is the dialog's own state, so it dies
  //    with the dialog rather than surviving in a renderer module
  await sleep(200);
  barTagBtn().click();
  out.reopened = await waitFor(() => !!dialog());
  await sleep(150);
  out.chipsAtReopen = chips().join(',');

  // F. Apply writes the staged tag onto every selected record
  await type('まとめタグ');
  out.stagedChip2 = await waitFor(() => chips().includes('まとめタグ'));
  applyBtn().click();
  out.dialogClosedOnApply = await waitFor(() => !dialog());

  await sleep(500); // let both sidecar writes land before the harness reads them
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
  const tagsOf = (id: string): string[] => {
    try {
      return JSON.parse(fs.readFileSync(path.join(saveFolder, `${id}.json`), 'utf8')).tags || [];
    } catch {
      return [];
    }
  };
  const a = tagsOf('bulk-a');
  const b = tagsOf('bulk-b');
  fs.rmSync(tmp, { recursive: true, force: true });
  const m = /EVAL_RESULT "(.+?)"\s*$/m.exec(out);
  let r = null;
  try {
    r = JSON.parse(JSON.parse('"' + (m ? m[1] : '') + '"'));
  } catch {
    /* fall through to the null report below */
  }
  if (!r) {
    console.log('BULK_TAG_TEST_FAIL (no eval result)');
    process.exit(1);
  }
  const checks = [
    ['the selection bar appears for a multi-card selection', r.barShown === true],
    ['タグを追加 opens the bulk dialog', r.dialogOpened === true],
    ['the dialog opens with nothing staged', r.chipsAtOpen === ''],
    ['Apply names the selection count', r.applyLabel === '2 件に適用'],
    ['Apply is disabled while nothing is staged', r.applyDisabledWhenEmpty === true],
    ['typing a tag stages it as a chip', r.stagedChip === true && r.applyEnabledAfterStage === true],
    ['cancel closes the dialog', r.dialogClosed === true],
    ['a cancelled tag is never written', !a.includes('すてるタグ') && !b.includes('すてるタグ')],
    ['reopening starts with an empty staging list', r.reopened === true && r.chipsAtReopen === ''],
    ['Apply closes the dialog', r.stagedChip2 === true && r.dialogClosedOnApply === true],
    ['Apply writes the tag to every selected record', a.includes('まとめタグ') && b.includes('まとめタグ')],
    ['tags a record already had are kept (additive)', b.includes('既存タグ')],
    ['no handler threw', Array.isArray(r.errors) && r.errors.length === 0],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  if (failed) console.log('  got: ' + JSON.stringify(r) + '\n  bulk-a: ' + JSON.stringify(a) + '\n  bulk-b: ' + JSON.stringify(b));
  console.log(failed ? 'BULK_TAG_TEST_FAIL' : 'BULK_TAG_TEST_PASS');
  process.exit(failed ? 1 : 0);
});
