import { startBulkCapture } from './bulk-capture.ts';
import { getContentSite } from './extractor/index.ts';
import { createI18n } from './i18n.ts';

export interface BulkEntryReservation {
  readonly owner: symbol;
  cancel(): void;
}

let reservedOwner: symbol | undefined;

/** 非同期のページ判定より前に、一括取り込みの開始権を一つだけ確保する。 */
export function reserveBulkEntry(): BulkEntryReservation | undefined {
  if (reservedOwner || typeof window.__snsPostSaveCleanup === 'function') return undefined;
  const owner = Symbol('bulk-entry');
  reservedOwner = owner;
  return {
    owner,
    cancel() {
      if (reservedOwner === owner) reservedOwner = undefined;
    },
  };
}

// 一括取り込み専用の入口。
export async function startBulkEntry(reservation = reserveBulkEntry()): Promise<boolean> {
  if (!reservation || reservedOwner !== reservation.owner) return false;
  let started = false;
  try {
    const site = getContentSite();
    if (!site || !(await site.isBulkCapturePage?.()) || reservedOwner !== reservation.owner) return false;
    const i18n = await createI18n();
    if (reservedOwner !== reservation.owner || typeof window.__snsPostSaveCleanup === 'function') return false;
    window.dispatchEvent(new Event('hologram:bulk-start'));
    startBulkCapture(site, i18n);
    started = true;
    return true;
  } finally {
    // 例外は握りつぶさず uncaught-report へ渡す一方、再試行を塞ぐ予約は残さない。
    if (reservedOwner === reservation.owner) reservedOwner = undefined;
    if (!started) reservation.cancel();
  }
}
