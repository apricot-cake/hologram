'use strict';

// Exercises the copy-image IPC handler (#132) in a REAL Electron main, because
// what it hinges on is nativeImage's actual decoding: the handler must refuse a
// file nativeImage can't read (svg) rather than write the resulting EMPTY image
// to the clipboard — that would silently wipe whatever the user had copied. The
// name gate and drag-out's path resolution are pure and covered by
// scripts/test-library-files.cts; only this branch needs Electron.
//
//   node scripts/test-app-copy-image.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-copyimg-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
fs.writeFileSync(path.join(saveFolder, 'dummy-0001.jpg'), jpeg);
// A real library can hold svg (app/src/main/ipc-transfer.ts accepts it) — the format nativeImage won't decode.
fs.writeFileSync(path.join(saveFolder, 'dummy-0002.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>');

// true only for the decodable image; every other case must report failure so the
// renderer can say so instead of implying a copy that didn't happen.
const evalJs = evalSource(async () => {
  const h = (window as any).hologram;
  return [await h.copyImage('dummy-0001.jpg'), await h.copyImage('dummy-0002.svg'), await h.copyImage('../Hologram/config.json'), await h.copyImage('nope.jpg')].join(',');
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
  fs.rmSync(tmp, { recursive: true, force: true });
  // the harness prints the eval's return JSON-encoded, so a string arrives quoted
  const m = /EVAL_RESULT "?([^"\r\n]+)"?/.exec(out);
  const got = m ? m[1] : '(no result)';
  const ok = got === 'true,false,false,false';
  console.log(`copyImage jpg,svg,traversal,missing = ${got} (want true,false,false,false)`);
  console.log(ok ? 'COPY_IMAGE_TEST_PASS' : 'COPY_IMAGE_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
