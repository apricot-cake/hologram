// Practice mode's business logic (#103) — the deps-requiring half of practice.ts's
// pure state, mirroring triage-builder.ts / undo-builder.ts: a leaf module with no
// cross-cutting state of its own, only orchestrator-owned closures arrive as
// injected deps.
//
// === Queue ===
// The current filter results, exactly as the grid renders them — postGrid's OWN
// getViewGroups() (the same array renderPosts() just pushed to hologramStore's
// 'postGroups'; see that module's file header), not a fresh getFilteredPosts() +
// groupRecords() pass, so a manual multi-image grouping or the multiOnly() filter
// is reflected identically here. Flattened one group at a time with the SAME
// gallery instance image-tab/lightbox/triage read (buildGroupGalleryItems), so a
// picture drawn here is pixel-identical to its card/detail view.
//
// Video and ugoira are left out: a moving picture has nothing to hold still under
// a countdown, and there is no player wired into the practice stage (v1 scope, the
// Issue's own "image-tab foundation + overlay + timer only"). An ugoira whose frame
// table didn't survive already degrades to its poster as a plain image upstream
// (records.ts's buildGalleryItems) and is kept; a playable one (ugoira set) is
// dropped here.
import { newShuffleSeed, shuffleRank } from './shuffle.ts';
import * as practice from './practice.ts';
import type { PracticeItem } from './practice.ts';

export interface PracticeBuilderDeps {
  /** The SAME gallery instance image-tab/lightbox/triage read (records.ts's makeGallery). */
  buildGroupGalleryItems(g: HologramPostGroup): { src: string; alt?: string; video?: boolean; ugoira?: unknown }[];
  /** postGrid's current render result — the filtered/sorted/grouped cards on screen right now. */
  getViewGroups(): HologramPostGroup[];
}

function flattenStillImages(deps: PracticeBuilderDeps): PracticeItem[] {
  const out: PracticeItem[] = [];
  for (const g of deps.getViewGroups()) {
    for (const it of deps.buildGroupGalleryItems(g)) {
      if (it.video || it.ugoira) continue;
      out.push({ src: it.src, alt: it.alt });
    }
  }
  return out;
}

// Seeded shuffle (services/shuffle.ts, #118's own "random" sort order) rather than
// a fresh Math.random().sort() — one shuffle primitive for the whole app instead of
// a second ad hoc one, and it comes with a spread test already covering it. A new
// seed per session (not a stored one — see practice.ts's "the queue is a snapshot"
// note) is exactly what makes each practice session draw a fresh order.
function shuffled(items: PracticeItem[]): PracticeItem[] {
  const seed = newShuffleSeed();
  return items
    .map((it, i) => ({ it, rank: shuffleRank(seed, `${it.src}|${i}`) }))
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.it);
}

export function makePractice(deps: PracticeBuilderDeps) {
  function startPractice(): void {
    practice.openWith(shuffled(flattenStillImages(deps)));
  }
  function closePractice(): void {
    practice.close();
  }
  return { startPractice, closePractice };
}
