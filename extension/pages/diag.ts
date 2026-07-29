// The design tokens this page's CSS reads, generated from the app's own sheet
// (#270). Imported here rather than <link>ed from the HTML so Vite hashes and
// emits it with the rest of the diagnostics page bundle.
import '../utils/tokens.generated.css';
import { startDiagnostics } from '../utils/diag.ts';

startDiagnostics();
