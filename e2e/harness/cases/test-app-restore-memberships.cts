'use strict';

// #593: 投稿をゴミ箱から復元すると、投稿一覧に戻るだけでなくライブラリの
// 「構造」にも戻る。
//
// 投稿がゴミ箱行きになると FK ON DELETE CASCADE で3つのものが落ち、レコード
// からは再構築できないので、それぞれが `.trash/<captureId>.json` を経由した
// 往復を明示的にしなければならない: フォルダの所属と、手動グループの所属
// （グループ内の位置も含む）。
//
// ライタを直接ではなく実際の IPC（delete-post / restore-post）経由で駆動する。
// 抜けていたのは配線の方だったため — 読み取り・適用のペア自体は
// db-write.test.ts がすでに隔離した状態でカバーしている。投稿がゴミ箱に
// ある「間に」フォルダを削除する。これが設計を決めるケース: 復元はその1つの
// 所属だけを落とし、それでも成功する（そうでなければ外部キーが復元全体を
// 巻き添えにしてしまう）。
//
// 正解は IPC の答えからではなく、アプリが終了した後の hologram.db から読む。
// そうすれば、読み取り経路の何かが欠けた行を存在するように見せかけることが
// できない。
//
//   node e2e/harness/cases/test-app-restore-memberships.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');
const { createDbWriter } = require(path.join(appDir, 'src', 'main', 'lib-db-write.ts'));
const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-restore-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const CAPTURE_ID = 'dummy-593';
const IMAGE = `${CAPTURE_ID}.jpg`;
const OTHER = 'dummy-593b';

fs.writeFileSync(path.join(saveFolder, IMAGE), Buffer.from('89504e470d0a1a0a', 'hex'));
fs.writeFileSync(path.join(saveFolder, `${OTHER}.jpg`), Buffer.from('89504e470d0a1a0a', 'hex'));

const base = { capturedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', platform: 'x', tags: ['tag-593'] };
const handle = seedLibrary(
  configDir,
  [
    {
      ...base,
      captureId: CAPTURE_ID,
      image: IMAGE,
      url: 'https://x.com/restore/status/593',
      text: 'restore fixture',
      media: [{ url: 'https://pbs.twimg.com/media/R593?format=jpg&name=orig', file: IMAGE }],
    },
    { ...base, captureId: OTHER, image: `${OTHER}.jpg`, url: 'https://x.com/restore/status/593b', text: 'group mate', media: [] },
  ],
  { close: false },
);
const seedWriter = createDbWriter(handle.sqlite);
seedWriter.setFolders({
  folders: [
    { id: 'keep', name: 'Keep', kind: 'static', created: 1, items: [CAPTURE_ID] },
    { id: 'doomed', name: 'Doomed', kind: 'static', created: 2, items: [CAPTURE_ID] },
  ],
  activeId: 'keep',
});
// ゴミ箱行きの投稿はグループの「2番目」のメンバーなので、「グループに戻る」
// は「seq 1 に戻る」ことを意味しなければならない — 順序が利用者の並びで
// あるコンテナ。
seedWriter.setManualGroups([[OTHER, CAPTURE_ID]]);
handle.sqlite.close();

// 削除と復元の間に 'doomed' を削除する。これこそが要点: 復元はその所属を
// 落として、それでも先へ進まなければならない。
const evalJs = evalSource(
  async ({ sleep }, args) => {
    const hologram = (window as any).hologram;
    await hologram.listPosts();
    await hologram.deletePost(args.image);
    const folders = await hologram.getFolders();
    await hologram.setFolders({ ...folders, folders: folders.folders.filter((f) => f.id !== 'doomed') });
    await hologram.restorePost(args.image);
    // restore-post は解決する時点で自身の書き込みをコミット済みだが、
    // await しない後続処理も蹴っている（posts-changed の再取得と、デバウンス
    // された saved-index の書き込み、ipc-trash.ts）— この余裕は、その途中で
    // アプリが引き倒されないようにするため。その後続処理がいつ終わるかを
    // レンダラー側の何かが報告することはない。
    // biome-ignore lint/plugin: no observable post-condition — the window covers main's un-awaited tail work before the app quits.
    await sleep(400);
    return 'restored';
  },
  { image: IMAGE },
);

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
  const evalOk = /EVAL_RESULT "restored"/.test(out);

  // #176: hologram.db は今や configDir ではなく保存フォルダの中にある。
  const db = openDatabase(path.join(saveFolder, 'hologram.db'), { readonly: true }).sqlite;
  const post = db.prepare('SELECT captureId, trashedAt FROM posts WHERE captureId = ?').get(CAPTURE_ID);
  const folders = (db.prepare('SELECT folderId FROM folder_items WHERE postId = ? ORDER BY folderId').all(CAPTURE_ID) as Array<{ folderId: string }>).map((r) => r.folderId);
  const group = db.prepare('SELECT groupId, seq FROM manual_group_items WHERE postId = ?').get(CAPTURE_ID);
  const tags = (db.prepare('SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ?').all(CAPTURE_ID) as Array<{ name: string }>).map((r) => r.name);
  db.close();

  const restored = !!post && !post.trashedAt;
  // 'keep' だけ: 'doomed' は投稿がゴミ箱にある間に削除された。
  const foldersOk = folders.join(',') === 'keep';
  const groupOk = !!group && group.seq === 1;
  const tagsOk = tags.join(',') === 'tag-593';

  fs.rmSync(tmp, { recursive: true, force: true });

  const pass = evalOk && restored && foldersOk && groupOk && tagsOk;
  console.log(`eval=${evalOk} restored=${restored} folders=[${folders.join(',')}] group=${JSON.stringify(group)} tags=[${tags.join(',')}]`);
  console.log(pass ? 'RESTORE_MEMBERSHIPS_PASS' : 'RESTORE_MEMBERSHIPS_FAIL');
  process.exit(pass ? 0 : 1);
});
