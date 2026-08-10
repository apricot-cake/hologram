// シェルの切り替え（redesign P1）のための、React から orchestrator への取り決め。
//
// orchestrator はモジュール評価時の IIFE（App.tsx が import する）から起動し、かつては
// index.html の静的なシェルの DOM（#postGrid、#emptyState、タブバー…）へ委譲リスナーを
// 結んでいた。今はシェルが React のもの（AppShell.tsx）なので、IIFE が走る時点でそれらの
// 要素はまだ存在しない。この promise があれば、orchestrator はシェルの DOM に触れる前に
// `await shellReady` できる。AppShell はマウントの effect からこれを解決するので、
// orchestrator が #postGrid などを探す時点では、それらは文書の中にある。
//
// orchestrator 自身の `viewerReady`（orchestrator → React。bootApp を止める）と対称。
// orchestrator の起動時の DOM の委譲が、要素ごとの props とハンドラへ解体された時点で
// 撤去する（§8-1 ①、P2 ⑥/⑪）。
let signal!: () => void;
export const shellReady: Promise<void> = new Promise((resolve) => {
  signal = resolve;
});

let signalled = false;
export function signalShellReady(): void {
  if (signalled) return; // 何度実行しても同じ。AppShell が載るのは1回だが、strict モードの二重呼び出しに備える
  signalled = true;
  signal();
}
