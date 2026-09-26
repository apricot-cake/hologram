import { extensionOrigin, logSaveEvent } from '../utils/capture-log.ts';
import { getContentSite, RESIDENT_MATCHES } from '../utils/extractor/index.ts';
import { startOverlay } from '../utils/overlay.ts';
import { installUncaughtReporting } from '../utils/uncaught-report.ts';
import { refreshUiRootStyles } from '../utils/ui-root.ts';
import { startBulkDiscovery } from '../utils/bulk-discovery.ts';

export default defineContentScript({
  // このスクリプトが常駐するサイトは、ここで繰り返さずサイト側のモジュール
  // 自身が宣言する（#212）。
  matches: RESIDENT_MATCHES,
  runAt: 'document_idle',
  main() {
    // 意図して disposable な runtime の外に置いている＝reporting は世代交代
    // を生き延びる必要があり、installUncaughtReporting はどのみち realm ご
    // とに1回しか効かない（#727）。
    installUncaughtReporting(window, logSaveEvent, { context: 'content', ownOrigin: extensionOrigin() });

    // 再注入（開発サーバーが拡張機能をリロードする、または background が前
    // の世代がまだ保持しているタブへ新しいコピーを注入する）が起きると、こ
    // のファイルは古い listener と DOM をまだ抱えているかもしれない realm
    // で再度実行される。owner シンボルは、入ってくる世代が出ていく世代を見
    // つけて先に片付ける手段だ（#727）。これがないと両者が同じ UI を二重に
    // 描いてしまう。
    const OWNER = Symbol.for('hologram.resident-runtime');

    interface ResidentOwner {
      generation: number;
      dispose: () => void;
    }

    const scope = globalThis as typeof globalThis & { [OWNER]?: ResidentOwner };
    const generation = (scope[OWNER]?.generation ?? 0) + 1;
    scope[OWNER]?.dispose();

    let disposed = false;
    const cleanups: Array<() => void> = [];
    const owner: ResidentOwner = {
      generation,
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const cleanup of cleanups.splice(0).reverse()) cleanup();
        if (scope[OWNER] === owner) delete scope[OWNER];
      },
    };
    scope[OWNER] = owner;

    const reportHoverSave = (message: { type?: string }, _sender: unknown, respond: (value: { hoverSave: boolean; platform?: string }) => void) => {
      if (message?.type === 'getHoverSaveStatus') respond({ hoverSave: true, platform: getContentSite()?.platform });
    };
    chrome.runtime.onMessage.addListener(reportHoverSave);
    cleanups.push(() => chrome.runtime.onMessage.removeListener(reportHoverSave));

    void (async () => {
      refreshUiRootStyles();
      cleanups.push(startBulkDiscovery());
      const overlayCleanup = await startOverlay();
      if (disposed) overlayCleanup();
      else {
        cleanups.push(overlayCleanup);
        void chrome.runtime.sendMessage({ type: 'hoverSaveReady' }).catch(() => {});
      }
    })().catch(() => owner.dispose());
  },
});
