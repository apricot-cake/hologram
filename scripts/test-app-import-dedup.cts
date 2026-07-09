'use strict';

// import-posts duplicate detection (BACKLOG L2): URL-less posts (Eagle/file
// migrations) used to duplicate wholesale on a re-import because the only
// dedup key was url. Now they fall back to eagleName + capturedAt + image byte
// size. Asserts, via a sandboxed Electron boot (CORPUS_SMOKE eval):
//  - first import lands; exact re-import skips everything (url AND legacy keys)
//  - same eagleName with a different capturedAt imports (names are NOT unique)
//  - same eagleName+capturedAt with different image bytes imports (3-point key)
//  - identical pair within ONE batch dedups to a single import
//  - a deleted (trashed) post does not resurrect through a re-import
//
//   node scripts/test-app-import-dedup.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-impdedup-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';
// Same "name and timestamp", different bytes — must NOT be treated as a dup.
const jpeg2B64 = Buffer.concat([Buffer.from(jpegB64, 'base64'), Buffer.from([0])]).toString('base64');

const evalJs = `(async () => {
  const jp = ${JSON.stringify(jpegB64)};
  const jp2 = ${JSON.stringify(jpeg2B64)};
  const mk = (name, at, img, extra) => Object.assign(
    { image: 'data:image/jpeg;base64,' + img, url: null, eagleName: name, capturedAt: at, tags: [] }, extra || {});
  // captureIds are import-<Date.now()>-<seq>; space the calls out so two batches
  // can't share a millisecond stamp.
  const gap = () => new Promise((r) => setTimeout(r, 5));
  const A = mk('dup name', '2025-01-01T00:00:00.000Z', jp);
  const B = mk('dup name', '2025-01-02T00:00:00.000Z', jp);
  const C = mk('c-item', '2025-01-03T00:00:00.000Z', jp, { url: 'https://x.com/u/status/777' });
  const r1 = await window.corpus.importPosts([A, B, C]); await gap();
  const r2 = await window.corpus.importPosts([A, B, C]); await gap();
  const D = mk('dup name', '2025-01-01T00:00:00.000Z', jp2);
  const r3 = await window.corpus.importPosts([D]); await gap();
  const r4 = await window.corpus.importPosts([A, A]); await gap();
  const E = mk('e-item', '2025-01-05T00:00:00.000Z', jp);
  const r5 = await window.corpus.importPosts([E, E]); await gap();
  const { posts } = await window.corpus.listPosts();
  const c = posts.find((p) => p.url === 'https://x.com/u/status/777');
  await window.corpus.deletePost(c.image); await gap();
  const r6 = await window.corpus.importPosts([C]);
  const s = (r) => r.imported + '/' + r.skipped;
  return [r1, r2, r3, r4, r5, r6].map(s).join(' ');
})()`;

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  CORPUS_CONFIG_DIR: configDir,
  CORPUS_SMOKE: '1',
  CORPUS_SMOKE_EVAL: evalJs,
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', () => {
  // fresh 3 | exact re-import all skip | new bytes import | already-present pair
  // skips | in-batch identical pair dedups | trashed stays dead
  const seqOk = out.includes('EVAL_RESULT "3/0 0/3 1/0 0/2 1/1 0/1"');
  // Count only imported sidecars — the app also writes org JSON (tabs.json etc.)
  // into the save folder on quit.
  const sidecars = fs.readdirSync(saveFolder).filter((f) => /^import-.*\.json$/.test(f));
  const diskOk = sidecars.length === 4; // A, B, D, E remain (C sits in .trash)
  let trashOk = false;
  try {
    trashOk = fs.readdirSync(path.join(saveFolder, '.trash')).filter((f) => /^import-.*\.json$/.test(f)).length === 1;
  } catch {
    trashOk = false;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`sequence=${seqOk} disk=${diskOk} trash=${trashOk}`);
  console.log(seqOk && diskOk && trashOk ? 'IMPORT_DEDUP_TEST_PASS' : 'IMPORT_DEDUP_TEST_FAIL');
  process.exit(seqOk && diskOk && trashOk ? 0 : 1);
});
