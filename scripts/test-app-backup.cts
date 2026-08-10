'use strict';

// 自動バックアップの配管をIPC越しにエンドツーエンドで検証する:
//  - set-backupは、保存フォルダと重なる出力先を拒否する
//  - run-backupはライブラリを<dir>/Hologram-backup/へ（個々のファイルとして）コピーする
//  - 2回目の実行は何度実行しても同じ（不変なアセットなので新たにコピーされるものは無い）
//  - 最初のバックアップの後にライブラリに現れたファイルは、次の実行で拾われる
//    （送り先は最初の1回目で凍結されない）
//  - #302以降、バックアップがライブラリから持ち込むすべては書き込み一度きりなので、
//    送り先に既にあるファイルは決して再コピーされない。かつてその場で変わっていたもの――
//    整理用のJSON――は今はDBの中で暮らしていて、下にあるDB世代として送り先に届く。
//    追跡対象のファイルとしてではない。
//  - DBレーン（#233）はライブラリ自身の.db-generations/ストアに世代を書き込み、
//    送り先はそのストアのコピーを受け取る
//  - 投稿の削除は送り先ではMOVE（#233）＝ファイルは削除して再コピーするのではなく
//    .trash/の下に着地する
//  - プルーニング安全ガードは、src（バックアップ元）が崩壊したとき（clear-all→空）
//    プルーニングを止め、送り先を無傷のまま保つ（2026-06-23のライブラリ喪失
//    インシデントのリグレッション）
//  - 送り先は自分がどのライブラリに属するかを記録し（#233/#176）、別のライブラリが
//    既に主張している送り先に対する実行は、何かを書き込んだりプルーニングしたり
//    する前に拒否される
//
//   node scripts/test-app-backup.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-bk-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
const outDir = path.join(tmp, 'out');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const ids: any[] = [];
const records: any[] = [];
// 投稿8件: clear-allによる崩壊でsrcがプルーニングガードの50%縮小比率を十分に下回る
// 数――この実行のもっと前にゴミ箱送りにした投稿がファイルを保持していても（#233が
// バックアップ対象とする.trash/の下に）変わらない。だからガードが効いたという
// アサーションが曖昧にならずに済む。
for (let i = 0; i < 8; i++) {
  const id = '170000000000' + i + '-bk' + i;
  ids.push(id);
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: 'https://x.com/u/status/' + (800 + i),
    platform: 'x',
    text: '本文' + i,
    displayName: '人' + i,
    screenName: 'u' + i,
    likes: 1 + i,
    capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [],
    tags: [],
    hashtags: [],
  });
}
seedLibrary(configDir, records);

