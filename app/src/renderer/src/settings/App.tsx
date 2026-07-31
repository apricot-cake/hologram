import { useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { SearchIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchContext } from './search-context.ts';
import { Section } from './components/Section.tsx';
import { SECTIONS } from './sections/registry.ts';
import { t } from '../_shared/i18n.ts';

// The whole settings modal, rebuilt on shadcn Dialog: sticky head (title /
// search) + side TOC + body. Master-detail: with no query the TOC picks ONE
// section to show as a page; with a query, every matching section is stacked
// and matches are highlighted. Esc / backdrop-close / focus trapping are
// Radix Dialog built-ins now (the hand-rolled handlers are gone).
// The open/closed store lives in services/settings.ts; index.tsx wires it into this shape.
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
      <Dialog open={open} onOpenChange={(v) => store.set(v)}>
        <DialogContent className="flex h-[min(1000px,85vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1100px,90vw)]">
          <DialogHeader className="shrink-0 gap-3 border-b px-6 pt-5 pb-4">
            <DialogTitle className="text-lg">{t('tabSettings')}</DialogTitle>
            <DialogDescription className="sr-only">{t('settingsSearch')}</DialogDescription>
            <div className="relative">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
              <Input type="search" autoComplete="off" placeholder={t('settingsSearch')} value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
            </div>
          </DialogHeader>

          <div className="flex min-h-0 flex-1">
            <nav className="bg-muted/40 flex w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r p-3">
              {SECTIONS.map((s) => (
                <Button key={s.id} type="button" variant={!searching && s.id === activeId ? 'secondary' : 'ghost'} size="sm" className="justify-start gap-2" hidden={tocHidden(s.id)} onClick={() => pickPage(s.id)}>
                  <s.Icon className="text-muted-foreground" aria-hidden="true" />
                  {t(s.titleKey)}
                </Button>
              ))}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {searching && matchCount === 0 && <div className="text-muted-foreground py-10 text-center text-sm">{t('settingsNoMatch')}</div>}
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
        </DialogContent>
      </Dialog>
    </SearchContext.Provider>
  );
}
