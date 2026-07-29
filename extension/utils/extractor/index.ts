// The extractor registry — the single place that knows which sites exist (#212).
//
// Adding a site is one new module next to this one plus one entry in
// EXTRACTORS: the capture path, the drag/hover save path, the timeline overlay,
// the metadata fetch, the service worker's sender check and the manifest's
// match patterns all read the list below instead of carrying their own
// per-platform branch. The same shape as gallery-dl / yt-dlp's extractor
// directory and Zotero's translators: one module per site, one common contract,
// one registry.
//
// RELATIVE IMPORTS IN THIS DIRECTORY CARRY THE .ts EXTENSION. Node's own type
// stripping runs these files un-built (scripts/*.cts require this module
// directly for the schema canary and the capture CLIs) and, unlike a bundler,
// it does no extensionless resolution.

import { METADATA_TIMEOUT_MS, withDeadline } from '../deadline.ts';
import bluesky from './bluesky.ts';
import { mediaSrcs } from './dom.ts';
import mastodon from './mastodon.ts';
import misskey from './misskey.ts';
import pixiv from './pixiv.ts';
import { emptyRecord } from './record.ts';
import type { CaptureSite, Extractor, MediaIdentitySite, OverlaySite, ParsedPost, PostMediaElement, PostRecord } from './types.ts';
import x from './x.ts';

// ORDER IS LOAD-BEARING. The fixed-host sites come first; Mastodon and Misskey
// are instance-hosted, so their URL patterns and page sniffs accept ANY host
// and would otherwise answer for a page that belongs to one of the others.
const EXTRACTORS: readonly Extractor[] = [x, bluesky, pixiv, mastodon, misskey];

function extractorFor(platform: string | null | undefined): Extractor | null {
  if (!platform) return null;
  return EXTRACTORS.find((e) => e.platform === platform) || null;
}

// === URL phase ===

function parsePostUrl(url): ParsedPost | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  for (const extractor of EXTRACTORS) {
    const parsed = extractor.parseUrl(u);
    if (parsed) return parsed;
  }
  return null;
}

function getHostname(url): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// May a tab at `tabUrl` ask the service worker to save for `platform`? The
// content scripts only ever run where the manifest let them, but a message can
// come from anywhere a page can reach — so the origin is re-checked here.
function isAllowedSender(tabUrl, platform): boolean {
  const hostname = getHostname(tabUrl);
  if (!hostname) return false;
  const extractor = extractorFor(platform);
  return extractor ? extractor.isAllowedOrigin(tabUrl || '', hostname) : false;
}

// === API phase ===

async function fetchPostMetadata(url, opts): Promise<PostRecord> {
  const parsed = parsePostUrl(url);
  if (!parsed) return emptyRecord(url, null);
  const extractor = extractorFor(parsed.platform);
  if (!extractor) return emptyRecord(url, parsed.platform);
  // SSRF / origin-confusion guard. An extractor that derives its API host from
  // the post URL (Misskey & Mastodon instances are arbitrary hosts) would let a
  // postUrl host chosen by a hostile page aim our privileged background fetch
  // at an attacker-named host. When the caller knows the sender tab's host,
  // require the two to match — a content script only ever extracts a
  // same-instance permalink, so this rejects nothing legitimate. The fixed-host
  // sites declare no derived host and are unaffected.
  const expectedHost = opts && opts.expectedHost;
  if (expectedHost && extractor.derivedApiHost && extractor.derivedApiHost(parsed) !== expectedHost) {
    return emptyRecord(url, parsed.platform);
  }
  // Bounded (#507): every extractor reaches a platform API over the network,
  // and a request that neither answers nor fails leaves the save with no end.
  // The limit is the whole step's, not each request's — see utils/deadline.ts.
  return withDeadline(extractor.fetchPost(parsed, url), METADATA_TIMEOUT_MS, 'metadata fetch');
}

// === Media URLs ===

function mediaKeyOf(platform: string, url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url) return null;
  return extractorFor(platform)?.mediaKey(url) ?? null;
}

// Every identity the page offers for one picture. An <img> is routinely
// swapped between spellings (src, currentSrc, a srcset entry) while the user
// looks at it, so all of them are collected and any one matching is a match.
function mediaKeysOf(el: PostMediaElement, platform: string): string[] {
  const keys = new Set<string>();
  for (const url of collectImageUrls(el, platform)) {
    const key = mediaKeyOf(platform, url);
    if (key) keys.add(key);
  }
  return [...keys];
}

function highResUrlOf(platform: string, url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url) return null;
  const extractor = extractorFor(platform);
  return extractor?.highResUrl ? extractor.highResUrl(url) : null;
}

// Every URL worth trying for one image, best first-class candidate included: the
// bridge downloads the first that works, so a thumbnail src is a usable fallback
// when the high-resolution rewrite 404s.
function collectImageUrls(el: PostMediaElement, platform: string): string[] {
  const urls = new Set<string>();
  const srcs = mediaSrcs(el);
  for (const src of srcs) urls.add(src);
  const highRes = highResUrlOf(platform, srcs[0] || '');
  if (highRes) urls.add(highRes);
  const srcset = el.getAttribute('srcset');
  if (srcset) {
    for (const entry of srcset.split(',')) {
      const url = entry.trim().split(/\s+/)[0];
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

// === DOM phase ===

// The extractor for the page this content script is running in, or null on a
// page no extractor claims.
function extractorForPage(): Extractor | null {
  return EXTRACTORS.find((e) => e.matchesPage()) || null;
}

function getCaptureSite(): CaptureSite | null {
  return extractorForPage()?.capture ?? null;
}

function getMediaIdentitySite(): MediaIdentitySite | null {
  return extractorForPage()?.mediaIdentity ?? null;
}

function getOverlaySite(): OverlaySite | null {
  return extractorForPage()?.overlay ?? null;
}

// === Manifest ===

// Read by the resident content-script entrypoint and by wxt.config.ts, so that
// a new site's hosts arrive with its module rather than in a second edit.
const RESIDENT_MATCHES: string[] = EXTRACTORS.flatMap((e) => [...(e.residentMatches ?? [])]);
const API_HOST_PERMISSIONS: string[] = EXTRACTORS.flatMap((e) => [...(e.apiHostPermissions ?? [])]);

export { API_HOST_PERMISSIONS, EXTRACTORS, RESIDENT_MATCHES, collectImageUrls, extractorFor, extractorForPage, fetchPostMetadata, getCaptureSite, getHostname, getMediaIdentitySite, getOverlaySite, highResUrlOf, isAllowedSender, mediaKeyOf, mediaKeysOf, parsePostUrl };
export type { CaptureSite, Extractor, MediaIdentity, MediaIdentitySite, MediaItem, OverlaySite, ParsedPost, PostMediaElement, PostRecord, PostRect, RawAcquisition } from './types.ts';
