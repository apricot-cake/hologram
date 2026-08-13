'use strict';

// このリポジトリの依存関係をインストールする。現在、上流の2つの問題により素の
// `npm install` だけでは動く tree ができない。それぞれを npm のフラグ1つで回避している。
// どちらのフラグも一時的なもので、どちらもハードコードしない＝インストール前に、この
// スクリプトが各フラグを必要とする条件をディスクから直接読み取り、インストール後に
// どれがまだ成立しているかを報告する。上流が直した日にはそのフラグは渡されなくなり、
// スクリプトがそう告げる＝誰も再確認しない回避策は、そのまま永続化する回避策になる。
//
// (1) --ignore-scripts — better-sqlite3 の gypfile:false はロックファイル駆動の
//   インストールには届かない（#510、#493 を差し戻す）
//   better-sqlite3 v13 はパッケージ内にビルド済みバイナリを同梱し
//   （prebuilds/<platform>-<arch>.node）、npm にソースからのコンパイルをさせない
//   ために package.json に `gypfile: false` を宣言している。ただしこの宣言が npm に
//   届くのはロックファイルなしの resolve のときだけ＝npm の arborist は
//   package-lock.json へ書き残す package.json のフィールドを固定の許可リストで管理
//   していて（@npmcli/arborist/lib/shrinkwrap.js の `pkgMetaKeys`）、`gypfile` は
//   そこに無い。このリポジトリは package-lock.json をコミットしているので、まっさらな
//   checkout での `npm install` は必ずロックファイル駆動になる＝better-sqlite3 の
//   解決済み記述子は `gypfile` を一切運ばず、npm は binding.gyp を同梱しつつ
//   install/preinstall スクリプトを持たないパッケージ向けの既定動作として、代わりに
//   node-gyp でのコンパイルを使う。それには Visual Studio が要るが、まっさらな開発機
//   には無いこともあり、無い場合はインストール全体が途中で止まる。
//
//   まっさらな worktree での直接の再現で確認済み（#510）: 展開済みの
//   node_modules/better-sqlite3/package.json は gypfile:false を持っているのに、素の
//   `npm install` は better-sqlite3 の `node-gyp rebuild` で失敗する＝古びて見える
//   `hasInstallScript: true` をロックファイルのエントリへ手で戻しても直らない。理由は、
//   そのフラグが開く唯一のコードパス（@npmcli/arborist/lib/arborist/rebuild.js の
//   `#addToBuildSet`、インストール済みパッケージの package.json を再読込する処理）が、
//   その再読込結果からメモリ上のノードへコピーするのは `scripts` だけで `gypfile` は
//   コピーしないから＝結局代わりに node-gyp を使う経路はやはり発火する。これが #493 の修正
//   （展開済みの package.json を確認して gypfile:false を正しく確認し、回避策はもう
//   不要と結論した）が持たなかった理由: その展開済みコピー自体が、すでに
//   --ignore-scripts を使ったインストールで展開されたものだったので、素のインストール
//   が成功することは何一つ証明できなかった。そもそもコンパイル自体が不要だった＝
//   better-sqlite3 のバイナリローダーは build/Release/ の有無に関わらず同梱の
//   prebuild を優先する。
//
//   このフラグは大味で、ルートパッケージの install スクリプトを全て無効化する。
//   そのため Electron のランタイムは下で明示的に復元している。拡張機能は別途
//   インストールされ、その `wxt prepare` は自身の postinstall 経由で走る。
//
//   現在これが抑止しているスクリプトのうち、このフラグが消える前に知っておく
//   価値があるものが1つある（#831）: onnxruntime-node の install ステップは
//   NuGet から CUDA 12 の execution provider をダウンロードする＝ただし
//   linux/x64 のときだけで、これはまさに CI が動いている環境。Windows が必要と
//   するものはすべて既に npm パッケージ内にあるので、--ignore-scripts を外す
//   ときは `--onnxruntime-node-install=skip` を添えるか、CI にかかるコストを
//   測るかのどちらかが要る。
//
// (2) --legacy-peer-deps — electron-vite の peer 範囲と vite 8 の衝突
//   electron-vite@5 は `peer vite: ^5 || ^6 || ^7` を宣言する一方、app/ は
//   vite 8 でビルドしているため、npm のリゾルバは tree を丸ごと拒否する。
//   vite 8 を受け入れる安定版 electron-vite はまだ無く（6.0.0 は beta のみ）、
//   `overrides` は peer 範囲を広げられないため、npm が公式に用意した抜け道が
//   唯一の手段になる。この違反は新しいものではない＝ロックファイルなしの
//   インストールは vite 8 が入って以来ずっと失敗しており、コミット済みの
//   ロックファイルが tree を支えていて、npm に再解決させる何かが起きた瞬間に
//   それが止まる。
//
//   node scripts/setup.cts

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

