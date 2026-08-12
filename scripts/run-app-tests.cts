'use strict';
// アプリテストの集約役: 実際のアプリまたは実際のブラウザを起動するテスト
// スクリプトをすべて実行し、1つでも失敗すれば0以外で終了する。3つの系統が
// ここに住んでいる —
//
//   test-app-*.cts        実際の Electron メインプロセスと、それが立ち上げる
//                         レンダラー
//   e2e-extension-*.cts   ビルド済み拡張機能を読み込んだ実際の Chromium。
//                         使い捨ての Native Messaging ホストと話す
//   e2e-overlay-*.cts     同じブラウザの仕掛けで、タイムラインのホバー
//                         コントロールを駆動する
//
// — そしてどれも「重い」（1つ1つが実プロセス）ので、これらはどれも npm
// test（Vitest＝純粋な単体テスト）の一部ではない。マイルストーンで実行する
// こと（feedback-verify-batch-at-milestones）。例えばレンダラーの再構成の後
// など、npm test には見えない静かな腐敗を捕まえるために（2026-07-02 の
// React island 移行では、これらのうち5本が誰にも気付かれずレッドのまま
// 残っていた）。
//
// スクリプトは lib-test-pool.cts の共有プール経由で、数本ずつ「並行」に
// 実行される（ハーネスの分は #933、ブラウザ層の分は #968）。互いの間で
// 共有されるものは何も無い — どのスクリプトも自前の mkdtemp サンドボックス
// を作り（ハーネスには HOLOGRAM_CONFIG_DIR、ブラウザテストには使い捨ての
// Chrome プロファイルとプロセスごとの Native Messaging ホスト名）、必要なら
// OS に空きポートを求め、隠すか headless で起動する — つまり競合する資源は
// マシンそのものだけ。
//
// 全部実行:         node scripts/run-app-tests.cts
// 一部だけ実行:      node scripts/run-app-tests.cts tabs search extension-orphan
// シャード実行:      node scripts/run-app-tests.cts --shard=1/2      (CI がやること)
// 並行数を上書き:    APP_TESTS_JOBS=1 node scripts/run-app-tests.cts

const fs = require('node:fs');
const path = require('node:path');
const { runPool } = require('./lib-test-pool.cts');

// CI ランナー（4 vCPU / 17GB windows-latest）でハーネス系統をフルに37回実行
// して計測（数値は #933 を参照）。4 は 1..4 の中で最速（中央値78秒、逐次実行の
// 257秒に対して）かつ最も安定していた（70〜82秒、3の時の85〜115秒に対して）。
// しかも最も遅い単体スクリプトを動かさない（4の時24.0秒、3の時24.3秒）—
// これが重要なのは、各ハーネスがアプリ自身のレンダラー内60秒の受け皿
// （app/src/main/index.ts）を持っていて、混んだマシンはそこを食いつぶすため
// （#818、単体テストスイートの同じ失敗モードについては #514）。6と8も計測
// したが、約15秒余分に稼ぐだけで、それぞれ3回の実行しかしていない: その
// マージンを使うには十分ではない。#968 はここにブラウザ系統を加える前に、
// 混成の集合（Electron と Chromium 一緒）に対して同じ数値を再計測している。
const DEFAULT_JOBS = 4;
// 止まった子プロセスから守る。値が2つあるのは、何を「止まった」とみなすかが
// 違うため: ハーネスのアプリ内 smoke の受け皿は60秒だが、ブラウザテストは
// 最大45秒の実際の保存タイムアウトを待ち、それを1本のスクリプトの中で何度も
// 行う — なので同じ120秒でも、そちらでは健全な実行の予算の「内側」であって
// 「外側」ではない。
const HARNESS_TIMEOUT_MS = 120000;
const BROWSER_TIMEOUT_MS = 240000;

