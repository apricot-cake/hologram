// 完全バックアップZIPの取り込み。
import { importComplete } from './posts.ts';
import { loadPosts } from './post-grid-builder.ts';
import { notify } from './ui.ts';
import { t } from '../_shared/i18n.ts';

async function reportDone(imported: number, skipped: number): Promise<void> {
  if (loadPosts) await loadPosts();
  if (skipped > 0) notify(t('importSkipped', [imported, skipped]));
  else notify(t('imported', [imported]));
}

export async function runZipImport(): Promise<void> {
  try {
    const res = await importComplete();
    if (res && res.canceled) return;
    notify(t('importing'));
    if (!res || !res.ok) {
      if (loadPosts) await loadPosts();
      notify(t('importFailed'));
      return;
    }
    // ok で答えた完全なインポートは常に両方のカウンタを運ぶ。フォールバック
    // は、平坦な結果の形（ipc-payloads.ts）が強いているだけのもの。
    await reportDone(res.imported ?? 0, res.skipped ?? 0);
  } catch {
    notify(t('importFailed'));
  }
}
