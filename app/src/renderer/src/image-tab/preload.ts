// Neighbour preload for the image tab (#241). Stepping through a group used to
// start every slide cold: the stage keys its media on `src`, so prev/next tears
// the old element down and mounts a fresh one, and that fresh element had
// nothing warm to hit — neither the fetch nor the decode. The grid had been
// carrying `decoding="async"` since forever; the surface where the big picture
// actually gets looked at had nothing.
//
// THE MEANS IS `new Image()` + `HTMLImageElement.decode()`, not markup. The
// browser-standard candidates and why the others lose:
//   - `<link rel="preload" as="image">` only schedules the DOWNLOAD ("it doesn't
//     load and execute … but only schedules it to be downloaded and cached",
//     MDN). For a library original read off the local disk over `asset://` the
//     download is the cheap half; the decode of a several-thousand-px JPEG is
//     what the next paint waits on. It is also declarative head markup aimed at
//     one navigation, which does not fit an index that moves per keypress.
//   - `fetchpriority` only reorders requests that are already being made. It
//     starts nothing, so it cannot warm an image the DOM has not asked for.
//   - `decode()` on the LIVE element helps only the slide already on screen.
//   - `decode()` on a DETACHED element is exactly the case MDN documents for
//     this ("initiate loading of the image prior to attaching it to an element
//     in the DOM … so that the image can be rendered immediately upon being
//     added"), and MDN's own `decoding` page points at it as the better answer
//     when the attribute alone is not enough. It covers BOTH halves — fetch and
//     decode — which is what the acceptance condition asks for.
//
// No library was added: this is two DOM calls.
export const PRELOAD_RADIUS = 1;

// Memory is bounded by holding at most 2 × PRELOAD_RADIUS decoded neighbours and
// evicting everything else on every step. The reference has to be HELD — a
// fire-and-forget `new Image()` is collectable the moment `decode()` settles, so
// the work could be thrown away before the user presses the key it was for.
// Holding it is therefore the same act as bounding it, which is why the window
// stays at 1: a 4000×4000 original costs 4000·4000·4 ≈ 64MB decoded, so radius 1
// tops out near 128MB — the same order as UgoiraPlayer's 96MB frame budget, and
// radius 2 would double it for no reach. Reach is not what radius buys anyway:
// prev/next and ←/→ move exactly one step, so radius 1 already covers every
// square the next input can land on, in both directions.

// Structural, not `ImageTabItem`: this module is a pure-logic unit imported by
// the Node-side test runner, and typing it structurally keeps it free of the
// component (and of JSX) without a second declaration to drift.
export interface PreloadableItem {
  src: string;
  video?: boolean;
  ugoira?: unknown;
  poster?: string;
}

// The still an `<img>` will actually paint for this item, or nothing if the item
// is not an image at all.
export function stillSourceOf(item: PreloadableItem | undefined): string | undefined {
  if (!item) return undefined;
  // An うごイラ shows its poster until the archive opens, and the archive comes
  // over IPC as a data URL (UgoiraPlayer) — not something an <img> can warm.
  if (item.ugoira) return item.poster || undefined;
  // A <video> has its own contract (preload="metadata"); pulling whole clips in
  // is not what "adjacent images" asked for and would blow the bound above.
  if (item.video) return undefined;
  return item.src || undefined;
}

// Sources to keep warm around `idx`, nearest first and forward before backward
// (next is the likelier move). Wraps, because the stage's prev/next wraps too.
// Deduped against the current slide and against each other — a group can repeat
// a src, and a two-item group has the same neighbour on both sides.
export function neighborPreloadSources(items: readonly PreloadableItem[], idx: number, radius: number = PRELOAD_RADIUS): string[] {
  const n = items.length;
  if (n < 2 || radius < 1) return [];
  const at = (k: number) => ((k % n) + n) % n;
  const cur = at(idx);
  const seen = new Set<string>();
  const curSrc = stillSourceOf(items[cur]);
  if (curSrc) seen.add(curSrc);
  const out: string[] = [];
  for (let d = 1; d <= radius; d++) {
    for (const k of [cur + d, cur - d]) {
      if (at(k) === cur) continue; // radius ≥ n wraps back onto the live slide
      const src = stillSourceOf(items[at(k)]);
      if (!src || seen.has(src)) continue;
      seen.add(src);
      out.push(src);
    }
  }
  return out;
}

export interface NeighborPreloader {
  // Makes the held set exactly `sources`: starts what is new, drops what left.
  sync(sources: readonly string[]): void;
  clear(): void;
  held(): string[];
}

export function createNeighborPreloader(): NeighborPreloader {
  const held = new Map<string, HTMLImageElement>();
  return {
    sync(sources) {
      for (const src of [...held.keys()]) if (!sources.includes(src)) held.delete(src);
      for (const src of sources) {
        if (held.has(src)) continue;
        const img = new Image();
        img.decoding = 'async';
        img.src = src;
        held.set(src, img);
        // decode() rejects with EncodingError when the request failed or the
        // data is corrupt (MDN). A neighbour that cannot be decoded is not an
        // error here — the slide that shows it renders its own broken state.
        void img.decode().catch(() => {});
      }
    },
    clear() {
      held.clear();
    },
    held: () => [...held.keys()],
  };
}
