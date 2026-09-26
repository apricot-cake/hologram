import { Menu } from '@base-ui/react/menu';
import { Calendar, Check, Folder, Globe, Hash, Heart, Image, Layers, ListFilter, type LucideIcon, MessageSquare, Proportions, Ruler, Search, Tag, User } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { activeFilters, beginFilterEditSession, endFilterEditSession, type FilterCat, type FilterCatValues, type FilterRow, filterCategories } from '../services/orchestrator.ts';
import { store } from '../services/store.ts';
import { FormEditor } from './FormEditor.tsx';
import { ValueIcon } from './ValueIcon.tsx';
import { groupRows, matchesRow, rowKey } from './selection.ts';
import { t } from '../_shared/i18n.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

const ICONS: Record<string, LucideIcon> = { kind: Layers, platform: Globe, domain: Globe, postType: MessageSquare, media: Image, aspectRatio: Proportions, tag: Tag, hashtag: Hash, user: User, folder: Folder, date: Calendar, followers: Heart, text: Search, dimension: Ruler };
export function CatIcon({ cat }: { cat: string }) {
  const Icon = ICONS[cat.replace(/^poster-/, '')] || ListFilter;
  return <Icon className="size-4 shrink-0 text-muted-foreground" />;
}
function Branch({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="min-h-9 gap-2 px-2" delay={120}>
        {icon}
        <span className="flex-1">{label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent side="left" collisionPadding={8} className="w-64 max-w-[calc(100vw-16px)]" aria-label={label}>
        {children}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
function Choice({ cat, row, refresh }: { cat: FilterCatValues; row: FilterRow; refresh: () => void }) {
  return (
    <Menu.CheckboxItem
      label={row.l}
      checked={!!row.on}
      closeOnClick={false}
      onCheckedChange={() => {
        const only = cat.only?.get();
        cat.pick(row);
        if (only != null) cat.only?.set(only);
        refresh();
      }}
      className="group/filter-choice flex min-h-9 cursor-default items-center gap-2 rounded py-2 pr-[30px] pl-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
    >
      <span data-slot="filter-check" aria-hidden="true" className={`flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-current ${row.on ? '' : 'opacity-0 group-hover/filter-choice:opacity-100 group-data-highlighted/filter-choice:opacity-100 [@media(pointer:coarse)]:opacity-100'}`}>
        {row.on && <Check className="size-3" />}
      </span>
      <ValueIcon cat={cat.cat} row={row} />
      <span className="min-w-0 flex-1 break-words">
        {row.l}
        {row.sn ? <small className="block text-xs text-muted-foreground">@{String(row.sn).replace(/^@/, '')}</small> : null}
      </span>
      {row.count != null && <span className="text-xs text-muted-foreground tabular-nums">{row.count}</span>}
    </Menu.CheckboxItem>
  );
}
function Values({ cat, refresh, onManage, rows }: { cat: FilterCatValues; refresh: () => void; onManage: (fn: () => void) => void; rows?: FilterRow[] }) {
  const [query, setQuery] = useState('');
  const [pageIndex, setPage] = useState(0);
  const items = useMemo(() => rows ?? cat.values(), [rows, cat]);
  const groups = useMemo(() => groupRows(items), [items]);
  const grouped = !rows && groups.some((g) => g.name);
  const choices = items.filter((r) => r.ghead == null && matchesRow(r, query));
  const pageSize = 50;
  const page = Math.min(pageIndex, Math.max(0, Math.ceil(choices.length / pageSize) - 1));
  const visible = choices.slice(page * pageSize, (page + 1) * pageSize);
  return (
    <>
      {(grouped || cat.showFind || items.length > 10 || rows) && (
        <div className="p-1 pb-2">
          <Input
            type="search"
            aria-label={t(grouped ? 'fpTagSearch' : 'fpSearch', { name: cat.label })}
            placeholder={t(grouped ? 'fpTagSearch' : 'fpSearch', { name: cat.label })}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            onKeyDown={(e) => {
              if (!['Escape', 'ArrowDown', 'ArrowUp', 'Tab'].includes(e.key)) e.stopPropagation();
            }}
          />
        </div>
      )}
      <div key={`${page}:${query}`} className="max-h-72 overflow-y-auto overscroll-contain">
        {grouped && !query
          ? groups
              .filter((g) => g.rows.length)
              .map((g, i) => (
                <Branch key={`${i}:${g.name}`} label={g.name} icon={<Tag className="size-4 text-muted-foreground" />}>
                  <Values cat={cat} rows={g.rows} refresh={refresh} onManage={onManage} />
                </Branch>
              ))
          : visible.map((row) => <Choice key={rowKey(row)} cat={cat} row={row} refresh={refresh} />)}
        {!choices.length && <p className="p-2 text-sm text-muted-foreground">{t('fpNoResults')}</p>}
      </div>
      {!(grouped && !query) && choices.length > pageSize && (
        <div className="flex items-center justify-between gap-2 border-t border-border/40 p-1">
          <DropdownMenuItem closeOnClick={false} disabled={page === 0} onClick={() => setPage(page - 1)}>
            {t('fpPrevious')}
          </DropdownMenuItem>
          <span className="text-xs text-muted-foreground">
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, choices.length)} / {choices.length}
          </span>
          <DropdownMenuItem closeOnClick={false} disabled={(page + 1) * pageSize >= choices.length} onClick={() => setPage(page + 1)}>
            {t('fpNext')}
          </DropdownMenuItem>
        </div>
      )}
      {!rows && (cat.only || cat.manage) && (
        <>
          <DropdownMenuSeparator />
          <div className={cat.only ? 'flex flex-wrap items-center justify-between gap-2 p-1' : 'hidden'}>
            {cat.only && (
              <label className="flex items-center gap-2 text-xs">
                {t('foldOnly')}
                <Switch
                  checked={cat.only.get()}
                  onCheckedChange={(v) => {
                    cat.only?.set(v);
                    refresh();
                  }}
                />
              </label>
            )}
          </div>
          {cat.manage && (
            <DropdownMenuItem
              onClick={() => {
                if (cat.manage) onManage(cat.manage);
              }}
            >
              {cat.manageLabel || t('ctxManage')}
            </DropdownMenuItem>
          )}
        </>
      )}
    </>
  );
}
function ValueCategory({ cat, refresh, onManage }: { cat: FilterCatValues; refresh: () => void; onManage: (fn: () => void) => void }) {
  const [only, setOnly] = useState(() => !!cat.only?.get());
  const editable: FilterCatValues = {
    ...cat,
    only: cat.only
      ? {
          get: () => only,
          set: (value) => {
            setOnly(value);
            cat.only?.set(value);
          },
        }
      : undefined,
  };
  return <Values cat={editable} refresh={refresh} onManage={onManage} />;
}
function Category({ cat, refresh, onManage }: { cat: FilterCat; refresh: () => void; onManage: (fn: () => void) => void }) {
  if (cat.editor === 'values') return <ValueCategory cat={cat} refresh={refresh} onManage={onManage} />;
  const options = cat.editor === 'date' ? cat.dimOptions : cat.editor === 'eng' ? cat.typeOptions : cat.axisOptions;
  if (options.length === 1)
    return (
      <div className="p-2">
        <FormEditor cat={cat} embedded onClose={refresh} />
      </div>
    );
  return (
    <>
      {options.map((option) => {
        const narrowed = cat.editor === 'date' ? { ...cat, dimOptions: [option] } : cat.editor === 'eng' ? { ...cat, typeOptions: [option] } : { ...cat, axisOptions: [option] };
        return (
          <Branch key={option.value} label={option.label} icon={<ValueIcon cat={cat.cat} row={{ v: option.value }} />}>
            <div className="p-2">
              <div className="mb-3 text-sm text-muted-foreground">{option.label}</div>
              <FormEditor cat={narrowed} embedded onClose={refresh} />
            </div>
          </Branch>
        );
      })}
    </>
  );
}
export function CategoryEditor({ cat, onManage }: { cat: FilterCat; onManage: (fn: () => void) => void }) {
  const [, setRevision] = useState(0);
  useEffect(() => {
    beginFilterEditSession();
    return endFilterEditSession;
  }, []);
  return <Category cat={cat} onManage={onManage} refresh={() => setRevision((v) => v + 1)} />;
}
function FilterPanel({ onManage }: { onManage: (fn: () => void) => void }) {
  const mode = useStore(store, (s) => s.browseMode);
  useStore(store, (s) => (s.browseMode === 'posters' ? s.posterQueryTree : s.browseMode === 'trash' ? s.trashQueryTree : s.postQueryTree));
  const [, setRevision] = useState(0);
  const refresh = () => setRevision((v) => v + 1);
  const categories = filterCategories().filter((cat) => cat.cat !== 'dimension');
  useEffect(() => {
    beginFilterEditSession();
    return endFilterEditSession;
  }, []);
  return (
    <div data-slot="filter-panel">
      {categories.map((cat) => (
        <Branch key={`${mode}:${cat.cat}`} label={cat.label} icon={<CatIcon cat={cat.cat} />}>
          <Category cat={cat} refresh={refresh} onManage={onManage} />
        </Branch>
      ))}
      <DropdownMenuSeparator className="my-2 bg-border/40" />
      <DropdownMenuItem
        closeOnClick={false}
        onClick={() => {
          for (const f of activeFilters()) if (f.type !== 'text') f.remove();
          refresh();
        }}
      >
        {t('fpReset')}
      </DropdownMenuItem>
    </div>
  );
}
export function AddFilterButton() {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <ListFilter />
        <span>{t('sbFilterTitle')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} collisionPadding={8} className="w-56 max-w-[calc(100vw-16px)]" aria-label={t('sbFilterTitle')}>
        {open && (
          <FilterPanel
            onManage={(fn) => {
              setOpen(false);
              fn();
            }}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
