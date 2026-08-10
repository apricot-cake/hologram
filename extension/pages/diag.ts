// このページが読むデザイントークン。アプリ自身のシート（#270）から生成した
// もので、加えて拡張機能が持つ2つのページが共有するページシェル（#44）も。
// HTML から <link> するのではなくここで import しているのは、Vite が診断
// ページの他のバンドルと一緒にハッシュ付けして出力できるようにするため。
import '../utils/tokens.generated.css';
import '../utils/page.css';
import { logSaveEvent } from '../utils/capture-log.ts';
import { startDiagnostics } from '../utils/diag.ts';
import { installUncaughtReporting } from '../utils/uncaught-report.ts';

// 絞り込みなし＝拡張機能が持つページ上で動くものはすべて自分たちのもの（#727）。
installUncaughtReporting(window, logSaveEvent, { context: 'diag' });
startDiagnostics();
