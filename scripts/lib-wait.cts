'use strict';

// 待ちを定義する唯一の場所（#986）。
//
// このモジュールが無かった頃は同じ `waitFor` が22本のハーネスにコピーされ、
// それぞれが独自のデフォルトタイムアウト（4000 / 5000 / 6000 / 8000 /
// 10000）を持ち、しかもどれも諦めた時に何を待っていたのかを言わなかった。
// この最後の部分こそが、タイムアウトを単に赤いだけでなく紛らわしいものに
// していた: #982 は「レイアウトが壊れた」と報告したが、実際に期限切れに
// なった待ちは顔スワップに対するもので、ヘルパーが素の `false` を返す
// だけだったせいで、呼び出し側それぞれが自分なりの言い回しを発明する
// 羽目になっていた。
//
// 利用者は2種類、契約は1つ:
//
//   - Node 側 — `sleep` / `waitFor`。ファイルシステムや子プロセスをポーリング
//     する e2e ドライバが使う。
//   - レンダラー側 — `rendererWaits()`。これはソーステキストを返す。ハーネスの
//     eval は executeJavaScript に渡す文字列なので、レンダラーは何も
//     `require` できない。ソースを埋め込むことだけがこのコードを共有する
//     手段になる（test-app-tab-restart.cts はローカルの `PRELUDE` で
//     すでにまったく同じことをやっていた）。
//
// どちらの側も、何を待っていたかに名前を付ける。レンダラーはそれを
// `console.error` で出力し、smoke ビルドはそれを `[renderer:error] …`
// としてハーネスの標準出力へ転送する（app/src/main/index.ts）ので、
// その名前は読み手が復元する必要なく PASS/FAIL の行の隣に届く。

// すべての待ちに共通の1つのデフォルト値。それまで使われていた5種類を置き換える。
// あえてその中で一番長い値にしてある: 上限が代償を払うのは、すでに壊れている
// 実行の時だけである。健全な実行は条件が満たされた瞬間に抜けるので、安い方の
// 失敗モード（遅いマシンが少し長く待つ）を、高い方の失敗モード（ランナーが
// 混んでいただけで正しいアプリが壊れていると判定される）より優先する。
const DEFAULT_TIMEOUT_MS = 10_000;

// 条件を再チェックする頻度。ループは反復回数ではなく実時間を数える:
// 負荷がかかった状態では 50ms の sleep は 50ms よりずっと遅く戻ってくるので、
// 反復回数で数えるループだと気付かないまま早く諦めてしまう。
const POLL_MS = 50;

// レンダラーの eval 全体に1つの予算。中の待ちはすべてこれで頭打ちになるので、
// 何段階も連続で止まるような退行が起きても、main 側の60秒 SMOKE_TIMEOUT に
// 突入して「eval の結果が無い」とだけ報告し何の名前も残さない（#952）ことに
// はならず、チェックごとの報告がちゃんと返る。あの受け皿が受け皿であり続ける
// 余地を残すサイズにしてある。
const RENDERER_BUDGET_MS = 45_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface WaitOptions {
  timeoutMs?: number;
  pollMs?: number;
}

// `fn` が真になるまでポーリングする。ついに真にならなければ `label` を
// 名指しして例外を投げる — Vitest の `vi.waitFor` や Testing Library の
// `waitFor` と同じ形で、どちらも誰も確認しない真偽値を返すのではなく失敗する。
async function waitFor(label: string, fn: () => unknown, options: WaitOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? POLL_MS;
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() >= until) throw new Error(`${timeoutMs}ms 待っても実現しなかった: ${label}`);
    await sleep(pollMs);
  }
}

// Node 側のための逆向きの検証。`fn` がその窓の間ずっと偽であれば解決し、
// そうでなければ `label` を名指しして例外を投げる。
//
// これはその全タイムアウトを使い切ることが「仕様」である — それこそが
// 「X は起きないことを証明する」ことの誠実な書き方であり、素の `sleep` に
// 課される lint ルールの正当化がこれには求められない理由でもある。
// 観測窓は短く保つこと。
async function neverHappens(label: string, fn: () => unknown, timeoutMs: number, options: { pollMs?: number } = {}): Promise<void> {
  const pollMs = options.pollMs ?? POLL_MS;
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) throw new Error(`起きるべきではなかったのに ${timeoutMs}ms 以内に起きた: ${label}`);
    if (Date.now() >= until) return;
    await sleep(pollMs);
  }
}

