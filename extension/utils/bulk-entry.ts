import { startBulkCapture } from './bulk-capture.ts';
import { getContentSite } from './extractor/index.ts';
import { createI18n } from './i18n.ts';

// 一括取り込み専用の入口。
export async function startBulkEntry(): Promise<void> {
  if (typeof window.__snsPostSaveCleanup === 'function') {
    window.__snsPostSaveCleanup();
    return;
  }
  let cancelled = false;
  const cancelPending = () => {
    cancelled = true;
    if (window.__snsPostSaveCleanup === cancelPending) {
      delete window.__snsPostSaveCleanup;
      window.__snsPostSaveActive = false;
    }
  };
  // Reserve the session before either asynchronous setup step. A second
  // activation can then cancel this pending run instead of starting alongside it.
  window.__snsPostSaveActive = true;
  window.__snsPostSaveCleanup = cancelPending;

  const site = getContentSite();
  if (!site || !(await site.isBulkCapturePage?.())) {
    cancelPending();
    return;
  }
  const i18n = await createI18n();
  if (cancelled) return;
  window.dispatchEvent(new Event('hologram:bulk-start'));
  startBulkCapture(site, i18n);
}
