import { extensionOrigin, logSaveEvent } from '../utils/capture-log.ts';
import { startCapture } from '../utils/capture.ts';
import { installUncaughtReporting } from '../utils/uncaught-report.ts';

// マニフェストには宣言していない＝background が chrome.scripting.executeScript
// でファイル名を指定して注入するため、UNLISTED スクリプトになっている。WXT は
// 出力ルートに単体バンドルとして `capture.js` を出す。これは background.ts が
// 指定する名前そのもので、scripts/ext-consistency.test.ts がこの対応を保証する。
export default defineUnlistedScript(() => {
  // Alt+S は常駐スクリプトが読み込まれないページでも動くため、このエントリは
  // 自前で reporting を持つ。共有ページでは realm 単位の guard が単一性を保つ（#727）。
  installUncaughtReporting(window, logSaveEvent, { context: 'content', ownOrigin: extensionOrigin() });
  void startCapture();
});
