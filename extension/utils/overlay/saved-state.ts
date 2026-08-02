// What the library holds for each tracked post: batching the "is this
// saved" question into one query per scroll burst, caching the answer, and
// folding a same-tab save straight into it (#334). Split out of overlay.ts by
// #399. Knows nothing about the DOM beyond a permalink and a media element to
// key off of, and nothing about drawing.
import { mediaKeyOf, mediaKeysOf } from '../extractor/index.ts';
import type { CaptureSite, MediaIdentitySite } from '../extractor/types.ts';
import type { BackgroundToContentMessage, CheckSavedMessage, CheckSavedResponse, SavedEntry } from '../messages.ts';
import { postMediaIn } from './positioning.ts';
import type { Anchor, SavedPictures, UnitState } from './types.ts';

// null (not empty string) when nothing resolved, so the unit stays unanswered
// and is re-read the next time it scrolls into view -- a feed unit is
// routinely half-rendered on its first intersection.
export function permalinkOf(capture: CaptureSite, unit: Element): string | null {
  try {
    return capture.getPermalink(unit) || null;
  } catch {
    return null;
  }
}

// The host's answer for one post, turned into what this side can compare.
// A saved picture whose URL yields no identity key drops the WHOLE post back
// to `whole`: leaving it out would put a save button on a picture that is
// already in the library, and saving it again is the one outcome the badge
// exists to prevent.
export function readSavedPictures(entry: SavedEntry | null | undefined, media: MediaIdentitySite | null): SavedPictures | null {
  if (!entry) return null;
  const urls: Array<string | null> = Array.isArray(entry.media) ? entry.media : [];
  const saved: SavedPictures = { whole: !urls.length, keys: new Set(), seqs: new Set() };
  urls.forEach((url, seq) => {
    if (typeof url !== 'string' || !url) {
      saved.seqs.add(seq); // recorded without a URL -- its place in the post is all there is
      return;
    }
    const key = media ? mediaKeyOf(media.platform, url) : null;
    if (key) saved.keys.add(key);
    else saved.whole = true;
  });
  return saved;
}

// Fold a just-completed save into what is known about the post. An empty list
// means the save reported no pictures of its own, which is the same "saved,
// pictures unknown" the host answers with.
export function addSavedPictures(prev: SavedPictures | null, urls: Array<string | null>, media: MediaIdentitySite | null): SavedPictures {
  const next: SavedPictures = prev || { whole: false, keys: new Set(), seqs: new Set() };
  if (!urls.length) {
    next.whole = true;
    return next;
  }
  for (const url of urls) {
    const key = typeof url === 'string' && url && media ? mediaKeyOf(media.platform, url) : null;
    if (key) next.keys.add(key);
    else next.whole = true;
  }
  return next;
}

// Is THIS picture one of the post's saved ones? The mark and the save button
// are two faces of this single question (#334): a multi-image post whose
// second picture was saved must keep offering the button on the first.
export function anchorSaved(state: UnitState, anchor: Anchor, index: number, media: MediaIdentitySite | null): boolean {
  const saved = state.saved;
  if (!saved) return false;
  if (saved.whole) return true;
  // A text anchor has no picture to compare a per-picture key against --
  // `whole` above is the only way a text-only post's record can say yes
  // (#365: it carries no media rows for readSavedPictures to key on).
  if (anchor.kind === 'text') return false;
  const el = media ? postMediaIn(anchor.box) : null;
  const keys = el && media ? mediaKeysOf(el, media.platform) : [];
  if (keys.some((key) => saved.keys.has(key))) return true;
  // No comparable URL on the page either -- then position is the only handle
  // left, and it only answers for pictures the library recorded without one.
  return !keys.length && saved.seqs.has(index);
}

export interface SavedQuery {
  // Marks a unit as needing an answer. Does not itself schedule a flush --
  // callers batch several adds (one IntersectionObserver callback, one
  // settings re-enable) and call scheduleQuery() once at the end, same as
  // the original single closure did.
  add(unit: Element): void;
  forget(unit: Element): void;
  scheduleQuery(): void;
  dispose(): void;
}

