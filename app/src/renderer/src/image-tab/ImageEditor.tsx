import { useEffect, useState } from 'react';
import ReactCrop from 'react-image-crop';
import { hologramIpc } from '../services/ipc.ts';
import { register } from '../services/image-edit-controls.ts';
import type { ImageTabItem } from './ImageTab.tsx';
import { flipEdit, rotateEdit, type ImageEdit } from './image-edit.ts';
import { fromPercentCrop, toPercentCrop } from './crop.ts';
import { useOrientedImage } from './use-oriented-image.ts';
import { handlePostsChanged } from '../services/orchestrator.ts';

export function ImageEditor({ item, onClose }: { item: ImageTabItem; onClose(): void }) {
  const [draft, setDraft] = useState<ImageEdit>(() => ({ crop: item.crop ?? null, rotation: item.rotation ?? 0, flipped: !!item.flipped }));
  const [cropping, setCropping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState('');
  const image = useOrientedImage(item.src, draft.rotation, draft.flipped);
  const busy = saving || committed || !image.src;
  useEffect(() => {
    if (committed && (item.rotation ?? 0) === draft.rotation && !!item.flipped === draft.flipped && JSON.stringify(item.crop ?? null) === JSON.stringify(draft.crop)) onClose();
  }, [committed, item.rotation, item.flipped, item.crop, draft, onClose]);
  useEffect(
    () =>
      register({
        editing: true,
        busy,
        saving,
        cropping,
        flipped: draft.flipped,
        start: () => {},
        crop: () => setCropping((v) => !v),
        rotate: () => setDraft(rotateEdit),
        flip: () => setDraft(flipEdit),
        reset: () => {
          setDraft({ crop: null, rotation: 0, flipped: false });
          setCropping(false);
        },
        cancel: onClose,
        save: () => {
          if (!item.postId || item.mediaSeq == null || busy) return;
          setSaving(true);
          setError('');
          void hologramIpc
            .setMediaEdit(item.postId, item.mediaSeq, draft)
            .then(async (result) => {
              if (result.ok) {
                setCommitted(true);
                await handlePostsChanged();
              } else setError('編集内容を保存できませんでした');
            })
            .catch(() => {
              setCommitted(false);
              setError('編集内容を保存できませんでした');
            })
            .finally(() => setSaving(false));
        },
      }),
    [item.postId, item.mediaSeq, draft, cropping, busy, saving, onClose],
  );
  const crop = draft.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  return (
    <div data-slot="image-editor" className="absolute inset-0 z-3 flex min-h-0 flex-col items-center justify-center bg-[var(--bg)] p-6">
      {image.src && (
        <ReactCrop crop={toPercentCrop(crop)} onChange={(_px, percent) => setDraft((v) => ({ ...v, crop: fromPercentCrop(percent) }))} disabled={!cropping || saving} keepSelection minWidth={12} minHeight={12} className="max-h-full max-w-full" renderSelectionAddon={() => <span data-slot="crop-selection" />}>
          <img src={image.src} alt={item.alt || ''} className="block max-h-[calc(100vh-180px)] max-w-full object-contain" draggable={false} />
        </ReactCrop>
      )}
      {!image.src && !image.error && <span>読み込み中…</span>}
      {(error || image.error) && (
        <div role="alert" className="absolute bottom-4 rounded-md bg-background p-2 text-destructive">
          {error || image.error}
        </div>
      )}
    </div>
  );
}
