// このページが読むデザイントークン。アプリ自身のシート（#270）から生成した
// もので、加えて拡張機能が持つページが共有するページシェル（#44）と、その上
// に重ねるポップアップ独自の層も。HTML から <link> するのではなくここで
// import しているのは、Vite がポップアップの他のバンドルと一緒にハッシュ付
// けして出力できるようにするため。
import '../utils/tokens.generated.css';
import '../utils/page.css';
import '../utils/popup.css';
import { logSaveEvent } from '../utils/capture-log.ts';
import { startPopup } from '../utils/popup.ts';
import { installUncaughtReporting } from '../utils/uncaught-report.ts';

// 絞り込みなし＝拡張機能が持つページ上で動くものはすべて自分たちのもの（#727）。
installUncaughtReporting(window, logSaveEvent, { context: 'popup' });
startPopup();
