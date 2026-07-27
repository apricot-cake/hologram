import { useEffect, useState } from 'react';
import { hologramTabsSource } from '../services/tabs.ts';
import { Tabs } from './Tabs.tsx';

// Presentational component for the tab strip (#tabBarInner) — lives under the single App
// root. This was converted off the old push (viewer.js built a TabsModel via
// renderTabs() and pushed it to a shared render bridge from ~15 call sites) to a
// PULLED source (services/tabs.ts's hologramTabsSource), the same shape as the
// grid/image-tab sources. viewer.js no longer owns the tabs array/activeTabId/
// editingId as closure state — hologramStore's keys of the same names ARE the state;
// it keeps only the mutation functions (switchTab/addTab/…) and ALL event
// delegation on #tabBarInner (unchanged — TabBarEvents, App.tsx). TabsHost emits
// the SAME DOM (.tab-item/.tab-close/.tab-new + data-tab) the old innerHTML did, so
// those delegated handlers keep firing.

// Not useSyncExternalStore: get() recomputes a fresh object on every notify (like
// the grid/image-tab sources) — a plain subscribe→setState effect sidesteps the
// tearing check.
export function TabsHost() {
  const [model, setModel] = useState(() => hologramTabsSource.get());
  useEffect(() => {
    const sync = () => setModel(hologramTabsSource.get());
    const unsub = hologramTabsSource.subscribe(sync);
    sync(); // catch anything that changed before this effect ran
    return unsub;
  }, []);
  return <Tabs model={model} />;
}
