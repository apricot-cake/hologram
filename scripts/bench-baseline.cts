'use strict';

// #5（SQLiteを正本にする）の性能ハーネス＝#293 St0 として作られ、常設の計測ツール
// として維持されている。
//
// ヘッドレスで（Electron無しで）動作し、scripts/gen-dummy-library.cts（#175）が
// 生成したライブラリ、または任意の実際の保存フォルダ＋データベースを対象にする。
//
// BEFOREの数値（このハーネスが置き換えたsidecar/lib-indexのスキャン）は#5の
// 2026-07-23のコメントに記録されており、そのコードがまだ存在していたコミット
// 3c6d118cから再現できる。このハーネスはもうsidecarアダプタを持たない: #302が
// そのスキャンを削除しており、それを再計測するためだけにここでコピーを生かしておく
// ことは、まさに#302が取り除こうとした残り物そのものになってしまう。
//
// 計測するシナリオ（#293本文）:
//   cold        — データベースを新規に開いて全投稿を読む（アプリの起動）
//   warm        — 同じ読み取りを既に開いているハンドルに対して行う（更新）＝再構築
//                 すべきディスク上の索引が無いので、coldとwarmが一致することそのものが
//                 求める結果
//   incremental — writePost経由で投稿の一部を書き換える（captureの着地）
//   search      — 実際のクエリエンジン（app/src/renderer/src/services/query.ts +
//                 search.ts）による代表的な自由文/タグ/プラットフォームファセット/
//                 AND結合クエリ
//   facets      — facetCounts()のバケット集計（app/src/renderer/src/services/facets.ts）
//                 比較対象となるDBネイティブの経路）
//   ipc         — 投稿配列全体のv8.serialize()/deserialize()（Electronの
//                 contextBridge/ipcRendererはJSONではなくV8の構造化クローン
//                 アルゴリズムを使う＝v8.serializeなら同じワイヤフォーマットと
//                 実際のバイト長が得られる。JSON.stringify().lengthでは得られない）
//
// 手法（2026-07-22のissueコメント＝BenchmarkDotNet Good Practices、Google Benchmark
// のreducing_variance.md、JMH、hyperfine、Criterionを引用）:
//   - 数値は同一の記録内でのみ比較可能（同じマシン、同じ負荷状態）＝マシン間・
//     実行間で差分を取ってはならない。まさにこの理由で、environmentは毎回の
//     レポートに記録する。before/afterの差分は、environmentブロックが一致する
//     2つのレポートを使わなければならない。
//   - ウォームアップの反復は実行して捨ててから計測の反復に入る（JIT/OSの
//     ファイルキャッシュ/GCを落ち着かせる）＝回数は隠さず明示的なCLIパラメータに
//     している。
//   - 既知の制約: ここでの「cold」は新規のデータベースハンドルを意味する＝
//     素のNodeからOSのページキャッシュを落とす、移植可能で非特権な方法は無い
//     （hyperfineの--prepareはこのハーネスには無いプラットフォーム固有ツールへ
//     シェルアウトする）。実行をまたぐディスクキャッシュの状態は、このハーネスが
//     制御できない実際の分散要因である＝黙って無視した抜け穴ではなく、文書化
//     した既知の限界。
//   - 外れ値は報告する（min/max）が、決して捨てない＝maxが平均の2倍を超えると
//     警告が出る。
//
//   node scripts/bench-baseline.cts <libraryDir> [options]
//
// オプション:
//   --db FILE              計測対象のデータベース（既定 <libraryDir>/hologram.db）
//   --warmup N             計測前に捨てる反復回数（既定 2）
//   --iterations N         シナリオごとの計測反復回数（既定 5）
//   --incremental-pct N    incrementalシナリオで書き換える投稿の割合（既定 1）
//   --out FILE             JSONレポートをFILEにも書き出す
//   --generator-hash HASH  記録する#175ジェネレーターの識別子をそのまま指定（任意。
//                          このハーネスはライブラリ内容のハッシュも自前で計算する
//                          （レポートの"generator"参照）ので、これは唯一の来歴検査
//                          ではなく補足）

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const v8 = require('node:v8');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { openDatabase } = require('../app/src/main/lib-db.ts');
const { postsByIds, postsFromDb } = require('../app/src/main/lib-db-query.ts');
const { makeTagResolver, preparePostStmts, writePost } = require('../app/src/main/lib-db-record-writer.ts');

