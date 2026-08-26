import { toast } from 'sonner';
import { t } from '../_shared/i18n.ts';
import { notify } from './ui.ts';
import { exportComplete, onExportProgress } from './posts.ts';

export async function createBackupFile(includeTrash = false) {
  const id = 'hologram-export';
  toast.loading(t('exporting'), { id, description: '0%' });
  const off = onExportProgress((progress) => {
    if (!progress || progress.done) return;
    toast.loading(t('exporting'), { id, description: `${progress.pct ?? 0}%` });
  });
  try {
    const result = await exportComplete('full', includeTrash);
    off();
    toast.dismiss(id);
    if (result?.saved) notify(t('exported'));
    else if (result?.empty) notify(t('noData'));
    else if (result?.error) notify(t('exportFailed'));
    return result;
  } catch (error) {
    off();
    toast.dismiss(id);
    notify(t('exportFailed'));
    return { saved: false, error: error instanceof Error ? error.message : 'export-failed' };
  }
}
