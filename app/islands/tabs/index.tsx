import { useSyncExternalStore } from 'react';
import { Tabs } from './Tabs.tsx';
import type { TabsModel } from './Tabs.tsx';

// Presentational island for the tab strip (#tabBarInner) — lives under the single App
// root now. React owns RENDERING; viewer.js keeps owning the tabs array, activeTabId, the
// rename/editing state, and ALL event delegation on #tabBarInner. renderTabs() builds a
// plain model and pushes it via render(); TabsHost (portaled into #tabBarInner by App.tsx)
// subscribes and emits the SAME DOM (.tab-item/.tab-close/.tab-new + data-tab) the old
// innerHTML did, so the delegated handlers keep firing. The bridge is assigned at module
// load (before viewer.js runs), so the old __corpusTabsModel stash-replay is gone.

let current: TabsModel | null = null;
const subs = new Set<() => void>();
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};
const getSnapshot = () => current;

function render(model?: TabsModel | null) {
  if (model) current = model;
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* ignore */
    }
  }
}

window.corpusTabs = { render };

export function TabsHost() {
  const m = useSyncExternalStore(subscribe, getSnapshot);
  return <Tabs model={m} />;
}
