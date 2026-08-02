// DOM discovery: which post units exist, which are on screen, and which
// media/anchor boxes each one currently has. Split out of overlay.ts by
// #399. This module knows nothing about saved state, geometry beyond "is it
// connected", or what gets drawn -- it only decides WHAT is being tracked and
// WHEN it enters/leaves view or gets removed from the page entirely.
import type { OverlaySite } from '../extractor/types.ts';
import type { Anchor, UnitState } from './types.ts';

export interface TrackerCallbacks {
  // An anchor stopped being live (its box was recycled away, or its unit
  // left the page entirely). Always the caller's cue to tear the control
  // down (control.ts's removeControl) and drop any hover pointing at it.
  onAnchorRemoved(anchor: Anchor): void;
  // An observed unit crossed into the viewport.
  onEnter(unit: Element, state: UnitState): void;
  // An observed unit left the viewport (or was pruned while detached).
  onLeave(unit: Element, state: UnitState): void;
  // Every entry in one IntersectionObserver callback batch has been applied.
  onIntersectionSettled(): void;
  // The page's own DOM changed. `childrenChanged` gates re-scanning for new
  // units; either flag may indicate the hovered anchor needs re-checking.
  onMutation(childrenChanged: boolean, modalChanged: boolean): void;
}

export interface Tracker {
  readonly tracked: Map<Element, UnitState>;
  readonly visible: Set<Element>;
  // media/text box -> the unit and Anchor it belongs to (the reverse index
  // pointer-driven hover lookups need).
  readonly anchorOf: Map<Element, { unit: Element; anchor: Anchor }>;
  // Re-reads a unit's media boxes into its Anchor map. A feed adds pictures
  // to a post after it first renders (lazy images, quote previews resolving),
  // and the same unit element gets recycled for another post entirely, so
  // this is called every paint rather than once.
  syncAnchors(unit: Element, state: UnitState): void;
  scan(): void;
  forgetDetached(): void;
  dispose(): void;
}

export function createTracker(site: OverlaySite, opts: { maxTracked: number; scanDebounceMs: number; observerMargin: string }, callbacks: TrackerCallbacks): Tracker {
  const tracked = new Map<Element, UnitState>();
  const visible = new Set<Element>();
  const anchorOf = new Map<Element, { unit: Element; anchor: Anchor }>();
  let scanTimer: ReturnType<typeof setTimeout> | null = null;

  function syncAnchors(unit: Element, state: UnitState): void {
    const mediaBoxes = site.mediaIn(unit);
    // A text-only post (#575) has no picture to key off, so the unit itself
    // becomes the one synthetic anchor -- but only when the site can point to
    // an avatar to place it near; otherwise it stays unmarked, the same as
    // before this existed.
    const textAnchor = mediaBoxes.length ? null : (site.textAnchorIn?.(unit) ?? null);
    const boxes: Element[] = mediaBoxes.length ? mediaBoxes : textAnchor ? [unit] : [];
    const live = new Set(boxes);
    for (const [box, anchor] of state.anchors) {
      if (live.has(box) && box.isConnected) continue;
      callbacks.onAnchorRemoved(anchor);
      anchorOf.delete(box);
      state.anchors.delete(box);
    }
    for (const box of boxes) {
      if (state.anchors.has(box)) continue;
      const kind: Anchor['kind'] = mediaBoxes.length ? 'media' : 'text';
      const anchor: Anchor = { box, kind, el: null, root: null, control: null, host: null, hostInlinePosition: null, hostInlinePriority: '', face: null, phase: 'idle', timer: null };
      state.anchors.set(box, anchor);
      anchorOf.set(box, { unit, anchor });
    }
  }

  function scan(): void {
    if (tracked.size >= opts.maxTracked) forgetDetached();
    for (const unit of Array.from(document.querySelectorAll(site.unitSelector))) {
      if (tracked.has(unit)) continue;
      if (tracked.size >= opts.maxTracked) break;
      tracked.set(unit, { url: null, saved: null, anchors: new Map() });
      io.observe(unit);
    }
  }

  // Units the page has unmounted (SPA navigation, feed recycling). Dropped
  // lazily rather than watched: a removal observer on x.com's feed fires
  // constantly for nodes we don't track.
  function forgetDetached(): void {
    for (const [unit, state] of tracked) {
      if (unit.isConnected) continue;
      io.unobserve(unit);
      visible.delete(unit);
      callbacks.onLeave(unit, state);
      for (const [box, anchor] of state.anchors) {
        callbacks.onAnchorRemoved(anchor);
        anchorOf.delete(box);
      }
      state.anchors.clear();
      tracked.delete(unit);
    }
  }

  function scheduleScan(): void {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, opts.scanDebounceMs);
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const state = tracked.get(entry.target);
        if (entry.isIntersecting) {
          visible.add(entry.target);
          if (state) callbacks.onEnter(entry.target, state);
        } else {
          visible.delete(entry.target);
          if (state) callbacks.onLeave(entry.target, state);
        }
      }
      callbacks.onIntersectionSettled();
    },
    { rootMargin: opts.observerMargin },
  );

  const mo = new MutationObserver((records) => {
    const childrenChanged = records.some((record) => record.type === 'childList');
    const modalChanged = records.some((record) => record.type === 'attributes' && record.target instanceof Element && record.target.matches('dialog, [role="dialog"], [aria-modal]'));
    callbacks.onMutation(childrenChanged, modalChanged);
    if (childrenChanged) scheduleScan();
  });
  mo.observe(document.documentElement, {
    childList: true,
    attributes: true,
    attributeFilter: ['aria-modal', 'class', 'hidden', 'open', 'style'],
    subtree: true,
  });
  scan();

  function dispose(): void {
    io.disconnect();
    mo.disconnect();
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = null;
    tracked.clear();
    anchorOf.clear();
    visible.clear();
  }

  return { tracked, visible, anchorOf, syncAnchors, scan, forgetDetached, dispose };
}
