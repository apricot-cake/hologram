'use strict';

// Verifies #34's "replace" end-to-end through a real Electron boot: a capture
// saved WHILE THE APP WAS CLOSED that carries a `replaces` marker retires the
// capture it names at the next launch — the acceptance criterion "アプリ停止中に
// 「置換」を選んだ場合も、次回起動時に旧ペアの掃除とタグ引き継ぎが完了する".
//
// That path cannot be unit-tested: scripts/db-replaces.test.ts drives
// applyPendingReplacements directly, and what is unproven there is the WIRING —
// that the inbox drain, the startup sweep and the trash folder actually meet
// inside a booted app. So this harness only writes inbox envelopes (exactly what
// the native host writes) and then reads the DB and the trash folder back.
//
//   node scripts/test-app-replaces.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { buildEnvelope, writeInboxEvent } = require(path.join(__dirname, '..', 'native-host', 'inbox.mts'));
const { normalizePostRecord } = require(path.join(__dirname, '..', 'native-host', 'post-record.mts'));

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-replaces-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

const POST_URL = 'https://x.com/u/status/34';
const OLD_ID = '1700000000000-0a1a';
const NEW_ID = '1700000000001-0b2b';

async function saveViaInbox(id: string, extra: Record<string, unknown>) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  const rec = normalizePostRecord(Object.assign({ captureId: id, image: `${id}.jpg`, url: POST_URL, platform: 'x', text: 't' }, extra));
  await writeInboxEvent(saveFolder, buildEnvelope(rec));
}

// Read the DB back from the renderer instead of opening it a second time: the
// app is the single writer, and a second better-sqlite3 handle from this
// process would race the very sweep under test.
const evalJs = `(async () => {
  for (let i = 0; i < 60; i++) {
    const posts = (await window.hologram.listPosts()).posts || [];
    if (posts.length === 1 && posts[0].captureId === ${JSON.stringify(NEW_ID)}) {
      return JSON.stringify({ ids: posts.map(p => p.captureId), tags: posts[0].tags.slice().sort() });
    }
    await new Promise(r => setTimeout(r, 200));
  }
  const posts = (await window.hologram.listPosts()).posts || [];
  return JSON.stringify({ ids: posts.map(p => p.captureId), tags: [] });
})()`;

const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir, HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });

(async () => {
  // Both captures land while the app has never run — the app-closed case. The
  // second says it replaces the first, which is all the native host can do.
  await saveViaInbox(OLD_ID, { tags: ['古いタグ'] });
  await saveViaInbox(NEW_ID, { tags: ['新しいタグ'], replaces: OLD_ID });

  const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d: Buffer) => {
    out += d.toString();
  });

  child.on('close', () => {
    const m = out.match(/EVAL_RESULT (.+)/);
    let result: any = null;
    try {
      result = JSON.parse(JSON.parse(m?.[1] ?? ''));
    } catch {
      result = null;
    }
    const trashDir = path.join(saveFolder, '.trash');
    const oldTrashed = fs.existsSync(path.join(trashDir, `${OLD_ID}.jpg`)) && fs.existsSync(path.join(trashDir, `${OLD_ID}.json`));
    const oldGone = !fs.existsSync(path.join(saveFolder, `${OLD_ID}.jpg`));
    const newKept = fs.existsSync(path.join(saveFolder, `${NEW_ID}.jpg`));
    const onlyNew = !!result && result.ids.length === 1 && result.ids[0] === NEW_ID;
    // The union is the point: the new record keeps its own tag AND inherits the
    // one the user had put on the capture being replaced.
    const tagsMerged = !!result && result.tags.join(',') === ['古いタグ', '新しいタグ'].sort().join(',');

    console.log('posts after sweep:', JSON.stringify(result));
    console.log('old capture in trash:', oldTrashed, '| old files gone:', oldGone, '| new files kept:', newKept);
    const ok = onlyNew && tagsMerged && oldTrashed && oldGone && newKept;
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(ok ? 'REPLACES_TEST_PASS' : 'REPLACES_TEST_FAIL');
    process.exit(ok ? 0 : 1);
  });
})();
