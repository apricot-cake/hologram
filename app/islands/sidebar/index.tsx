import { createRoot } from 'react-dom/client';
import { Sidebar } from './Sidebar.tsx';

// Sidebar island entry — mounts into the existing #filterRows container (React owns its
// children; the container element and viewer.js's delegated click listener on it survive).
// viewer.js keeps every filter rule and pushes the whole model via window.corpusSidebar;
// React owns rendering the rows. No i18n here: labels arrive already-localized from
// viewer.js (same convention as inspector/context-menu).

function mount() {
  const el = document.getElementById('filterRows');
  if (el) createRoot(el).render(<Sidebar />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
