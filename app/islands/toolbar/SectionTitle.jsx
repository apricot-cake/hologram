import { useSyncExternalStore, useCallback } from 'react';
import { t } from '../_shared/i18n.js';

// Sidebar section title that names the current mode/layout — e.g. "ビュー · ライブラリ",
// "レイアウト · カード". Replaces viewer.js's static setText for #sbViewTitle /
// #sbLayoutTitle / #sbPosterLayoutTitle: the base label comes from baseKey, the suffix
// is derived live from a window.corpusStore key (browseMode / view / posterView) via
// the same map the toggles use. One component, three mounts — the storeKey/map/baseKey
// props parameterize it (mirrors DensityToggle's storeKey/dataAttr sharing).
//
// Rendered as a SINGLE text node, not "<span>base</span> · <span>suffix</span>": the
// host .sb-title is `display:flex; justify-content:space-between`, so two flex children
// would be pushed to opposite ends. One text node = one flex child = the label stays
// left-aligned exactly as before (no CSS change needed).

const BROWSE_MAP = { posts: 'browsePosts', posters: 'browsePosters', collections: 'browseCollections' };
const VIEW_MAP = { card: 'viewCard', tile: 'viewTile', list: 'viewList' };

export function SectionTitle({ baseKey, storeKey, map, defaultVal }) {
  const subscribe = useCallback((cb) => window.corpusStore.subscribe(storeKey, cb), [storeKey]);
  const getVal = useCallback(() => window.corpusStore.get(storeKey) || defaultVal, [storeKey, defaultVal]);
  const v = useSyncExternalStore(subscribe, getVal);
  const suffixKey = map[v];
  return <>{suffixKey ? `${t(baseKey)} · ${t(suffixKey)}` : t(baseKey)}</>;
}

export { BROWSE_MAP, VIEW_MAP };