type Verdict = {
  needed: boolean;
  // なぜ（もう）必要なのか／不要なのかを、最終レポートが表示する言葉で。
  reason: string;
};

type Workaround = {
  flag: string;
  label: string;
  upstream: string;
  // null = まだ判定できない（読める対象がインストールされていない）。呼び出し側は
  // これを「まだ必要とみなす」として扱う: この方向に外すと未使用のフラグが残るだけで
  // 済むが、逆方向に外すとインストールが失敗するか中途半端な tree になる。
  check: () => Verdict | null;
};

function readJson(file: string): Record<string, any> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// パッケージのインストール済み package.json ではなく、ロックファイル自身の
// better-sqlite3 エントリを読む。前述の通り、npm の arborist は `gypfile` を
// package-lock.json へ決して書き残さない＝ロックファイルのエントリこそが、素の
// 無修正 `npm install` が実際に見るものであり、この検査が答えるべき対象そのもの。
// 代わりにインストール済みコピーを読む（#493 以前のこの検査がしていたこと、かつ
// その誤りの原因）のは、PACKAGE がまだオプトアウトしていることを証明するだけで、
// npm のロックファイル駆動インストールがそれを尊重することの証明にはならない＝
// その展開済みファイル自体が、すでに --ignore-scripts を使ったインストールで
// 置かれたものだったから。
//
// これは上流が本当のバグを直したか（npm が `gypfile` を書き残すようにするか、
// rebuild 検出の経路を別の形で作り直すか）は判定できない: それは npm 自身の
// コードの変更であって、package.json が宣言できる何かではない。そのため、この
// 検査が「もう不要」へ切り替わるのは、package-lock.json 自体が better-sqlite3
// について `gypfile:false` を運び始めたときだけ＝それが npm が変わったと
// 観測できる唯一の兆候。それまでは「必要」のまま。これはこのファイルの他の
// 箇所でも既定として代わりに使われている `check() → null` と同じ安全側の挙動。
function sqliteCheck(root: string = repoRoot): Verdict | null {
  const lock = readJson(path.join(root, 'package-lock.json'));
  const entry = lock?.packages?.['node_modules/better-sqlite3'];
  if (!entry) return null;
  if (entry.gypfile === false) {
    return { needed: false, reason: 'package-lock.json の better-sqlite3 エントリが gypfile:false を保持するようになりました＝npm がロックファイル駆動のインストールでもこの項を読むようになったということです' };
  }
  return {
    needed: true,
    reason: 'package-lock.json は better-sqlite3 の gypfile を保持しません＝ロックファイル駆動のインストールでは npm が node-gyp rebuild を既定にします（binding.gyp を同梱・install スクリプト無しのため）',
  };
}

// electron-vite が宣言する peer 範囲と、実際にインストールされている vite を比較する。
// ここではメジャー番号だけが問題になる: 範囲は caret 項の並びで、衝突は厳密に
// 「vite 8 が許可されたメジャーの中に無い」という話。認識できない範囲の形は
// 推測せず判定不能として報告する＝ここで誤って「もう不要」と判定すると、次の
// インストールが壊れる。
function peerCheck(root: string = repoRoot): Verdict | null {
  const ev = readJson(path.join(root, 'node_modules', 'electron-vite', 'package.json'));
  const vite = readJson(path.join(root, 'node_modules', 'vite', 'package.json'));
  if (!ev || !vite) return null;
  const range: string | undefined = ev.peerDependencies?.vite;
  const installedMajor = Number(String(vite.version).split('.')[0]);
  if (!range || !Number.isFinite(installedMajor)) return null;
  const allowed = [...range.matchAll(/\^(\d+)/g)].map((m) => Number(m[1]));
  if (!allowed.length) return { needed: true, reason: `electron-vite の peer 範囲（${range}）を判定できません＝安全側に倒して回避策を維持します` };
  if (allowed.includes(installedMajor)) {
    return { needed: false, reason: `electron-vite@${ev.version} の peer（${range}）が、使用中の vite ${vite.version} を受け入れます` };
  }
  return { needed: true, reason: `electron-vite@${ev.version} の peer は ${range}＝使用中の vite ${vite.version} を受け入れません` };
}

