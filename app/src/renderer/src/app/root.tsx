import { createRoot } from 'react-dom/client';
import './log.ts';
import { initI18n } from '../_shared/i18n.ts';
import { App } from './App.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';

// Mounts the single unified React root (Final shape B DoD). A body-appended host div holds the
// App; the App's children render in place or as fixed overlays (nothing portals into a
// static container any more — #621). One createRoot() for the whole renderer — components
// used to be their own createRoot() calls and were migrated under this one in batches (see
// App.tsx). The mount
// is gated on initI18n() so t() is synchronous inside the App (the searchbox placeholder,
// and future toolbar/settings text, need it). Overlays and model-push components are
// unaffected by the tiny gate delay — they render only once their
// bridge holds content and pull the current model via useSyncExternalStore on mount.
// Idempotent (mounted guard) so re-import is safe.
let mounted = false;
function mount() {
  if (mounted) return;
  mounted = true;
  const root = document.createElement('div');
  root.id = 'hologramAppRoot';
  document.body.appendChild(root);
  // One root means one uncaught render error empties the entire window, so the
  // boundary sits directly under it (#324 — see ErrorBoundary.tsx).
  createRoot(root).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}

initI18n().then((api) => {
  // The document has to name the language it actually resolved to, not the one
  // index.html was written with (#1057, WCAG 2.2 SC 3.1.1 Language of Page). What
  // it decides: which voice a screen reader uses, which glyphs the font picks for
  // the han characters ja and zh disagree about, and whether Chrome offers to
  // translate the window. Nothing textual has rendered yet — the mount below waits
  // on this same promise — so this is not a correction, it is the first claim the
  // document makes.
  //
  // Here rather than inside initI18n(): scripts/clipboard-intake.test.ts and
  // drop-import.test.ts call that under Vitest's node environment, where there is
  // no document to write to. The roots are the modules that own one.
  if (api) document.documentElement.lang = api.resolved;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
});
