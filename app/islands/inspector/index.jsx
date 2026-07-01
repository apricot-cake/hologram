import { createRoot } from 'react-dom/client';
import { Inspector } from './Inspector.jsx';

// Inspector island entry — mounts into the existing #postDetailBox container (inside
// the persistent #postDetail aside). viewer.js keeps the aside's hidden/insp-open
// chrome; React owns everything rendered inside the box. No i18n: labels arrive
// already-localized from viewer.js (same convention as context-menu/kind-menu).

function mount() {
  const el = document.getElementById('postDetailBox');
  if (el) createRoot(el).render(<Inspector />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