// ここでの全インストールに渡すもので、WORKAROUNDS の一部ではない: これらは
// 何かを回避しているわけではないので、生き延びるべき上流の問題も無い。`npm audit`
// はインストールのたびにレジストリへの往復コストがかかる＝app-tests の各シャードの
// 準備のうち7秒はルートのインストールだけで発生している（#967）＝しかもその判定を
// 読む者は誰もいない: 脆弱性は Dependabot のアラートとセキュリティアップデート経由で
// このリポジトリに届き、そちらはコミット済みのロックファイルを求められずとも見ている。
// `npm audit` はオンデマンドで実行しても同じ結果を返す。--no-fund は、読めるくらい
// 静かであることが仕事の全てであるスクリプトから出力の1行を削る。
const QUIET_FLAGS = ['--no-audit', '--no-fund'];

const WORKAROUNDS: Workaround[] = [
  { flag: '--ignore-scripts', label: 'better-sqlite3 の不要な node-gyp ビルド（ロックファイル駆動のインストールでは gypfile:false が届かない）', upstream: 'https://github.com/WiseLibs/better-sqlite3/issues/1503', check: sqliteCheck },
  { flag: '--legacy-peer-deps', label: 'electron-vite の peer 範囲と vite 8 の衝突', upstream: 'https://github.com/alex8088/electron-vite/releases', check: peerCheck },
];

// bridge.mts と同じ形: インストールが実行されるのはこのファイルが RUN されたとき
// だけ（末尾の require.main ガード参照）なので、テストは require() してプローブを
// フィクスチャの tree に対して動かせる。`export` ではなく `module.exports` を使う
// のは、.cts は中身が何であれ CommonJS であり、これは Node の型剥がしのもとで
// ビルドせず動くため＝ここに `export` 文を書くと消去可能な注釈ではなく実行時の
// 構文エラーになる。代償は、tsc がこの代入から export を一切読み取れないこと＝
// これがいくつかのスイートを scripts/tsconfig.test.json から外している理由。
// 直すなら native-host/ が #1052 で取った手段（.mts になる）であって、ここを
// 変えることではない。
module.exports = { sqliteCheck, peerCheck, WORKAROUNDS, decideFlags };

// 判定の集合が生むフラグ自体をテストが検査できるよう切り出した＝判定そのものだけ
// ではない。「判定不能」はここでは「まだ必要」と同じに振る舞わなければならない。
function decideFlags(verdicts: (Verdict | null)[]): string[] {
  return WORKAROUNDS.filter((_w, i) => verdicts[i] === null || verdicts[i]?.needed).map((w) => w.flag);
}

// npm は Windows ではシェルを経由しなければならない（そのエントリポイントは
// npm.cmd で、Node はシェルなしに .cmd を spawn しない）。コマンド全体をコマンド +
// 引数配列ではなく1本の文字列として渡す: shell:true のもとでの配列形式は
// DEP0190 を発火させるもので、それは読めるくらい静かであることが仕事の全てである
// スクリプトの出力に、セキュリティの非推奨通知を混ぜてしまう。
function run(command: string, cwd: string) {
  console.log(`\n$ ${command}${cwd === repoRoot ? '' : `   (${path.relative(repoRoot, cwd)})`}`);
  execFileSync(command, { cwd, stdio: 'inherit', shell: true });
}