const files = fs.readdirSync(__dirname).sort();
// 列挙するのではなく発見する。新しいスクリプトは存在するだけで CI に加わる —
// 例外リストは無い。#972 が最後の1つを閉じたため（hostile-css と
// banner-layout は一度も app-tests.yml に入っていなかったが、それは単に
// これらが書かれた当時ワークフローが e2e のステップを手で列挙していたから
// であって、外しておくと誰かが決めたわけではなかった）。ブラウザ系統を
// 先に置くのは時間がかかるものだからで、長いものから先に配ることでプール化
// された実行の末尾を短く保てる。`e2e-capture-test.cts` はあえてどちらの
// パターンにもマッチしない: それは実際のプラットフォームを読むので、
// ランナー上ではログイン画面を報告することしかできない（docs/テスト.md）。
const all = [
  ...files.filter((f: string) => /^e2e-(extension|overlay)-.*\.cts$/.test(f)).map((f: string) => ({ file: path.join(__dirname, f), name: f, timeoutMs: BROWSER_TIMEOUT_MS })),
  ...files.filter((f: string) => /^test-app-.*\.cts$/.test(f)).map((f: string) => ({ file: path.join(__dirname, f), name: f, timeoutMs: HARNESS_TIMEOUT_MS })),
];

const tokens: string[] = [];
let shard: { index: number; total: number } | null = null;
for (const arg of process.argv.slice(2)) {
  const match = /^--shard=(\d+)\/(\d+)$/.exec(arg);
  if (match) {
    shard = { index: Number(match[1]), total: Number(match[2]) };
    if (shard.index < 1 || shard.index > shard.total) {
      console.error(`--shard=i/n は 1 <= i <= n でなければならない (got ${arg})`);
      process.exit(2);
    }
    continue;
  }
  if (arg.startsWith('-')) {
    console.error(`未知のオプション ${arg}`);
    process.exit(2);
  }
  tokens.push(arg);
}

// トークンはファイル名そのものか、その特徴的な中間部分のどちらか。
const matches = (name: string, token: string) => name === token || name === `test-app-${token}.cts` || name === `e2e-${token}.cts`;
let picked = tokens.length ? all.filter((s) => tokens.some((t) => matches(s.name, t))) : all;
if (!picked.length) {
  console.error(`一致するスクリプトが無い (have: ${all.map((s) => s.name).join(', ')})`);
  process.exit(2);
}
const total = picked.length;
// 連続した切り出しではなくラウンドロビン: 系統は順序どおりに並んでいるので、
// 切り出すと1つのシャードにブラウザテストが全部集まってしまう。n個おきに
// 取ることで、誰も所要時間の表を保守しなくても長いものを均等にばらまける。
// プール自身のワークスティーリングが、シャードの中に残ったものをさらに
// ならしてくれる。
if (shard) {
  const s = shard;
  picked = picked.filter((_, i) => i % s.total === s.index - 1);
  if (!picked.length) {
    console.error(`シャード ${s.index}/${s.total} が空 — スクリプトは全部で${total}本しかない`);
    process.exit(2);
  }
}

const jobsEnv = process.env.APP_TESTS_JOBS;
const jobs = jobsEnv === undefined ? DEFAULT_JOBS : Number(jobsEnv);
if (!Number.isInteger(jobs) || jobs < 1) {
  console.error(`APP_TESTS_JOBS は正の整数でなければならない (got ${JSON.stringify(jobsEnv)})`);
  process.exit(2);
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const scope = shard ? `${total}本中${picked.length}本、シャード ${shard.index}/${shard.total}` : `${picked.length}本`;
  console.log(`run-app-tests: ${scope}、${jobs}本ずつ`);
  const failed = await runPool(picked, jobs);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (failed.length) {
    // 最後の行でもう一度名指しする: 25本のシャードでは1本ごとの行はログの
    // ずっと上にあり、読み手が最初に目にするのはこちら（#829）。
    console.error(`FAIL run-app-tests: ${picked.length}本中${failed.length}本がレッド (${elapsed}s): ${failed.map((s) => s.name).join(', ')}`);
    process.exit(1);
  }
  console.log(`PASS run-app-tests: ${picked.length}本すべてグリーン (${elapsed}s)`);
}

main();
