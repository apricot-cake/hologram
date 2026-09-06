// グローバル履歴ページ（#145）――レンダラー側の半分。記録は
// tabs-builder.ts の onPush フックにぶら下げた fire-and-forget の IPC
// 呼び出し（実際の書き込みは main が持つ――ipc-history.ts/lib-db-write.ts
// 参照）。読み取り／削除／全消去は main のキーセットページングクエリを
// そのまま通す。実体は本物の ES モジュール（named exports）で、
// tabs-builder.ts と history-panel.ts から利用する。
import { hologramIpc } from './ipc.ts';
import type { HistoryQueryOptions, HistoryQueryResult } from '../../../main/ipc-payloads.ts';

// このレンダラー内のすべてのタブにわたる、最後に記録された u――#145 の
// 設計 §4: 「連続する同一 u は積まない」（makeNavHistory 自身の push()
// が1つのタブのスタックの中で適用しているのと同じ規則を、アプリ全体へ
// 一般化したもの）。意図してモジュールレベルにしている: グローバルな
// 履歴ログには、これをキー付けするタブごとの範囲というものが無い。
let lastU: string | null = null;

/**
 * push 時の訪問を1件記録する。tabs-builder.ts の onPush フックからだけ
 * 呼ばれる（replace 時には決して呼ばれない――tab-state.ts の onPush の
 * doc 参照）。`title` は呼び出し側がすでに導出した表示ラベル（tabTitleOf
 * / imageTabTitleOf ／固定の「posters」ラベル）――このモジュール自身は
 * ラベルを一切生成しない。
 */
export function recordPush(entry: HologramNavEntry, title: string): void {
  if (entry.u === lastU) return;
  lastU = entry.u;
  hologramIpc.appendHistory({ ts: Date.now(), u: entry.u, kind: entry.kind, title, state: entry.state }).catch(() => {
    /* できる範囲で――落ちた履歴行1つは表に出すほどのものではない */
  });
}

export function queryHistory(opts: HistoryQueryOptions): Promise<HistoryQueryResult> {
  return hologramIpc.queryHistory(opts);
}

export function deleteHistoryRow(id: number): Promise<void> {
  return hologramIpc.deleteHistoryRow(id).then(() => undefined);
}

export function clearHistory(): Promise<void> {
  lastU = null;
  return hologramIpc.clearHistory().then(() => undefined);
}
