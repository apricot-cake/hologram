import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, FolderPlus, Pin as PinIcon, PinOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ImageTab } from '../image-tab/ImageTab.tsx';
import type { ImageTabModel } from '../image-tab/ImageTab.tsx';
import { ViewerToolbar } from '../image-tab/ViewerToolbar.tsx';
import { PromptHost, promptName } from '../prompt/Prompt.tsx';
import { t } from '../_shared/i18n.ts';
import { fileSrc } from '../services/asset-src.ts';
import { hologramIpc } from '../services/ipc.ts';
import type { PinItem } from '../../../main/ipc-payloads.ts';

// The pin (floating mini-viewer) window's whole UI (#79) — a tile grid that
// opens into a one-at-a-time detail view sharing the main window's own
// ImageTab/ViewerToolbar (zoom/flip/grid/grayscale come free that way). No
// AppShell, no orchestrator: the set lives in this component's own state,
// seeded once from pin-get-initial and appended to by pin-items-added — never
// persisted, never written back to the library (removing a tile here only
// ever changes THIS array).

function dedupeAppend(existing: PinItem[], added: PinItem[]): PinItem[] {
  const seen = new Set(existing.map((it) => it.file));
  const fresh = added.filter((it) => it.file && !seen.has(it.file));
  return fresh.length ? [...existing, ...fresh] : existing;
}

export function PinApp() {
  const [items, setItems] = useState<PinItem[]>([]);
  const [view, setView] = useState<'grid' | 'detail'>('grid');
  const [idx, setIdx] = useState(0);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  // The keydown effect below closes over `items`/`idx` only at mount time
  // (it subscribes once); a ref keeps ArrowRight's wrap math current without
  // re-subscribing the listener on every append.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    hologramIpc.pinGetInitial().then((initial) => {
      if (initial.length) setItems((prev) => dedupeAppend(prev, initial));
    });
    return hologramIpc.onPinItemsAdded((added) => setItems((prev) => dedupeAppend(prev, added)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view !== 'detail') return;
      if (e.key === 'Escape') {
        setView('grid');
        return;
      }
      // ← at the first tile exits to the grid (there is nothing before it to
      // page to); everywhere else it pages, same as → always does.
      if (e.key === 'ArrowLeft') {
        if (idx === 0) setView('grid');
        else setIdx((i) => i - 1);
      } else if (e.key === 'ArrowRight') {
        setIdx((i) => (i + 1) % Math.max(1, itemsRef.current.length));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, idx]);

  const openDetail = (i: number) => {
    setIdx(i);
    setView('detail');
  };
  const removeAt = (i: number) => {
    setItems((prev) => {
      const next = prev.filter((_, n) => n !== i);
      if (view === 'detail') {
        if (!next.length) setView('grid');
        else setIdx((cur) => Math.max(0, Math.min(cur >= i ? cur - 1 : cur, next.length - 1)));
      }
      return next;
    });
  };
  const toggleAlwaysOnTop = () => {
    hologramIpc.pinToggleAlwaysOnTop().then(setAlwaysOnTop);
  };
  const saveAsFolder = () => {
    if (!items.length) return;
    promptName(t('pinSaveFolderPrompt'), '', (name) => {
      hologramIpc.pinSaveAsFolder(name, items.map((it) => it.captureId).filter(Boolean));
    });
  };

  const clampedIdx = Math.max(0, Math.min(idx, items.length - 1));
  const model: ImageTabModel = {
    tabId: 'pin',
    items: items.map((it) => ({ src: fileSrc(it.file), video: it.video })),
    idx: clampedIdx,
    labels: {
      missing: t('imgTabMissing'),
      missingDesc: t('imgTabMissingDesc'),
      closeTab: t('pinBackToGrid'),
      prev: t('lbPrev'),
      next: t('lbNext'),
      info: t('tipInfo'),
    },
    onIndexChange: setIdx,
    onCloseTab: () => setView('grid'),
  };

  return (
    <div className="bg-background text-foreground flex h-screen w-screen flex-col overflow-hidden">
      {/* app-drag (globals.css's @utility, same pair the main window's own
          titlebar uses): the whole strip moves the window except the three
          buttons, each opted back out with app-no-drag. */}
      <div data-slot="pin-titlebar" className="app-drag flex h-7 shrink-0 items-center justify-end gap-0.5 border-b px-1">
        <Button variant="ghost" size="icon-sm" className="app-no-drag" aria-pressed={alwaysOnTop} aria-label={t('pinAlwaysOnTop')} onClick={toggleAlwaysOnTop}>
          {alwaysOnTop ? <PinIcon className="size-3.5" /> : <PinOff className="size-3.5" />}
        </Button>
        <Button variant="ghost" size="icon-sm" className="app-no-drag" aria-label={t('pinSaveFolder')} disabled={!items.length} onClick={saveAsFolder}>
          <FolderPlus className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" className="app-no-drag" aria-label={t('pinClose')} onClick={() => hologramIpc.windowControl('close')}>
          <X className="size-3.5" />
        </Button>
      </div>
      {view === 'detail' && items.length ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-1 py-0.5">
            <Button variant="ghost" size="icon-sm" aria-label={t('pinBackToGrid')} onClick={() => setView('grid')}>
              <ChevronLeft className="size-4" />
            </Button>
            <ViewerToolbar />
            <Button variant="ghost" size="icon-sm" aria-label={t('tipDelete')} onClick={() => removeAt(clampedIdx)}>
              <X className="size-4" />
            </Button>
          </div>
          <ImageTab model={model} />
        </div>
      ) : (
        <PinGrid items={items} onOpen={openDetail} onRemove={removeAt} />
      )}
      <PromptHost />
    </div>
  );
}

function PinGrid({ items, onOpen, onRemove }: { items: PinItem[]; onOpen: (i: number) => void; onRemove: (i: number) => void }) {
  if (!items.length) {
    return <div className="text-muted-foreground flex flex-1 items-center justify-center p-4 text-center text-sm">{t('pinEmpty')}</div>;
  }
  return (
    <div className="flex flex-1 flex-wrap content-start gap-1.5 overflow-y-auto p-1.5">
      {items.map((it, i) => (
        <div key={it.file} className="group relative size-24 shrink-0 overflow-hidden rounded-md border">
          <button type="button" className="block size-full cursor-pointer" onClick={() => onOpen(i)}>
            {it.video ? <video src={fileSrc(it.file)} className="size-full object-cover" muted /> : <img src={fileSrc(it.file, 200)} alt="" className="size-full object-cover" draggable={false} />}
          </button>
          <button type="button" aria-label={t('tipDelete')} className="bg-background/80 text-foreground absolute top-1 right-1 hidden size-5 items-center justify-center rounded-full group-hover:flex" onClick={() => onRemove(i)}>
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
