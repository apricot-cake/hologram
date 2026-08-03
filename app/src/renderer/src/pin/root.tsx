import { createRoot } from 'react-dom/client';
import '../app/log.ts';
import { initI18n } from '../_shared/i18n.ts';
import { ErrorBoundary } from '../app/ErrorBoundary.tsx';
import { PinApp } from './PinApp.tsx';

// Mounts the pin window's own React root — same shape as app/root.tsx (one
// root, gated on initI18n so t() is synchronous inside the first render),
// reusing that module's log.ts/ErrorBoundary.tsx directly rather than forking
// them: neither assumes anything about the main window's DOM.
let mounted = false;
function mount() {
  if (mounted) return;
  mounted = true;
  const root = document.createElement('div');
  root.id = 'hologramPinRoot';
  document.body.appendChild(root);
  createRoot(root).render(
    <ErrorBoundary>
      <PinApp />
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
