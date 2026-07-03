import { useSyncExternalStore, useCallback } from 'react';
import { t } from '../_shared/i18n.ts';

// Sidebar section title with a current-mode readout — control name left ("ビュー"),
// live mode value right ("ライブラリ", .sb-title-mode). Replaces viewer.js's static
// setText for #sbViewTitle / #sbLayoutTitle / #sbPosterLayoutTitle: the base label
// comes from baseKey, the value is derived live from a window.corpusStore key
// (browseMode / view / posterView) via the same map the toggles use. One component,
// three mounts — the storeKey/map/baseKey props parameterize it.
//
// TWO spans on purpose: the host .sb-title is `display:flex;
// justify-content:space-between`, which pushes the value to the right edge — the
// iOS Settings label/value row. (The previous single-text-node "ビュー · ライブラリ"
// avoided that push, but the one-liner made the control name and the mode name
// indistinguishable — user 2026-07-04.)

const BROWSE_MAP = { posts: 'browsePosts', posters: 'browsePosters', collections: 'browseCollections' };
const VIEW_MAP = { card: 'viewCard', tile: 'viewTile', list: 'viewList' };

export function SectionTitle({ baseKey, storeKey, map, defaultVal }: { baseKey: string; storeKey: string; map: Record<string, string>; defaultVal: string }) {
  const subscribe = useCallback((cb: () => void) => window.corpusStore.subscribe(storeKey, cb), [storeKey]);
  const getVal = useCallback((): string => window.corpusStore.get(storeKey) || defaultVal, [storeKey, defaultVal]);
  const v = useSyncExternalStore(subscribe, getVal);
  const suffixKey = map[v];
  return (
    <>
      <span>{t(baseKey)}</span>
      {suffixKey ? <span className="sb-title-mode">{t(suffixKey)}</span> : null}
    </>
  );
}

export { BROWSE_MAP, VIEW_MAP };
