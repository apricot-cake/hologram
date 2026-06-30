import { createRoot } from 'react-dom/client';
import { SearchModeSeg } from './SearchModeSeg.jsx';
import { initI18n } from './i18n.js';

// Toolbar island — the sidebar's small toolbar controls, React-owned. This is the
// first slice of the shell (above the leaf islands): presentational, with state in
// shared stores (window.corpusSearch for the search mode; window.corpusStore for
// the view density, added as a second root in a later step). viewer.js keeps the
// heavy logic. Each control mounts into its EXISTING, now-empty container so the
// DOM/CSS contract is unchanged and viewer.js's sibling labels (#sbSearchTitle,
// #searchModeHint) stay put.

function mountSearchMode() {
  const el = document.getElementById('searchModeSeg');
  if (el) createRoot(el).render(<SearchModeSeg />);
}

function mountAll() {
  mountSearchMode();
}

// Resolve i18n before render so t() is synchronous in components. The single
// window.corpusI18n promise is shared with viewer.js — awaiting it is cheap and
// adds no extra IPC. (Same pattern as the settings island.)
initI18n().then(() => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }
});
