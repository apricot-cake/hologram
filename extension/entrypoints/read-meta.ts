import WebAutoExtractor from '@marbec/web-auto-extractor';
import { decodeHTMLAttribute } from 'entities/decode';
import { chooseWebMeta } from '../utils/extractor/web-meta.ts';
import type { PageMetaExtractedMessage } from '../utils/messages.ts';
import type { WaeBucket } from '@marbec/web-auto-extractor';
import type { WebMetaResult } from '../utils/extractor/web-meta.ts';

// #239: reads schema.org (JSON-LD/microdata/RDFa), OGP, Dublin Core and
// Highwire metadata off the tab's own DOM and reports it back. Not declared
// in the manifest — background.ts's doSaveBookmark injects it by file name
// through chrome.scripting.executeScript({files:['read-meta.js']}), the exact
// name it names (scripts/ext-consistency.test.ts guards that pair, same as
// capture.js's).
//
// `files:`, never `func:` (#759's serialization trap: `func` is evaluated
// with no closure over this module's scope, which would strip out both
// chooseWebMeta and the WebAutoExtractor import). Because this runs as an
// ordinary bundled script instead, the read's result cannot ride back as
// executeScript()'s return value the way #195's OGP-only extractOgp() once
// did — it is reported over chrome.runtime.sendMessage instead, the same
// content-script -> background channel capture.ts's own save request uses.
// doSaveBookmark matches the reply to its own request by sender.tab.id.
// The `<meta>` half of the parse, taken from the DOM instead of from the
// library's own read of the serialized HTML (#894).
//
// WHY. The library hands attribute values back EXACTLY as they appear in the
// source — `&amp;` stays `&amp;`, `&mdash;` stays `&mdash;` (measured against
// 2.2.1). For text that is a cosmetic wart; for a URL it is silent corruption.
// Qiita's og:image is a signed imgix URL with ~20 query parameters, so every
// separator arrives as `&amp;` and the CDN sees parameters named `amp;w`,
// `amp;fm` … `amp;s` — the signature is simply not there, imgix answers 403,
// and because announced media that cannot be downloaded fails the whole save
// (handleSavePost), the bookmark was lost with no reason recorded anywhere.
// Pages whose og:image has no query string at all (YouTube, GitHub) were
// unaffected, which is why this looked Qiita-specific.
//
// This script runs IN THE PAGE, so the browser has already parsed those
// attributes: `.content` is the decoded value, straight from the reference
// implementation of HTML entity decoding. No decoding of our own, and nothing
// re-parsed. The library keeps the job only it can do (JSON-LD / microdata /
// RDFa) — and what it hands back from those two formats is decoded below
// (#902).
//
// Shape matches what chooseWebMeta already consumes (lowerMetaMap): keyed by
// the page's own spelling, values as arrays, `<head>` only, plus the `<title>`
// text under `title` — the key the library uses for the same fallback.
function metatagsFromDom(doc: Document): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const push = (name: string | null, value: string | null) => {
    if (!name || !value) return;
    (out[name] ||= []).push(value);
  };
  for (const el of Array.from(doc.head?.querySelectorAll('meta') || [])) {
    // Same four naming attributes the library recognises. It picks whichever
    // comes first in the element's own attribute order; a fixed precedence is
    // used here instead, which differs only for a tag that carries two of them.
    push(el.getAttribute('name') || el.getAttribute('property') || el.getAttribute('itemprop') || el.getAttribute('http-equiv'), el.content);
  }
  push('title', doc.title);
  return out;
}

// #902, the other half of the same defect: microdata and RDFa are assembled by
// the library out of its own read of the serialized HTML, so `Tom &amp; Jerry
// &mdash; 記事名` reaches chooseWebMeta with the references still in it. The
// `<meta>` trick above cannot help here — these values come from `itemprop`
// elements' text and from `content`/`href` attributes all over the body, not
// from a handful of tags with a decoded DOM property to read.
//
// WHY A DEPENDENCY. `entities` is the decoder htmlparser2/cheerio/parse5 use;
// it is the ecosystem's standard answer, table-complete (`&mdash;` `&nbsp;`
// and the rest, not just the five URL-critical ones) and needs no HTML to be
// re-parsed to get an answer. It has no dependencies of its own, and is a
// DIRECT dependency of extension/ at a pinned version (ADR 0002), not a
// transitive one borrowed from somewhere else in the tree. Cost, measured
// 2026-08-07: read-meta.js 17.5KB -> 56.0KB, nearly all of it the named-
// reference table. That bundle is read from disk and injected once per
// bookmark save — no network, no per-page cost.
//
// WHY THE ATTRIBUTE MODE. `decodeHTMLAttribute` differs from `decodeHTML` on
// exactly one thing: the legacy semicolon-less references (`&amp` followed by
// an alphanumeric or `=`) are left alone instead of decoded. Text-mode there
// would rewrite the query string `?a=1&ampersand=2` to `?a=1&ersand=2` — the
// #894 corruption again, just from the other direction — and microdata feeds
// author.url. Everything a real page writes (`&amp;`, `&mdash;`, `&#39;`,
// `&#x2014;`) is terminated and decodes identically in both modes.
//
// NOT APPLIED TO JSON-LD: that bucket comes from a `<script>` element's raw
// text, which carries no references at all, so decoding it would corrupt a
// literal `&amp;` an author actually wrote (this issue's own acceptance
// condition). Keys are left as-is too — they are `@type`/property names that
// chooseWebMeta matches against fixed spellings.
function decodeDeep(value: unknown): unknown {
  if (typeof value === 'string') return decodeHTMLAttribute(value);
  if (Array.isArray(value)) return value.map(decodeDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, decodeDeep(v)]));
  return value;
}

function decodeBucket(bucket: WaeBucket | undefined): WaeBucket {
  return decodeDeep(bucket || {}) as WaeBucket;
}

export default defineUnlistedScript(() => {
  const fallback: WebMetaResult = { title: null, description: null, author: null, published: null, siteName: null, image: null, url: location.href, metaSource: {} };
  let result: WebMetaResult;
  try {
    // Same absolutizing behavior #195's extractOgp had — an <a>/<link>
    // element's own .href property is always the resolved absolute URL,
    // never the raw (possibly relative) attribute text.
    const canonical = (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href || null;
    const parsed = new WebAutoExtractor().parse(document.documentElement.outerHTML);
    result = chooseWebMeta({ ...parsed, metatags: metatagsFromDom(document), microdata: decodeBucket(parsed.microdata), rdfa: decodeBucket(parsed.rdfa) }, { pageUrl: location.href, canonicalHref: canonical, baseURI: document.baseURI });
  } catch {
    // A parse failure must not leave the save hanging until background.ts's
    // deadline fires (#507's own reasoning) — an empty read degrades exactly
    // like a page with no metadata at all: the save still lands on the tab's
    // own URL, just with no schema.org/OGP fields filled.
    result = fallback;
  }
  chrome.runtime.sendMessage({ type: 'pageMetaExtracted', result } satisfies PageMetaExtractedMessage);
});
