// キャッチされない例外と未処理の rejection（#727）。Chrome はこれらの行き先を
// chrome://extensions のエラーコンソールひとつに絞っていて、そのページは人間
// が目で見て読むためのものでしかない＝拡張機能は chrome:// に触れず、裏の API
// は内部専用で、Chrome 136 はデフォルトプロファイルに対する CDP を閉じた。そ
// のため発生元でこれらを捕まえ、capture.log の既存の `unknown` ステージ
// （「固有のステージを持たない例外」）へ書き込み、`uncaught` にどの文脈から漏
// れたかを記す。
//
// `target`/`write` を引数にしているのは、呼び出し元同士に他の共通点がないか
// らだ＝service worker は logCapture を持ち `self` を listen し、拡張機能の
// ページは logSaveEvent を通して `window` を listen する。ページと共有する
// content script の window では、ページが ErrorEvent の filename や message
// を偽装できるため、この reporter 自体をインストールしない。

// 構造としては capture-log.ts の SaveLogEntry を `unknown` ステージに固定し
// たものだが、上記の chrome フリーを保つためここで別途宣言している。
export interface UncaughtLogEntry {
  stage: 'unknown';
  phase: 'fail';
  [key: string]: unknown;
}

export interface UncaughtEventTarget {
  addEventListener(type: string, listener: (event: any) => void): void;
}

export interface UncaughtReportOptions {
  // レポート行がどの文脈を名乗るか＝background / diag / popup。
  context: string;
}

// JS realm ごとに listener の組はひとつ。
const UNCAUGHT_INSTALLED = Symbol.for('hologram.uncaught-reporting');

// スタックはクラッシュ箇所を指し示すためのもので、呼び出し履歴を丸ごとログ行
// へ運ぶためのものではない。
function trimStack(stack: unknown): string | null {
  if (typeof stack !== 'string' || !stack) return null;
  return stack.split('\n').slice(0, 8).join('\n');
}

export function installUncaughtReporting(target: UncaughtEventTarget, write: (entry: UncaughtLogEntry) => void, opts: UncaughtReportOptions): void {
  const flagged = target as UncaughtEventTarget & { [UNCAUGHT_INSTALLED]?: boolean };
  if (flagged[UNCAUGHT_INSTALLED]) return;
  flagged[UNCAUGHT_INSTALLED] = true;

  target.addEventListener('error', (event: ErrorEvent) => {
    try {
      const stack = trimStack((event.error as Error | undefined)?.stack);
      write({
        stage: 'unknown',
        phase: 'fail',
        uncaught: opts.context,
        error: String(event.message || event.error || 'unknown error'),
        stack,
        source: event.filename ? `${event.filename}:${event.lineno ?? 0}` : null,
      });
    } catch {
      /* 無視する＝診断情報は必須ではない */
    }
  });

  target.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    try {
      const reason = event.reason as { message?: unknown; stack?: unknown } | null | undefined;
      const stack = trimStack(reason?.stack);
      write({
        stage: 'unknown',
        phase: 'fail',
        uncaught: opts.context,
        error: String((reason && (reason.message ?? reason)) || 'unhandled rejection'),
        stack,
      });
    } catch {
      /* 無視する＝診断情報は必須ではない */
    }
  });
}
