import { createRoot } from 'react-dom/client';
import { FilterPopoverHost } from './FilterPopover.tsx';

// Filter-popover island entry. One always-mounted host renders whatever
// window.corpusFilterPopover holds. It needs no existing container (it's a body-level
// overlay), so we create its own root — no HTML mount point required. No i18n: the
// labels arrive already-localized from viewer.js.

function mount() {
  const root = document.createElement('div');
  root.id = 'filterPopoverRoot';
  document.body.appendChild(root);
  createRoot(root).render(<FilterPopoverHost />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
