// Bridge to the renderer's existing i18n. `hologramI18n` (from renderer/i18n.ts)
// resolves to { lang, resolved, getMessage }. Islands reuse the SAME message
// keys as the rest of the app — no duplicated strings. Call initI18n() once before
// rendering so t() is synchronous inside components.
// Shared by settings / toolbar / searchbox (was duplicated per-island until the
// third consumer arrived — BACKLOG「i18n.js 共有化」).
import { hologramI18n } from '../../renderer/i18n.ts';

let api: HologramI18nApi | null = null;

export async function initI18n(): Promise<HologramI18nApi | null> {
  try {
    api = await hologramI18n;
  } catch {
    api = null; // i18n unavailable — t() falls back to the raw key
  }
  return api;
}

export function t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string {
  if (!api) return key;
  return api.getMessage(key, subs);
}

export function lang(): string {
  return api ? api.lang : 'auto';
}
