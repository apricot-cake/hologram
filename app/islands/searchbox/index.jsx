import { createRoot } from 'react-dom/client';
import { initI18n, t } from '../_shared/i18n.js';
import { SearchBox } from './SearchBox.jsx';

// Mounts the searchbox island into .search-wrap (#searchWrap): the leading
// magnifier icon + the react-aria ComboBox (input + suggest dropdown). Unlike the
// model-push islands there is no render() replay — the island self-owns its DOM;
// the value flows through corpusStore 'searchQuery' and the data callbacks
// through window.corpusSearchBox (searchbox.js bridge).
(async () => {
  await initI18n();
  const host = document.getElementById('searchWrap');
  if (!host) return;
  createRoot(host).render(
    <>
      <svg className="search-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></svg>
      <SearchBox placeholder={t('searchPlaceholder')} />
    </>
  );
})();
