import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from '../services/lightbox.ts';
import { Lightbox } from './Lightbox.tsx';

// React が持つ、画像1枚のクイックビュー（覗き見）のオーバーレイ＝単一の App のルートの下に
// ある。状態のストア（開閉）は services/lightbox.ts にあり、orchestrator.ts や *-builder.ts の
// モジュールから直接 import できる。このコンポーネントは購読して描くだけ。#143 で1件だけに
// 絞り（送りは無い）、P2⑦ でオーバーレイの要素そのものをここへ移した（以前は静的な
// #lightbox の div にクラスを命令的に付け外ししていた）。だから Lightbox は自分のスクリムを
// document.body へポータルする。

export function LightboxHost() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return <Lightbox state={s} />;
}
