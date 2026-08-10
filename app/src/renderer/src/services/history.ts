// グローバル履歴ページ（#145）――レンダラー側の半分。記録は
// tabs-builder.ts の onPush フックにぶら下げた fire-and-forget の IPC
// 呼び出し（実際の書き込みは main が持つ――ipc-history.ts/lib-db-write.ts
// 参照）。読み取り／削除／全消去は main のキーセットページングクエリを
// そのまま通す。実体は本物の ES モジュール（named exports）で、
// tabs-builder.ts、history-panel.ts、command-builder.ts のパレット
// プロバイダから直接 import される。
import { hologramIpc } from './ipc.ts';
import type { HistoryQueryOptions, HistoryQueryResult, HistoryRow } from '../../../main/ipc-payloads.ts';

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
  noteRecent({ id: -1, ts: Date.now(), u: entry.u, kind: entry.kind, title, state: entry.state });
  hologramIpc.appendHistory({ ts: Date.now(), u: entry.u, kind: entry.kind, title, state: entry.state }).catch(() => {
    /* できる範囲で――落ちた履歴行1つは表に出すほどのものではない */
  });
}

export function queryHistory(opts: HistoryQueryOptions): Promise<HistoryQueryResult> {
  return hologramIpc.queryHistory(opts);
}

export function deleteHistoryRow(id: number): Promise<void> {
  dropRecent(id);
  return hologramIpc.deleteHistoryRow(id).then(() => undefined);
}

export function clearHistory(): Promise<void> {
  recent = [];
  lastU = null;
  return hologramIpc.clearHistory().then(() => undefined);
}

// --- 最近の訪問キャッシュ（コマンドパレットの「history」セクション、#145 の設計 §9） ---
// パレットの候補プロバイダは同期的（services/command-registry.ts:
// 「entries(query) … 今この瞬間の候補」）なので、キー入力のたびに生きた
// DB との往復をするという選択肢は無い。最近の訪問の小さなメモリ内リング
// ――recordPush から埋まるので、この「セッション」については常に最新――
// が、独自のクエリエンジン無しでパレットの @history 流のクイックジャンプ
// 行を与える。このキャッシュが一度も見ていない行（アプリを開く前や別の
// ウィンドウのもの）は、DB を直接読む完全な履歴パネルにしか出てこない
// ――パレットが完全性と引き換えに同期性を取るのは、queryEntries の
// クエリでゲートされたコーパスプロバイダがタグ／ポスターに対してすでに
// している取引と同じ。
const RECENT_CAP = 50;
let recent: HistoryRow[] = [];

function noteRecent(row: HistoryRow): void {
  recent = [row, ...recent.filter((r) => r.u !== row.u)].slice(0, RECENT_CAP);
}

function dropRecent(id: number): void {
  recent = recent.filter((r) => r.id !== id);
}

/** 同期的――パレットの history プロバイダはこれを直接読む。 */
export function recentHistory(): readonly HistoryRow[] {
  return recent;
}
