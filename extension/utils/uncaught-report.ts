// キャッチされない例外と未処理の rejection（#727）。Chrome はこれらの行き先を
// chrome://extensions のエラーコンソールひとつに絞っていて、そのページは人間
// が目で見て読むためのものでしかない＝拡張機能は chrome:// に触れず、裏の API
// は内部専用で、Chrome 136 はデフォルトプロファイルに対する CDP を閉じた。そ
// のため発生元でこれらを捕まえ、capture.log の既存の `unknown` ステージ
// （「固有のステージを持たない例外」）へ書き込み、`uncaught` にどの文脈から漏
// れたかを記す。
//
// `target`/`write` を引数にしているのは、呼び出し元同士に他の共通点がないか
// らだ＝service worker は logCapture を持ち `self` を listen し、ページ側は
// すべて logSaveEvent を通して `window` を listen する。ここは chrome.* に一
// 切触れず（import ですら）、chrome 由来の唯一の入力である拡張機能のオリジン
// は opts 経由で受け取る。これによってこのモジュールは chrome の型を持たない
// Node 側のテストプロジェクトからも import できる。

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
  // レポート行がどの文脈を名乗るか＝background / content / diag / options。
  context: string;
  // 省略時: target 上の全イベントを拡張機能自身のものとして扱う（worker・拡張
  // 機能のページ）。文字列を渡した場合: target は共有ウィンドウで、そのオリジ
  // ンに帰属できるイベント（ファイル名かスタックに現れる）だけを記録する＝
  // ページ自体のエラーはこちらが記録するものではない。null の場合: 帰属の判
  // 定は必要だが帰属先のオリジンがない（孤児になった content script）というこ
  // とであり、何も記録しない。
  ownOrigin?: string | null;
}

// JS realm ごとに listener の組はひとつ＝ひとつの拡張機能の content script は
// すべてページの isolated world を共有するため、これがなければ常駐スクリプト
// と注入された右クリックからの一括取り込みが同じイベントを報告してしまう。
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

  if (opts.ownOrigin === null) return;
  const origin = opts.ownOrigin ?? null;
  const attributable = (filename: string | null | undefined, stack: string | null | undefined) => !origin || Boolean(filename?.startsWith(origin) || stack?.includes(origin));

  target.addEventListener('error', (event: ErrorEvent) => {
    try {
      const stack = trimStack((event.error as Error | undefined)?.stack);
      if (!attributable(event.filename, stack)) return;
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
      // rejection にはファイル名が付かないため、共有ウィンドウでは自分のもの
      // だと主張する手段はスタックしかない。スタックを持たない rejection は
      // そこでは帰属を判定できず、破棄する。
      const reason = event.reason as { message?: unknown; stack?: unknown } | null | undefined;
      const stack = trimStack(reason?.stack);
      if (!attributable(null, stack)) return;
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
