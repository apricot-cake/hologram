// #777: "このタグを分割…" -- the row-menu action for splitting an existing tag
// entity's posts into a new same-name entity (disambiguated by a display
// parent), reviewed thumbnail-by-thumbnail. Two steps in one dialog:
//  1. pick the new entity's display parent -- the same input shape as the
//     rename-collision "keep separate" branch (TagManagementPage.tsx), since a
//     parent is required so the two same-name tags stay distinguishable on
//     sight (#21 2026-07-18 comment item 2).
//  2. thumbnail review: every post carrying the source tag, pre-selected to
//     move to the new entity when it co-occurs with the chosen parent tag
//     (the acceptance line "共起する表示親タグを持つ投稿が初期選択される");
//     clicking a thumbnail flips it between staying and moving.
// Confirming calls split-tag once; like rename/merge elsewhere on this page,
// this is not an undo-tracked action.
import { useState } from 'react';
import { t } from '../_shared/i18n.ts';
import { hologramIpc } from '../services/ipc.ts';
import { fileSrc } from '../services/asset-src.ts';
import { notify } from '../services/ui.ts';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { TagSplitPost, TagVocabRow } from '../../../main/ipc-payloads.ts';

export function TagSplitDialog({ tagId, tagName, allTags, onClose, onDone }: { tagId: number; tagName: string; allTags: TagVocabRow[]; onClose: () => void; onDone: () => void }) {
  const [parentId, setParentId] = useState('');
  const [step, setStep] = useState<'parent' | 'review'>('parent');
  const [preview, setPreview] = useState<TagSplitPost[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // A same-name split disambiguates against SOME OTHER tag, never itself.
  const parentCandidates = allTags.filter((r) => r.id !== tagId);
  const parentLabel = parentCandidates.find((r) => String(r.id) === parentId)?.displayName ?? '';

  const startReview = async (chosenParentId: number) => {
    setStep('review');
    setPreview(null);
    const rows = await hologramIpc.getTagSplitPreview(tagId, chosenParentId);
    setPreview(rows);
    setSelected(new Set(rows.filter((r) => r.suggestedToNew).map((r) => r.postId)));
  };

  const toggle = (postId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  };

  const confirm = async () => {
    const res = await hologramIpc.splitTag(tagId, Number(parentId), [...selected]);
    if (!res.ok) {
      notify(t('tagMgmtErrorGeneric'));
      return;
    }
    onDone();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={step === 'review' ? 'sm:max-w-3xl' : undefined}>
        {step === 'parent' ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('tagMgmtSplitParentTitle', [tagName])}</DialogTitle>
              <DialogDescription>{t('tagMgmtSplitParentDesc')}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 py-2">
              <label className="text-sm font-medium" htmlFor="tag-split-parent">
                {t('tagMgmtKeepSeparateParentLabel')}
              </label>
              <select id="tag-split-parent" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">{t('tagMgmtKeepSeparateParentPh')}</option>
                {parentCandidates.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.displayName}
                  </option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                {t('tagMgmtCancel')}
              </Button>
              <Button disabled={!parentId} onClick={() => parentId && startReview(Number(parentId))}>
                {t('tagMgmtSplitNext')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('tagMgmtSplitReviewTitle', [tagName])}</DialogTitle>
              <DialogDescription>{t('tagMgmtSplitReviewDesc', [parentLabel])}</DialogDescription>
            </DialogHeader>
            {preview === null ? (
              <div className="p-6 text-sm text-muted-foreground">{t('tagMgmtLoading')}</div>
            ) : preview.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">{t('tagMgmtSplitEmpty')}</div>
            ) : (
              <div className="grid max-h-[55vh] grid-cols-4 gap-2 overflow-auto py-2 sm:grid-cols-6">
                {preview.map((p) => {
                  const toNew = selected.has(p.postId);
                  return (
                    <button key={p.postId} type="button" className={cn('relative aspect-square overflow-hidden rounded-md border-2 bg-[var(--surface-2)]', toNew ? 'border-primary' : 'border-transparent')} onClick={() => toggle(p.postId)}>
                      {p.thumbFile ? <img src={fileSrc(p.thumbFile, 200)} className="size-full object-cover" alt="" loading="lazy" /> : <div className="flex size-full items-center justify-center text-lg text-muted-foreground">{'▶'}</div>}
                      <span className={cn('absolute inset-x-0 bottom-0 truncate px-1 py-0.5 text-center text-[10px] text-white', toNew ? 'bg-primary/85' : 'bg-black/65')}>{toNew ? t('tagMgmtSplitToNew') : t('tagMgmtSplitStay')}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <DialogFooter>
              <div className="mr-auto text-xs text-muted-foreground">{t('tagMgmtSplitCount', [selected.size, (preview?.length ?? 0) - selected.size])}</div>
              <Button variant="outline" onClick={onClose}>
                {t('tagMgmtCancel')}
              </Button>
              <Button disabled={!preview?.length || !selected.size} onClick={confirm}>
                {t('tagMgmtSplitConfirm')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
