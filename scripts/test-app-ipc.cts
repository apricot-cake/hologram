'use strict';

// Exercises the mutation IPC handlers (update-tags, delete-post) headlessly by
// asking the renderer to call them, then checks the resulting files on disk.
//
//   node scripts/test-app-ipc.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-ipc-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

function writePost(id, tags) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, `${id}.json`),
    JSON.stringify(
      {
        captureId: id,
        image: `${id}.jpg`,
        url: `https://x.com/u/status/${id}`,
        platform: 'x',
        text: 't',
        tags,
        capturedAt: '2026-01-01T00:00:00.000Z',
        date: '2026-01-01T00:00:00.000Z',
      },
      null,
      2,
    ),
  );
}
writePost('dummy-0001', []);
writePost('dummy-0002', []);

const evalJs = `(async () => {
  await window.hologram.updateTags('dummy-0001.jpg', ['tagX']);
  await window.hologram.deletePost('dummy-0002.jpg');
  const { posts } = await window.hologram.listPosts();
  return posts.length;
})()`;

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
  const rec1 = JSON.parse(fs.readFileSync(path.join(saveFolder, 'dummy-0001.json'), 'utf8'));
  const tagOk = JSON.stringify(rec1.tags) === JSON.stringify(['tagX']);
  const delOk = !fs.existsSync(path.join(saveFolder, 'dummy-0002.jpg')) && !fs.existsSync(path.join(saveFolder, 'dummy-0002.json'));
  const countOk = /EVAL_RESULT 1\b/.test(out);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`updateTags=${tagOk} delete=${delOk} listCount=${countOk}`);
  console.log(tagOk && delOk && countOk ? 'IPC_TEST_PASS' : 'IPC_TEST_FAIL');
  process.exit(tagOk && delOk && countOk ? 0 : 1);
});
