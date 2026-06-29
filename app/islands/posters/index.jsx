import { createRoot } from 'react-dom/client';
import { Posters } from './Posters.jsx';

// Presentational island for the poster grid (#posterGrid). React owns RENDERING
// the cards; viewer.js keeps owning posterList, the count badge, the grid density
// classes/vars, the inspected highlight (model-driven via inspectedKey), and ALL
// event delegation on #posterGrid (click → info/tag/open, contextmenu → menu).
// pushPosterModel() builds a plain model and pushes it here; we emit the SAME DOM
// (.poster-card[data-index] / .poster-tag[data-ptag] / .poster-info[data-pinfo]).

let root = null;
let current = null;

function ensureRoot() {
  if (root) return root;
  const el = document.getElementById('posterGrid');
  if (!el) return null;
  root = createRoot(el);
  return root;
}

function render(model) {
  if (model) current = model;
  const r = ensureRoot();
  if (r) r.render(<Posters model={current} />);
}

window.corpusPosters = { render };

// Script order is viewer.js → islands; replay a model stashed before load.
if (window.__corpusPostersModel) render(window.__corpusPostersModel);
