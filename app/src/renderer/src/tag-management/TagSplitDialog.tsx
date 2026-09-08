// #777: 「このタグを分割…」＝行のメニューにある操作で、既存のタグ実体が持つ投稿を、
// 同名の新しい実体（表示に使う親タグで曖昧さを回避する）へ分ける。サムネイルを1枚ずつ
// 見て決める。1つのダイアログで2段階:
//  1. 新しい実体の表示に使う親タグを選ぶ＝改名の衝突の「別のタグとして残す」の枝
//     （TagManagementPage.tsx）と同じ入力の形。同名のタグ2つが見た目で区別できる
//     ままであるよう、親タグは必須（#21 2026-07-18 のコメントの項目2）。
//  2. サムネイルでの確認: 元のタグが付いた投稿をすべて並べ、選んだ親タグと共起する
//     ものは新しい実体へ移す側に初期選択しておく（受け入れ条件の行
//     「共起する表示親タグを持つ投稿が初期選択される」）。サムネイルをクリックすると、
//     元のままと移すの間で切り替わる。
// 確定すると split-tag を1回呼ぶ。このページの改名・統合と同じく、undo の追跡対象には
// ならない。
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

  // 同名の分割が曖昧さを回避する相手は必ず他のタグで、自分自身は決して相手にしない。
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
              <DialogTitle>{t('tagMgmtSplitParentTitle', { name: tagName })}</DialogTitle>
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
              <DialogTitle>{t('tagMgmtSplitReviewTitle', { name: tagName })}</DialogTitle>
              <DialogDescription>{t('tagMgmtSplitReviewDesc', { name: parentLabel })}</DialogDescription>
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
              <div className="mr-auto text-xs text-muted-foreground">{t('tagMgmtSplitCount', { selected: selected.size, remaining: (preview?.length ?? 0) - selected.size })}</div>
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
