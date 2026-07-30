import type { DragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { t } from '../_shared/i18n.ts';
import { promptName } from '../prompt/Prompt.tsx';
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
// TRANSIENT: the .iv-detail-overlay / .iv-detail-box classes are still legacy CSS. This
// surface is not one of the redesigned ones, so it keeps them until either it is reworked
// or P3 (#6) sweeps the layer.

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
  // render). `dragId` state stays for the .iv-dragging CSS class only, where a one-frame
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
  const doRemove = (f: HologramFolder) => {
    if (window.confirm(t('foldDeleteConfirm', [f.name]))) managerRemove(f.id);
  };
  const endDrag = () => {
    dragIdRef.current = null;
    setDragId(null);
    setDropTarget(null);
  };

  return (
    <div className="iv-detail-box">
      <button className="iv-insp-close" id="ivFolderClose" type="button" onClick={closeManager}>
        ×
      </button>
      <div className="iv-insp-title">{t('foldManageTitle')}</div>
      <div className="iv-folder-new">
        <input
          ref={inputRef}
          id="ivFolderNewName"
          type="text"
          className="search-box"
          placeholder={t('foldNewPlaceholder')}
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doCreate();
          }}
        />
        <button className="iv-htbtn" id="ivFolderCreate" type="button" onClick={doCreate}>
          {t('foldCreate')}
        </button>
      </div>
      <div id="ivFolderList" className="iv-folder-list">
        {model.list.length === 0 ? (
          <div className="iv-folder-empty">{t('foldEmpty')}</div>
        ) : (
          model.list.map((f) => {
            const cls = ['iv-folder-row'];
            if (dragId === f.id) cls.push('iv-dragging');
            if (dropTarget && dropTarget.id === f.id) cls.push(dropTarget.before ? 'iv-drop-before' : 'iv-drop-after');
            return (
              <div
                key={f.id}
                className={cls.join(' ')}
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
                <span className="iv-fold-name">{f.name}</span>
                <span className="iv-fold-n">{f.items.length}</span>
                <button className="iv-fold-btn" type="button" title={t('foldRename')} onClick={() => doRename(f)}>
                  ✎
                </button>
                <button className="iv-fold-btn" type="button" title={t('foldDelete')} onClick={() => doRemove(f)}>
                  🗑
                </button>
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
      className="iv-detail-overlay"
      onClick={(e: ReactMouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) closeManager();
      }}
    >
      <FolderManagerBox key={model.openId} model={model} />
    </div>
  );
}
