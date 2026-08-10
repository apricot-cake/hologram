'use strict';

// #50の前処理を、実際のアプリでオフラインのまま検証する。
//
// タグモデルは378MBあり、オプトインの裏に住んでいるので、このハーネスは
// 何もダウンロードせず、モデルも読み込まない。ここで固定するのはモデルより
// 「前」の全て: Electronのデコーダーが返すバイト順と、decode → resize →
// letterboxの連鎖がそこから作るテンソル。
//
// それがここで守る価値のある半分。なぜなら、それが静かに壊れる半分だから。
// 赤と青のチャンネルが入れ替わっても例外は投げないし、どのログを見ても
// おかしく見えないし、モデルを失敗させもしない＝ただ別の絵を説明させて
// しまうだけ。単体テスト（scripts/ai-tags.test.ts）は自分で組み立てたbitmapに
// 対する算術しか検証できない。実際のdecodeがどう見えるかを言えるのは
// Electronだけ。
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
// 意図的に`ai: { enabled: true }`を付けない: これのどれもオプトインを必要と
// せず、それを必要としないことを確認すること自体がこのテストの要点の一部。
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
    if (code !== 0) throw new Error(`Electronが終了しました ${code}\n${output}`);
    const line = output.split(/\r?\n/).find((l) => l.startsWith('AI_TAGS_SMOKE_RESULT'));
    if (!line) throw new Error(`出力にAI_TAGS_SMOKE_RESULTがありません\n${output}`);
    const r = JSON.parse(line.slice('AI_TAGS_SMOKE_RESULT'.length));

    // 1. チャンネル順。プローブ自身の答えではなく証拠に対して検証する。不透明な
    // 青のピクセルは、RGBAでは最後の色バイトが255、BGRAでは最初のバイトが255。
    check('channel order is one of the two known layouts', r.channelOrder === 'rgba' || r.channelOrder === 'bgra', r.channelOrder);
    const expectedBlue = r.channelOrder === 'bgra' ? [255, 0, 0, 255] : [0, 0, 255, 255];
    check('the reported order matches an independently decoded blue pixel', JSON.stringify(r.bluePixel) === JSON.stringify(expectedBlue), { reported: r.channelOrder, bluePixel: r.bluePixel });

    // 2. テンソル。モデルはBGRを求めるので、赤は[0, 0, 255]、青は[255, 0, 0]。
    // 順序を間違えるとこの2つが入れ替わる。
    check('the tensor is [1, 448, 448, 3]', r.tensorLength === 448 * 448 * 3, r.tensorLength);
    check('the red half of the source comes out as BGR red', JSON.stringify(r.leftHalf) === JSON.stringify([0, 0, 255]), r.leftHalf);
    check('the blue half of the source comes out as BGR blue', JSON.stringify(r.rightHalf) === JSON.stringify([255, 0, 0]), r.rightHalf);
    // 3. パディングは「白」。黒いパディングは汎用的なpad()が与えるもので、
    // モデルはそれで訓練されていない。
    check('the letterbox padding is white', JSON.stringify(r.corner) === JSON.stringify([255, 255, 255]), r.corner);

    // 4. ジョブ種別の宣言: オプトインのゲートはrequiresModelにかかっており、
    // モデルが無い間、アセットは候補にならない（常に失敗する実行は、
    // backfillのたびにライブラリ全体を再計画してしまう）。
    check('the ai-tags job kind is registered', !!r.jobKind, r.jobKind);
    check('it declares requiresModel', r.jobKind?.requiresModel === true, r.jobKind);
    check('a still image is one segment', r.jobKind?.maxSegments === 1, r.jobKind);
    check('it accepts nothing while the model is absent', r.jobKind?.acceptsWithoutModel === false, r.jobKind);

    // 5. 何も取得されていない。オプトインは一度も与えられていないので、
    // モデルの1バイトたりとも触れられてはならない。
    const modelsRoot = path.join(configDir, 'models');
    check('no model was downloaded', !fs.existsSync(modelsRoot), modelsRoot);

    if (failed) throw new Error(`${failed} 件の検査が失敗しました\n${output}`);
    console.log(`PASS app ai-tags: チャンネル順 ${r.channelOrder}、前処理はモデルの参照値と一致`);
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
