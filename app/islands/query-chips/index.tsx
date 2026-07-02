import { createRoot } from 'react-dom/client';
import { Chips } from './Chips.tsx';
import type { Root } from 'react-dom/client';
import type { ChipsModel } from './Chips.tsx';

// Presentational island for the query-builder active bars — post (#queryChips)
// and poster (#posterQueryChips). React owns RENDERING the chips; viewer.js's
// createQueryBuilder keeps owning STATE/DATA, the qbNodeMap (id→node), and ALL
// event delegation on the container (click/dragstart/dragover/drop/contextmenu).
//
// render() builds a plain view-model and pushes it here; we emit the SAME DOM
// (.qb-pill/.qb-grp/.qb-op + data-nid) the old innerHTML did, so every delegated
// handler keeps firing — no click bridge, no state moved out of viewer.js.
//
// Both bars share this one bundle, keyed by container id (one React root each).

const roots = new Map(); // container id → React root

function rootFor(id: string) {
  let r = roots.get(id);
  if (r) return r;
  const el = document.getElementById(id);
  if (!el) return null;
  r = createRoot(el);
  roots.set(id, r);
  return r;
}

function render(id: string, model: ChipsModel) {
  const r = rootFor(id);
  if (r) r.render(<Chips model={model} />);
}

window.corpusQueryChips = { render };

// Script order is viewer.js → islands, so viewer.js may have run render() (and
// stashed the latest model per container in window.__corpusQueryChips) before
// this bundle finished loading. Replay whatever is pending.
const pending = window.__corpusQueryChips;
if (pending) for (const id of Object.keys(pending)) render(id, pending[id]);
