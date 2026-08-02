// URL bookmark intake (#195) — the fallback stage of the page right-click menu
// for pages no site extractor recognizes (or before #122 lands, every page).
//
// Design (see #195's 2026-08-02 comment, the current record — the two 2026-07-18
// comments it replaces are noted stale there):
//   - OGP is read from the DOM the browser already rendered, never fetched. A
//     content script/injected function reading its OWN tab's document needs no
//     SSRF guard; a main-process fetch of an arbitrary URL would (#63) — that is
//     exactly the fetch-based v2 the 2026-07-19 comment rejected.
//   - extractOgp() takes no arguments and touches only the page's own globals
//     (document/location), so the SAME function both runs as the
//     chrome.scripting.executeScript injection (background.ts) and drives a
//     JSDOM fixture in the unit test (scripts/bookmark.test.ts) — no separate
//     "real" and "tested" implementations to keep in sync.
//   - buildBookmarkMeta() is the pure composition step: what extractOgp() read
//     -> the PostRecord shape buildRecord() (background.ts) already knows how to
//     turn into a save. Kept separate from extractOgp() so the composition rule
//     (title/description/site-name fallbacks, absolutizing og:image once) is
//     unit-testable without chrome.scripting or a real tab at all.
import { emptyRecord } from './extractor/record.ts';
import type { PostRecord } from './extractor/types.ts';
import type { AnnouncedMedia } from '../../native-host/protocol.mts';

export interface OgpResult {
  title: string | null;
  description: string | null;
  // Already absolutized (relative and protocol-relative og:image happen — see
  // extractOgp's comment) — background.ts hands this straight to the same
  // announced-media downloader every other save path uses.
  image: string | null;
  siteName: string | null;
  // og:url / canonical, falling back to the tab's own location. Not necessarily
  // the tab's CURRENT url (a SPA can rewrite it) — canonical is what the page
  // itself says this content's permalink is.
  url: string | null;
}

// Runs INSIDE the tab (chrome.scripting.executeScript's `func`, background.ts).
// chrome.scripting serializes `func` to a source string and evaluates it with
// NO closure over this module's scope (Chrome docs, chrome.scripting: "any
// bound parameters and execution context will be lost") — so metaContent()
// and absolutize() are declared INSIDE this function, not at module scope, or
// the injected copy throws ReferenceError before it reads anything (#759). The
// same self-containment requirement is why this function still takes no
// arguments and touches only the page's own globals (document/location): no
// fetch, no network, so an untrusted page can make this read only its own
// document, the same access any content script already has.
export function extractOgp(): OgpResult {
  function metaContent(prop: string): string | null {
    const el = (document.querySelector(`meta[property="${prop}"]`) as HTMLMetaElement | null) || (document.querySelector(`meta[name="${prop}"]`) as HTMLMetaElement | null);
    const v = el?.getAttribute('content');
    return v && v.trim() ? v.trim() : null;
  }

  // og:image is routinely a relative or protocol-relative URL in the wild —
  // the native host's media downloader (like every save path's media[])
  // expects an absolute one. Resolved against the page's own base, which also
  // folds a protocol-relative "//host/path" onto the page's own scheme.
  function absolutize(u: string | null): string | null {
    if (!u) return null;
    try {
      return new URL(u, document.baseURI).href;
    } catch {
      return null;
    }
  }

  const canonical = (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href || null;
  return {
    title: metaContent('og:title') || document.title || null,
    description: metaContent('og:description') || null,
    image: absolutize(metaContent('og:image')),
    siteName: metaContent('og:site_name') || location.hostname || null,
    url: canonical || location.href || null,
  };
}

function hostnameOf(u: string): string | null {
  try {
    return new URL(u).hostname || null;
  } catch {
    return null;
  }
}

// Compose an OGP read into the PostRecord shape buildRecord() (background.ts)
// already knows how to save. platform stays null (2026-08-02 design comment
// #2 — the sidebar's site facet gives a platform-less record its own row per
// resolvable domain, #253, which is a better fit for a bookmark's origin than
// the fixed platform list).
//
// title never ends up null: recordHoldsContent (native-host/post-record.mts)
// gates every savePost write on the record carrying SOMETHING, and a page with
// no og:title and an empty <title> is exactly the shape #492 exists to refuse —
// falling back to the URL itself means a save never produces an empty-shell
// bookmark for a page that at least has a URL.
export function buildBookmarkMeta(ogp: OgpResult, tabUrl: string): PostRecord {
  const url = ogp.url || tabUrl;
  const rec = emptyRecord(url, null);
  rec.title = ogp.title || url;
  rec.text = ogp.description || null;
  rec.displayName = ogp.siteName || hostnameOf(url) || url;
  if (ogp.image) {
    rec.mediaType = 'image';
    rec.media = [{ url: ogp.image, alt: null, width: null, height: null } as AnnouncedMedia];
  }
  return rec;
}
