import { createRoot } from 'react-dom/client';
import './log.ts';
import { initI18n } from '../_shared/i18n.ts';
import { App } from './App.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';

// Mounts the single unified React root (最終形B DoD). A body-appended host div holds the
// App; the App's children portal into their viewer-owned containers or render as fixed
// overlays. One createRoot() for the whole renderer — components used to be their own
// createRoot() calls and were migrated under this one in batches (see App.tsx). The mount
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

initI18n().then(() => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
});
