import { createRoot } from 'react-dom/client';
import { EditOverlay } from './EditOverlay.jsx';

// Edit-overlay island entry — mounts into the existing #editOverlayBox container
// (inside the persistent #editOverlay backdrop). viewer.js keeps the backdrop's
// show/hide + modal-chrome classList; React owns everything rendered inside the box.
// No i18n: labels arrive already-localized from viewer.js (same convention as
// context-menu/kind-menu/inspector).

function mount() {
  const el = document.getElementById('editOverlayBox');
  if (el) createRoot(el).render(<EditOverlay />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