export interface SavedQueryOptions {
  debounceMs: number;
  tracked: Map<Element, UnitState>;
  isVisible: (unit: Element) => boolean;
  isWanted: () => boolean; // markMode !== 'off' || hoverSave
  isAlive: () => boolean; // extensionAlive()
  getPermalink: (unit: Element) => string | null;
  getMedia: () => MediaIdentitySite | null;
  onResolved: (unit: Element, state: UnitState) => void; // repaint if visible
}

export function createSavedQuery(opts: SavedQueryOptions): SavedQuery {
  const pending = new Set<Element>();
  let queryTimer: ReturnType<typeof setTimeout> | null = null;

  function flushQuery() {
    // The PASSIVE half of #594. This runs whenever a post scrolls into view,
    // so on an orphaned tab it is what notices -- and what takes the stale
    // marks and buttons off the page -- the moment the user starts using the
    // tab again. Nothing is said: scrolling is not a request, and a toast on
    // every open timeline after an auto-update is exactly the noise #154's
    // charter 2 keeps out. The user's own request has its own path (the
    // controller's save flow).
    if (!opts.isWanted() || !opts.isAlive()) {
      pending.clear();
      return;
    }
    // url -> the units showing that post. One permalink can appear twice on a
    // page (a post and its own quote-preview), and both should light up.
    const byUrl = new Map<string, Element[]>();
    for (const unit of pending) {
      const state = opts.tracked.get(unit);
      if (!state) continue;
      if (state.url === null) state.url = opts.getPermalink(unit);
      if (!state.url) continue; // not a post after all (a header, an ad, a suggestion)
      const list = byUrl.get(state.url);
      if (list) list.push(unit);
      else byUrl.set(state.url, [unit]);
    }
    pending.clear();
    if (!byUrl.size) return;

    chrome.runtime.sendMessage({ type: 'checkSaved', urls: [...byUrl.keys()] } satisfies CheckSavedMessage, (res?: CheckSavedResponse) => {
      // A host that cannot be reached answers nothing: leave the posts
      // unmarked rather than asserting "not saved". background.js already
      // re-asks on the next scroll (its negative cache never recorded
      // these). The save button still appears -- offering to save is safe
      // when the answer is unknown; claiming "not saved" would not be.
      if (chrome.runtime.lastError || !res?.ok || !res.results) return;
      for (const [url, units] of byUrl) {
        const saved = readSavedPictures(res.results[url], opts.getMedia());
        for (const unit of units) {
          const state = opts.tracked.get(unit);
          if (!state) continue;
          state.saved = saved;
          if (opts.isVisible(unit)) opts.onResolved(unit, state);
        }
      }
    });
  }

  function scheduleQuery() {
    if (queryTimer || !pending.size) return;
    queryTimer = setTimeout(() => {
      queryTimer = null;
      flushQuery();
    }, opts.debounceMs);
  }

  // A save made in this tab: re-mark that post without waiting for the next
  // scroll (background.js pushes this the moment the host acknowledges).
  const onMessage = (message: BackgroundToContentMessage) => {
    if (message?.type !== 'savedUpdate' || !message.url) return;
    const urls: Array<string | null> = Array.isArray(message.media) ? message.media : [];
    for (const [unit, state] of opts.tracked) {
      if (state.url !== message.url) continue;
      state.saved = addSavedPictures(state.saved, urls, opts.getMedia());
      if (opts.isVisible(unit)) opts.onResolved(unit, state);
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);

  return {
    add(unit: Element) {
      pending.add(unit);
    },
    forget(unit: Element) {
      pending.delete(unit);
    },
    scheduleQuery,
    dispose() {
      chrome.runtime.onMessage.removeListener(onMessage);
      if (queryTimer) clearTimeout(queryTimer);
      queryTimer = null;
      pending.clear();
    },
  };
}
