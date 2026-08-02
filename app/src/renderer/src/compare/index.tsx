import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from '../services/compare.ts';
import { Compare } from './Compare.tsx';

// React-owned compare-view overlay (#82) — lives under the single App root, next
// to LightboxHost. The state store is services/compare.ts so orchestrator.ts can
// open it directly; this component just subscribes and renders.

export function CompareHost() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return <Compare state={s} />;
}
