import type { ReactNode } from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FolderPlus, Group, ListChecks, Tag, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { t } from '../_shared/i18n.ts';
import { postIdKey } from '../services/records.ts';
import { isAllSelected, selectedGroups } from '../services/selection.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';
import { selectionClear, selectionDelete, selectionFolder, selectionGroup, selectionSelectAll, selectionTag } from '../services/orchestrator.ts';

// Bottom floating selection bar (redesign §3-4 / P2⑥) — a Google-Photos / Linear-type
// capsule pinned bottom-center, shown whenever 1+ post cards are selected. It replaces
// the old top #selectionBar: the container + delegated data-act dispatcher are gone, and
// each button calls an orchestrator-exported selection action directly (onClick →
// function). The model is self-derived from hologramStore — count/allSelected/groupDisabled
// come straight from 'selectedSet' + 'postGroups' (reusing services/selection.ts's own
// isAllSelected/selectedGroups), same derivation the retired SelectionBar component used.
//
// Each action shows an icon + a text label (the old inventory: select-all / tag / folder
// / group / delete / clear). The labels are RESPONSIVE to available width: the full
// wording ("タグを追加") when there's room, a short form ("タグ") when the bar is squeezed
// (a narrow window, an open inspector, an expanded sidebar) — so it stays readable
// instead of collapsing to bare icons. Clear (✕) is the one icon-only button (universal).
// The full wording is always the accessible name.
//
// Layout: rendered inside the SidebarInset content column (AppShell), so its absolute
// bottom-center placement stays clear of the right inspector — which since #243 is ALWAYS
// a flex sibling that narrows the inset, at every window width. That retired the old
// reservation branch (the inspector used to detach into a fixed overlay below 1280px, and
// the bar had to hold back 320px for it).
//
// The full/short label switch therefore no longer keys off a window breakpoint at all: it asks
// the bar's own box whether the full wording fits (ResizeObserver). Same visible behavior,
// but driven by the actual space rather than by a proxy for it — so it also stays correct
// when the sidebar collapses or the inspector opens, neither of which moves the viewport.
//
// Selection only ever exists in the post grid (poster cards drill in, they don't
// multi-select), so the bar also hides in the posters view to never strand a stale
// capsule after a mode switch. The store's 'browseMode' key is unset (undefined) at boot
// — it's only written on a real posts⇄posters change — so the test mirrors the shell's
// own convention (App's ShellClasses / LeftSidebar): posters is the explicit value,
// anything else (including the unset boot state) is posts.
//
// Motion: the element stays mounted and slides/fades between shown and hidden states via
// one CSS transition (both directions — no exit-presence library, redesign §3-10a). The
// wrapper is pointer-events-none so it never covers the grid; only the capsule itself
// takes clicks.

// Width the capsule needs for the full labels (measured: 638px) plus the wrapper's own
// horizontal padding. Below it the short forms are used.
const FULL_LABEL_MIN_W = 670;

const subSelectedSet = (cb: () => void) => storeSubscribe('selectedSet', cb);
const getSelectedSet = () => storeGet('selectedSet') as Set<string> | undefined;
const subPostGroups = (cb: () => void) => storeSubscribe('postGroups', cb);
const getPostGroups = () => storeGet('postGroups') as HologramPostGroup[] | null | undefined;
const subBrowseMode = (cb: () => void) => storeSubscribe('browseMode', cb);
const getBrowseMode = () => storeGet('browseMode') as string | undefined;
// Derived once by AppShell (width + toggle + selection); read here, not re-derived.
const subInspectorOverlay = (cb: () => void) => storeSubscribe('inspectorOverlay', cb);
const getInspectorOverlay = () => !!storeGet('inspectorOverlay');
// Does the bar's own box still fit the full labels? Watching the element (not the
// viewport) is what makes this correct when the inspector opens or the sidebar collapses
// — both change the room available here without the window changing size at all.
function useFitsFullLabels(ref: React.RefObject<HTMLDivElement | null>): boolean {
  const [fits, setFits] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number') setFits(w >= FULL_LABEL_MIN_W);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return fits;
}

