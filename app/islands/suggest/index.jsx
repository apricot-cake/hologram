import { createRoot } from 'react-dom/client';
import { Suggest } from './Suggest.jsx';

// Presentational island for the search-suggest dropdown (#searchSuggest, a body-
// level div viewer.js creates). React owns RENDERING the rows; viewer.js keeps
// owning suggestItems, suggestIdx, buildSuggest/applySuggest, the dropdown's
// positioning + show/hide, the delegated mousedown, and the search-box keyboard
// nav. renderSuggest() builds a plain model and pushes it here; we emit the SAME
// DOM (.sg-row[data-sg] + .sel) the old innerHTML did.

let root = null;
let current = null;

function ensureRoot() {
  if (root) return root;
  const el = document.getElementById('searchSuggest');
  if (!el) return null;
  root = createRoot(el);
  return root;
}

function render(model) {
  if (model) current = model;
  const r = ensureRoot();
  if (r) r.render(<Suggest model={current} />);
}

window.corpusSuggest = { render };

// Script order is viewer.js → islands; replay a model stashed before load.
if (window.__corpusSuggestModel) render(window.__corpusSuggestModel);
