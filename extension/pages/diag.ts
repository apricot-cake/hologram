// The design tokens this page reads, generated from the app's own sheet
// (#270), plus the page shell both extension-owned pages share (#44). Imported
// here rather than <link>ed from the HTML so Vite hashes and emits them with
// the rest of the diagnostics page bundle.
import '../utils/tokens.generated.css';
import '../utils/page.css';
import { startDiagnostics } from '../utils/diag.ts';

startDiagnostics();
