'use strict';

// pixivのうごイラ再生（#119 St3）を実際のレンダラーで検証する。
//
// うごイラはpixivが配布するそのままのzip（フレーム画像の束）としてライブラリに
// 入り、それを直接再生できる単一ファイル形式は無い＝アプリ側がzipを開き、
// フレームをcanvasへ描画する。ここでカバーするのはまさにその経路そのもの、
// 単体テストが決して触れない部分:
//
//   - mainが書庫を開き、フレームテーブルと照合し、1フレームぶんのバイト列を
//     IPC経由で返す（ugoira-frames-present / ugoira-frame、#506）
//   - レンダラーが受け取ったバイトからBlobを組み立て、canvasへ描画できる
//   - canvasはフレームテーブルのdelayが示す速さで進む（ピクセルが実際に変わる）
//   - 一時停止でフレームが止まり、再生で再び動き出す
//
// PNGから3フレームのzipを組み立て、各フレームに異なる色を与えることで「これは
// どのフレームか」を1ピクセルから見分けられるようにする。ダブルクリックで
// 画像タブへ入るのはtest-app-click-modelと同じ形。
//
//   node e2e/harness/cases/test-app-ugoira.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { readEvalResult } = require('../../../scripts/lib-eval-result.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-ugoira-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

// --- 1x1のPNGをその場で組み立てる（フレームは色で見分けるので、既製の画像1枚では足りない） ---
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png1x1(r: number, g: number, b: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 2; // カラータイプ: truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, r, g, b]))), chunk('IEND', Buffer.alloc(0))]);
}

// --- 最小限のZIPライター。STORE（無圧縮）のみ（実際のzipを1つ作るのに十分） ---
function zipOf(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'latin1');
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // 必要バージョン
    local.writeUInt16LE(0, 8); // 手法: store
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, e.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + e.data.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

const ID = 'dummy-ugo1';
// 赤→緑→青。canvasの1ピクセルでどのフレームかわかる
const FRAME_COLORS = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
];
const FRAMES = FRAME_COLORS.map((_, i) => ({ file: `00000${i}.png`, delay: 60 }));
fs.writeFileSync(path.join(saveFolder, `${ID}-media-0.zip`), zipOf(FRAMES.map((f, i) => ({ name: f.file, data: png1x1(FRAME_COLORS[i][0], FRAME_COLORS[i][1], FRAME_COLORS[i][2]) }))));
fs.writeFileSync(path.join(saveFolder, `${ID}-poster.jpg`), jpeg);
fs.writeFileSync(path.join(saveFolder, `${ID}.jpg`), jpeg);
seedLibrary(configDir, [
  {
    captureId: ID,
    image: `${ID}.jpg`,
    url: 'https://www.pixiv.net/artworks/147661146',
    platform: 'pixiv',
    title: 'うごイラ',
    mediaType: 'gif',
    media: [{ url: 'https://i.pximg.net/u.zip', alt: null, width: 1, height: 1, file: `${ID}-media-0.zip`, type: 'ugoira', posterFile: `${ID}-poster.jpg`, frames: FRAMES }],
    capturedAt: '2026-01-01T00:00:00.000Z',
    date: '2026-01-01T00:00:00.000Z',
  },
]);

