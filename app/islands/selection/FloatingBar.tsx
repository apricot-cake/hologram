import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { FolderPlus, Group, ListChecks, Tag, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { t } from '../_shared/i18n.ts';
import { postIdKey } from '../../renderer/records.ts';
import { isAllSelected, selectedGroups } from '../../renderer/selection.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../../renderer/store.ts';
import { selectionClear, selectionDelete, selectionFolder, selectionGroup, selectionSelectAll, selectionTag } from '../../renderer/orchestrator.ts';

// Bottom floating selection bar (redesign §3-4 / P2⑥) — a Google-Photos / Linear-type
// capsule pinned bottom-center, shown whenever 1+ post cards are selected. It replaces
// the old top #selectionBar: the container + delegated data-act dispatcher are gone, and
// each button calls an orchestrator-exported selection action directly (onClick →
// function). The model is self-derived from corpusStore — count/allSelected/groupDisabled
// come straight from 'selectedSet' + 'postGroups' (reusing renderer/selection.ts's own
// isAllSelected/selectedGroups), same derivation the retired SelectionBar island used.
//
// Icon-forward buttons (label via tooltip + aria-label): a compact capsule is the
// Google-Photos selection-bar form, and it's what fits the content column once the right
// inspector claims 320px — a six-label bar would not. The actions stay the old inventory
// (select-all / tag / folder / group / delete / clear).
//
// Layout: rendered inside the SidebarInset content column (AppShell), so its absolute
// bottom-center placement stays clear of the right inspector. In WIDE mode the inspector
// is a flex sibling that already narrows the inset, so centering there is automatically
// clear. In NARROW mode (<1280px) the inspector is instead a fixed overlay that does NOT
// narrow the inset, so when it's open the bar reserves its 320px on the right — the same
// breakpoint the .inspector CSS switches on.
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
const INSPECTOR_OVERLAY_QUERY = '(max-width: 1279px)';

const subSelectedSet = (cb: () => void) => storeSubscribe('selectedSet', cb);
const getSelectedSet = () => storeGet('selectedSet') as Set<string> | undefined;
const subPostGroups = (cb: () => void) => storeSubscribe('postGroups', cb);
const getPostGroups = () => storeGet('postGroups') as CorpusPostGroup[] | null | undefined;
const subBrowseMode = (cb: () => void) => storeSubscribe('browseMode', cb);
const getBrowseMode = () => storeGet('browseMode') as string | undefined;
const subInspected = (cb: () => void) => storeSubscribe('inspectedKey', cb);
const getInspectorOpen = () => storeGet('inspectedKey') != null;

// Live "is the inspector currently a fixed overlay" flag = the narrow breakpoint. Its
// own external-store shim so it re-renders on a window resize across the breakpoint.
const subOverlayMode = (cb: () => void) => {
  const mql = window.matchMedia(INSPECTOR_OVERLAY_QUERY);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
};
const getOverlayMode = () => window.matchMedia(INSPECTOR_OVERLAY_QUERY).matches;

// One capsule button: icon-only, its label surfaced as a tooltip + aria-label.
function Action({ label, danger, disabled, onClick, children }: { label: string; danger?: boolean; disabled?: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button size="icon-sm" variant="ghost" disabled={disabled} aria-label={label} onClick={onClick} className={cn('rounded-full', danger && 'text-destructive hover:text-destructive hover:bg-destructive/10')}>
            {children}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function FloatingBar() {
  const selectedSet = useSyncExternalStore(subSelectedSet, getSelectedSet);
  const postGroups = useSyncExternalStore(subPostGroups, getPostGroups);
  const mode = useSyncExternalStore(subBrowseMode, getBrowseMode);
  const inspectorOpen = useSyncExternalStore(subInspected, getInspectorOpen);
  const overlayMode = useSyncExternalStore(subOverlayMode, getOverlayMode);

  const count = selectedSet ? selectedSet.size : 0;
  const shown = count > 0 && mode !== 'posters';
  const groups = postGroups || [];
  const allSelected = isAllSelected(groups, postIdKey);
  // Manual grouping needs at least two selected cards (groups).
  const groupDisabled = selectedGroups(groups, postIdKey).length < 2;
  // Reserve the inspector's 320px only when it's a fixed overlay (narrow) AND open;
  // in wide mode it's a flex sibling that already excludes itself from the inset.
  const reserveInspector = overlayMode && inspectorOpen;

  return (
    <div
      aria-hidden={!shown}
      className={cn('pointer-events-none absolute inset-x-0 bottom-6 z-50 flex justify-center pl-4 transition-[opacity,transform] duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)]', reserveInspector ? 'pr-[336px]' : 'pr-4', shown ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0')}
    >
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border bg-popover p-1 text-popover-foreground shadow-lg">
        <span className="px-2 text-sm font-medium tabular-nums whitespace-nowrap">{t('selectedCount', [count])}</span>
        <Separator orientation="vertical" className="mx-0.5 h-5" />
        <Action label={allSelected ? t('deselectAll') : t('selectAll')} onClick={() => selectionSelectAll()}>
          <ListChecks />
        </Action>
        <Action label={t('tagSelected')} onClick={(e) => selectionTag(e.currentTarget.getBoundingClientRect())}>
          <Tag />
        </Action>
        <Action label={t('folderSelected')} onClick={(e) => selectionFolder(e.currentTarget.getBoundingClientRect())}>
          <FolderPlus />
        </Action>
        <Action label={t('groupSelected')} disabled={groupDisabled} onClick={() => selectionGroup()}>
          <Group />
        </Action>
        <Action label={t('deleteSelected')} danger onClick={() => selectionDelete()}>
          <Trash2 />
        </Action>
        <Separator orientation="vertical" className="mx-0.5 h-5" />
        <Action label={t('cancelSelect')} onClick={() => selectionClear()}>
          <X />
        </Action>
      </div>
    </div>
  );
}
