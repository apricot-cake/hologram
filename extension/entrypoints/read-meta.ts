import WebAutoExtractor from '@marbec/web-auto-extractor';
import { chooseWebMeta } from '../utils/extractor/web-meta.ts';
import type { PageMetaExtractedMessage } from '../utils/messages.ts';
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
// RDFa); note that microdata and RDFa values still carry entities — that is
// the same defect in the fields this one does not feed, tracked separately.
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

export default defineUnlistedScript(() => {
  const fallback: WebMetaResult = { title: null, description: null, author: null, published: null, siteName: null, image: null, url: location.href, metaSource: {} };
  let result: WebMetaResult;
  try {
    // Same absolutizing behavior #195's extractOgp had — an <a>/<link>
    // element's own .href property is always the resolved absolute URL,
    // never the raw (possibly relative) attribute text.
    const canonical = (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href || null;
    const parsed = new WebAutoExtractor().parse(document.documentElement.outerHTML);
    result = chooseWebMeta({ ...parsed, metatags: metatagsFromDom(document) }, { pageUrl: location.href, canonicalHref: canonical, baseURI: document.baseURI });
  } catch {
    // A parse failure must not leave the save hanging until background.ts's
    // deadline fires (#507's own reasoning) — an empty read degrades exactly
    // like a page with no metadata at all: the save still lands on the tab's
    // own URL, just with no schema.org/OGP fields filled.
    result = fallback;
  }
  chrome.runtime.sendMessage({ type: 'pageMetaExtracted', result } satisfies PageMetaExtractedMessage);
});
