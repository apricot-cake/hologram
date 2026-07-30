import { useEffect, useState } from 'react';
import { hologramTabsSource } from '../services/tabs.ts';
import { Tabs } from './Tabs.tsx';

// The tab strip's host — lives under the single App root, inside AppShell's titlebar
// band. It was converted off the old push (viewer.js built a TabsModel via renderTabs()
// and pushed it to a shared render bridge from ~15 call sites) to a PULLED source
// (services/tabs.ts's hologramTabsSource), the same shape as the grid / image-tab
// sources. hologramStore's tabs/activeTabId keys ARE the state; tabs-builder.ts keeps
// the mutations (switchTab/addTab/…), which the strip calls directly (#621).

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
