import { UploadCloud } from 'lucide-react';
import type { DragEvent as ReactDragEvent } from 'react';
import { useEffect, useState } from 'react';
import { t } from '../_shared/i18n.ts';
import { handleDroppedPaths, pathsFromFileList } from '../services/drop-intake.ts';

// Window-wide drop-to-import overlay (#234). Detection (dragenter/dragleave, just
// counting depth to know when to show/hide) stays a pure OBSERVER — no
// preventDefault, so it never competes with the app's own internal drag & drop
// (folder reordering, LeftSidebar.tsx) for drops that are not a file drag in the
// first place: those never carry 'Files' in dataTransfer.types, the one signal
// that reliably tells an OS file drag apart from a page-internal one (an
// internal drag's payload travels as text/plain, see LeftSidebar.tsx's
// onDragStart). The actual accept — preventDefault + read the files — happens on
// THIS component's own overlay element once it is showing: an element-scoped
// receiver layered above services/theme.ts's window-level navigation guard,
// which still catches anything nobody here handles (see that file's module
// comment; it is left in place on purpose, not replaced by this).
function isFileDrag(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.prototype.includes.call(e.dataTransfer.types, 'Files');
}

export function DropOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Depth counter: a drag over a child element fires its own enter/leave pair
    // before the window's, so a naive show-on-enter/hide-on-leave flickers at
    // every boundary crossing inside the window.
    let depth = 0;
    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      depth++;
      setVisible(true);
    };
    const onDragLeave = () => {
      if (depth === 0) return;
      depth--;
      if (depth === 0) setVisible(false);
    };
    const onWindowDrop = () => {
      // Defensive reset only — the overlay covers the whole viewport while
      // visible, so a Files drop should always land on its own onDrop below,
      // never bubble up here first.
      depth = 0;
      setVisible(false);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onWindowDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onWindowDrop);
    };
  }, []);

  if (!visible) return null;
  return (
    <div
      className="bg-background/90 fixed inset-0 z-[13600] flex flex-col items-center justify-center gap-3 border-4 border-dashed border-primary text-center"
      onDragOver={(e: ReactDragEvent<HTMLDivElement>) => {
        if (!isFileDrag(e.nativeEvent)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e: ReactDragEvent<HTMLDivElement>) => {
        if (!isFileDrag(e.nativeEvent)) return;
        e.preventDefault();
        e.stopPropagation();
        setVisible(false);
        const paths = pathsFromFileList(e.dataTransfer.files);
        void handleDroppedPaths(paths);
      }}
    >
      <UploadCloud className="size-12 text-primary" />
      <p className="text-lg font-medium">{t('dropOverlayHint')}</p>
    </div>
  );
}
