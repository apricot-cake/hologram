import { useSyncExternalStore } from 'react';
import { t } from '../_shared/i18n.ts';
import { tipProps } from '../_shared/tip.ts';
import { subscribe, getMode, setMode } from '../../renderer/search.ts';

// Search-mode segmented control. おおまか (fuzzy) LEADS on the left and is the default
// (2026-07-04); ぴったり (exact) sits on the right. State lives in search.ts (shared
// with the filter flyout), so React only REFLECTS it: we subscribe via
// useSyncExternalStore (the unsubscribe runs on unmount / HMR) and write back with
// setMode on click. viewer.js keeps its own corpusSearch.subscribe side effect
// (re-render posts / follow the editing leaf).
//
// The thumb slide is an inline transform on .seg-thumb (fuzzy = left / exact = right)
// so we never mutate the container's className. Each option carries an instant .ui-tip
// tooltip explaining what it does (the old always-on hint line below is dropped).

export function SearchModeSeg() {
  const fuzzy = useSyncExternalStore(subscribe, getMode) === 'fuzzy';
  return (
    <>
      <span className="seg-thumb" aria-hidden="true" style={{ transform: fuzzy ? '' : 'translateX(100%)' }} />
      <button type="button" className={'seg-opt' + (fuzzy ? ' is-on' : '')} data-mode="fuzzy" aria-pressed={fuzzy} {...tipProps(t('searchHintLoose'))} onClick={() => setMode('fuzzy')}>
        {t('searchFuzzy')}
      </button>
      <button type="button" className={'seg-opt' + (!fuzzy ? ' is-on' : '')} data-mode="normal" aria-pressed={!fuzzy} {...tipProps(t('searchHintExact'))} onClick={() => setMode('normal')}>
        {t('searchExact')}
      </button>
    </>
  );
}
