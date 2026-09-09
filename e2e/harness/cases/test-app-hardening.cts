'use strict';

// app/main.js の堅牢化に対する回帰テスト。HOLOGRAM_SMOKE ハーネス経由で
// 実際の IPC ハンドラを通して駆動する。独立した2つの修正をカバーする:
//
//   件1: 投稿を削除しても共有 avatars/ の投稿者アバターは残る。
//   件2: ナビゲーションの封じ込め: レンダラー起点の window.open は拒否され
//        （setWindowOpenHandler）、レンダラーのグローバルなドロップの番人は
//        ウィンドウへドロップされたファイルを preventDefault() する。
//
//   node e2e/harness/cases/test-app-hardening.cts

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-harden-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');

// 件1: 現行のメディアと共有アバターを持つ投稿を削除する。
const POST = 'dummy-har-0001';
const AVATAR_URL = 'https://h/a.png';
const AVATAR_SHARED = path.join('avatars', `${crypto.createHash('sha1').update(AVATAR_URL).digest('hex').slice(0, 16)}.png`);
fs.writeFileSync(path.join(saveFolder, `${POST}.jpg`), jpeg);
fs.mkdirSync(path.join(saveFolder, 'avatars'), { recursive: true });
fs.writeFileSync(path.join(saveFolder, AVATAR_SHARED), png);
seedLibrary(configDir, [
  {
    captureId: POST,
    image: `${POST}.jpg`,
    media: [{ file: `${POST}.jpg`, url: `https://pbs.twimg.com/media/${POST}.jpg` }],
    avatar: AVATAR_URL,
    avatarFile: AVATAR_SHARED,
    url: `https://x.com/u/status/${POST}`,
    platform: 'x',
    text: 't',
    tags: [],
    capturedAt: '2026-01-01T00:00:00.000Z',
    date: '2026-01-01T00:00:00.000Z',
  },
]);

const evalJs = evalSource(
  async (_waits, args) => {
    // 件2: window.open は setWindowOpenHandler によって拒否されなければ
    // ならない（遮断された時は null を返す）。
    let openDenied = false;
    try {
      const w = window.open('https://example.com', '_blank');
      openDenied = w === null;
    } catch {
      openDenied = true;
    }

    // 件2: レンダラーのグローバルなドロップの番人は、ウィンドウレベルの
    // ドロップを preventDefault しなければならない。
    const dropEvt = new Event('drop', { bubbles: true, cancelable: true });
    window.dispatchEvent(dropEvt);
    const dropPrevented = dropEvt.defaultPrevented;
    const dragEvt = new Event('dragover', { bubbles: true, cancelable: true });
    window.dispatchEvent(dragEvt);
    const dragPrevented = dragEvt.defaultPrevented;

    // 件1: 投稿を削除する → そのファイルが .trash/ へ移る。
    await (window as any).hologram.deletePost(`${args.post}.jpg`);

    return { openDenied, dropPrevented, dragPrevented };
  },
  { post: POST },
);

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'),
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
  const m = out.match(/EVAL_RESULT (\{.*\})/);
  let r: Record<string, any> = {};
  try {
    r = JSON.parse((m && m[1]) as string);
  } catch {
    /* ignore */
  }

  const trashDir = path.join(saveFolder, '.trash');
  // 件1の主張（ディスク状態）: 旧アバターは共有ストアに移り、主画像だけが
  // 投稿の項目フォルダーごと .trash へ移る。
  const avatarOrphaned = fs.existsSync(path.join(saveFolder, `${POST}-avatar.png`));
  const avatarShared = fs.existsSync(path.join(saveFolder, AVATAR_SHARED));
  const primaryGone = !fs.existsSync(path.join(saveFolder, 'items', POST));
  const primaryInTrash = fs.existsSync(path.join(trashDir, POST, `${POST}.jpg`));

  fs.rmSync(tmp, { recursive: true, force: true });

  let ok = true;
  const check = (label, cond) => {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + label);
    if (!cond) ok = false;
  };

  console.log('\n--- main.js hardening regressions ---\n');
  // 件1
  check('件1 アバターが保存先に孤児化していない', !avatarOrphaned);
  check('件1 共有アバターが削除後も残る', avatarShared);
  check('件1 主画像が保存先から消えた', primaryGone);
  check('件1 主画像が .trash へ回収された', primaryInTrash);
  // 件2
  check('件2 window.open が拒否された', r.openDenied === true);
  check('件2 window drop が preventDefault された', r.dropPrevented === true);
  check('件2 window dragover が preventDefault された', r.dragPrevented === true);

  console.log('\n' + (ok ? 'HARDENING_TEST_PASS' : 'HARDENING_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
