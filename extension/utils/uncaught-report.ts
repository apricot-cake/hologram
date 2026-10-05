// キャッチされない例外と未処理の rejection（#727）。Chrome はこれらの行き先を
// chrome://extensions のエラーコンソールひとつに絞っていて、そのページは人間
// が目で見て読むためのものでしかない＝拡張機能は chrome:// に触れず、裏の API
// は内部専用で、Chrome 136 はデフォルトプロファイルに対する CDP を閉じた。そ
// のため拡張機能だけが所有する worker/page では発生元で捕まえ、共有
// window 上の content script では自分で catch できた経路だけを、capture.log の `unknown` ステージ
// （「固有のステージを持たない例外」）へ書き込み、`uncaught` にどの文脈から漏
// れたかを記す。
//
// `target`/`write` を引数にしているのは、呼び出し元同士に他の共通点がないか
// らだ＝service worker は logCapture を持ち `self` を listen し、content script
// は明示的な catch から logSaveEvent を呼ぶ。共有 window の ErrorEvent はページが
// filename/message/error.stack を構築できるため、帰属判定には一切使わない。ここは
// chrome.* に触れず、Node 側のテストプロジェクトからも import できる。

// 構造としては capture-log.ts の SaveLogEntry を `unknown` ステージに固定し
// たものだが、上記の chrome フリーを保つためここで別途宣言している。
export interface UncaughtLogEntry {
  stage: 'unknown';
  phase: 'fail';
  [key: string]: unknown;
}

export interface UncaughtEventTarget {
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
}

export interface UncaughtReportOptions {
  // レポート行がどの文脈を名乗るか＝background / diag / options。
  context: string;
}

// 拡張機能所有 realm ごとに listener の組はひとつ。dispose を値として保持し、
// ページ再読み込みを伴わない再初期化でも旧世代を片付けられる。
const UNCAUGHT_INSTALLED = Symbol.for('hologram.uncaught-reporting');
interface InstalledReporting {
  dispose(): void;
}

// スタックはクラッシュ箇所を指し示すためのもので、呼び出し履歴を丸ごとログ行
// へ運ぶためのものではない。
function trimStack(stack: unknown): string | null {
  if (typeof stack !== 'string' || !stack) return null;
  return stack.slice(0, 2048).split('\n').slice(0, 8).join('\n');
}

export function reportCaughtException(write: (entry: UncaughtLogEntry) => void, context: string, error: unknown, operation?: string): void {
  try {
    const value = error as { message?: unknown; stack?: unknown } | null | undefined;
    write({
      stage: 'unknown',
      phase: 'fail',
      uncaught: context,
      operation,
      error: String((value && (value.message ?? value)) || 'unknown error').slice(0, 1024),
      stack: trimStack(value?.stack),
    });
  } catch {
    /* 診断失敗で本来の処理をさらに壊さない */
  }
}

export function guardCaughtException<Args extends unknown[], Result>(write: (entry: UncaughtLogEntry) => void, context: string, operation: string, callback: (...args: Args) => Result): (...args: Args) => Result | undefined {
  return (...args) => {
    try {
      const result = callback(...args);
      if (result && typeof (result as unknown as { then?: unknown }).then === 'function') {
        void Promise.resolve(result).catch((error) => reportCaughtException(write, context, error, operation));
      }
      return result;
    } catch (error) {
      reportCaughtException(write, context, error, operation);
      return undefined;
    }
  };
}

export function installUncaughtReporting(target: UncaughtEventTarget, write: (entry: UncaughtLogEntry) => void, opts: UncaughtReportOptions): () => void {
  const flagged = target as UncaughtEventTarget & { [UNCAUGHT_INSTALLED]?: InstalledReporting };
  if (flagged[UNCAUGHT_INSTALLED]) return flagged[UNCAUGHT_INSTALLED].dispose;

  const onError = (event: ErrorEvent) => {
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
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
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
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onUnhandledRejection);
  const installed: InstalledReporting = {
    dispose() {
      target.removeEventListener('error', onError);
      target.removeEventListener('unhandledrejection', onUnhandledRejection);
      if (flagged[UNCAUGHT_INSTALLED] === installed) delete flagged[UNCAUGHT_INSTALLED];
    },
  };
  flagged[UNCAUGHT_INSTALLED] = installed;
  return installed.dispose;
}
