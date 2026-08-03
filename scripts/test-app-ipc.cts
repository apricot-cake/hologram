'use strict';

// Exercises the mutation IPC handlers (update-tags, delete-post, restore-post)
// headlessly by asking the renderer to call them, then checks the result:
// - update-tags is a DB-only write; the tag is read back from hologram.db
// - delete-post moves the media into .trash/ and writes the record there as JSON
//   (the trash is self-describing — ipc-trash.ts's module comment), while the
//   library folder keeps no per-post JSON at all (#302)
// - a third post is tagged, trashed, and restored to prove that round trip does not
//   lose the DB-only tag/userKind/tagReviewed state (trashing deletes the posts row;
//   restore rebuilds it from the trash-side record)
//
//   node scripts/test-app-ipc.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
const { seedLibrary } = require('./lib-seed-library.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-ipc-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

const records: any[] = [];
function addPost(id, tags, media: any[] = []) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  records.push({
    captureId: id,
    image: `${id}.jpg`,
    url: `https://x.com/u/status/${id}`,
    platform: 'x',
    text: 't',
    tags,
    media: media || [],
    capturedAt: '2026-01-01T00:00:00.000Z',
    date: '2026-01-01T00:00:00.000Z',
  });
}
addPost('dummy-0001', []);
addPost('dummy-0002', []);
addPost('dummy-0003', []);
// #119 St1 acceptance: deleting a video post recovers its -media-/-poster. files too.
addPost('dummy-0004', [], [{ url: 'https://x/clip.mp4', alt: null, width: null, height: null, file: 'dummy-0004-media-0.mp4', type: 'video', posterFile: 'dummy-0004-poster.jpg' }]);
fs.writeFileSync(path.join(saveFolder, 'dummy-0004-media-0.mp4'), Buffer.from('fake-mp4'));
fs.writeFileSync(path.join(saveFolder, 'dummy-0004-poster.jpg'), jpeg);
seedLibrary(configDir, records);

const evalJs = `(async () => {
  await window.hologram.updateTags('dummy-0001.jpg', ['tagX']);
  await window.hologram.deletePost('dummy-0002.jpg');
  await window.hologram.updateTags('dummy-0003.jpg', ['tagY'], { userKind: 'plain', tagReviewed: true });
  await window.hologram.deletePost('dummy-0003.jpg');
  await window.hologram.restorePost('dummy-0003.jpg');
  await window.hologram.deletePost('dummy-0004.jpg');
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
  // #302: the library folder holds media only — an edit must not put a record there.
  const noLibraryJsonOk = fs.readdirSync(saveFolder).filter((f) => f.toLowerCase().endsWith('.json')).length === 0;

  // #176: hologram.db lives inside the save folder now, not configDir (ADR 0023).
  const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'), { readonly: true });
  const tagsOf = (id) =>
    sqlite
      .prepare('SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ? ORDER BY pt.rowid')
      .all(id)
      .map((r) => r.name);
  const dbTags = tagsOf('dummy-0001');
  const restoredRow = sqlite.prepare("SELECT userKind, tagReviewed FROM posts WHERE captureId = 'dummy-0003'").get();
  const restoredTags = tagsOf('dummy-0003');
  sqlite.close();
  const tagOk = JSON.stringify(dbTags) === JSON.stringify(['tagX']);
  const restoreOk = JSON.stringify(restoredTags) === JSON.stringify(['tagY']) && !!restoredRow && restoredRow.userKind === 'plain' && restoredRow.tagReviewed === 1;

  // The media leaves the library and the record lands in the trash, describing it.
  const delOk = !fs.existsSync(path.join(saveFolder, 'dummy-0002.jpg')) && fs.existsSync(path.join(saveFolder, '.trash', 'dummy-0002.jpg')) && fs.existsSync(path.join(saveFolder, '.trash', 'dummy-0002.json'));
  // #119 St1: delete-post sweeps -media-/-poster. files, not just the image.
  const videoDelOk = !fs.existsSync(path.join(saveFolder, 'dummy-0004-media-0.mp4')) && !fs.existsSync(path.join(saveFolder, 'dummy-0004-poster.jpg')) && fs.existsSync(path.join(tmp, 'saves', '.trash', 'dummy-0004-media-0.mp4')) && fs.existsSync(path.join(tmp, 'saves', '.trash', 'dummy-0004-poster.jpg'));
  const countOk = /EVAL_RESULT 2\b/.test(out);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`updateTags(db)=${tagOk} noLibraryJson=${noLibraryJsonOk} delete=${delOk} videoDelete=${videoDelOk} restoreKeepsDbFlags=${restoreOk} listCount=${countOk}`);
  const pass = tagOk && noLibraryJsonOk && delOk && videoDelOk && restoreOk && countOk;
  console.log(pass ? 'IPC_TEST_PASS' : 'IPC_TEST_FAIL');
  process.exit(pass ? 0 : 1);
});
