// 「あの保存は実際に成功したか」＝拡張機能自身が持つ、最近の保存の記録。
// ツールバーのポップアップが読む（#124）。
//
// なぜ拡張機能が自前で持つのか。すべての保存の完全な記録は native host の
// capture.log であり、拡張機能はそれを読めない＝host は追記するだけで、そ
// れを読み返すメッセージ型は存在しない。追加することも検討したが却下し
// た＝「このマシンで、たった今の、直近数件」だけを覆えばよいリストのため
// に拡張機能/host の境界を広げることになるからだ。そこでこれは拡張機能が
// 自分自身のために書く小さなリングバッファになっている。
//
// .session ではなく chrome.storage.local: この問い（「昨夜いくつか保存し
// たが、ちゃんと入ったか」）はブラウザの再起動をまたいで残るが、答えの方
// はそうではない。ここにあるものはこのマシンの外へは一切出ない。

export const SAVE_HISTORY_KEY = 'saveHistory.v1';

// 20行。ポップアップはログビューアではなくひと目で見るためのもの（長い履
// 歴を読む場所は診断ページと capture.log の方だ）。だからリングは、一括取
// り込みがその晩の普通の保存をリストの外へ押し出してしまわない程度に小さ
// く保たなければならない（下の折りたたみを参照。これはその約束のもう半
// 分）。
export const SAVE_HISTORY_MAX = 20;

export interface SaveHistoryEntry {
  ts: number;
  ok: boolean;
  // この保存がどの経路から来たか。save 用のゲートがすでに使っている語彙で
  // （'save' | 'savePost' | 'saveDragged' | 'saveBookmark'）。
  type: string;
  platform: string | null;
  // 投稿自身の URL。省略せずそのまま保持する。ポップアップは表示のために
  // 短縮するが、行はクリックできる＝その行が名指しする投稿を開くことが、
  // 行が持つ唯一の操作だ。
  url: string | null;
  // 保存の元になったタブ。2つの取り込みの保存が同じ実行に属するかどうか
  // を判定する（foldInto を参照）ためだけに使い、表示はしない。
  tabId?: number | null;
  // host がそのレコードに割り当てた id。経路がそれを知った場合。#125
  // のために運んでいる＝「これをアプリで開く」はアプリが見つけられるレ
  // コードを名指ししなければならず、拡張機能が自分で発行した id ではそ
  // れにならない。
  captureId?: string | null;
  // 一括取り込みの経路（#362）がセットする。これがあることが、その行を
  // 折りたためる条件になる。
  capturedVia?: string | null;
  // この行が代表する保存の件数。省略時は1。
  count?: number;
  error?: string | null;
}

export const countOf = (entry: SaveHistoryEntry): number => (typeof entry.count === 'number' && entry.count > 0 ? entry.count : 1);

// 2つの保存が同じ実行に属するのは、同じタブの同じ取り込みから来ていて、
// 終わり方も同じだったとき。
//
// 実行の結果は人が「実行」と呼ぶものの一部ではないはずだが、それでも
// `ok` を条件に含めている＝失敗を成功の行に折りたたむと、それは数字の中
// に隠れてしまう。入らなかった保存は、入った保存と同じくらい目に見えて
// いなければならない＝それこそがこのリストが存在する理由の全てだ。
function sameRun(a: SaveHistoryEntry, b: SaveHistoryEntry): boolean {
  return !!a.capturedVia && a.capturedVia === b.capturedVia && a.tabId === b.tabId && a.ok === b.ok;
}

// リングへ1件の保存を追加する。
//
// 一括取り込み（#362）は1秒に1投稿保存するので、折りたたみがなければ1回
// の実行だけで20行すべてを埋めてしまい、このリストは「最近の保存」であ
// ることをやめて、ある1回の実行の直近20秒を覗く窓になってしまう。そこで、
// リストの先頭にある実行を継続する保存は、新しい行を押し出すのではなく
// その行の件数とタイムスタンプを更新する。間に挟まる普通の保存は実行を
// 終わらせる＝その後に続く取り込みの保存は新しい行から始まり、これがリ
// ストに物事が起きた順序について誠実さを保たせている。
//
// 純粋な関数にしていて、リング自体を読むのではなく受け取る形にしてい
// る。これでこのルールを chrome.storage なしにテストできる。
export function foldInto(rows: readonly SaveHistoryEntry[], entry: SaveHistoryEntry, max = SAVE_HISTORY_MAX): SaveHistoryEntry[] {
  const head = rows[0];
  if (head && sameRun(head, entry)) {
    return [{ ...head, ts: entry.ts, count: countOf(head) + 1, captureId: entry.captureId ?? head.captureId ?? null }, ...rows.slice(1)];
  }
  return [entry, ...rows].slice(0, max);
}

// 今日何件保存したか。折りたたまれた実行は、それが代表する保存の件数と
// して数える。あえて専用のフィールドに数えるのではなく導出する形にして
// いる＝別のカウンタを持てば、それが隣にあるリストと食い違いうるものが
// もう1つ増えるだけだ。
export function savedOn(rows: readonly SaveHistoryEntry[], now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return rows.filter((row) => row.ok && row.ts >= start).reduce((sum, row) => sum + countOf(row), 0);
}

export function rowsOf(stored: unknown): SaveHistoryEntry[] {
  return Array.isArray(stored) ? (stored.filter((row) => row && typeof row === 'object' && typeof (row as SaveHistoryEntry).ts === 'number') as SaveHistoryEntry[]) : [];
}

export async function readSaveHistory(): Promise<SaveHistoryEntry[]> {
  try {
    const got = await chrome.storage.local.get(SAVE_HISTORY_KEY);
    return rowsOf(got?.[SAVE_HISTORY_KEY]);
  } catch {
    return [];
  }
}

// 絶対に例外を投げず、これを生んだ保存を絶対に遅らせない＝記録を書き込め
// なかった保存も保存であることに変わりなく、このリストはあくまで便宜だ。
export async function recordSave(entry: SaveHistoryEntry): Promise<void> {
  try {
    const rows = await readSaveHistory();
    await chrome.storage.local.set({ [SAVE_HISTORY_KEY]: foldInto(rows, entry) });
  } catch {
    /* できる範囲で */
  }
}
