'use strict';

// レガシーZIPインポートの重複検出（BACKLOG L2）: url無しの投稿（Eagle/ファイル
// 移行）は、唯一の重複判定キーがurlだったため、再インポート時に丸ごと重複して
// いた。今はeagleName + capturedAt + 画像のバイトサイズにフォールバックする。
// サンドボックス化したElectron起動（HOLOGRAM_SMOKE eval）経由で検証する:
//  - 最初のインポートは着地する。全く同じ再インポートは全てスキップする
//    （urlキーもレガシーキーも）
//  - 同じeagleNameでcapturedAtが違えばインポートする（名前は一意ではない）
//  - 同じeagleName+capturedAtで画像バイトが違えばインポートする（3点のキー）
//  - 1つのバッチ内で同一のペアは1件のインポートに重複排除される
//  - 削除（ゴミ箱行き）した投稿は再インポートで復活しない
//
// #34は、urlの重複を固定のスキップから問いへと変えた: 1件持つバッチは何も
// インポートせず、呼び出し側がcopy/replace/skipを言うまで { needsChoice,
// duplicates } を返す。上のurl無しレガシーキーはその問いの一部ではない
// （比較できる第2の軸が無いため）＝そちらは黙ってスキップし続ける＝だから
// 下の流れには両方の形がまだ残っている。末尾の'replace'の回は、この目印が
// 拡張機能の答えと同じsweepへ届くことを証明する。
//
// #299: インポートはDBへ直接書き込む（sidecarなし）ので、「着地した」は
// import-*.jsonのsidecarファイルを数えるのではなくhologram.db（読み取り専用で
// 開く）に対して検証し、「ゴミ箱行き」は.trash/へ移動したメディアファイルに
// 対して検証する（移動すべきsidecarが無い＝ipc-trash.ts参照）。
//
// #322: バッチはここで書くレガシーZIP（metadata.json + images/）で、パスで
// インポートする。あの書庫がこれらのレコードの唯一の生成元だから＝mainは今、
// それを読んで展開するので、代わりに呼ぶbytes-inのIPCが無い。通常パスを
// 手渡すピッカーはmain自身のダイアログで、そちらのレンダラー側
// （import-complete）はこのテストが扱う対象ではないので、evalは
// importLegacyZipをフィクスチャのパスで直接呼ぶ。
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
// 同じ「名前とタイムスタンプ」でバイトが違う＝重複として扱ってはいけない。
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

// バッチごとに1つのレガシーエクスポート: metadata.jsonがレコードを列挙し、
// それぞれがimages/下の自分のエントリを指す＝#300以前のエクスポートが書いていた
// 形で、同一ペアのバッチも含む（そのペアは2件のレコードなのでエントリも2つ）。
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
      // captureIdはimport-<Date.now()>-<seq>。2つのバッチが同じミリ秒の
      // スタンプを共有できないよう呼び出しの間隔を空ける。
      // biome-ignore lint/plugin: the delay IS the spec — captureIds embed Date.now(), so consecutive batches have to land in different milliseconds. There is nothing to observe; 5ms is one tick past the collision.
      const gap = () => sleep(5);
      const r1 = await imp('abc');
      await gap();
      // CのURLは既にライブラリにある→バッチは止まって問い合わせる（#34）。
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
      // オプショナルチェーンではなく名前を付ける: ゴミ箱行きの投稿こそが次の
      // 2回のことなので、無ければ実行を止めてそう言わなければならない。
      const c = posts.find((p) => p.url === 'https://x.com/u/status/777');
      if (!c) throw new Error('Cのurlをもつインポートされたポストがライブラリからありません');
      await h.deletePost(c.image);
      await gap();
      const r6 = await imp('c');
      await gap();
      // 'replace': Fの最初のインポートは2回目によって退役する。タグも含めて。
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
    // 新規3件 | 再インポートは1件のURL重複について問い合わせる | "skip"と答えた
    // ら全てスキップ | 新しいバイトはインポート | 既に存在するペアはスキップ |
    // バッチ内の同一ペアは重複排除 | ゴミ箱行きは死んだまま | replaceはインポート
    // して古い方を退役させる
    const seqOk = out.includes('EVAL_RESULT "3/0 dup1 0/3 1/0 0/2 1/1 0/1 1/0 replaced"');

    // #299: 数えるsidecarは無い＝A、B、D、EはDBの行として着地していなければ
    // ならない（Cはゴミ箱行きになったので、その行はipc-trash.tsの明示的な
    // deletePostで削除された）。
    let diskOk = false;
    try {
      // #176: hologram.db は今は configDir ではなく保存フォルダの中にある（ADR 0025）。
      const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'), { readonly: true });
      // A、B、D、E に加えて F の置き換え（F の最初のインポートはこれによって退役した）。
      diskOk = sqlite.prepare("SELECT COUNT(*) AS n FROM posts WHERE captureId LIKE 'import-%'").get().n === 5;
      sqlite.close();
    } catch {
      diskOk = false;
    }
    // Cのメディアファイル（インポートされたレコードにsidecarは無い）が.trash/へ
    // 移動した＝それがsidecarの無い投稿でもdelete-postが機能し続けることの証明。
    let trashOk = false;
    try {
      // 手で削除したCと、Fの置き換えられた元のものが、どちらもここに着地する。
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
