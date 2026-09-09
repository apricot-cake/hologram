'use strict';

// #34 の「置換」を、実際の Electron 起動を通してエンドツーエンドで検証する:
// 「アプリが閉じている間」に保存され、`replaces` の印を持つキャプチャは、
// 次の起動時にそれが名指すキャプチャを引退させる — 受け入れ基準「アプリが
// 停止している間に『置換』が選ばれても、古い対の後片付けとタグの継承は
// 次の起動時にちゃんと完了する」。
//
// この経路は単体テストできない: tests/integration/db-replaces.test.ts は
// applyPendingReplacements を直接駆動するが、そこで証明されていないのは
// 「配線」— 取込キューの drain、起動時の掃引、ゴミ箱フォルダが、起動した
// アプリの中で実際に噛み合うこと。そこでこのハーネスは取込キューのエンベロー
// プ（ネイティブホストが実際に書くものそのもの）を書くだけにして、その後
// DB とゴミ箱フォルダを読み返す。
//
//   node e2e/harness/cases/test-app-replaces.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { buildEnvelope, writeInboxEvent } = require(path.join(__dirname, '../../../native-host/inbox.mts'));
const { normalizePostRecord } = require(path.join(__dirname, '../../../native-host/post-record.mts'));
const { evalSource } = require('../../../scripts/lib-wait.cts');

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
  const itemDir = path.join(saveFolder, 'items', id);
  const image = `items/${id}/${id}.jpg`;
  fs.mkdirSync(itemDir, { recursive: true });
  fs.writeFileSync(path.join(itemDir, `${id}.jpg`), jpeg);
  const rec = normalizePostRecord(Object.assign({ captureId: id, image, media: [{ file: image, url: `https://pbs.twimg.com/media/${id}.jpg` }], url: POST_URL, platform: 'x', text: 't' }, extra));
  await writeInboxEvent(saveFolder, buildEnvelope(rec));
}

// DB を2度目に開くのではなくレンダラーから読み返す: アプリが唯一の書き手
// であり、このプロセスからの2つ目の better-sqlite3 ハンドルは、検証対象の
// まさにその掃引と競合してしまう。
const evalJs = evalSource(
  async ({ waitFor }, args) => {
    const list = async () => (await (window as any).hologram.listPosts()).posts || [];
    const replaced = await waitFor(
      '置換した側のキャプチャだけが唯一の投稿として残ること',
      async () => {
        const posts = await list();
        return posts.length === 1 && posts[0].captureId === args.newId;
      },
      12_000,
    );
    const posts = await list();
    // 以前と同じ2つの形: タグは置換が着地して初めて意味を持つので、
    // タイムアウトしてもその時点で見えていた id は報告する。
    return JSON.stringify({ ids: posts.map((p: any) => p.captureId), tags: replaced ? posts[0].tags.slice().sort() : [] });
  },
  { newId: NEW_ID },
);

const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir, HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });

(async () => {
  // どちらのキャプチャも、アプリが一度も動いていない間に着地する — アプリが
  // 閉じているケース。2つ目は1つ目を置換すると言う。それがネイティブホストに
  // できるすべて。
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
    const oldTrashed = fs.existsSync(path.join(trashDir, OLD_ID, `${OLD_ID}.jpg`)) && fs.existsSync(path.join(trashDir, `${OLD_ID}.json`));
    const oldGone = !fs.existsSync(path.join(saveFolder, 'items', OLD_ID));
    const newKept = fs.existsSync(path.join(saveFolder, 'items', NEW_ID, `${NEW_ID}.jpg`));
    const onlyNew = !!result && result.ids.length === 1 && result.ids[0] === NEW_ID;
    // 和集合であることが要点: 新しいレコードは自分自身のタグを保ちつつ、
    // 置換される側のキャプチャに利用者が付けていたタグも継承する。
    const tagsMerged = !!result && result.tags.join(',') === ['古いタグ', '新しいタグ'].sort().join(',');

    console.log('掃引後の投稿:', JSON.stringify(result));
    console.log('古いキャプチャがゴミ箱にある:', oldTrashed, '| 古いファイルが消えた:', oldGone, '| 新しいファイルが残っている:', newKept);
    const ok = onlyNew && tagsMerged && oldTrashed && oldGone && newKept;
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(ok ? 'REPLACES_TEST_PASS' : 'REPLACES_TEST_FAIL');
    process.exit(ok ? 0 : 1);
  });
})();
