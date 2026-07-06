import { createRoot } from 'react-dom/client';
import { SelectionBar } from './SelectionBar.tsx';

// Selection-bar island entry — mounts into the existing #selectionBar container (React
// owns its children; the container element, its viewer-owned show/hide, and the delegated
// click listener on it survive). viewer.js keeps every bulk-action rule and pushes the
// model via window.corpusSelectionBar; React owns rendering the buttons + count. No i18n
// here: labels arrive already-localized from viewer.js.

function mount() {
  const el = document.getElementById('selectionBar');
  if (el) createRoot(el).render(<SelectionBar />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
