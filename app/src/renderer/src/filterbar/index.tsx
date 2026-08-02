// "+ Filter" entry point (redesign §3-2 / P2③) — the Linear-style add-filter flow
// that restores the ability to ADD filters after P1 removed the sidebar facet rows
// (which used to open qf-pop/filter-popover; both are now unreachable). A Popover with
// two steps: a Command list of the current mode's facet categories, then that
// category's editor (value checklist / grouped-tag two-pane, or a date/engagement
// form). All the data + routing is reused from orchestrator.filterCategories(); this
// component only renders + navigates the two steps.
import { ArrowLeft, BookMarked, Calendar, Drama, Folder, Globe, Hash, Heart, Image, Link2, ListFilter, type LucideIcon, MessageSquare, Ruler, Search, Server, Tag, User } from 'lucide-react';
import { useState } from 'react';
import { defaultFilter } from 'cmdk';
import { type FilterCat, filterCategories } from '../services/orchestrator.ts';
import { normalize } from '../services/search.ts';
import { FormEditor } from './FormEditor.tsx';
import { ValueEditor } from './ValueEditor.tsx';
import { t } from '../_shared/i18n.ts';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// The chip's leading glyph carries the category cue (same idiom as the filter chips).
// Poster-* categories share the base icon (poster-tag → Tag, etc.).
// #253: 'domain' (an unsupported-site row's leaf) shares the 'platform' glyph — both are rows of the same "サイト" facet.
const ICONS: Record<string, LucideIcon> = { kind: Link2, platform: Globe, domain: Globe, postType: MessageSquare, media: Image, tag: Tag, work: BookMarked, character: Drama, hashtag: Hash, user: User, instance: Server, folder: Folder, date: Calendar, engagement: Heart, text: Search, dimension: Ruler };
// Shared by the "+ Filter" category list and the active-filter chips (FilterChips).
// Accepts either a category key ('poster-tag') or a leaf type ('tag') — both resolve
// to the same base glyph.
export function CatIcon({ cat }: { cat: string }) {
  const Icon = ICONS[cat.replace(/^poster-/, '')] || ListFilter;
  return <Icon className="size-4 text-muted-foreground" />;
}

function CatList({ cats, onPick }: { cats: FilterCat[]; onPick: (c: FilterCat) => void }) {
  return (
    <Command className="w-64" filter={(value, search, keywords) => defaultFilter(normalize(value), normalize(search), keywords?.map(normalize))}>
      <CommandInput placeholder={t('qfFindPh')} />
      <CommandList>
        <CommandEmpty>—</CommandEmpty>
        <CommandGroup>
          {cats.map((c) => (
            <CommandItem key={c.cat} value={c.label} onSelect={() => onPick(c)}>
              <CatIcon cat={c.cat} />
              <span>{c.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

export function AddFilterButton() {
  const [open, setOpen] = useState(false);
  const [cats, setCats] = useState<FilterCat[]>([]);
  const [sel, setSel] = useState<FilterCat | null>(null);
  // Recompute the category list on each open (counts/vocab/mode change between opens);
  // reset to the category step. filterCategories is assigned by orchestrator.ts's boot
  // IIFE — safe here since this only runs on a user click, long after boot.
  const handleOpen = (o: boolean) => {
    setOpen(o);
    if (o) {
      setCats(filterCategories());
      setSel(null);
    }
  };
  const close = () => setOpen(false);
  // The folder-manager modal can't share the popover's focus scope — close first.
  const manage = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <Popover open={open} onOpenChange={(o) => handleOpen(o)}>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <ListFilter />
        <span>{t('sbFilterTitle')}</span>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} collisionPadding={8} className="w-max max-w-[min(520px,calc(100vw-24px))] p-0">
        {sel ? (
          <>
            <div className="flex items-center gap-1 border-b border-border p-1">
              <Button variant="ghost" size="icon-sm" aria-label="戻る" onClick={() => setSel(null)}>
                <ArrowLeft />
              </Button>
              <span className="text-sm font-medium">{sel.label}</span>
            </div>
            {sel.editor === 'values' ? <ValueEditor key={sel.cat} cat={sel} onManage={manage} /> : <FormEditor key={sel.cat} cat={sel} onClose={close} />}
          </>
        ) : (
          <CatList cats={cats} onPick={setSel} />
        )}
      </PopoverContent>
    </Popover>
  );
}
