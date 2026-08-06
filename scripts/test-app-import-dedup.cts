'use strict';

// Legacy-ZIP import duplicate detection (BACKLOG L2): URL-less posts (Eagle/file
// migrations) used to duplicate wholesale on a re-import because the only
// dedup key was url. Now they fall back to eagleName + capturedAt + image byte
// size. Asserts, via a sandboxed Electron boot (HOLOGRAM_SMOKE eval):
//  - first import lands; exact re-import skips everything (url AND legacy keys)
//  - same eagleName with a different capturedAt imports (names are NOT unique)
//  - same eagleName+capturedAt with different image bytes imports (3-point key)
//  - identical pair within ONE batch dedups to a single import
//  - a deleted (trashed) post does not resurrect through a re-import
//
// #34 turned the URL duplicate from a fixed skip into a question: a batch
// carrying one imports NOTHING and answers { needsChoice, duplicates } until
// the caller says copy / replace / skip. The URL-less legacy keys above are NOT
// part of that question (they have no second axis to compare on), so they keep
// skipping silently — which is why the sequence below still has both shapes in
// it. The 'replace' round at the end proves the marker reaches the same sweep
// the extension's answer does.
//
// #299: the import writes straight into the DB (no sidecar), so "landed"
// is asserted against hologram.db (readonly open) instead of counting
// import-*.json sidecar files, and "trashed" is asserted against the media
// file moved into .trash/ (there is no sidecar to move — see ipc-trash.ts).
//
// #322: the batches are legacy ZIPs (metadata.json + images/) written here and
// imported by PATH, because that archive is the only producer of these records —
// main reads and expands it now, so there is no bytes-in IPC to call instead.
// The picker that normally hands the path over is main's own dialog; the renderer
// side of that (import-complete) is not what this test is about, so the eval calls
// importLegacyZip with the fixture path directly.
//
//   node scripts/test-app-import-dedup.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
const { evalSource } = require('./lib-wait.cts');

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-impdedup-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';
const jpeg = Buffer.from(jpegB64, 'base64');
// Same "name and timestamp", different bytes — must NOT be treated as a dup.
const jpeg2 = Buffer.concat([jpeg, Buffer.from([0])]);

const JSZip = require('jszip');
const mk = (name: string, at: string, img: Buffer, extra?: Record<string, unknown>) => Object.assign({ img, url: null, eagleName: name, capturedAt: at, tags: [] }, extra || {});
const A = mk('dup name', '2025-01-01T00:00:00.000Z', jpeg);
const B = mk('dup name', '2025-01-02T00:00:00.000Z', jpeg);
const C = mk('c-item', '2025-01-03T00:00:00.000Z', jpeg, { url: 'https://x.com/u/status/777' });
const D = mk('dup name', '2025-01-01T00:00:00.000Z', jpeg2);
const E = mk('e-item', '2025-01-05T00:00:00.000Z', jpeg);
const F = mk('f-item', '2025-01-06T00:00:00.000Z', jpeg, { url: 'https://x.com/u/status/888', tags: ['ふるいタグ'] });
const F2 = Object.assign({}, F, { tags: ['あたらしいタグ'] });

// One legacy export per batch: metadata.json listing the records, each pointing at
// its own entry under images/ — the shape the pre-#300 export wrote, including for
// the identical-pair batches (that pair is two records, so it is two entries).
const zipDir = path.join(tmp, 'zips');
fs.mkdirSync(zipDir, { recursive: true });
async function legacyZip(name: string, records: Array<Record<string, any>>) {
  const zip = new JSZip();
  const meta = records.map((r, i) => {
    const imageFile = `images/${i}.jpg`;
    zip.file(imageFile, r.img);
    return Object.assign({}, r, { img: undefined, imageFile });
  });
  zip.file('metadata.json', JSON.stringify(meta));
  const out = path.join(zipDir, `${name}.zip`);
  fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer' }));
  return out;
}

async function buildFixtures() {
  return {
    abc: await legacyZip('abc', [A, B, C]),
    d: await legacyZip('d', [D]),
    aa: await legacyZip('aa', [A, A]),
    ee: await legacyZip('ee', [E, E]),
    c: await legacyZip('c', [C]),
    f: await legacyZip('f', [F]),
    f2: await legacyZip('f2', [F2]),
  };
}

