import { createRoot } from 'react-dom/client';
import { Subrows } from './Subrows.tsx';
import type { Root } from 'react-dom/client';
import type { SubrowModel } from './Subrows.tsx';

// Presentational island for the sidebar's tag-group subrows — the first React
// slice of the (densely-coupled) core. The clean pattern for a core fragment:
// React owns RENDERING, viewer.js keeps owning STATE/DATA + event delegation.
//
// viewer.js's updateSidebarTagGroups computes the row data and pushes it here via
// window.corpusSidebarTags.render(rows). We render <Subrows> into the existing
// static `#sbTagGroupSubRows .sb-subrows-inner`, emitting the same DOM the old
// innerHTML did, so the delegated [data-tag-group] click handler on #filterRows
// still fires — no click bridge, and no bidirectional activeFilters wiring.

let root: Root | null = null;
let current: SubrowModel[] = [];

function ensureRoot() {
  if (root) return root;
  const el = document.querySelector('#sbTagGroupSubRows .sb-subrows-inner');
  if (!el) return null;
  root = createRoot(el);
  return root;
}

function render(rows?: SubrowModel[]) {
  if (Array.isArray(rows)) current = rows;
  const r = ensureRoot();
  if (r) r.render(<Subrows rows={current} />);
}

window.corpusSidebarTags = { render };

// viewer.js may have pushed data before this bundle finished loading — catch up.
if (Array.isArray(window.__corpusSbTagRows)) render(window.__corpusSbTagRows);
