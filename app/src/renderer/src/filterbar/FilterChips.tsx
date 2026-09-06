import { Check, ChevronDown, X } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { type ActiveFilter, activeFilters, type FacetMode, filterCategories } from '../services/orchestrator.ts';
import { openFolder } from '../services/orchestrator.ts';
import { all as folderAll, onChange as folderOnChange } from '../services/folders.ts';
import { store, subscribeKey } from '../services/store.ts';
import { CatIcon } from './index.tsx';
import { FormEditor } from './FormEditor.tsx';
import { InlineFilterInput } from './InlineFilterInput.tsx';
import { ValueEditor } from './ValueEditor.tsx';
import { t } from '../_shared/i18n.ts';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// browseMode と2本のクエリの木をまとめて1つ購読する。スナップショットは有効なモードの木
// （変更と変更の間は参照が安定＝store.set は実際に変わったときだけ差し替える）なので、
// useSyncExternalStore は木の編集とモード切替で再描画し、有効でないモードの木への編集は
// 無視する。
const TREE_KEYS = ['browseMode', 'postQueryTree', 'posterQueryTree'] as const;
const subActive = (cb: () => void) => {
  const unsubs = TREE_KEYS.map((k) => subscribeKey(k, cb));
  return () => {
    for (const u of unsubs) u();
  };
};
const getActive = () => {
  const s = store.getState();
  return s.browseMode === 'posters' ? s.posterQueryTree : s.postQueryTree;
};
const subActiveFolder = (cb: () => void) => subscribeKey('activeFolderId', cb);
const getActiveFolder = () => store.getState().activeFolderId;
const subFolders = (cb: () => void) => folderOnChange(cb);
const getFolders = () => folderAll();

function modeWord(mode: FacetMode, multi: boolean): string {
  if (mode === 'exclude') return t('fbModeExclude');
  if (mode === 'and') return t('fbModeAll');
  return t(multi ? 'fbModeAny' : 'fbModeInclude');
}

function Chip({ f }: { f: ActiveFilter }) {
  const [open, setOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const category = filterCategories().find((c) => c.cat === f.cat);
  const valueCat = category?.editor === 'values' ? category : null;
  const modes: FacetMode[] = valueCat?.multi ? ['or', 'and', 'exclude'] : ['or', 'exclude'];
  const handleOpen = (next: boolean) => {
    if (next && !category) return;
    setOpen(next);
    if (next) setModeOpen(false);
  };
  return (
    <span data-slot="filter-chip" className="inline-flex min-h-7 max-w-full items-center rounded-md border border-border bg-background pr-0.5 text-sm">
      <span className="flex shrink-0 items-center gap-1 px-1.5 text-muted-foreground">
        <CatIcon cat={f.type} />
        <span className="text-xs">{f.label}</span>
      </span>
      {valueCat ? (
        <Popover
          open={modeOpen}
          onOpenChange={(next) => {
            setModeOpen(next);
            if (next) setOpen(false);
          }}
        >
          <PopoverTrigger render={<button type="button" data-slot="filter-operator" aria-label={f.label + ': ' + modeWord(f.mode, valueCat.multi)} className="flex h-7 shrink-0 items-center gap-1 border-l border-border px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground" />}>
            {modeWord(f.mode, valueCat.multi)}
            <ChevronDown className="size-3" />
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-max min-w-36 p-1">
            <div role="group" aria-label={f.label}>
              {modes.map((mode) => (
                <button
                  type="button"
                  key={mode}
                  aria-pressed={f.mode === mode}
                  className="flex w-full items-center justify-between gap-4 rounded px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    f.setMode?.(mode);
                    setModeOpen(false);
                  }}
                >
                  {modeWord(mode, valueCat.multi)}
                  {f.mode === mode ? <Check className="size-4" /> : <span className="size-4" />}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : f.mode === 'exclude' ? (
        <span className="px-1.5 text-xs text-muted-foreground">{t('fbModeExclude')}</span>
      ) : null}
      <Popover open={open} onOpenChange={handleOpen}>
        <PopoverTrigger render={<button type="button" disabled={!category} data-slot="filter-values" className="flex h-7 min-w-0 items-center gap-1 border-l border-border px-1.5 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none" />}>
          <span className="min-w-0 truncate">{f.values.join('・')}</span>
          {category ? <ChevronDown className="size-3 shrink-0" /> : null}
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} collisionPadding={8} className="w-max max-w-[min(520px,calc(100vw-24px))] p-0">
          {category ? (
            category.editor === 'values' ? (
              <ValueEditor
                cat={category}
                onManage={(fn) => {
                  setOpen(false);
                  fn();
                }}
              />
            ) : (
              <FormEditor cat={category} onClose={() => setOpen(false)} />
            )
          ) : null}
        </PopoverContent>
      </Popover>
      <button type="button" className="ml-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground" aria-label={t('qfDelete')} onClick={() => f.remove()}>
        <X className="size-3.5" />
      </button>
    </span>
  );
}

export function FilterChips() {
  // 有効なクエリの木（またはブラウズモード）が変わるたびに再描画する。そのうえで
  // activeFilters() が生きている木からチップを導き直す。この呼び出しの目的は購読そのもので、
  // スナップショットを直に読んではいない。activeFilters は orchestrator.ts の起動時の IIFE
  // が代入するので、最初の描画は防いでおく（起動前はどのみち木が空なので [] が正しい）。
  useSyncExternalStore(subActive, getActive);
  const activeFolderId = useSyncExternalStore(subActiveFolder, getActiveFolder);
  const folders = useSyncExternalStore(subFolders, getFolders);
  const chips = activeFilters ? activeFilters() : [];
  const posters = store.getState().browseMode === 'posters';
  const activeFolder = activeFolderId ? folders.find((f) => f.id === activeFolderId) : null;
  if (chips.length === 0 && !activeFolder) return null;
  return (
    <div data-slot="filter-chips" className="flex flex-wrap items-center gap-1.5 py-1.5">
      {activeFolder && (
        <span data-slot="filter-chip" className="inline-flex min-h-7 max-w-full items-center rounded-md border border-border bg-background pr-0.5 text-sm">
          <span className="flex shrink-0 items-center gap-1 px-1.5 text-muted-foreground">
            <CatIcon cat="folder" />
            <span className="text-xs">{t('qfCatFolder')}</span>
          </span>
          <span className="flex h-7 min-w-0 items-center border-l border-border px-1.5">
            <span className="min-w-0 truncate">{activeFolder.name}</span>
          </span>
          <button type="button" className="ml-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground" aria-label={t('qfDelete')} onClick={() => openFolder(null)}>
            <X className="size-3.5" />
          </button>
        </span>
      )}
      {chips.map((f, i) => (
        <Chip key={f.cat + ':' + i} f={f} />
      ))}
      <InlineFilterInput posters={posters} />
    </div>
  );
}
