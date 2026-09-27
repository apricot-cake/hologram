import { useCallback } from 'react';
import { hologramIpc } from '../../services/ipc';

const backdrops = new Map<HTMLElement, number>();

export function combinedDim(amounts: Iterable<number>): number {
  let remaining = 1;
  for (const amount of amounts) remaining *= 1 - amount;
  return 1 - remaining;
}

function syncDim() {
  void hologramIpc.setTitlebarSymbolDim(combinedDim(backdrops.values())).catch(console.error);
}

// ネイティブの記号色だけを暗くする。背景は Backdrop 自身が描く。
// 記号の描画は DOM と別なので、フェードの各フレームとの同期は行わない。
export function useTitlebarSymbolDim(amount = 0.5) {
  return useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      backdrops.set(element, amount);
      syncDim();
      return () => {
        backdrops.delete(element);
        syncDim();
      };
    },
    [amount],
  );
}