const backupDir = path.join(outDir, 'Hologram-backup');
const countBackupRoot = () => {
  try {
    // トップレベルの「ファイル」だけを数える＝.db-generations/、.trash/、共有ストアは
    // 投稿アセットのプルーニングとは無関係な常設サブフォルダなので、これらを数えると
    // 下のプルーニング無傷アサーションが同種同士（投稿ファイルだけ）を比較できなく
    // なる――.hologram-inboxに既に適用していたのと同じ理屈だ。.hologram-backup.jsonも
    // 同じ理由で除外する＝これは送り先自身がどのライブラリに属するかの記録
    // （#233/#176）であり、コピーされたアセットでは決してない。
    return fs.readdirSync(backupDir, { withFileTypes: true }).filter((e) => e.isFile() && e.name !== '.hologram-backup.json' && !/\.tmp(-\d+)?$/i.test(e.name)).length;
  } catch {
    return -1;
  }
};
// ストアディレクトリ(ライブラリ自身のもの、あるいは送り先にあるそのコピー)の中にある
// 唯一の世代ファイル。無ければnull。
const oneGeneration = (root: string): string | null => {
  try {
    const names = fs.readdirSync(path.join(root, '.db-generations')).filter((n) => /^hologram-\d{8}-\d{6}\.db$/.test(n));
    return names.length ? names[0] : null;
  } catch {
    return null;
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

// 最初のバックアップの後にライブラリに現れるファイル。名前は何でもよい。重要なのは、
// ミラーがライブラリのルートで見つけたものを何であれ運ぶこと、そして後からのその場での
// 編集は再コピーを引き起こさない（書き込み一度きり）ことだ。
const LATE_FILE = 'late-arrival.json';
const lateFilePath = path.join(saveFolder, LATE_FILE);

(async () => {
  // 起動A: 保存フォルダの中に入れ子になった出力先は拒否されなければならない（重なり）。
  // その後run1（4件のシード投稿を新規コピー）とrun2（何も変わらない＝何度実行しても同じ）。
  const evalA = evalSource(
    async ({ waitFor }, args) => {
      const h = (window as any).hologram;
      // ライブラリがシードした投稿を返すことこそ、ここに以前あった400msが期待していた
      // ものだ＝データベースが開いていて8件すべてを持っていることであり、それを下の
      // run1が数える。
      await waitFor('the library to report the seeded posts', async () => ((await h.listPosts()).posts || []).length >= args.wantPosts);
      const bad = await h.setBackup({ dir: args.nestedDir });
      const overlapRejected = !!(bad && bad.ok === false && bad.error === 'overlap');
      const good = await h.setBackup({ dir: args.outDir });
      const dirSet = !!(good && good.backup && good.backup.dir);

      // 件数を決め打ちしない――メディアレーン自身の集計であるfileCountに対して
      // アサートする。1件多い書き込みはDBレーンの最初の世代（#233）で、同じ実行が
      // それを作って持ち越す。
      const r1 = await h.runBackup();
      const run1 = !!(r1 && r1.ok && r1.fileCount >= 8 && r1.written === r1.fileCount + 1 && r1.pruned === 0 && !r1.pruneSkipped);

      // 何度実行しても同じ――アセットは不変なので、コピーすべきものもプルーニングすべき
      // ものも新たに無い
      const r2 = await h.runBackup();
      const run2 = !!(r2 && r2.ok && r2.written === 0 && r2.pruned === 0 && !r2.pruneSkipped);

      return { overlapRejected, dirSet, run1, run2 };
    },
    { wantPosts: records.length, nestedDir: path.join(saveFolder, 'nested'), outDir },
  );
  const rA = await launch(evalA);

  // DBレーン（#301 / #233）: run1はSQLiteのバックアップAPIを通して、ライブラリ自身の
  // ストアに世代を書き込んでいなければならない――稼働中の（ここではツリー外にある）DB
  // ファイルの生コピーでは決してない――そして同じ世代を送り先まで運んでいなければ
  // ならない。
  const localGeneration = oneGeneration(saveFolder);
  let dbGenerationWritten = false;
  let dbGenerationCopied = false;
  if (localGeneration) {
    try {
      dbGenerationWritten = fs.statSync(path.join(saveFolder, '.db-generations', localGeneration)).size > 0;
    } catch {
      /* 無し→falseのまま */
    }
    dbGenerationCopied = fs.existsSync(path.join(backupDir, '.db-generations', localGeneration));
  }

  // 送り先は最初の1回目で凍結されてはいけない＝後から現れたファイルも次の実行で
  // ちゃんと拾われる。
  fs.writeFileSync(lateFilePath, JSON.stringify({ notes: ['A'] }, null, 2));

  const evalB = evalSource(async (_waits) => {
    const e1 = await (window as any).hologram.runBackup();
    const edit1 = !!(e1 && e1.ok && e1.written >= 1 && !e1.pruneSkipped);
    return { edit1 };
  });
  const rB = await launch(evalB);

  // その場で変更する。バックアップが運ぶものは書き込まれた後は何も変わらないので、
  // この後の実行は何もコピーしてはならない――書き込み一度きりは契約であって
  // 見落としではない（runBackupのコメント参照）。
  fs.writeFileSync(lateFilePath, JSON.stringify({ notes: ['A', 'B'] }, null, 2));

  const evalC = evalSource(
    async (_waits, args) => {
      const h = (window as any).hologram;
      const e2 = await h.runBackup();
      const writeOnce = !!(e2 && e2.ok && e2.written === 0 && !e2.pruneSkipped);
      const e3 = await h.runBackup();
      const editIdempotent = !!(e3 && e3.ok && e3.written === 0 && !e3.pruneSkipped);

      // 投稿を1件削除する→#233以降、送り先はファイルを削除するのではなく.trash/の下へ
      // MOVEする＝バックアップは保留中の削除を保留のままにしておく。削除が書くtrashの
      // サイドカーは新規なので、同じ実行がそれをコピーする。
      await h.deletePost(args.firstImage);
      const r3 = await h.runBackup();
      const trashMoved = !!(r3 && r3.ok && r3.moved === 1 && r3.pruned === 0 && !r3.pruneSkipped);

      // srcを崩壊させる（clear-allですべての投稿アセットを消す）→ガードは必ず
      // プルーニングを止め、送り先には触れないままにしなければならない。理由は
      // ルートに何が残っているかによってshrinkかemptyかが変わる。どちらも有効な
      // トリップだ。
      await h.clearAll();
      const r4 = await h.runBackup();
      const guardHeld = !!(r4 && r4.ok && r4.pruned === 0 && (r4.pruneSkipped === 'empty' || r4.pruneSkipped === 'shrink'));

      // 送り先のルートには、r3がそこに残したものがまだあるはずだ（ガードがすべての
      // 削除を止めたので）。r3.fileCountはメディアレーン全体を数えるので、.trash/の下に
      // 住む2件のエントリを差し引いてルート自身の件数を得る。
      return { writeOnce, editIdempotent, trashMoved, guardHeld, expectRoot: r3.fileCount - 2 };
    },
    { firstImage: ids[0] + '.jpg' },
  );
  const rC = await launch(evalC);

  const r = Object.assign({}, rA, rB, rC);

  // ファイルシステム側の検証: ガードが効いた崩壊の実行は、送り先をr3がしたのと
  // まったく同じ状態のまま残した（ファイルは1つも削除されていない）――プルーニングが
  // ディスク上で本当に止められたことの証拠。
  const rootAfter = countBackupRoot();
  const backupIntact = typeof r.expectRoot === 'number' && rootAfter === r.expectRoot;
  // trash移動のファイルシステム側の検証: ゴミ箱送りにした投稿のファイルは、送り先の
  // .trash/の下にあり、もうそのルートには無い。
  const trashedOnDisk = fs.existsSync(path.join(backupDir, '.trash', ids[0] + '.jpg')) && !fs.existsSync(path.join(backupDir, ids[0] + '.jpg'));
  // 書き込み一度きりのファイルシステム側の検証: 送り先のコピーは最初にコピーされた
  // 時点のファイル（1件のnote）を保持していて、後からのその場での編集は反映
  // されていない。
  let writeOnceOnDisk = false;
  try {
    const mj = JSON.parse(fs.readFileSync(path.join(backupDir, LATE_FILE), 'utf8'));
    writeOnceOnDisk = Array.isArray(mj.notes) && mj.notes.length === 1;
  } catch {
    /* 無し／読めない→falseのまま */
  }
  // clear-allのファイルシステム側の検証: #302以降ライブラリはメディア以外何も
  // 持たないので、全消去は正確に「すべての投稿アセットが消える」ことになる――
  // ルートに置かれた非メディアファイルはその管轄外であり、生き残らなければならない。
  let clearSweptAssets = false;
  try {
    const left = fs.readdirSync(saveFolder);
    clearSweptAssets = !left.some((f) => /\.jpe?g$/i.test(f)) && left.includes(LATE_FILE);
  } catch {
    /* 読めない→falseのまま */
  }
  // #233/#176: 送り先は自分が属するライブラリのidを運び、上の最初の実行がそれを
  // 採用した。そのidを見知らぬものへ書き換える――この送り先を設定したまま別の
  // ライブラリを開いたユーザーが到達する状態――と、次の実行は問答無用で拒否
  // しなければならない。ここではプルーニングガードは救ってくれない＝別のライブラリは
  // 「崩壊したソース」ではなく、単に別物であり、ミラーは喜んでこのバックアップを
  // そこまでプルーニングしてしまうからだ。
  const identityFile = path.join(backupDir, '.hologram-backup.json');
  const identityAdopted = fs.existsSync(identityFile);
  fs.writeFileSync(identityFile, JSON.stringify({ libraryId: 'another-library', lastRunAt: null }));
  const rootBeforeMismatch = countBackupRoot();
  const evalD = evalSource(async (_waits) => {
    const r = await (window as any).hologram.runBackup();
    return { mismatchRefused: !!(r && r.ok === false && r.error === 'library-mismatch') };
  });
  const rD = await launch(evalD);
  // 拒否は拒否を意味する＝何もコピーされず、何もプルーニングされず、主張自体にも
  // 手を付けない（拒否された実行は、黙って送り先を再び採用してしまってはならない）。
  let mismatchLeftAlone = false;
  try {
    mismatchLeftAlone = countBackupRoot() === rootBeforeMismatch && JSON.parse(fs.readFileSync(identityFile, 'utf8')).libraryId === 'another-library';
  } catch {
    /* 読めない→falseのまま */
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.overlapRejected && r.dirSet && r.run1 && r.run2 && r.edit1 && r.writeOnce && r.editIdempotent && writeOnceOnDisk && r.trashMoved && trashedOnDisk && r.guardHeld && backupIntact && clearSweptAssets && dbGenerationWritten && dbGenerationCopied && identityAdopted && rD.mismatchRefused && mismatchLeftAlone;
  console.log(
    `overlap=${r.overlapRejected} dirSet=${r.dirSet} run1=${r.run1} run2=${r.run2} lateFile=${r.edit1} writeOnce=${r.writeOnce} idem=${r.editIdempotent} writeOnceOnDisk=${writeOnceOnDisk} trashMoved=${r.trashMoved}/${trashedOnDisk} guard=${r.guardHeld} root=${rootAfter}/${backupIntact} clearSweptAssets=${clearSweptAssets} dbGeneration=${dbGenerationWritten}/${dbGenerationCopied} identity=${identityAdopted}/${rD.mismatchRefused}/${mismatchLeftAlone}`,
  );
  console.log(ok ? 'BACKUP_TEST_PASS' : 'BACKUP_TEST_FAIL');
  process.exit(ok ? 0 : 1);
})();
