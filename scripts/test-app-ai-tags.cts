'use strict';

// #50's preprocessing, in the real app and offline.
//
// The tag model is 378MB and lives behind an opt-in, so this harness downloads
// nothing and loads no model. What it pins is everything BEFORE the model: the
// byte order Electron's decoder hands back, and the tensor the decode →
// resize → letterbox chain produces from it.
//
// That is the half worth guarding here, because it is the half that fails
// silently. A swapped red and blue channel does not throw, does not look wrong
// in any log, and does not make the model fail — it just makes it describe a
// different picture. The unit tests (scripts/ai-tags.test.ts) can only check
// the arithmetic against a bitmap they built themselves; only Electron can say
// what a real decode looks like.
//
//   node scripts/test-app-ai-tags.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-ai-tags-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
// Deliberately NO `ai: { enabled: true }`: none of this needs the opt-in, and
// checking that it does not is part of the point.
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const child = spawn(resolveElectron(), ['.'], {
  cwd: appDir,
  env: { ...process.env, APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir, HOLOGRAM_SMOKE: '1', HOLOGRAM_AI_TAGS_SMOKE: '1' },
  stdio: 'pipe',
});

let output = '';
child.stdout.on('data', (c) => {
  output += c;
});
child.stderr.on('data', (c) => {
  output += c;
});

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) return;
  failed++;
  console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}

child.on('close', (code) => {
  try {
    if (code !== 0) throw new Error(`Electron exited ${code}\n${output}`);
    const line = output.split(/\r?\n/).find((l) => l.startsWith('AI_TAGS_SMOKE_RESULT'));
    if (!line) throw new Error(`no AI_TAGS_SMOKE_RESULT in output\n${output}`);
    const r = JSON.parse(line.slice('AI_TAGS_SMOKE_RESULT'.length));

    // 1. The channel order, checked against evidence rather than against the
    // probe's own answer. An opaque blue pixel is 255 in the LAST colour byte
    // under RGBA and in the FIRST under BGRA.
    check('channel order is one of the two known layouts', r.channelOrder === 'rgba' || r.channelOrder === 'bgra', r.channelOrder);
    const expectedBlue = r.channelOrder === 'bgra' ? [255, 0, 0, 255] : [0, 0, 255, 255];
    check('the reported order matches an independently decoded blue pixel', JSON.stringify(r.bluePixel) === JSON.stringify(expectedBlue), { reported: r.channelOrder, bluePixel: r.bluePixel });

    // 2. The tensor. The model wants BGR, so red is [0, 0, 255] and blue is
    // [255, 0, 0]; get the order wrong and these two swap.
    check('the tensor is [1, 448, 448, 3]', r.tensorLength === 448 * 448 * 3, r.tensorLength);
    check('the red half of the source comes out as BGR red', JSON.stringify(r.leftHalf) === JSON.stringify([0, 0, 255]), r.leftHalf);
    check('the blue half of the source comes out as BGR blue', JSON.stringify(r.rightHalf) === JSON.stringify([255, 0, 0]), r.rightHalf);
    // 3. The padding is WHITE. Black padding is what a generic pad() would give
    // and what the model was not trained on.
    check('the letterbox padding is white', JSON.stringify(r.corner) === JSON.stringify([255, 255, 255]), r.corner);

    // 4. The job kind's declaration: the opt-in gate hangs on requiresModel,
    // and an asset is not a candidate while the model is absent (a run that
    // always fails would re-plan the whole library on every backfill).
    check('the ai-tags job kind is registered', !!r.jobKind, r.jobKind);
    check('it declares requiresModel', r.jobKind?.requiresModel === true, r.jobKind);
    check('a still image is one segment', r.jobKind?.maxSegments === 1, r.jobKind);
    check('it accepts nothing while the model is absent', r.jobKind?.acceptsWithoutModel === false, r.jobKind);

    // 5. Nothing was fetched. The opt-in was never given, so not a byte of the
    // model may have been touched.
    const modelsRoot = path.join(configDir, 'models');
    check('no model was downloaded', !fs.existsSync(modelsRoot), modelsRoot);

    if (failed) throw new Error(`${failed} check(s) failed\n${output}`);
    console.log(`PASS app ai-tags: channel order ${r.channelOrder}, preprocessing matches the model's reference`);
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
