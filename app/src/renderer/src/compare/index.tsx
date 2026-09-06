import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from '../services/compare.ts';
import { Compare } from './Compare.tsx';

export function CompareHost() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return <Compare state={s} />;
}
