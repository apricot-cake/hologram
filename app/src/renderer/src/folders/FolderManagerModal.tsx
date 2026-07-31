import type { DragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pencil, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { t } from '../_shared/i18n.ts';
import { promptName } from '../prompt/Prompt.tsx';
import { open as confirmOpen } from '../services/confirm.ts';
import { closeManager, getManager, managerCreate, managerMove, managerRemove, managerRename, subscribeManager } from '../services/folders.ts';

// Folder management modal — React-owned, and React-MOUNTED since #621: it used to portal
// into an empty <div id="ivFolderModal"> kept static in index.html and drive that
// element's [hidden] attribute by hand, which made "is the folder modal up?" a question
// six other modules answered by reading the DOM back. Now the overlay IS the component
// (present only while open) and everyone asks folders.ts's isManagerOpen() instead.
//
// It lists whichever store folders.ts's openManager() currently targets. Library folders
// are edited in the sidebar tree now (#41), so in practice the one caller left is the
// poster-folder facet's 管理 footer; create/rename/delete/drag-reorder all call folders.ts's
// manager* actions, which persist via that store and notify onChange so the owning view
// refreshes its chips.
//
// 残 (P3 #6): the redesign charter (#154 憲章5) retires management modals — the manager is
// the sidebar tree. That landed for LIBRARY folders in #621; POSTER folders have no tree of
// their own, so this is still their only rename / delete / reorder surface and removing it
// would delete the feature rather than move it. The look is Tailwind + the shadcn parts now,
// so the legacy sheet could go, but the surface itself waits on a poster-folder home.
// Consequence to keep in mind: its scrim is its own div, not a Base UI overlay, so the
// window-control strip's .wc-dim (globals.css) does not dim while it is up.

function dropBefore(row: HTMLElement, clientY: number) {
  const r = row.getBoundingClientRect();
  return clientY < r.top + r.height / 2;
}

function FolderManagerBox({ model }: { model: HologramFolderManagerModel }) {
  const [name, setName] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // dragstart→dragover can fire in the same tick (no yield between them, especially on a
  // fast flick), ahead of the setDragId() re-render — so the id that GATES over/drop must
  // come from a ref (always current), not the `dragId` state closure (can be stale by one
  // render). `dragId` state stays for the dimmed-row styling only, where a one-frame
  // lag is harmless.
  const dragIdRef = useRef<string | null>(null);

  // The parent keys this component by model.openId, so a fresh session (openManager())
  // remounts it from scratch — useState('') initial values already give a blank input;
  // this effect only needs to run once per mount to focus it, same as the old setTimeout-
  // after-render focus.
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  const doCreate = () => {
    if (managerCreate(name)) setName('');
  };
  const doRename = (f: HologramFolder) => {
    promptName(t('foldRenamePrompt'), f.name, (nm) => managerRename(f.id, nm));
  };
  // Same AlertDialog the sidebar tree's folder delete uses (LeftSidebar's deleteFolder) —
  // these stores are flat, so there is no subtree count to warn about.
  const doRemove = (f: HologramFolder) => {
    confirmOpen({
      message: t('foldDeleteConfirm', [f.name]),
      okLabel: t('foldDelete'),
      cancelLabel: t('confirmCancel'),
      onOk: () => managerRemove(f.id),
    });
  };
  const endDrag = () => {
    dragIdRef.current = null;
    setDragId(null);
    setDropTarget(null);
  };

  return (
    <div className="max-h-[85vh] w-full max-w-[420px] animate-in overflow-y-auto rounded-xl border border-border bg-[var(--surface)] p-[18px] text-[12px] duration-200 fade-in zoom-in-95">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="text-[13px] leading-[1.5] font-semibold break-words">{t('foldManageTitle')}</div>
        <Button variant="ghost" size="icon" className="-mt-1 -mr-1 size-7 shrink-0 text-muted-foreground" aria-label={t('confirmCancel')} onClick={closeManager}>
          <X />
        </Button>
      </div>
      <div className="my-2.5 flex gap-1.5">
        <Input ref={inputRef} type="text" className="flex-1" placeholder={t('foldNewPlaceholder')} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doCreate()} />
        <Button variant="outline" size="sm" className="shrink-0" onClick={doCreate}>
          {t('foldCreate')}
        </Button>
      </div>
      <div className="flex flex-col gap-0.5">
        {model.list.length === 0 ? (
          <div className="px-0.5 py-2.5 text-muted-foreground">{t('foldEmpty')}</div>
        ) : (
          model.list.map((f) => {
            const dragging = dragId === f.id;
            const drop = dropTarget && dropTarget.id === f.id ? (dropTarget.before ? 'shadow-[inset_0_2px_0_var(--accent)]' : 'shadow-[inset_0_-2px_0_var(--accent)]') : '';
            return (
              <div
                key={f.id}
                className={`flex cursor-grab items-center gap-2 border-b border-[var(--border-subtle)] px-1 py-1.5 ${dragging ? 'opacity-45' : ''} ${drop}`}
                draggable
                onDragStart={(e: DragEvent<HTMLDivElement>) => {
                  dragIdRef.current = f.id;
                  setDragId(f.id);
                  e.dataTransfer.effectAllowed = 'move';
                  try {
                    e.dataTransfer.setData('text/plain', f.id);
                  } catch {
                    /* some engines disallow */
                  }
                }}
                onDragOver={(e: DragEvent<HTMLDivElement>) => {
                  const draggedId = dragIdRef.current;
                  if (!draggedId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (f.id !== draggedId) setDropTarget({ id: f.id, before: dropBefore(e.currentTarget, e.clientY) });
                }}
                onDrop={(e: DragEvent<HTMLDivElement>) => {
                  const draggedId = dragIdRef.current;
                  if (!draggedId) return;
                  e.preventDefault();
                  if (f.id !== draggedId) managerMove(draggedId, f.id, dropBefore(e.currentTarget, e.clientY));
                  endDrag();
                }}
                onDragEnd={endDrag}
              >
                <span className="flex-1 break-words">{f.name}</span>
                <span className="text-[11px] text-muted-foreground">{f.items.length}</span>
                <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" aria-label={t('foldRename')} title={t('foldRename')} onClick={() => doRename(f)}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-6 text-muted-foreground hover:text-destructive" aria-label={t('foldDelete')} title={t('foldDelete')} onClick={() => doRemove(f)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function FolderManagerHost() {
  const model = useSyncExternalStore(subscribeManager, getManager);
  if (!model) return null;
  return (
    // Conditionally rendered, so its presence IS its open state — the same shape the
    // quick-view peek took in P2⑦. A click that lands on the scrim itself (not inside
    // the box) closes.
    <div
      className="fixed inset-0 z-[11000] flex animate-in items-center justify-center bg-black/50 p-6 duration-150 fade-in"
      onClick={(e: ReactMouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) closeManager();
      }}
    >
      <FolderManagerBox key={model.openId} model={model} />
    </div>
  );
}
