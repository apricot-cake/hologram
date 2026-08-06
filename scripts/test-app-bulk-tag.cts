'use strict';

// Verifies bulk tagging from the selection bar (redesign P2⑦) in a real renderer:
//
//   - selecting 2+ cards and pressing タグを追加 opens a Dialog
//   - Apply is inert until something is staged
//   - staged tags are NOT written until Apply — cancelling discards them
//   - a reopened dialog starts empty (staging is per-open, not sticky)
//   - Apply merges the staged tags into every selected record's tags (post_tags
//     in the DB — #298/St5 made tag edits a DB-only write), keeping the tags
//     each record already had (additive is the only mode)
//
// This replaces tag-pop's mode:'bulk', where the staging lived in a renderer
// module of its own; it now lives in the dialog's React state. The "discard"
// and "reopened dialog is empty" checks are what that move has to keep true.
// Assertions are on chips and on disk, not on the Base UI internals.
//
// Waits come from scripts/lib-wait.cts (#986): the whole eval is bounded by that
// module's WAIT_DEADLINE, which sits below main's SMOKE_TIMEOUT so a stall still
// returns this suite's per-check report instead of "no eval result".
//
//   node scripts/test-app-bulk-tag.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { readEvalResult } = require('./lib-eval-result.cts');

const electronPath = resolveElectron();
const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

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
const records: any[] = [];
seed.forEach((s, i) => {
  fs.writeFileSync(path.join(saveFolder, `${s.id}.jpg`), jpeg);
  records.push({
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
  });
});
seedLibrary(configDir, records);

// sleep / waitFor / waitStable / neverHappens come in as the first argument —
// scripts/lib-wait.cts (#986). The body is a real function rather than a template
// literal so Biome's no-fixed-wait plugin and tsc can both read it; it is
// serialised, so it closes over nothing from this file.
const evalJs = evalSource(async ({ sleep, waitFor, neverHappens }) => {
  const dialog = () => document.querySelector('[data-slot="dialog-content"]');
  const chips = () => [...document.querySelectorAll('[data-slot="dialog-content"] [data-slot="tag-chip"]')].map((c) => c.getAttribute('data-tag'));
  const input = () => document.querySelector<HTMLInputElement>('[data-slot="dialog-content"] [data-slot="tag-input"]');
  const btnIn = (root, re) => [...root.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
  const applyBtn = () => dialog() && btnIn(dialog(), /件に適用/);
  const cancelBtn = () => dialog() && btnIn(dialog(), /^キャンセル$/);
  const barTagBtn = () => document.querySelector<HTMLButtonElement>('button[aria-label="タグを追加"]');
  // Named rather than optional-chained: pressing this button IS the step, so a
  // missing bar has to stop the run and say so instead of leaving the next wait to
  // report "the dialog never opened".
  const pressBarTagBtn = () => {
    const btn = barTagBtn();
    if (!btn) throw new Error('the selection bar has no タグを追加 button to press');
    btn.click();
  };
  // Addressed by what the card says (no key attribute on the cells — #618).
  const postCards = () => [...document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]')];
  const cardOf = (n) => postCards().find((c) => (c.textContent || '').includes('本文' + n));
  const requireCard = (n) => {
    const c = cardOf(n);
    if (!c) throw new Error('the grid is missing the seeded card 本文' + n);
    return c;
  };
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  const out: Record<string, any> = {};

  // React owns the input's value, so a plain .value assignment is invisible to it.
  const setInput = (el, v) => {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (!desc?.set) throw new Error('the tag input exposes no native value setter to drive');
    desc.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // TagField's Enter handler commits React's `query` state, not the DOM value
  // (inspector/TagField.tsx), so an Enter dispatched before the input event has
  // rendered is silently a no-op. Re-pressing until the chip is staged is the
  // observable form of the fixed 50ms that used to stand in for that render (#986);
  // once the tag is staged the field clears its query, so repeats are no-ops too.
  const type = async (label, text) => {
    const el = input();
    if (!el) throw new Error('the bulk tagging dialog has no tag input to type into');
    el.focus();
    setInput(el, text);
    return waitFor(label, () => {
      const box = input();
      if (box) box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return chips().includes(text);
    });
  };

  await waitFor('the grid to show both seeded posts', () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length >= 2);

  // A. select both cards (plain click = single, Ctrl = add) — the bar appears
  requireCard(0).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  requireCard(1).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  out.barShown = await waitFor('the selection bar to appear for the two picked cards', () => !!barTagBtn());

  // B. タグを追加 opens the dialog, and it starts with nothing staged
  pressBarTagBtn();
  out.dialogOpened = await waitFor('the bulk tagging dialog to open', () => !!dialog());
  out.chipsAtOpen = chips().join(',');
  out.applyLabel = applyBtn() ? applyBtn().textContent.trim() : '';
  out.applyDisabledWhenEmpty = !!(applyBtn() && applyBtn().disabled);

  // C. staging a tag enables Apply — but writes nothing yet
  out.stagedChip = await type('the typed tag to be staged as a chip', 'すてるタグ');
  out.applyEnabledAfterStage = !!(applyBtn() && !applyBtn().disabled);

  // D. cancelling discards the staged list (asserted on disk at the end: すてるタグ
  //    must never appear in either sidecar)
  cancelBtn().click();
  out.dialogClosed = await waitFor('the cancelled dialog to close', () => !dialog());

  // E. reopening starts clean — the staging is the dialog's own state, so it dies
  //    with the dialog rather than surviving in a renderer module
  pressBarTagBtn();
  out.reopened = await waitFor('the bulk tagging dialog to open a second time', () => !!dialog());
  // "The discarded tag does NOT come back": a post-condition would pass on its first
  // poll, so this window is spent on purpose (#986).
  await neverHappens('a chip from the cancelled session to reappear in the reopened dialog', () => chips().length > 0, 250);
  out.chipsAtReopen = chips().join(',');

  // F. Apply writes the staged tag onto every selected record
  out.stagedChip2 = await type('the second typed tag to be staged as a chip', 'まとめタグ');
  applyBtn().click();
  out.dialogClosedOnApply = await waitFor('the dialog to close once Apply was pressed', () => !dialog());

  // Fixed on purpose: the tags this suite asserts on are written by MAIN (#298/St5
  // made tag edits a DB write), and the dialog closes on the renderer's own state —
  // so there is nothing here to observe that says the write landed before the app quits.
  // biome-ignore lint/plugin: the delay IS the spec here — it covers main's DB write, which the renderer cannot observe.
  await sleep(400);
  out.errors = errors;
  return JSON.stringify(out);
});

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
  // #298/St5: tag edits are DB-only (app/src/main/ipc-trash.ts's update-tags no longer
  // touches the sidecar), so persistence is asserted against post_tags, not disk.
  let a: string[] = [];
  let b: string[] = [];
  try {
    // #176: hologram.db lives inside the save folder now, not configDir (ADR 0025).
    const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'), { readonly: true });
    const tagsOf = (id: string) =>
      sqlite
        .prepare('SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ? ORDER BY pt.rowid')
        .all(id)
        .map((r: any) => r.name);
    a = tagsOf('bulk-a');
    b = tagsOf('bulk-b');
    sqlite.close();
  } catch {
    /* reported as failed checks below */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const r = readEvalResult(out);
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
