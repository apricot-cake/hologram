import { createRoot } from 'react-dom/client';
import { ContextMenuHost } from './ContextMenu.jsx';

// Context-menu island entry. One always-mounted host renders whatever
// window.corpusContextMenu holds. It needs no existing container (it's a body-level
// overlay), so we create its own root — no HTML mount point required. No i18n: the
// menu labels arrive already-localized from viewer.js.

function mount() {
  const root = document.createElement('div');
  root.id = 'contextMenuRoot';
  document.body.appendChild(root);
  createRoot(root).render(<ContextMenuHost />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
