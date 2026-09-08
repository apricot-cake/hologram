// このスクリプトは、自分を注入した拡張機能にまだ繋がっているか？（#594）
//
// 何が起きているか。拡張機能をリロードする（あるいは Chrome が自分でアッ
// プデートする。リリース後はこれも同じ出来事になる）と、すでに開いている
// タブで動いている content script には手を触れない。それらはメモリ上で拡
// 張機能との接続を絶たれたまま動作を続ける＝「孤児」になった状態だ。それらが
// 描いたものはページ上にそのまま残るが、もう何一つ動かない。
//
// 実際に観測できることは何か。動いているタブの下で拡張機能をリロードし、
// 使い捨ての Chromium で計測した（e2e/extension/e2e-extension-orphan.cts が計測
// し続けている）:
//
//   chrome.runtime               オブジェクトのままである
//   chrome.runtime.id            undefined に変わる＝これを読んでも絶対に例外は投げない
//   chrome.runtime.sendMessage   同期的に例外「Extension context invalidated.」を投げる
//   chrome.storage.local.get     同期的に、同じメッセージの例外を投げる
//   chrome.runtime.onMessage.addListener / removeListener
//                                例外を投げない（Chrome がすでに listener を落としている）
//
// つまり `chrome.runtime.id` こそが、痛い目を見て気付くのではなく尋ねて確
// かめられる唯一の扉であり、尋ねるコストはプロパティを1回読むだけで済む。
//
// なぜ他の2つの慣用手段を使わないか。無効化されると `onDisconnect` が発火
// する、長生きする `chrome.runtime.connect()` ポートも、もう1つのよく知ら
// れた検出手段だ。しかし開いたポートは MV3 の service worker を起こしたま
// まにしてしまう（keep-alive のハックが悪用しているのと同じ仕組みだ）し、
// この拡張機能は開いているタイムラインすべてに常駐スクリプトを持ってい
// る。メッセージ送信で probe する方法も同じ理由で worker を起こしてしま
// う。実際の呼び出しから来た例外を catch するのは検出とすら言えない＝そ
// の時点ではもうユーザーが求めたことはすでに失敗している。
//
// これに対応するプラットフォームのイベントは存在しない。web-extensions 標
// 準にはそれを求める未解決の要望がある（w3c/webextensions#138＝content
// script には終了通知が来ない）ので、取れる形はポーリングか問い合わせのど
// ちらかしかなく、このモジュールは「どのみち API を使おうとしていたその
// 瞬間に尋ねる」という形を採っている。ここにタイマーで動くものは何もな
// い。

type GoneHandler = () => void;

const handlers: GoneHandler[] = [];
let announced = false;

// 1つのハンドラが壊れても他のハンドラを巻き込んではいけない＝teardown ハ
// ンドラは拡張機能がもう制御していないページに対して実行され、半端に終
// わった teardown はどちらの極端よりも悪い。
function run(handler: GoneHandler): void {
  try {
    handler();
  } catch {
    /* ハンドラの目的は後始末であり、これ以上報告する先はどこにもない */
  }
}

// 声に出して言う。1回だけ。probe からではなく、実際の呼び出しが投げた例外
// から context が消えたと知った呼び出し元は、これを直接使う。
export function noteExtensionGone(): void {
  if (announced) return;
  announced = true;
  // 反復ではなく splice する＝teardown の最中に別のハンドラを登録するハン
  // ドラがいると、そうしなければ今歩いている配列自体が伸びてしまう。
  for (const handler of handlers.splice(0, handlers.length)) run(handler);
}

// probe 本体。最初に false になった時点で知らせるので、ガードされたどの入
// り口も同時に後始末の引き金になる＝足並みを揃えるための別の監視役は要ら
// ない。
export function extensionAlive(): boolean {
  let alive = false;
  try {
    alive = Boolean(chrome.runtime?.id);
  } catch {
    alive = false; // どの計測でも見たことはないが、それに依存しないための1分岐のコスト
  }
  if (!alive) noteExtensionGone();
  return alive;
}

// この context が孤児になったときに `handler` を実行する＝すでに孤児に
// なっていれば即座に実行する。遅れて登録する呼び出し元こそ、まさに今
// 「諦めろ」と告げられたばかりの呼び出し元だからだ。
export function onExtensionGone(handler: GoneHandler): () => void {
  if (announced) {
    run(handler);
    return () => undefined;
  }
  handlers.push(handler);
  return () => {
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}
