import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from '../services/compare.ts';
import { Compare } from './Compare.tsx';

// React が持つ比較ビューのオーバーレイ（#82）＝単一の App のルートの下、LightboxHost の
// 隣にある。状態のストアは services/compare.ts にあり、orchestrator.ts から直接開ける。
// このコンポーネントは購読して描くだけ。

export function CompareHost() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return <Compare state={s} />;
}
