import { createRoot } from 'react-dom/client';
import { Collections } from './Collections.jsx';

// Presentational island for the collection grid (#collectionGrid). React owns
// RENDERING; viewer.js keeps owning the collection list, the records/thumbs
// computation, the #collectionCount badge, and ALL event delegation on
// #collectionGrid (click → new/open, contextmenu → card menu). renderCollections()
// builds a plain model and pushes it here; we emit the SAME DOM
// (.collection-card[data-cid]/[data-cnew]) the old innerHTML did.

let root = null;
let current = null;

function ensureRoot() {
  if (root) return root;
  const el = document.getElementById('collectionGrid');
  if (!el) return null;
  root = createRoot(el);
  return root;
}

function render(model) {
  if (model) current = model;
  const r = ensureRoot();
  if (r) r.render(<Collections model={current} />);
}

window.corpusCollections = { render };

// Script order is viewer.js → islands, so viewer.js may have run renderCollections()
// (and stashed the latest model) before this bundle loaded — replay it.
if (window.__corpusCollectionsModel) render(window.__corpusCollectionsModel);
