import { startBulkCapture } from './bulk-capture.ts';
import { getContentSite } from './extractor/index.ts';
import { createI18n } from './i18n.ts';

export interface BulkEntryReservation {
  readonly owner: symbol;
  cancel(): void;
}

interface BulkEntryReservationState {
  owner?: symbol;
}

// resident.content と executeScript された bulk.js は別々の bundle だが、同じ
// isolated world の globalThis を共有する。module local に置くと各 bundle が
// setup 中の予約を別々に取得できてしまうため、realm 共通のシンボルに置く。
const RESERVATION_STATE = Symbol.for('hologram.bulk-entry-reservation');
const scope = globalThis as typeof globalThis & { [RESERVATION_STATE]?: BulkEntryReservationState };
const reservationState = (scope[RESERVATION_STATE] ??= {});

/** 非同期のページ判定より前に、一括取り込みの開始権を一つだけ確保する。 */
export function reserveBulkEntry(): BulkEntryReservation | undefined {
  if (reservationState.owner || typeof window.__snsPostSaveCleanup === 'function') return undefined;
  const owner = Symbol('bulk-entry');
  reservationState.owner = owner;
  return {
    owner,
    cancel() {
      if (reservationState.owner === owner) reservationState.owner = undefined;
    },
  };
}

// 一括取り込み専用の入口。
export async function startBulkEntry(reservation = reserveBulkEntry()): Promise<boolean> {
  if (!reservation || reservationState.owner !== reservation.owner) return false;
  let started = false;
  try {
    const site = getContentSite();
    if (!site || !(await site.isBulkCapturePage?.()) || reservationState.owner !== reservation.owner) return false;
    const i18n = await createI18n();
    if (reservationState.owner !== reservation.owner || typeof window.__snsPostSaveCleanup === 'function') return false;
    window.dispatchEvent(new Event('hologram:bulk-start'));
    startBulkCapture(site, i18n);
    started = true;
    return true;
  } finally {
    // 例外は握りつぶさず uncaught-report へ渡す一方、再試行を塞ぐ予約は残さない。
    if (reservationState.owner === reservation.owner) reservationState.owner = undefined;
    if (!started) reservation.cancel();
  }
}
