'use strict';

import { toast } from 'sonner';

// 共有 UI ユーティリティ――唯一の正本。すべての呼び出し元（folders.ts、
// *-builder.ts の各モジュールなど）が、自前で作り込むのではなく同じ
// トースト通知＋エスケープの実装を使う。

// トースト通知の任意のボタン。今日のところ唯一のものは「Undo」（#235）:
// 完了した一括／破壊的な編集は、Ctrl+Z を覚えておかせる代わりに、自分が
// 報告したその場で戻る手段を提供する。
export type NotifyAction = { label: string; onClick: () => void };

// sonner（shadcn/ui の標準トースター）経由の一時的なトースト通知。
// <Toaster /> の出口は App.tsx（components/ui/sonner.tsx）に一度だけ
// マウントされる。sonner の toast() は自身の外部ストアを通してどこからでも
// 呼べる（素の service モジュールも含めて）ので、これは旧来の #ivToast
// ブリッジが持っていたのと同じ1行の契約を保つ。
export function notify(msg: unknown, action?: NotifyAction | null) {
  const text = msg == null ? '' : String(msg);
  if (!action) {
    toast(text);
    return;
  }
  toast(text, { action: { label: action.label, onClick: action.onClick } });
}

// innerHTML 経由で置くテキスト向けの、引用符も安全な HTML エスケープ。
// " と ' もエスケープするので、誤って属性の中で使われた結果でも安全な
// まま（viewer の旧来の div ベースのエスケープはそれらを未エスケープの
// ままにしていた）。通常のテキスト内容に対する表示は変わらない。
export function escapeHtml(s: unknown) {
  const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => MAP[c]);
}
