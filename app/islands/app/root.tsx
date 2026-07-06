import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

// Mounts the single unified React root (最終形B DoD). A body-appended host div holds the
// App; the App's children portal into their viewer-owned containers or render as fixed
// overlays. One createRoot() for the whole renderer — islands are migrated under it in
// batches (see App.tsx). Idempotent (mounted guard) so re-import is safe.
let mounted = false;
function mount() {
  if (mounted) return;
  mounted = true;
  const root = document.createElement('div');
  root.id = 'corpusAppRoot';
  document.body.appendChild(root);
  createRoot(root).render(<App />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
