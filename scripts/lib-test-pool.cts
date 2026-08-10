'use strict';

// app-tests スイートがそのスクリプトを流す、上限付きワーカープール。
//
// #933 が42本の Electron ハーネス向けにこれを書いた（1つの逐次ステップとして
// それらはワークフローの49%を占めていた）。#968 は拡張機能・オーバーレイの
// ブラウザテストを、2本目のプールを書くのではなく同じプールへ移した。これで
// 並行数はただ1箇所で決まり、層をまたいでずれることが無くなる。
//
// どのエントリも自前のサンドボックスへ実際の Electron または Chromium を
// 起動する独立した node スクリプトなので、プール全体の仕事は N本を同時に
// 空中に保つことと、レッドになった実行を読めるままにすること（#829）:
// 出力は子プロセスごとにバッファされ、元の順序で印字され、決して混ざらない。

const { spawn } = require('node:child_process');

interface PoolScript {
  // 実行するスクリプトへの絶対パス。
  file: string;
  // レポートがそれを呼ぶ名前 — ファイル名で、読み手が grep する対象。
  name: string;
  // 止まった子プロセスから守る。プール単位ではなくスクリプト単位にしてある
  // のは、何を「止まった」とみなすかが系統ごとに違うため。一覧は
  // run-app-tests.cts を参照。
  timeoutMs: number;
}

interface PoolResult {
  ok: boolean;
  ms: number;
  output: string;
  note: string;
}

function runOne(script: PoolScript, results: (PoolResult | null)[], i: number): Promise<void> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // stdin はパイプではなく /dev/null: そうしないと、それを自分のブラウザへ
    // 引き継ぐスクリプトが、誰も書き込まない開いたストリームの上に座って
    // しまう。
    const child = spawn(process.execPath, [script.file], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: script.timeoutMs,
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      output += d;
    });
    child.stderr.on('data', (d: string) => {
      output += d;
    });
    child.on('error', (err: Error) => {
      results[i] = { ok: false, ms: Date.now() - t0, output, note: `スクリプトを実行できなかった: ${err.message}` };
      resolve();
    });
    child.on('close', (code: number | null, signal: string | null) => {
      if (results[i]) return; // 'error' がすでにこれに答えている
      results[i] = {
        ok: code === 0,
        ms: Date.now() - t0,
        output,
        note: signal ? `${script.timeoutMs / 1000}秒後に強制終了された (${signal})` : '',
      };
      resolve();
    });
  });
}

function report(script: PoolScript, result: PoolResult): void {
  console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${script.name} (${(result.ms / 1000).toFixed(1)}s)`);
  if (result.ok) return;
  if (result.note) console.log(`     ${result.note}`);
  // 末尾だけだと、複数の検証を持つスクリプトの FAIL 行が切り詰められて
  // しまう（#829）: すべての `FAIL <check>` 行に加えて最後の15行を、元の
  // 順序のまま、重複無く保つ。
  const lines = result.output.trim().split(/\r?\n/);
  const tailStart = Math.max(0, lines.length - 15);
  const kept = lines.filter((line, n) => /^\s*FAIL/.test(line) || n >= tailStart);
  console.log(kept.join('\n').replace(/^/gm, '     '));
}

// すべてのスクリプトを、一度に最大 `jobs` 本まで実行し、失敗したものを返す。
// スクリプトは渡された順序で配られるので、呼び出し元が最長のものを先に
// 置けば実行の末尾は短く保たれる。
async function runPool(scripts: PoolScript[], jobs: number): Promise<PoolScript[]> {
  const results: (PoolResult | null)[] = new Array(scripts.length).fill(null);
  let next = 0;
  let printed = 0;
  // ワーカーはリストから次の添字を取り、完了のたびに、先頭から連続して
  // 埋まった分だけが印字される — だから速いスクリプトが、自分の後ろに
  // 並んでいた遅いスクリプトを追い越すことは無く、それでも出力は実行の
  // 進行に合わせて現れる。
  const worker = async () => {
    while (next < scripts.length) {
      const i = next++;
      await runOne(scripts[i], results, i);
      while (printed < scripts.length && results[printed]) {
        report(scripts[printed], results[printed] as PoolResult);
        printed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, scripts.length) }, worker));
  return scripts.filter((_, i) => !(results[i] as PoolResult).ok);
}

module.exports = { runPool };
