// 「ウェブで探す」の一括オープン対象を通常の設定経路へ保存する。
import { hologramIpc } from '../services/ipc.ts';
import type { PlatformId } from './types.ts';

const DEFAULT_CHECKED: PlatformId[] = ['x', 'bluesky', 'pixiv'];

export async function loadWebSearchChecked(): Promise<PlatformId[]> {
  const prefs = await hologramIpc.getPrefs();
  const value = prefs.webSearchChecked;
  if (!Array.isArray(value) || !value.length) return DEFAULT_CHECKED.slice();
  const known = new Set(DEFAULT_CHECKED);
  const filtered = value.filter((item): item is PlatformId => typeof item === 'string' && known.has(item as PlatformId));
  return filtered.length ? filtered : DEFAULT_CHECKED.slice();
}

export function saveWebSearchChecked(ids: readonly PlatformId[]): void {
  hologramIpc.setPref('webSearchChecked', ids as PlatformId[]);
}