function parseArgs(argv) {
  const opts = { warmup: 2, iterations: 5, incrementalPct: 1, out: null, generatorHash: null, libraryDir: null, db: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--warmup') opts.warmup = Number(rest[++i]);
    else if (a === '--iterations') opts.iterations = Number(rest[++i]);
    else if (a === '--incremental-pct') opts.incrementalPct = Number(rest[++i]);
    else if (a === '--out') opts.out = rest[++i];
    else if (a === '--generator-hash') opts.generatorHash = rest[++i];
    else if (a === '--db') opts.db = rest[++i];
    else if (a.startsWith('--')) throw new Error(`不明なオプション: ${a}`);
    else if (!opts.libraryDir) opts.libraryDir = a;
    else throw new Error(`予期しない引数: ${a}`);
  }
  if (!opts.libraryDir) throw new Error('<libraryDir> がありません。使い方: node scripts/bench-baseline.cts <libraryDir> [--db FILE] [--warmup N] [--iterations N] [--incremental-pct N] [--out FILE] [--generator-hash HASH]');
  if (!Number.isFinite(opts.warmup) || opts.warmup < 0) throw new Error('--warmup は 0 以上でなければなりません');
  if (!Number.isFinite(opts.iterations) || opts.iterations < 1) throw new Error('--iterations は 1 以上でなければなりません');
  return opts;
}

