import { useEffect, useState } from 'react';
import { corpusTabsSource } from '../../renderer/tabs.ts';
import { Tabs } from './Tabs.tsx';

// Presentational island for the tab strip (#tabBarInner) — lives under the single App
// root. P4-B slice⑯ converts this off the old push (viewer.js built a TabsModel via
// renderTabs() and pushed it to a shared render bridge from ~15 call sites) to a
// PULLED source (renderer/tabs.ts's corpusTabsSource), the same shape as the
// grid/image-tab sources. viewer.js no longer owns the tabs array/activeTabId/
// editingId as closure state — corpusStore's keys of the same names ARE the state;
// it keeps only the mutation functions (switchTab/addTab/…) and ALL event
// delegation on #tabBarInner (unchanged — TabBarEvents, App.tsx). TabsHost emits
// the SAME DOM (.tab-item/.tab-close/.tab-new + data-tab) the old innerHTML did, so
// those delegated handlers keep firing.

// Not useSyncExternalStore: get() recomputes a fresh object on every notify (like
// the grid/image-tab sources) — a plain subscribe→setState effect sidesteps the
// tearing check.
export function TabsHost() {
  const [model, setModel] = useState(() => corpusTabsSource.get());
  useEffect(() => {
    const sync = () => setModel(corpusTabsSource.get());
    const unsub = corpusTabsSource.subscribe(sync);
    sync(); // catch anything that changed before this effect ran
    return unsub;
  }, []);
  return <Tabs model={model} />;
}