const evalJsFor = (zips: Record<string, string>) =>
  evalSource(
    async ({ sleep }, args) => {
      const z = args.zips;
      const h = (window as any).hologram;
      const imp = (key: string, mode?: string) => h.importLegacyZip(z[key], mode);
      // captureIds are import-<Date.now()>-<seq>; space the calls out so two batches
      // can't share a millisecond stamp.
      // biome-ignore lint/plugin: the delay IS the spec — captureIds embed Date.now(), so consecutive batches have to land in different milliseconds. There is nothing to observe; 5ms is one tick past the collision.
      const gap = () => sleep(5);
      const r1 = await imp('abc');
      await gap();
      // C's URL is already in the library -> the batch stops and asks (#34).
      const ask = await imp('abc');
      await gap();
      const r2 = await imp('abc', 'skip');
      await gap();
      const r3 = await imp('d');
      await gap();
      const r4 = await imp('aa');
      await gap();
      const r5 = await imp('ee');
      await gap();
      const { posts } = await h.listPosts();
      // Named rather than optional-chained: the trashed post IS what the next two
      // rounds are about, so a missing one has to stop the run and say so.
      const c = posts.find((p) => p.url === 'https://x.com/u/status/777');
      if (!c) throw new Error('the imported post carrying the C url is missing from the library');
      await h.deletePost(c.image);
      await gap();
      const r6 = await imp('c');
      await gap();
      // 'replace': F's first import is retired by its second, tags and all.
      await imp('f');
      await gap();
      const r7 = await imp('f2', 'replace');
      await gap();
      const after = (await h.listPosts()).posts.filter((p) => p.url === 'https://x.com/u/status/888');
      const s = (r) => r.imported + '/' + r.skipped;
      const askShape = ask.needsChoice ? 'dup' + ask.duplicates : s(ask);
      const replaced = after.length === 1 && after[0].tags.slice().sort().join(',') === ['あたらしいタグ', 'ふるいタグ'].sort().join(',') ? 'replaced' : 'BAD:' + JSON.stringify(after.map((p) => p.tags));
      return [s(r1), askShape, s(r2), s(r3), s(r4), s(r5), s(r6), s(r7), replaced].join(' ');
    },
    { zips },
  );

buildFixtures().then((zips) => {
  const env = Object.assign({}, process.env, {
    APPDATA: tmp,
    HOLOGRAM_CONFIG_DIR: configDir,
    HOLOGRAM_SMOKE: '1',
    HOLOGRAM_SMOKE_EVAL: evalJsFor(zips),
  });

  const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d.toString();
    process.stdout.write(d);
  });

  child.on('close', () => {
    // fresh 3 | re-import ASKS about the one URL duplicate | answered "skip" all
    // skip | new bytes import | already-present pair skips | in-batch identical
    // pair dedups | trashed stays dead | replace imports and retires the old one
    const seqOk = out.includes('EVAL_RESULT "3/0 dup1 0/3 1/0 0/2 1/1 0/1 1/0 replaced"');

    // #299: no sidecar to count — A, B, D, E must have landed as DB rows (C was
    // trashed, so its row was deleted by ipc-trash.ts's explicit deletePost).
    let diskOk = false;
    try {
      // #176: hologram.db lives inside the save folder now, not configDir (ADR 0025).
      const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'), { readonly: true });
      // A, B, D, E plus F's REPLACEMENT (F's first import was retired by it).
      diskOk = sqlite.prepare("SELECT COUNT(*) AS n FROM posts WHERE captureId LIKE 'import-%'").get().n === 5;
      sqlite.close();
    } catch {
      diskOk = false;
    }
    // C's media file (an imported record has no sidecar) moved into .trash/ —
    // that's what proves delete-post still works for a sidecar-less post.
    let trashOk = false;
    try {
      // C (deleted by hand) and F's replaced original both land here.
      trashOk = fs.readdirSync(path.join(saveFolder, '.trash')).filter((f) => /^import-.*\.jpg$/.test(f)).length === 2;
    } catch {
      trashOk = false;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`sequence=${seqOk} disk=${diskOk} trash=${trashOk}`);
    console.log(seqOk && diskOk && trashOk ? 'IMPORT_DEDUP_TEST_PASS' : 'IMPORT_DEDUP_TEST_FAIL');
    process.exit(seqOk && diskOk && trashOk ? 0 : 1);
  });
});