function main() {
  // 前回のインストールの判定が、今回のインストールのフラグを選ぶ。
  const flags = decideFlags(WORKAROUNDS.map((w) => w.check()));

  run(['npm install', ...flags, ...QUIET_FLAGS].join(' '), repoRoot);

  // extension/ は自分のロックファイルを持つ別の npm プロジェクト（意図的に＝
  // 独立した WXT ビルドのため）なので、ルートのインストールではカバーされない。
  // まっさらな worktree ではこれが無いと拡張機能のビルドと型検査の両方が失敗する。
  // 自身の postinstall が `wxt prepare` を走らせ、tsconfig が extend する .wxt/ の
  // 型を生成する。自身の tree には peer の衝突が無いので、上の回避策フラグは
  // どれも取らない＝ここでの全インストールが受け取る静音フラグだけ。
  const extDir = path.join(repoRoot, 'extension');
  run(['npm install', ...QUIET_FLAGS].join(' '), extDir);

  // 3つのスイートがビルド済みの拡張機能バンドル（capture.js、resident.js）を
  // ディスクから直接読むため、これを実行するまでは新規インストールした tree で
  // `npm test` が失敗する。各スイートに自前でビルドさせるのではなくここでビルド
  // することで、コストをスイートごとではなく setup ごとの1回に抑える。
  run('npm run build:ext', repoRoot);

  // リポジトリが git hooks を置いている場所（#732）。そのうちの1つは、マージ済みの
  // 拡張機能を日常使いの Chrome へ昇格させる＝これが唯一、作者が使うブラウザを
  // 実際に取り込まれたコードの上に保つ手段。誰も有効化していない hook は動いている
  // ように見えて、静かに何もしない。
  console.log('\n$ git config core.hooksPath .githooks');
  try {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repoRoot, stdio: 'inherit' });
  } catch {
    console.log('  (not a git checkout — skipped)');
  }

  // electron が公開している package.json には postinstall スクリプトが無い
  // （固定しているまさにそのバージョン 43.2.0 で確認済み＝レジストリのマニフェスト
  // も展開済みの tarball もどちらも宣言していない）ので、ルートのインストールに
  // --ignore-scripts を渡したかどうかに関わらず、上の処理は electron の約225MB の
  // ランタイムを一切ダウンロードしない＝この呼び出しは常設の要件であって、
  // あのフラグの巻き添え修理ではない。install.js は、もし electron に postinstall
  // があったなら electron 自身が走らせるのと同じファイル。直接呼ぶ必要が毎回ある。
  const electronExe = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
  const electronInstaller = path.join(repoRoot, 'node_modules', 'electron', 'install.js');
  if (!fs.existsSync(electronExe) && fs.existsSync(electronInstaller)) {
    // `npm rebuild electron` ではない: それは「rebuilt dependencies successfully」
    // と報告しつつ何もダウンロードせず、実行ファイルが無いまま成功したように見える。
    console.log('\n$ node node_modules/electron/install.js');
    execFileSync(process.execPath, [electronInstaller], { cwd: repoRoot, stdio: 'inherit' });
  }

  // インストール後に読み直し、レポートが今存在する tree を説明するようにする。
  console.log('');
  const resolved: Workaround[] = [];
  const remaining: string[] = [];
  for (const w of WORKAROUNDS) {
    const v = w.check();
    if (v && !v.needed) {
      resolved.push(w);
      console.log('='.repeat(72));
      console.log(`上流が修正されました。${w.flag} はもう要りません。`);
      console.log(`  ${v.reason}`);
      console.log(`  ${w.upstream}`);
      console.log('='.repeat(72));
    } else if (v) {
      remaining.push(`${w.flag}（${w.label}）`);
    } else {
      remaining.push(`${w.flag}（${w.label}・判定不能のため維持）`);
    }
  }
  if (resolved.length === WORKAROUNDS.length) {
    console.log('');
    console.log('回避策は全て不要になりました。scripts/setup.cts と package.json の "setup"、');
    console.log('docs/開発ガイド.md の該当節を削除し、素の npm install へ戻してください。');
  } else if (resolved.length) {
    console.log('');
    console.log(`該当のフラグを scripts/setup.cts と docs/開発ガイド.md から外してください。残りは ${remaining.join(' / ')}。`);
  } else {
    console.log(`完了。今回も必要だった回避策: ${remaining.join(' / ')}`);
  }
}

if (require.main === module) main();
