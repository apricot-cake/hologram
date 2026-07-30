import { useState, useEffect } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Highlight } from '../components/Highlight.tsx';
import { t } from '../../_shared/i18n.ts';
import { listTrash, restorePost, deleteFromTrash, emptyTrash } from '../../services/trash.ts';

// Soft-deleted record as returned by the list-trash IPC — only the fields used here.
interface TrashRecord {
  captureId?: string;
  image?: string;
  video?: string;
  title?: string;
  screenName?: string;
  platform?: string;
  trashedAt?: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtDate = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
};

// ゴミ箱: soft-deleted records with restore / permanent-delete / empty-all.
// The empty-all confirm is a shadcn AlertDialog (replaces window.confirm).
export function Trash() {
  const [records, setRecords] = useState<TrashRecord[]>([]);

  const load = async () => {
    try {
      setRecords((await listTrash()) || []);
    } catch {
      setRecords([]);
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once initial load (load is re-created per render but behaviorally stable)
  useEffect(() => {
    load();
  }, []);

  const restore = async (r: TrashRecord) => {
    try {
      await restorePost((r.image || r.video || r.captureId) as string);
    } catch {
      /* ignore */
    }
    await load();
  };
  const perma = async (r: TrashRecord) => {
    try {
      await deleteFromTrash(r.captureId as string);
    } catch {
      /* ignore */
    }
    await load();
  };
  const emptyAll = async () => {
    try {
      await emptyTrash();
    } catch {
      /* ignore */
    }
    await load();
  };

  return (
    <div className="space-y-3">
      <div className="text-muted-foreground text-sm">
        <Highlight text={records.length ? t('trashCount', [records.length]) : t('trashEmpty')} />
      </div>

      {records.length > 0 && (
        <div className="max-h-64 divide-y overflow-y-auto rounded-lg border">
          {records.map((r) => {
            const title = r.title || r.screenName || r.captureId || '';
            const platform = r.platform || '';
            const date = fmtDate(r.trashedAt);
            return (
              <div key={r.captureId || r.image || r.video} className="flex items-center gap-3 p-2.5">
                {r.image ? (
                  // decoding="async" (#569): a scrollable list of these can be decoding
                  // together, same call as PostCard's card thumbnail.
                  <img src={'asset://' + r.image} className="size-9 shrink-0 rounded-md object-cover" loading="lazy" decoding="async" alt="" />
                ) : (
                  <span className="bg-muted size-9 shrink-0 rounded-md" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{title}</div>
                  <div className="text-muted-foreground text-xs">{`${platform} ${date}`}</div>
                </div>
                <Button variant="outline" size="xs" className="shrink-0" onClick={() => restore(r)}>
                  {t('trashRestoreBtn')}
                </Button>
                <Button variant="destructive" size="xs" className="shrink-0" onClick={() => perma(r)}>
                  {t('trashDeleteBtn')}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="destructive" disabled={!records.length} />}>{t('trashEmptyBtn')}</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('trashEmptyBtn')}</AlertDialogTitle>
            <AlertDialogDescription>{t('trashEmptyConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('confirmCancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={emptyAll}>{t('trashEmptyBtn')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
