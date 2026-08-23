'use strict';

// ライブラリの整理状態をDB世代（#233）まで巻き戻すことを、IPC越しに
// エンドツーエンドで検証する。興味深い半分は単体テストできないからだ:
// アプリが動いている間に、稼働中のデータベースを閉じ、ディスク上で置き換え、
// 開き直す。
//
//  - list-db-generationsがローカルの復元ポイントを報告する
//  - 巻き戻すとその世代が持っていた整理状態が復元される（世代が取られた後に
//    付けたタグは再び消える）
//  - その世代より後にできた投稿は巻き戻しを生き延び、巻き戻し前の自動
//    スナップショットから再登録される（「所蔵を過去に減らす操作ではない」）
//  - そのスナップショット自体はストアに残るので、巻き戻しは取り消せる
//  - その後もデータベースは使える（投稿が通常の経路で読み戻せる）
//
//   node scripts/test-app-rollback.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-rb-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
for (const dir of [configDir, saveFolder]) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const post = (n: number) => {
  const id = '170000000000' + n + '-rb' + n;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  return {
    captureId: id,
    image: id + '.jpg',
    url: 'https://x.com/u/status/' + (900 + n),
    platform: 'x',
    text: '本文' + n,
    displayName: '人' + n,
    screenName: 'u' + n,
    capturedAt: '2026-04-0' + (n + 1) + 'T12:00:00Z',
    media: [],
    tags: [],
    hashtags: [],
  };
};

const seeded = [post(0), post(1), post(2)];
seedLibrary(configDir, seeded);

// この E2E の主題は稼働中 DB の置き換えであり、Google Drive への接続ではない。
// 起動前の閉じた DB から、巻き戻し先になるローカル復元ポイントを作る。
const generation = 'hologram-20260823-120000.db';
const generationsDir = path.join(saveFolder, '.db-generations');
fs.mkdirSync(generationsDir, { recursive: true });
fs.copyFileSync(path.join(saveFolder, 'hologram.db'), path.join(generationsDir, generation));

const TAG_AFTER = 'この世代より後に付けたタグ';
const generationsOf = (root: string): string[] => {
  try {
    return fs.readdirSync(path.join(root, '.db-generations')).filter((n) => /^hologram-\d{8}-\d{6}\.db$/.test(n));
  } catch {
    return [];
  }
};

function launch(evalJs): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir, HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });
    const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
      process.stdout.write(d);
    });
    child.on('close', () => {
      let r: Record<string, any> = {};
      const m = out.match(/EVAL_RESULT (.+)/);
      if (m) {
        try {
          r = JSON.parse(m[1]);
        } catch {
          /* 無視 */
        }
      }
      resolve(r);
    });
  });
}

(async () => {
  // 起動A: 復元ポイントの「後」になって初めて、ライブラリは巻き戻しが取り消す
  // はずのタグを得る。
  const evalA = evalSource(
    async ({ sleep }, args) => {
      const hologram = (window as any).hologram;
      // 意図的に遅延として保持している。これはこのリポジトリの中で、それが
      // 匂いにならない唯一の場所（#989）: 破壊的なデータベース置き換えの前に
      // 真でなければならないのは、起動処理自身のデータベース作業が終わって
      // いることだが、それを示す観測可能なものが無い。代わりに事後条件を待つと
      // むしろ「悪化」する＝listPosts()を求めることは、巻き戻しがデータベースを
      // 閉じて名前変更するまさに直前にデータベースを再起動させてしまい、その
      // 名前変更は再オープンに負ける（Windowsでのepern）。実測: この遅延では
      // 20/20が緑、事後条件では21回中3回が赤。#989が再オープンを止めたらこれを
      // 取り除くこと。それまでは、短い待機はより速いテストではなく、より悪い
      // テストになる。
      // biome-ignore lint/plugin: no observable post-condition exists for "startup's database work has settled" — see #989
      await sleep(400);
      await hologram.updateTags(args.firstImage, [args.tagAfter]);
      const posts = await hologram.listPosts();
      const tagged = (posts.posts.find((p) => p.captureId === args.firstCaptureId) || {}).tags || [];
      return { taggedBefore: tagged.includes(args.tagAfter) };
    },
    { firstImage: seeded[0].image, firstCaptureId: seeded[0].captureId, tagAfter: TAG_AFTER },
  );
  const rA = await launch(evalA);

  // その世代がまだ知らない投稿を、全ての実際のプロデューサーと同じやり方で
  // データベースへ直接書く。これこそがsweepが巻き戻しをまたいで運ばなければ
  // ならないもの＝これを失うと「整理状態を元に戻す」が「それ以降に保存した
  // 投稿を返せ」に化けてしまう。
  const late = post(3);
  seedLibrary(configDir, [late]);

  // 起動B: 一覧を取り、巻き戻し、その後ライブラリを再び読み出す。
  const evalB = evalSource(
    async ({ sleep }, args) => {
      const hologram = (window as any).hologram;
      // 起動Aと同じ理由で、ここではもっと重要になる: 巻き戻しは次の行にある。
      // #989参照。
      // biome-ignore lint/plugin: no observable post-condition exists for "startup's database work has settled" — see #989
      await sleep(400);
      const list = await hologram.listDbGenerations();
      const listed = !!(list && list.length === 1 && list[0].name === args.generation && list[0].atDestination === false && list[0].size > 0);

      const res = await hologram.rollbackDbGeneration(args.generation);
      const rolledBack = !!(res && res.ok && res.reregistered === 1);

      const posts = await hologram.listPosts();
      const ids = posts.posts.map((p) => p.captureId).sort();
      const tagged = (posts.posts.find((p) => p.captureId === args.firstCaptureId) || {}).tags || [];
      return { listed, rolledBack, ids, tagGone: !tagged.includes(args.tagAfter) };
    },
    { generation, firstCaptureId: seeded[0].captureId, tagAfter: TAG_AFTER },
  );
  const rB = await launch(evalB);

  const expectedIds = [...seeded.map((p) => p.captureId), late.captureId].sort();
  const keptEverything = Array.isArray(rB.ids) && rB.ids.length === expectedIds.length && rB.ids.every((id: string, i: number) => id === expectedIds[i]);
  // 巻き戻し前の状態は今それ自体が復元ポイントなので、ストアは増えている。
  const stashKept = generationsOf(saveFolder).length === 2;

  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = rA.taggedBefore && rB.listed && rB.rolledBack && rB.tagGone && keptEverything && stashKept;
  console.log(`taggedBefore=${rA.taggedBefore} listed=${rB.listed} rolledBack=${rB.rolledBack} tagGone=${rB.tagGone} keptEverything=${keptEverything} stashKept=${stashKept}`);
  console.log(ok ? 'ROLLBACK_TEST_PASS' : 'ROLLBACK_TEST_FAIL');
  process.exit(ok ? 0 : 1);
})();
