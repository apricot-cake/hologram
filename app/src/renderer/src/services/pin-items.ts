// Pin-item construction (#79): what "this card" or "this post" contributes to
// a pinned mini-viewer set. Deliberately the single cover file the card's own
// thumbnail already shows (densityImage's rule — the same one post-grid-
// builder.ts's cardMenuItems uses for "reveal in folder"/"copy image"), not
// every page of a multi-image post: the pin window is a lightweight reference
// set, not a second gallery, and a "1枚をピン" design should not silently
// balloon into a dozen tiles for one right-click.
import { densityImage, isVideoFile } from './records.ts';
import type { PinItem } from '../../../main/ipc-payloads.ts';

export function pinItemOfPost(p: HologramPost): PinItem | null {
  const file = densityImage(p) || p.image || '';
  if (!file) return null;
  return { captureId: p.captureId || '', file, video: isVideoFile(file) };
}

export function pinItemOfGroup(g: HologramPostGroup): PinItem | null {
  return pinItemOfPost(g.rep);
}

/**
 * The card menu's "複数選択対応" (#79 entry ①): every group in `groups`
 * becomes at most one tile, deduped by file (the same post reachable through
 * two different selections should not double up). Callers decide which
 * groups are in play — see post-grid-builder.ts's onCardMenuPick, which
 * mirrors dragFilesOf's "selection wins when the clicked card is inside it"
 * rule.
 */
export function pinItemsOfGroups(groups: HologramPostGroup[]): PinItem[] {
  const seen = new Set<string>();
  const out: PinItem[] = [];
  for (const g of groups) {
    const it = pinItemOfGroup(g);
    if (it && !seen.has(it.file)) {
      seen.add(it.file);
      out.push(it);
    }
  }
  return out;
}
