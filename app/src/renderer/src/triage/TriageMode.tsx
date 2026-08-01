import { useEffect, useState, useSyncExternalStore } from 'react';
import { CheckCheck, Inbox, X } from 'lucide-react';
import { DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { t } from '../_shared/i18n.ts';
import * as triage from '../services/triage.ts';
import { triageApplyFolder, triageApplyTag, triageCloseTriage, triageCurrentMedia, triageListFolders, triageSkip, triageUndoLast } from '../services/orchestrator.ts';

// Full-screen triage stage (#46). A Dialog like every other overlay (Esc, outside
// press and focus trap come from Base UI — see lightbox/Lightbox.tsx for the same
// composition), but the Popup IS the page rather than a centered card: triage
// replaces the grid for as long as it's open, the same "leave the browse chrome,
// this is the whole window now" feel image-tab/ gives the detail view. z-13000
// matches every other modal (Settings/Confirm/BulkTagDialog) — nothing needs to
// layer under it while a triage session owns the screen.
//
// State is read straight from triage.ts's store (pure, no deps) via
// useSyncExternalStore; the ACTIONS (apply tag/folder/skip/undo) are the bound
// orchestrator.ts exports, same split every other *Host component uses (e.g.
// image-tab/index.tsx pulling its model from services/image-tab.ts while dispatching
// through callbacks the orchestrator wired in).
//
// v1 deliberately does not reuse TagField (inspector/TagField.tsx): every queue item
// is untagged by construction, so TagField's chip list would always start empty and
// its vocabulary popover would be the only thing actually used — a plain Enter-to-add
// input keeps this component decoupled from the inspector's picker-data plumbing. A
// vocabulary-aware pick could follow later without changing the action wiring below.
// Likewise there is no zoom/pan (image-tab/ImageTab.tsx's Zoomable) or ugoira
// playback: triage is a fast glance-and-decide pass, not inspection — a post that
// needs a closer look can be tagged broadly here and refined afterward in the grid.

function ProgressLabel({ idx, total }: { idx: number; total: number }) {
  return (
    <div className="tabular-nums text-muted-foreground text-sm" data-slot="triage-progress">
      {t('triageProgress', [Math.min(idx + 1, total), total])}
    </div>
  );
}

function PinSlot({ slot, tag }: { slot: number; tag: string }) {
  const [draft, setDraft] = useState('');
  const [popOpen, setPopOpen] = useState(false);
  if (tag) {
    return (
      <div className="group relative inline-flex items-center" data-slot="triage-pin-slot" data-pinned="true">
        <Button type="button" variant="outline" size="sm" className="gap-1 pr-6" onClick={() => void triageApplyTag(tag)}>
          <span className="rounded bg-muted px-1 font-mono text-[10px] tabular-nums">{slot + 1}</span>
          {tag}
        </Button>
        <button type="button" aria-label={t('triagePinClear')} title={t('triagePinClear')} onClick={() => triage.setPinnedTag(slot, null)} className="absolute right-1 rounded-full p-0.5 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100">
          <X className="size-3" />
        </button>
      </div>
    );
  }
  return (
    <Popover
      open={popOpen}
      onOpenChange={(next) => {
        setPopOpen(next);
        if (next) setDraft('');
      }}
    >
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" size="sm" aria-label={t('triagePinEmpty')} title={t('triagePinEmpty')} className="border-dashed text-muted-foreground">
            <span className="rounded bg-muted px-1 font-mono text-[10px] tabular-nums">{slot + 1}</span>+
          </Button>
        }
      />
      <PopoverContent className="w-56" side="top">
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const v = draft.trim();
            if (v) triage.setPinnedTag(slot, v);
            setPopOpen(false);
          }}
        >
          <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('triagePinInputPlaceholder')} />
          <Button type="submit" size="sm">
            {t('triagePinSave')}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function FolderPopover({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [query, setQuery] = useState('');
  const folders = triageListFolders().filter((f) => !query.trim() || f.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) setQuery('');
      }}
    >
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            {t('triageFolderButton')}
          </Button>
        }
      />
      <PopoverContent className="w-64" side="top">
        <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('triageFolderSearchPlaceholder')} />
        <div className="mt-1.5 max-h-56 overflow-y-auto">
          {folders.length === 0 ? (
            <div className="px-1 py-2 text-muted-foreground text-xs">{t('triageFolderEmpty')}</div>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                type="button"
                className="block w-full cursor-default rounded-sm px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onOpenChange(false);
                  triageApplyFolder(f.id);
                }}
              >
                {f.name}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TriageStage({ state }: { state: triage.TriageState }) {
  const [tagDraft, setTagDraft] = useState('');
  const [folderOpen, setFolderOpen] = useState(false);
  const g = triage.current();
  const media = triageCurrentMedia();
  const total = state.queue.length;

  // 'F' opens the folder popover — UI-only, so it stays local to this component
  // rather than triage-builder.ts's handleTriageKey (which owns the data actions:
  // 1-9 quick-tag / Space skip / Backspace undo — see that module's file header).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFolderOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (total === 0) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Inbox />
          </EmptyMedia>
          <EmptyTitle>{t('triageEmptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('triageEmptyDesc')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => triageCloseTriage()}>
            {t('triageClose')}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  if (!g) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CheckCheck />
          </EmptyMedia>
          <EmptyTitle>{t('triageDoneTitle')}</EmptyTitle>
          <EmptyDescription>{t('triageDoneDesc')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => triageCloseTriage()}>
            {t('triageClose')}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  return (
    <div data-slot="triage-stage" className="flex h-full min-h-0 w-full flex-col">
      {/* pr-[--window-controls-w]: WindowControls.tsx portals the OS-style min/max/close
          strip at a fixed top-right, z-[13600] — above this dialog's z-13000 — so
          without this reserve triage's own close button paints right under it and
          becomes unclickable (the same reserve AppShell's titlebar band applies to
          the tab strip; caught this by screenshot, the button was invisible). */}
      <div className="flex items-center justify-between border-b py-2 pr-[var(--window-controls-w,138px)] pl-4">
        <ProgressLabel idx={state.idx} total={total} />
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('triageClose')} title={t('triageClose')} onClick={() => triageCloseTriage()} className="mr-2">
          <X />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
        {media &&
          (media.video ? (
            <video key={media.src} data-slot="triage-media" className="max-h-full max-w-full object-contain" src={media.src} controls playsInline preload="metadata" />
          ) : (
            <img key={media.poster || media.src} data-slot="triage-media" className="max-h-full max-w-full object-contain" src={media.poster || media.src} alt={media.alt || ''} decoding="async" />
          ))}
      </div>
      <div className="flex flex-col gap-2 border-t px-4 py-3">
        {state.lastAction && (
          <div className="flex items-center gap-2 text-muted-foreground text-xs" data-slot="triage-last-action">
            <span>{state.lastAction.label}</span>
            <Button type="button" variant="ghost" size="sm" className="h-5 px-1.5 text-xs" onClick={() => triageUndoLast()}>
              {t('triageUndo')} (Backspace)
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <form
            className="mr-1 flex-1 basis-48"
            onSubmit={(e) => {
              e.preventDefault();
              const v = tagDraft.trim();
              if (v) void triageApplyTag(v);
            }}
          >
            <Input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder={t('triageTagPlaceholder')} />
          </form>
          {Array.from({ length: 9 }, (_, i) => (
            <PinSlot key={i} slot={i} tag={state.pinnedTags[i] || ''} />
          ))}
          <FolderPopover open={folderOpen} onOpenChange={setFolderOpen} />
          <Button type="button" variant="outline" size="sm" onClick={() => triageSkip()}>
            {t('triageSkip')} (Space)
          </Button>
        </div>
        <div className="text-muted-foreground text-xs">{t('triageHint')}</div>
      </div>
    </div>
  );
}

export function TriageMode() {
  const state = useSyncExternalStore(triage.subscribe, triage.get);
  return (
    <DialogPrimitive.Root
      open={state.open}
      onOpenChange={(next) => {
        if (!next) triageCloseTriage();
      }}
    >
      <DialogPortal>
        <DialogOverlay className="bg-background" />
        <DialogPrimitive.Popup className="fixed inset-0 z-[13000] flex outline-none duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)] data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0">
          <DialogTitle className="sr-only">{t('cmdTriageStart')}</DialogTitle>
          {/* Keyed on the current item: remounting on every advance is what resets the
              tag-draft input and closes the folder popover for the next post, without
              an effect whose only dependency (the item's identity) never appears in
              its own body — the same reset-via-remount ImageTab's Zoomable slide uses
              (image-tab/ImageTab.tsx, keyed on item.src). */}
          <TriageStage key={triage.current()?.key || String(state.idx)} state={state} />
        </DialogPrimitive.Popup>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
