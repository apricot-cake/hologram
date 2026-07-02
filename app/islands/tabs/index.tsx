import { createRoot } from 'react-dom/client';
import { Tabs } from './Tabs.tsx';
import type { Root } from 'react-dom/client';
import type { TabsModel } from './Tabs.tsx';

// Presentational island for the tab strip (#tabBarInner). React owns RENDERING;
// viewer.js keeps owning the tabs array, activeTabId, the rename/editing state, and
// ALL event delegation on #tabBarInner. renderTabs() builds a plain model and
// pushes it here; we emit the SAME DOM (.tab-item/.tab-close/.tab-new + data-tab)
// the old innerHTML did, so the delegated handlers keep firing.

let root: Root | null = null;
let current: TabsModel | null = null;

function ensureRoot() {
  if (root) return root;
  const el = document.getElementById('tabBarInner');
  if (!el) return null;
  root = createRoot(el);
  return root;
}

function render(model?: TabsModel | null) {
  if (model) current = model;
  const r = ensureRoot();
  if (r) r.render(<Tabs model={current} />);
}

window.corpusTabs = { render };

// Script order is viewer.js → islands, so viewer.js may have run renderTabs() (and
// stashed the latest model in window.__corpusTabsModel) before this bundle loaded.
if (window.__corpusTabsModel) render(window.__corpusTabsModel);
