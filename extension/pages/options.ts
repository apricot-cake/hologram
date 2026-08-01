// The design tokens this page reads, generated from the app's own sheet
// (#270), plus the page shell both extension-owned pages share (#44). Imported
// here rather than <link>ed from the HTML so Vite hashes and emits them with
// the rest of the settings page bundle.
import '../utils/tokens.generated.css';
import '../utils/page.css';
import { logSaveEvent } from '../utils/capture-log.ts';
import { startOptions } from '../utils/options.ts';
import { installUncaughtReporting } from '../utils/uncaught-report.ts';

// Unfiltered: everything running on an extension-owned page is our own (#727).
installUncaughtReporting(window, logSaveEvent, { context: 'options' });
startOptions();