// One capsule button: icon + visible label; `title` (the full wording) is the accessible
// name even when the visible `label` is shortened.
function Action({ label, title, danger, disabled, onClick, children }: { label: string; title: string; danger?: boolean; disabled?: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode }) {
  return (
    <Button size="sm" variant="ghost" disabled={disabled} aria-label={title} onClick={onClick} className={cn('rounded-full', danger && 'text-destructive hover:bg-destructive/10 hover:text-destructive')}>
      {children}
      {label}
    </Button>
  );
}

export function FloatingBar() {
  const selectedSet = useSyncExternalStore(subSelectedSet, getSelectedSet);
  const postGroups = useSyncExternalStore(subPostGroups, getPostGroups);
  const mode = useSyncExternalStore(subBrowseMode, getBrowseMode);
  const wrapRef = useRef<HTMLDivElement>(null);
  const showFull = useFitsFullLabels(wrapRef);
  const inspectorOverlay = useSyncExternalStore(subInspectorOverlay, getInspectorOverlay);

  const count = selectedSet ? selectedSet.size : 0;
  // ...and in the trash (#268), which carries its OWN selection and its own two
  // verbs: this bar's tag / folder / group actions all write to the library, which
  // is exactly what a deleted post must not accept until it is restored.
  const shown = count > 0 && mode !== 'posters' && mode !== 'trash';
  const groups = postGroups || [];
  const allSelected = isAllSelected(groups, postIdKey);
  // Manual grouping needs at least two selected cards (groups).
  const groupDisabled = selectedGroups(groups, postIdKey).length < 2;
  return (
    <div
      ref={wrapRef}
      data-slot="selection-bar"
      aria-hidden={!shown}
      // Hold back the inspector's width while it OVERLAYS the grid (#259). As a docked
      // column it narrows this bar's container instead, and centering needs no help —
      // hence the flag rather than "is the inspector open".
      style={inspectorOverlay ? { paddingRight: 'calc(var(--inspector-w) + 1rem)' } : undefined}
      className={cn('pointer-events-none absolute inset-x-0 bottom-6 z-50 flex justify-center px-4 transition-[opacity,transform] duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)]', shown ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0')}
    >
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border bg-popover p-1 text-popover-foreground shadow-lg">
        <span className="px-2 text-sm font-medium tabular-nums whitespace-nowrap">{t('selectedCount', [count])}</span>
        <Separator orientation="vertical" className="mx-0.5 h-5" />
        <Action label={allSelected ? t('deselectAll') : t('selectAll')} title={allSelected ? t('deselectAll') : t('selectAll')} onClick={() => selectionSelectAll()}>
          <ListChecks />
        </Action>
        <Action label={showFull ? t('tagSelected') : t('selTag')} title={t('tagSelected')} onClick={() => selectionTag()}>
          <Tag />
        </Action>
        <Action label={showFull ? t('folderSelected') : t('selFolder')} title={t('folderSelected')} onClick={(e) => selectionFolder(e.currentTarget)}>
          <FolderPlus />
        </Action>
        <Action label={t('groupSelected')} title={t('groupSelected')} disabled={groupDisabled} onClick={() => selectionGroup()}>
          <Group />
        </Action>
        <Action label={showFull ? t('deleteSelected') : t('selDelete')} title={t('deleteSelected')} danger onClick={() => selectionDelete()}>
          <Trash2 />
        </Action>
        <Separator orientation="vertical" className="mx-0.5 h-5" />
        <Button size="icon-sm" variant="ghost" className="rounded-full" aria-label={t('cancelSelect')} onClick={() => selectionClear()}>
          <X />
        </Button>
      </div>
    </div>
  );
}
