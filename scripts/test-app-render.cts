'use strict';

// Renders the Electron viewer against a temporary save folder containing one
// dummy post, captures a screenshot, and reports where it was written.
//
//   node scripts/test-app-render.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-render-'));
const configDir = path.join(tmp, 'Hologram'); // passed as HOLOGRAM_CONFIG_DIR below
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'testextensionidabcdefghijklmnop' }));

const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' + 'AAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';

const captureId = '1717500000000-abcd';
fs.writeFileSync(path.join(saveFolder, `${captureId}.jpg`), Buffer.from(jpegB64, 'base64'));
seedLibrary(configDir, [
  {
    captureId,
    image: `${captureId}.jpg`,
    url: 'https://x.com/testuser/status/1',
    platform: 'x',
    text: 'レンダリング確認用のダミー投稿です。DBのレコードから一覧が描画されることを確認します。',
    displayName: 'てすと太郎',
    screenName: 'testuser',
    likes: 24853,
    reposts: 3210,
    replies: 142,
    date: '2026-04-04T10:30:00Z',
    capturedAt: '2026-04-04T12:00:00Z',
    tags: ['test'],
  },
]);

const shot = path.join(appDir, '.smoke-shot.png');
try {
  fs.unlinkSync(shot);
} catch {}

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'),
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_SHOT: shot,
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: 'inherit' });

child.on('close', (code) => {
  const ok = fs.existsSync(shot);
  console.log(`electron exit=${code} screenshot=${ok ? shot : 'MISSING'}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
});
