import { createRoot } from 'react-dom/client';
import { PosterSidebar } from './PosterSidebar.tsx';
import { Sidebar } from './Sidebar.tsx';

// Sidebar island entry — mounts the two filter-row columns: the post-mode column into
// #filterRows (Sidebar) and the poster-mode column into #posterFilterRows (PosterSidebar).
// For each, React owns its children; the container element and viewer.js's delegated click
// listener on it survive. viewer.js keeps every filter rule and pushes each column's model
// via window.corpusSidebar (render/renderPoster); React owns rendering the rows. No i18n
// here: labels arrive already-localized from viewer.js (same convention as inspector/
// context-menu).

function mount() {
  const post = document.getElementById('filterRows');
  if (post) createRoot(post).render(<Sidebar />);
  const poster = document.getElementById('posterFilterRows');
  if (poster) createRoot(poster).render(<PosterSidebar />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
