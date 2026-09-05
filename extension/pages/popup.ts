// 共通の配色とフォームに、ポップアップ用の余白・幅を適用する。
import '../utils/tokens.generated.css';
import '../utils/page.css';
import '../utils/popup.css';
import { logSaveEvent } from '../utils/capture-log.ts';
import { startOptions } from '../utils/options.ts';
import { installUncaughtReporting } from '../utils/uncaught-report.ts';

// 絞り込みなし＝拡張機能が持つページ上で動くものはすべて自分たちのもの（#727）。
installUncaughtReporting(window, logSaveEvent, { context: 'popup' });
startOptions();
