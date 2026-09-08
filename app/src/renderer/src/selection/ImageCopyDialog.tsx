import { useRef, useSyncExternalStore } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { close, copyImage, get, subscribe } from '../services/image-copy.ts';
import { fileSrc } from '../services/asset-src.ts';
import { t } from '../_shared/i18n.ts';

export function ImageCopyDialogHost() {
  const files = useSyncExternalStore(subscribe, get);
  const last = useRef<string[] | null>(null);
  if (files) last.current = files;
  const shownFiles = files ?? last.current;
  return (
    <Dialog
      open={!!files}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        data-slot="image-copy-dialog"
        className="sm:w-[80vw] sm:max-w-[1100px]"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') event.stopPropagation();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('copyImageChoose')}</DialogTitle>
          <DialogDescription>{t('copyImageHint')}</DialogDescription>
        </DialogHeader>
        <div className={`grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto p-1 ${(shownFiles?.length ?? 0) > 2 ? 'sm:grid-cols-3' : ''}`}>
          {shownFiles?.map((file, index) => (
            <button
              key={file}
              type="button"
              className="rounded-md border border-border p-1 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={t('copyImageNumber', { index: index + 1 })}
              onClick={() => {
                close();
                void copyImage(file);
              }}
            >
              <img src={fileSrc(file, 640)} alt="" loading="lazy" decoding="async" className="aspect-square w-full object-contain" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