// レンダラー側のためのソーステキスト。ハーネスの eval の先頭に埋め込んで使う:
//
//   const evalJs = `(async () => {
//     ${rendererWaits()}
//     await waitFor('the grid to fill', () => cards().length >= 12);
//   })()`;
//
// ここで定義されるヘルパー:
//
//   sleep(ms)                     — 固定の遅延。遅延そのものが仕様である場合
//                                   （バナーの表示時間、デバウンス）か、テストが
//                                   何かが「起きない」ことを証明する場合にのみ
//                                   正当。どちらの場合も呼び出し箇所に一行の
//                                   理由を添える（#986）。
//   waitFor(label, fn, ms)        — `fn` が真になるまでポーリングする。ハーネス
//                                   自身が失敗した検証を報告できるよう真偽値を
//                                   返し、期限切れになったら `label` を stderr に
//                                   名指しする。`fn` は同期・非同期どちらでも良い。
//   waitStable(label, read, ms)   — `read()` が3回連続で同じ値を返すまで
//                                   ポーリングする。「完了」イベントを持たない
//                                   レイアウト向け: masonry は計測し、コミット
//                                   し、次のコミットでまた物を動かし得るので、
//                                   観測可能な事後条件は「計測値が繰り返される」
//                                   こと。
//   neverHappens(label, fn, ms)   — 逆向きの検証。`fn` がその窓の間ずっと偽で
//                                   あれば true を返し、そうでなければ `label`
//                                   を名指しする。これは全タイムアウトを使い
//                                   切ることが「仕様」であり、観測窓は短く保つ
//                                   こと。
function rendererWaits(options: { budgetMs?: number } = {}): string {
  const budgetMs = options.budgetMs ?? RENDERER_BUDGET_MS;
  return `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const WAIT_DEADLINE = Date.now() + ${budgetMs};
  const __waitExpired = (label, ms) => {
    console.error('[wait] ' + ms + 'ms 待っても実現しなかった: ' + label);
    (globalThis.__waitTimeouts || (globalThis.__waitTimeouts = [])).push({ label: label, ms: ms });
  };
  const waitFor = async (label, fn, ms = ${DEFAULT_TIMEOUT_MS}) => {
    const until = Math.min(Date.now() + ms, WAIT_DEADLINE);
    for (;;) {
      if (await fn()) return true;
      if (Date.now() >= until) { __waitExpired(label, ms); return false; }
      await sleep(${POLL_MS});
    }
  };
  const waitStable = async (label, read, ms = ${DEFAULT_TIMEOUT_MS}) => {
    const until = Math.min(Date.now() + ms, WAIT_DEADLINE);
    let prev = null;
    let repeats = 0;
    for (;;) {
      const cur = JSON.stringify(await read());
      repeats = cur === prev ? repeats + 1 : 0;
      if (repeats >= 2) return true;
      prev = cur;
      if (Date.now() >= until) { __waitExpired(label, ms); return false; }
      await sleep(${POLL_MS});
    }
  };
  const neverHappens = async (label, fn, ms) => {
    const until = Date.now() + ms;
    for (;;) {
      if (await fn()) { console.error('[wait] 起きるべきではなかったのに起きた: ' + label); return false; }
      if (Date.now() >= until) return true;
      await sleep(${POLL_MS});
    }
  };
`;
}

// レンダラーの eval 本体が受け取るヘルパー。テンプレートリテラルの中の自由な
// 名前のまま残すのではなく、引数として宣言することで、Biome と tsc が本体を
// そもそも見えるようになる — 下の evalSource を参照。
interface RendererWaits {
  sleep(ms: number): Promise<void>;
  waitFor(label: string, fn: () => unknown, ms?: number): Promise<boolean>;
  waitStable(label: string, read: () => unknown, ms?: number): Promise<boolean>;
  neverHappens(label: string, fn: () => unknown, ms: number): Promise<boolean>;
}

// HOLOGRAM_SMOKE_EVAL に渡す文字列を、テンプレートリテラルではなく「本物の
// 関数」から組み立てる。
//
//   const evalJs = evalSource(async ({ waitFor }, args) => {
//     await waitFor('the grid to fill', () => cards().length >= args.want);
//     return { count: cards().length };
//   }, { want: 12 });
//
// なぜ本体を文字列のまま保たないか: それだと何にも読めなかったから。Biome の
// linter は JavaScript をパースするので、テンプレートリテラルの中に固定の
// `sleep(60)` があっても見えない（Biome 2.5.6 で実測 — リテラルの1行外にある
// 同じ呼び出しは検出されるが、中にあるものは検出されない）。この issue の
// 出発点になった固定待ち149件のうち111件がそうしたリテラルの中に住んでいた。
// 対象の4分の3が見えないルールは、開いたまま閉じた扉を装っているようなもの。
// 関数を渡せば本体はただのコードになる: プラグインも tsc もそれを見え、
// セレクタに対する go-to-definition も効く。
//
// これは Playwright が page.evaluate に対して同じ理由で選んだ形であり、同じ
// 制約も伴う: 関数はシリアライズされるので、このファイル内の何かをクロージャ
// として捕まえることは一切できない。必要なものはすべて `args` を通じて渡し、
// それはソースへ JSON エンコードされる。
function evalSource<A = null>(body: (waits: RendererWaits, args: A) => unknown, args?: A, options: { budgetMs?: number } = {}): string {
  return `(async () => {
${rendererWaits(options)}
  return await (${body})({ sleep, waitFor, waitStable, neverHappens }, ${JSON.stringify(args ?? null)});
})()`;
}

module.exports = { sleep, waitFor, neverHappens, rendererWaits, evalSource, DEFAULT_TIMEOUT_MS, POLL_MS, RENDERER_BUDGET_MS };
