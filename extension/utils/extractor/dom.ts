// DOM-phase helpers shared by more than one extractor. Nothing site-specific
// lives here — a rule that only one site needs belongs in that site's module.
//
// Every function reads the page through the globals at CALL time (never at
// module load), which is what lets the jsdom fixture suites swap `document` /
// `location` per fixture.

import type { PostMediaElement, PostRect } from './types.ts';

// This host, or any subdomain of it. Subdomains (pro.x.com, mobile.twitter.com,
// www.pixiv.net …) serve the same web UI, so a site that accepts a host accepts
// its subdomains too.
function hostnameMatches(host: string): boolean {
  return location.hostname === host || location.hostname.endsWith(`.${host}`);
}

function normalizeRect(rect: { x?: number; y?: number; top?: number; left?: number; width?: number; height?: number; right?: number; bottom?: number } | DOMRect): PostRect {
  const x = rect?.x ?? rect?.left ?? 0;
  const y = rect?.y ?? rect?.top ?? 0;
  const width = rect?.width ?? (rect?.right ?? x) - (rect?.left ?? x);
  const height = rect?.height ?? (rect?.bottom ?? y) - (rect?.top ?? y);

  return {
    x,
    y,
    top: rect?.top ?? y,
    left: rect?.left ?? x,
    width,
    height,
    right: rect?.right ?? x + width,
    bottom: rect?.bottom ?? y + height,
  };
}

// Add a marker class to the elements whose hover styling has to be quiet while
// the screenshot is taken, and hand back the undo.
function prepareScopedCaptureState(className: string, elements: ReadonlyArray<Element | null | undefined>): () => void {
  const captureTargets = [...new Set(elements.filter((e): e is Element => Boolean(e)))];

  captureTargets.forEach((element) => {
    element.classList.add(className);
  });

  return () => {
    captureTargets.forEach((element) => {
      element.classList.remove(className);
    });
  };
}

// The URLs an element can be recognised by. Tag name rather than instanceof:
// the fixture tests run these against a jsdom realm whose constructors are not
// the ones this module closed over.
function mediaSrcs(el: PostMediaElement): string[] {
  if (el.tagName === 'VIDEO') {
    const poster = (el as HTMLVideoElement).poster;
    return poster ? [poster] : [];
  }
  const img = el as HTMLImageElement;
  return [img.src, img.currentSrc].filter((src) => !!src);
}

function anySrc(el: PostMediaElement, test: (src: string) => boolean): boolean {
  return mediaSrcs(el).some(test);
}

interface ParsedMediaPath {
  match: RegExpMatchArray;
  url: string;
}

function parseMediaUrlPath(href: string, pathRegex: RegExp): ParsedMediaPath | null {
  try {
    const url = new URL(href, location.origin);
    const match = url.pathname.match(pathRegex);
    if (!match) return null;
    return { match, url: url.href };
  } catch {
    return null;
  }
}

// Nearest candidate link by DOM distance (avoids a neighboring post's link on
// grids where several candidates share an ancestor). The walk is BOUNDED by
// the nearest post container (boundarySel): walking past it would attribute
// the image to whatever unrelated post is DOM-nearest — avatars, banners and
// sidebar images must yield no identity instead of a fabricated record.
// (audit 2026-06-11)
function findAncestorContainerLink(img: Element, selector: string, boundarySel: string): Element | null {
  let el = img.parentElement;
  while (el && el !== document.body) {
    const candidates = el.querySelectorAll(selector);
    if (candidates.length) {
      // Bounded: only trust a candidate while still inside a post container.
      // Once the widening search escapes it (avatar/banner/sidebar images),
      // the nearest match belongs to some unrelated post — give up instead.
      if (boundarySel && !el.closest(boundarySel)) return null;
      if (candidates.length === 1) return candidates[0] ?? null;
      let best: Element | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const link of candidates) {
        const d = mediaTreeDistance(img, link);
        if (d < bestDist) {
          bestDist = d;
          best = link;
        }
      }
      return best;
    }
    if (boundarySel && el.matches(boundarySel)) return null; // container exhausted — stop
    el = el.parentElement;
  }
  return null;
}

function mediaTreeDistance(a: Element, b: Element): number {
  const ancestorsA: Element[] = [];
  for (let n: Element | null = a; n; n = n.parentElement) ancestorsA.push(n);
  const indexInA = new Map(ancestorsA.map((n, i) => [n, i]));
  let depthB = 0;
  for (let n: Element | null = b; n; n = n.parentElement) {
    const idx = indexInA.get(n);
    if (idx !== undefined) return idx + depthB;
    depthB++;
  }
  return Number.POSITIVE_INFINITY;
}

export { anySrc, findAncestorContainerLink, hostnameMatches, mediaSrcs, mediaTreeDistance, normalizeRect, parseMediaUrlPath, prepareScopedCaptureState };
export type { ParsedMediaPath };
