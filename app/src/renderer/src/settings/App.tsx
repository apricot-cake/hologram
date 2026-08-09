import { useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { SearchIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchContext } from './search-context.ts';
import { Section } from './components/Section.tsx';
import { SECTIONS } from './sections/registry.ts';
import { t } from '../_shared/i18n.ts';

// 設定モーダルの全体。shadcn の Dialog の上に作り直してある: 貼り付く頭（タイトルと
// 検索）＋横の目次＋本体。マスター・ディテール型で、クエリが無ければ目次が節を1つ選んで
// ページとして見せ、クエリがあれば一致した節をすべて積み上げて一致箇所を強調する。
// Esc・背景で閉じる・フォーカスの閉じ込めは、今は Radix Dialog に元から備わっている
// （手書きのハンドラは無くなった）。
// 開閉のストアは services/settings.ts にあり、index.tsx がこの形へつなぐ。
export interface OpenStore {
  isOpen(): boolean;
  set(v: boolean): void;
  subscribe(cb: () => void): () => void;
}

export function App({ store }: { store: OpenStore }) {
  const open = useSyncExternalStore(store.subscribe, store.isOpen);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const [matchIds, setMatchIds] = useState<Set<string> | null>(null); // null = 検索していない
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // 開くと1ページ表示へ戻す（検索も消す）＝以前の open() と同じ振る舞い。
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const q = query.trim().toLowerCase();

  // ページをまたぐ検索: どの節がクエリを含むか。描画済みの textContent を読む（以前の
  // `sec.textContent.includes(q)` に忠実で、option のラベルも含む）。描画の前に走るので、
  // 違う節が一瞬映ることはない。
  // biome-ignore lint/correctness/useExhaustiveDependencies: `open` は意図して足した依存＝モーダルが開き直された時に節の文字列を読み直す。sectionRefs と SECTIONS は安定している
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
