'use strict';

// 内部の診断ページ（キャプチャのフローの一部ではない）。仕事は2つ:
//   1. chrome.storage のフォールバック用リングバッファを読み返す＝host の
//      capture.log に届かなかったイベント（host に到達できないときにまさ
//      に起きること）。これは、放っておけば service worker のコンソールだ
//      けが唯一の行き先になってしまう失敗を覗く窓になる。
//   2. 拡張機能自身のオリジンから native-host への接続をテストする。それに
//      よって実際の保存とまったく同じ形で allowed_origins のチェックが働
//      き、正確な chrome.runtime.lastError を表に出せる。
// chrome-extension://<id>/diag.html で開く。
//
// IIFE で包んでいるのは、DIAG_PREFIX（background.ts でも宣言されている）が
// 衝突しないようにするため＝このファイルと background.ts は実行時に JS
// realm を共有することは絶対にない（これは通常のページスクリプトで、
// background.ts は service worker）が、tsc は拡張機能の全ファイルを1つのプ
// ログラムとしてコンパイルするため、トップレベルの名前はその全体で一意で
// なければならない。drag.ts/i18n.ts も同じ IIFE の慣習を使っている。
import { pingNativeHost, protocolReportOf } from './host-probe.ts';
import type { QueueStatsResponse, ResendQueueResponse } from './messages.ts';
import type { SaveQueueStats } from './save-queue.ts';

export function startDiagnostics(): void {
  const DIAG_PREFIX = 'diaglog_';

  function readStoredLogs(): Promise<unknown[]> {
    return new Promise((r) =>
      chrome.storage.local.get(null, (all) => {
        r(
          Object.keys(all)
            .filter((k) => k.startsWith(DIAG_PREFIX))
            .sort()
            .map((k) => all[k]),
        );
      }),
    );
  }

  // #203: 再試行キューの棚卸し。読み取り専用（{type:'queueStats'} のハン
  // ドラは掃除を一切しない）なので、このページの読み込み自体が
  // testNative() の ping に加えて connectNative の試行を引き起こすことはな
  // い＝それを行うのは下の resendQueue だけだ。
  function readQueueStats(): Promise<SaveQueueStats | null> {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'queueStats' }, (res?: QueueStatsResponse) => {
          void chrome.runtime.lastError;
          resolve(res?.ok ? res.stats : null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  // 診断パス全体を再実行せずキューの区画だけを再描画する（testNative は
  // host を起動する＝キューの数字を新しくするだけのためにそれをもう一度や
  // る理由はない）。
  let lastOut: Record<string, unknown> | null = null;
  function renderOut(out: Record<string, unknown>) {
    lastOut = out;
    window.__hologramDiag = out; // ページのコンソールから読める
    const outEl = document.getElementById('out');
    if (outEl) outEl.textContent = JSON.stringify(out, null, 2);
  }

  async function run() {
    const out: Record<string, unknown> = { id: chrome.runtime.id, ts: new Date().toISOString() };
    out.storedLogs = await readStoredLogs();
    // 接続テストとバージョン比較は utils/host-probe.ts にまとめてある。
    const ping = await pingNativeHost(); // Chrome が見つけられれば host を起動する
    out.nativeTest = ping;
    out.protocol = protocolReportOf(ping);
    out.saveQueue = await readQueueStats();
    renderOut(out);
    return out;
  }

  // ツールバーの警告に送られてここへ来た読み手のためのくだり（#269 —
  // diag.html?issue=inject）。この URL を組み立てるのは拡張機能自身の
  // service worker だけで、パラメータは自前のテキストを運ぶのではなく、
  // ページに既にある固定のブロックを選ぶだけのものだ。
  if (new URLSearchParams(location.search).get('issue') === 'inject') {
    document.getElementById('issue-inject')?.removeAttribute('hidden');
  }

  document.getElementById('rerun')?.addEventListener('click', run);
  document.getElementById('clear')?.addEventListener('click', () => {
    chrome.storage.local.get(null, (all) => {
      const keys = Object.keys(all).filter((k) => k.startsWith(DIAG_PREFIX));
      chrome.storage.local.remove(keys, run);
    });
  });
  // #203: 今すぐ再試行キューの掃除を1回実行し、そこに残った数字で再描画す
  // る＝診断パス全体は再実行しないので、これによって testNative 経由で
  // host に再度 ping することにはならない。
  document.getElementById('resend-queue')?.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({ type: 'resendQueue' }, (res?: ResendQueueResponse) => {
        void chrome.runtime.lastError;
        const stats = res?.ok ? res.stats : null;
        renderOut({ ...(lastOut || {}), saveQueue: stats });
      });
    } catch {
      /* このページの下で extension context が消えている＝ここで復旧できることはない */
    }
  });
  run();
}
