import { useSyncExternalStore } from 'react';
import { t } from '../_shared/i18n.js';

// Search-mode segmented control (exact / fuzzy). State lives in window.corpusSearch
// (shared with the filter flyout), so React only REFLECTS it: we subscribe via
// useSyncExternalStore (the onChange unsubscribe runs on unmount / HMR) and write
// back with setMode on click. viewer.js keeps its own corpusSearch.onChange side
// effect (re-render posts / follow the editing leaf).
//
// We emit the SAME DOM the old innerHTML did (.seg-thumb + two .seg-opt), so the
// existing .seg-control CSS keeps working. The thumb slide was driven by the
// container's `.is-fuzzy` class, but the only rule it carried was a translateX on
// the thumb — we apply that as an inline transform on .seg-thumb instead, so we
// never reach out to mutate the root container's own className.

const subscribe = (cb) => window.corpusSearch.onChange(cb);
const getMode = () => window.corpusSearch.getMode();

export function SearchModeSeg() {
  const fuzzy = useSyncExternalStore(subscribe, getMode) === 'fuzzy';
  return (
    <>
      <span className="seg-thumb" aria-hidden="true" style={{ transform: fuzzy ? 'translateX(100%)' : '' }} />
      <button
        type="button"
        className={'seg-opt' + (!fuzzy ? ' is-on' : '')}
        data-mode="normal"
        aria-pressed={!fuzzy}
        onClick={() => window.corpusSearch.setMode('normal')}
      >{t('searchExact')}</button>
      <button
        type="button"
        className={'seg-opt' + (fuzzy ? ' is-on' : '')}
        data-mode="fuzzy"
        aria-pressed={fuzzy}
        onClick={() => window.corpusSearch.setMode('fuzzy')}
      >{t('searchFuzzy')}</button>
    </>
  );
}
