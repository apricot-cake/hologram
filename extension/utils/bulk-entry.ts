import { startBulkCapture } from './bulk-capture.ts';
import { getContentSite } from './extractor/index.ts';
import { createI18n } from './i18n.ts';

// 一括取り込み専用の入口。
export async function startBulkEntry(): Promise<void> {
  if (typeof window.__snsPostSaveCleanup === 'function') {
    window.__snsPostSaveCleanup();
    return;
  }
  const site = getContentSite();
  if (!site || !(await site.isBulkCapturePage?.())) return;
  window.dispatchEvent(new Event('hologram:bulk-start'));
  startBulkCapture(site, await createI18n());
}