// --- 計測の基本操作: ウォームアップは捨て、N回計測し、統計と外れ値警告を報告する。
async function measure(name: string, fn: () => Promise<{ ms: number; extra?: any }>, { warmup, iterations }: { warmup: number; iterations: number }) {
  for (let i = 0; i < warmup; i++) await fn();
  const values: { ms: number; extra?: any }[] = [];
  for (let i = 0; i < iterations; i++) values.push(await fn());
  const ms = values.map((v) => v.ms);
  const min = Math.min(...ms);
  const max = Math.max(...ms);
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  const warn = max > mean * 2 ? `外れ値: max ${max.toFixed(1)}ms が平均 ${mean.toFixed(1)}ms の2倍を超えている（捨てずそのまま表示）` : null;
  return { name, warmup, iterations, msValues: ms, min, max, mean, warning: warn, extra: values[values.length - 1].extra };
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

// --- 計測対象: ライブラリ自身のデータベース ---------------------------------
// coldScanは新規のハンドルを開き（起動）、warmScanは既に開いているものを再利用する
// （更新）。どちらもpostsFromDb経由で全投稿を読む＝これはindex.tsのlistPosts()/
// listPostsDelta()がしていることそのもの。途中でディスクから再導出するものは
// 何も無い: それこそが#302が計測した変化。
let _handle: any = null;
function closeHandle() {
  if (_handle) {
    try {
      _handle.sqlite.close();
    } catch {
      /* 既に閉じている */
    }
    _handle = null;
  }
}
async function coldScan(dbFile: string) {
  closeHandle();
  const t0 = nowMs();
  _handle = openDatabase(dbFile);
  const posts = await postsFromDb(_handle.sqlite);
  return { posts, ms: nowMs() - t0 };
}
async function warmScan() {
  const t0 = nowMs();
  const posts = await postsFromDb(_handle.sqlite);
  return { posts, ms: nowMs() - t0 };
}

// 共有ライターを通じて投稿の`pct`%を書き換える＝captureの着地と同じ作業
// （posts + media + post_tags + FTS5の行）。書き換えがスタブではなく実際の内容を
// 運ぶよう、先に読み戻す。触れたidを返す。
async function rewritePosts(sqlite: any, ids: string[], pct: number) {
  const n = Math.max(1, Math.round((ids.length * pct) / 100));
  const step = Math.max(1, Math.floor(ids.length / n));
  const picked: string[] = [];
  for (let i = 0; i < ids.length && picked.length < n; i += step) picked.push(ids[i]);
  const records = await postsByIds(sqlite, picked);
  const stmts = preparePostStmts(sqlite);
  const resolveTagId = makeTagResolver(sqlite);
  const t0 = nowMs();
  sqlite.exec('BEGIN');
  for (const rec of records) writePost(stmts, resolveTagId, rec);
  sqlite.exec('COMMIT');
  return { ms: nowMs() - t0, touched: picked.length };
}

// --- environment + generatorの来歴 ---
function gitRevOf(file) {
  try {
    return execFileSync('git', ['log', '-1', '--format=%H', '--', file], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

function environmentInfo() {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    cpuModel: cpus[0] ? cpus[0].model : null,
    cpuCount: cpus.length,
    totalMemGB: +(os.totalmem() / 1073741824).toFixed(1),
    nodeVersion: process.version,
    repoCommit: gitRevOf('.') || null,
  };
}

// 生成されたライブラリの実際のバイト（ソート済みファイル名＋内容）をハッシュする。
// これにより、後から基準値を「これは本当に同じデータだったか」と照合できる＝
// #175には--validateオプションが無く（2026-07-22のコメント）、このハーネスは
// seed/countだけを信用せず自前で内容のハッシュを取る（同じCLI引数のままでも
// ジェネレーターの変更が出力バイトを変えることはある）。
function libraryContentHash(dir) {
  const names = fs
    .readdirSync(dir)
    // データベースは意図的に除外する: incrementalシナリオがそこへ書き込むため、
    // それをハッシュすると、同じ生成ライブラリに対する同じハーネスの2回の実行間で
    // 来歴の数値が変わってしまう。
    .filter((f) => !/\.db(-wal|-shm)?$/i.test(f) && fs.statSync(path.join(dir, f)).isFile())
    .sort();
  const h = crypto.createHash('sha256');
  for (const f of names) {
    h.update(f);
    h.update(fs.readFileSync(path.join(dir, f)));
  }
  return { hash: h.digest('hex'), fileCount: names.length };
}

// --- search / facetsのシナリオ: 手で選んだ定数ではなく、実際のデータから代表的な
// クエリを選ぶ＝どの規模/seedでもハーネスが意味を持ち続けるように。 ---
function pickRepresentative(posts: any[]) {
  const tagFreq = new Map();
  const platFreq = new Map();
  const words: string[] = [];
  for (const p of posts) {
    for (const t of p.tags || []) tagFreq.set(t, (tagFreq.get(t) || 0) + 1);
    platFreq.set(p.platform || '__none', (platFreq.get(p.platform || '__none') || 0) + 1);
    if (p.text && words.length < 5000) {
      const w = String(p.text)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((x) => x.length >= 3);
      if (w.length) words.push(w[0]);
    }
  }
  const topTag = [...tagFreq.entries()].sort((a, b) => b[1] - a[1])[0];
  const topPlat = [...platFreq.entries()].sort((a, b) => b[1] - a[1])[0];
  const word = words.length ? words[Math.floor(words.length / 2)] : null;
  return { tag: topTag ? topTag[0] : null, platform: topPlat ? topPlat[0] : null, textTerm: word };
}

async function runSearchAndFacets(posts: any[], opts: { warmup: number; iterations: number }) {
  const Q = await import(pathToFileURL(path.join(__dirname, '..', 'app', 'src', 'renderer', 'src', 'services', 'query.ts')).href);
  const F = await import(pathToFileURL(path.join(__dirname, '..', 'app', 'src', 'renderer', 'src', 'services', 'facets.ts')).href);

  const rep = pickRepresentative(posts);
  const predOf = Q.makePostPredOf({ isInFolder: () => false });

  const results: Record<string, any> = {};
  const scenarios: [string, any][] = [];
  if (rep.tag) scenarios.push(['tag:' + rep.tag, { kind: 'cond', type: 'tag', value: rep.tag }]);
  if (rep.platform) scenarios.push(['platform:' + rep.platform, { kind: 'cond', type: 'platform', value: rep.platform }]);
  if (rep.tag && rep.platform)
    scenarios.push([
      'platform+tag AND',
      {
        kind: 'group',
        op: 'and',
        neg: false,
        children: [
          { kind: 'cond', type: 'platform', value: rep.platform },
          { kind: 'cond', type: 'tag', value: rep.tag },
        ],
      },
    ]);

  for (const [label, leaf] of scenarios) {
    results[label] = await measure(
      label,
      async () => {
        const t0 = nowMs();
        let hits = 0;
        for (const p of posts) if (Q.evalNode(leaf, p, predOf)) hits++;
        return { ms: nowMs() - t0, extra: { hits } };
      },
      opts,
    );
  }

  // facetCounts — ライブラリ全体に対するバケット集計（サイドバーのファセットパネルの形）。
  const facetDeps = {
    getFilteredPosts: () => posts,
    allPosts: () => posts,
    qHasValue: () => false,
    posterQHasValue: () => false,
    hostOf: Q.hostOf,
    userKey: Q.userKey,
    t: () => '',
    PF_NAME: {},
    tagGroupOf: () => undefined,
    multiOnly: () => false,
    posterTagsOf: () => [],
    filteredPosters: () => [],
    posterFilterVocab: () => [],
    namedPosters: () => [],
    posterFolders: () => [],
    buildUsers: () => [],
  };
  const { facetCounts } = F.makeFacets(facetDeps);
  results['facets:platform'] = await measure(
    'facets:platform',
    async () => {
      const t0 = nowMs();
      const m = facetCounts((p) => p.platform || '__none');
      return { ms: nowMs() - t0, extra: { buckets: m.size } };
    },
    opts,
  );
  results['facets:tag'] = await measure(
    'facets:tag',
    async () => {
      const t0 = nowMs();
      const m = facetCounts((p) => p.tags);
      return { ms: nowMs() - t0, extra: { buckets: m.size } };
    },
    opts,
  );

  return { representative: rep, results };
}

// --- IPC相当のシナリオ: node:v8の構造化クローンserialize/deserialize —
// Electronのcontext​Bridge/ipcRendererが使うのと同じアルゴリズムなので、ここでの
// バイト長とタイミングは実際のIPCコストを近似する（JSON.stringify().lengthでは
// 近似にならない: ワイヤフォーマットもサイズも異なるため）。 ---
function runIpcScenario(posts: any[], opts: { warmup: number; iterations: number }) {
  return measure(
    'ipc:v8-serialize-roundtrip',
    async () => {
      const t0 = nowMs();
      const buf = v8.serialize(posts);
      const back = v8.deserialize(buf);
      const ms = nowMs() - t0;
      return { ms, extra: { bytes: buf.length, postsRoundTripped: back.length } };
    },
    opts,
  );
}

async function main() {
  const opts = parseArgs(process.argv);
  const dir = path.resolve(opts.libraryDir);
  if (!fs.existsSync(dir)) throw new Error(`libraryDir が見つかりません: ${dir}`);

  const dbFile = path.resolve(opts.db || path.join(dir, 'hologram.db'));
  if (!fs.existsSync(dbFile)) throw new Error(`データベースが見つかりません: ${dbFile}（scripts/gen-dummy-library.cts で生成するか、--db を指定してください）`);
  console.log(`bench-baseline: ${dir}  db=${dbFile}  warmup=${opts.warmup} iterations=${opts.iterations}`);

  const report: Record<string, any> = {
    environment: environmentInfo(),
    generator: { hashArg: opts.generatorHash, library: libraryContentHash(dir), generatorScriptCommit: gitRevOf('scripts/gen-dummy-library.cts') },
    params: { warmup: opts.warmup, iterations: opts.iterations, incrementalPct: opts.incrementalPct },
    db: dbFile,
    scenarios: {},
  };

  // cold — 計測する各反復がデータベースをゼロから開く。
  let lastColdPosts: any = null;
  report.scenarios.cold = await measure(
    'cold',
    async () => {
      const r = await coldScan(dbFile);
      lastColdPosts = r.posts;
      return { ms: r.ms, extra: { postCount: r.posts.length } };
    },
    opts,
  );

  // warm — 直前のcold反復が開いたままにしたハンドルに対して同じ読み取りを行う。
  report.scenarios.warm = await measure(
    'warm',
    async () => {
      const r = await warmScan();
      return { ms: r.ms, extra: { postCount: r.posts.length } };
    },
    opts,
  );

  // incremental — ライブラリの一部を書き換える。captureの着地1回ぶんの作業。
  const allIds = lastColdPosts.map((p: any) => p.captureId);
  report.scenarios.incremental = await measure(
    'incremental',
    async () => {
      const r = await rewritePosts(_handle.sqlite, allIds, opts.incrementalPct);
      return { ms: r.ms, extra: { touchedCount: r.touched } };
    },
    opts,
  );

  const { representative, results: searchResults } = await runSearchAndFacets(lastColdPosts, opts);
  report.searchRepresentative = representative;
  report.scenarios = { ...report.scenarios, ...searchResults };
  report.scenarios.ipc = await runIpcScenario(lastColdPosts, opts);

  for (const [name, s] of Object.entries(report.scenarios as Record<string, any>)) {
    const w = s.warning ? `  ⚠ ${s.warning}` : '';
    console.log(`  ${name.padEnd(22)} min=${s.min.toFixed(1)}ms mean=${s.mean.toFixed(1)}ms max=${s.max.toFixed(1)}ms${w}`);
  }

  closeHandle();

  const json = JSON.stringify(report, null, 2);
  if (opts.out) {
    fs.writeFileSync(opts.out, json);
    console.log(`レポートを ${opts.out} に書き出しました`);
  }
  console.log(json);
}

main().catch((err) => {
  process.stderr.write(`bench-baseline: ${err.stack || err.message}\n`);
  process.exit(1);
});
