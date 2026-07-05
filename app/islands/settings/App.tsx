import { useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { SearchContext } from './search-context.ts';
import { Section } from './components/Section.tsx';
import { SECTIONS } from './sections/registry.ts';
import { t } from '../_shared/i18n.ts';

// The whole settings modal: scrim overlay + sticky head (title / search / close)
// + side TOC + body. Master-detail: with no query the TOC picks ONE section to
// show as a page; with a query, every matching section is stacked and matches are
// highlighted (faithful to the old setupSettingsView behavior). Reuses the
// existing .settings-view / .section / .toc-item CSS from index.html.
// The tiny open/closed store made in index.tsx (window.corpusSettings drives it).
export interface OpenStore {
  isOpen(): boolean;
  set(v: boolean): void;
  subscribe(cb: () => void): () => void;
}

export function App({ store }: { store: OpenStore }) {
  const open = useSyncExternalStore(store.subscribe, store.isOpen);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const [matchIds, setMatchIds] = useState<Set<string> | null>(null); // null = no active search
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Opening resets to single-page mode (clears any search) — mirrors old open().
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  // Esc closes while open.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.set(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, store]);

  const q = query.trim().toLowerCase();

  // Cross-page search: which sections contain the query? Read rendered
  // textContent (faithful to the old `sec.textContent.includes(q)`, incl. option
  // labels). Runs before paint so there's no flash of the wrong sections.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `open` is a deliberate extra dep — re-scan section text when the modal (re)opens; sectionRefs/SECTIONS are stable
  useLayoutEffect(() => {
    if (!q) {
      setMatchIds(null);
      return;
    }
    const ids = SECTIONS.filter((s) => {
      const el = sectionRefs.current[s.id];
      return el && (el.textContent as string).toLowerCase().includes(q);
    }).map((s) => s.id);
    setMatchIds(new Set(ids));
  }, [q, open]);

  // Keep the overlay element present (hidden) when closed so its fade-in animation
  // plays on open; the body (incl. the WebGL canvas) only renders while open.
  if (!open) return <div className="settings-view" hidden />;

  const searching = !!q && matchIds !== null;
  const matchCount = searching ? (matchIds as Set<string>).size : SECTIONS.length;
  const isHidden = (id: string) => (searching ? !(matchIds as Set<string>).has(id) : id !== activeId);
  const tocHidden = (id: string) => (searching ? !(matchIds as Set<string>).has(id) : false);
  const pickPage = (id: string) => {
    setActiveId(id);
    setQuery('');
  };

  return (
    <SearchContext.Provider value={q}>
      <div
        className="settings-view"
        onClick={(e) => {
          if (e.target === e.currentTarget) store.set(false);
        }}
      >
        <div className="settings-view-inner">
          <div className="settings-view-head">
            <h1 className="settings-view-title">{t('tabSettings')}</h1>
            <div className="settings-search-wrap">
              <svg className="settings-search-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input type="search" className="settings-search" autoComplete="off" placeholder={t('settingsSearch')} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <button className="icon-btn" type="button" aria-label="閉じる" data-tip="閉じる" onClick={() => store.set(false)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <div className="settings-empty" hidden={!(searching && matchCount === 0)}>
            {t('settingsNoMatch')}
          </div>

          <div className="settings-body">
            <nav className="settings-toc">
              {SECTIONS.map((s) => (
                <button key={s.id} type="button" className={'toc-item' + (!searching && s.id === activeId ? ' active' : '')} hidden={tocHidden(s.id)} onClick={() => pickPage(s.id)}>
                  {t(s.titleKey)}
                </button>
              ))}
            </nav>
            <div className="settings-panel">
              {SECTIONS.map((s) => (
                <Section
                  key={s.id}
                  title={t(s.titleKey)}
                  hidden={isHidden(s.id)}
                  innerRef={(el) => {
                    sectionRefs.current[s.id] = el;
                  }}
                >
                  <s.Component />
                </Section>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SearchContext.Provider>
  );
}
