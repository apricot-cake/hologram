import type { SavedEntry } from './protocol.mts';

export function alreadySaved(entry: SavedEntry | undefined, scope: 'post' | 'media', urls: readonly (string | null)[]): boolean {
  if (!entry?.id) return false;
  if (scope === 'media') {
    // 投稿全体と個別保存は別の保存単位。全体保存だけで個別保存を抑止しない。
    return urls.length > 0 && urls.every((url) => !!url && entry.individualMedia?.includes(url));
  }
  if (entry.post !== true) return false;
  if (!urls.length) return true;
  if (urls.every((url) => !!url && entry.media.includes(url))) return true;
  // 古い保存には画像 URL がない。全体保存済みで枚数も足りていれば再保存しない。
  return entry.media.some((url) => !url) && urls.length <= entry.media.length;
}
