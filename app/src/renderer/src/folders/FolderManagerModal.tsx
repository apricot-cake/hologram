import type { DragEvent } from 'react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../_shared/i18n.ts';
import { closeManager, getManager, managerCreate, managerMove, managerRemove, managerRename, subscribeManager } from '../../renderer/folders.ts';

// Shared folder management modal (#ivFolderModal) — React-owned. Lists whichever
// store folders.ts's openManager() currently targets (the library collections store by
// default, or the poster folder store when opened via openManager({store, onChange}) — see
// folders.ts); create/rename/delete/drag-reorder all call folders.ts's manager* actions,
// which persist via that store and notify onChange so the owning view refreshes its chips.
// #ivFolderModal stays the portal target (its [hidden] attribute + .iv-detail-box CSS hooks
// are unchanged) — same "empty static container, React owns the content + visibility"
// pattern as ConfirmHost/#confirmOverlay.

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
    const nm = window.prompt(t('foldRenamePrompt'), f.name);
    if (nm != null) managerRename(f.id, nm);
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
  // #ivFolderModal's CSS keys on [hidden] (not a .show class, unlike confirmOverlay) —
  // toggle it before paint so there's no open/close flash.
  useLayoutEffect(() => {
    const el = document.getElementById('ivFolderModal');
    if (el) el.hidden = !model;
  }, [model]);
  // Backdrop click (on #ivFolderModal itself, outside .iv-detail-box) closes — attached
  // once on the static element, same idiom as ConfirmHost/LightboxHost.
  useEffect(() => {
    const el = document.getElementById('ivFolderModal');
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      if (e.target === el) closeManager();
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, []);
  const host = document.getElementById('ivFolderModal');
  return model && host ? createPortal(<FolderManagerBox key={model.openId} model={model} />, host) : null;
}