const evalJs = evalSource(async ({ sleep, waitFor, neverHappens }) => {
  const out: Record<string, any> = {};

  const cardEl = () => document.querySelector('[data-slot="post-grid"] [data-slot="post-card"]');
  await waitFor('the seeded ugoira post to appear as a card', () => !!cardEl());
  const card = cardEl();
  out.cardFound = !!card;
  if (!card) return JSON.stringify(out);
  // 再生バッジ: 「クリックするまで動かない」の表示は動画のときと同じように出る
  out.playBadge = !!document.querySelector('[data-slot="post-card-play"]');

  card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  out.imageTabActive = await waitFor('the image tab to open on double click', () => !!document.querySelector('[data-slot="image-tab-view"]'));

  const canvasEl = () => document.querySelector<HTMLCanvasElement>('[data-slot="ugoira-stage"] canvas');
  await waitFor('the ugoira stage to put up its canvas', () => !!canvasEl());
  const canvas = canvasEl();
  out.canvasFound = !!canvas;
  if (!canvas) return JSON.stringify(out);

  // 最初のフレームが描画されるまで待つ（IPC → Blob → createImageBitmap）
  const px = () => {
    try {
      // `!`ではなく名前を付ける: 2dコンテキストを返さないcanvasは本当の失敗で
      // あり、読み取り失敗と同じ'ERR:'の報告に落ちる。
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('the ugoira canvas has no 2d context');
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return d[0] + ',' + d[1] + ',' + d[2];
    } catch (e) {
      return 'ERR:' + e.message;
    }
  };
  const drawn = await waitFor('the first ugoira frame to be drawn onto the canvas', () => {
    const p = px();
    return p !== '0,0,0' && !p.startsWith('ERR');
  });
  out.firstPixel = drawn ? px() : null;

  // フレームが実際に進む＝各delayのティックで色が変わる。固定の時間窓ではなく
  // 2色目が現れるまでサンプリングする: ここから描画済みフレーム2までの各段は
  // IPC（mainがzipからフレームを読む）+ createImageBitmapで、負荷のかかったCI
  // ランナーではその最初の一歩だけで旧来の1秒予算を超えていた＝夜間ランは
  // ["255,0,0"]のまま赤くなったが、同じビルドはローカルでは3色全てを進んでいた。
  // 検証しているのはアニメーションが動くことであって、ランナーがそこへ
  // どれだけ速く着くかではない。
  const seen = new Set<string>();
  await waitFor(
    'the ugoira to advance far enough to show a second frame colour',
    () => {
      seen.add(px());
      return seen.size >= 2;
    },
    10000,
  );
  out.colorsSeen = [...seen].sort();

  // 一時停止すると止まる
  const toggle = document.querySelector<HTMLElement>('[data-slot="ugoira-toggle"]');
  out.toggleFound = !!toggle;
  if (toggle) {
    toggle.click();
    // 固定の遅延として保持する: クリックが着地した時点で既に飛んでいたフレームは
    // その後も描画されるが、その描画はアニメーションが動いていることにはならない。
    // 300msはフレームdelay（60ms）5回分なので、その頃には飛んでいたフレームは
    // 着地している。
    // biome-ignore lint/plugin: drains a frame already in flight — five 60ms frame delays
    await sleep(300);
    const held = px();
    // 「何も起きない」にはポーリングすべき事後条件が無い＝検証そのものが不在
    // であることなので、これは意図的に時間窓を丸ごと消費する。短く保つ。
    out.pausedHeld = await neverHappens('the paused canvas to change frames', () => px() !== held, 500);
    toggle.click();
    const resumeFrom = px();
    out.resumed = await waitFor('the frames to start advancing again after resuming', () => px() !== resumeFrom, 3000);
  }
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
  const r = readEvalResult(out) || {};
  fs.rmSync(tmp, { recursive: true, force: true });

  let ok = true;
  const check = (label, cond) => {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + label);
    if (!cond) ok = false;
  };

  console.log('\n--- うごイラ再生（#119 St3） ---\n');
  check('① カードが出る', r.cardFound === true);
  check('② ▶ バッジが付く', r.playBadge === true);
  check('③ ダブルクリックで画像タブへ', r.imageTabActive === true);
  check('④ canvas が立つ', r.canvasFound === true);
  check(`⑤ main がコマを返し 1コマ目を描画 (${r.firstPixel})`, !!r.firstPixel && !String(r.firstPixel).startsWith('ERR'));
  check(`⑥ コマが進む（2色以上を観測: ${JSON.stringify(r.colorsSeen)}）`, Array.isArray(r.colorsSeen) && r.colorsSeen.length >= 2);
  check('⑦ 一時停止ボタンがある', r.toggleFound === true);
  check('⑦ 一時停止でコマが止まる', r.pausedHeld === true);
  check('⑧ 再生で再び進む', r.resumed === true);

  console.log('\n' + (ok ? 'PASS すべて緑' : 'FAIL 赤あり'));
  process.exit(ok ? 0 : 1);
});
