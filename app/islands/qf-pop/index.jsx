import { createRoot } from 'react-dom/client';
import { QfPopHost } from './QfPop.jsx';

// qf-pop island entry. One always-mounted host renders whatever window.corpusQfPop
// holds. It needs no existing container (it's a body-level overlay), so we create its
// own root — no HTML mount point required. No i18n: labels arrive already-localized
// from viewer.js.

function mount() {
  const root = document.createElement('div');
  root.id = 'qfPopRoot';
  document.body.appendChild(root);
  createRoot(root).render(<QfPopHost />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
