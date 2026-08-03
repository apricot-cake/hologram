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
export default defineUnlistedScript(() => {
  const fallback: WebMetaResult = { title: null, description: null, author: null, published: null, siteName: null, image: null, url: location.href, metaSource: {} };
  let result: WebMetaResult;
  try {
    // Same absolutizing behavior #195's extractOgp had — an <a>/<link>
    // element's own .href property is always the resolved absolute URL,
    // never the raw (possibly relative) attribute text.
    const canonical = (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href || null;
    const parsed = new WebAutoExtractor().parse(document.documentElement.outerHTML);
    result = chooseWebMeta(parsed, { pageUrl: location.href, canonicalHref: canonical, baseURI: document.baseURI });
  } catch {
    // A parse failure must not leave the save hanging until background.ts's
    // deadline fires (#507's own reasoning) — an empty read degrades exactly
    // like a page with no metadata at all: the save still lands on the tab's
    // own URL, just with no schema.org/OGP fields filled.
    result = fallback;
  }
  chrome.runtime.sendMessage({ type: 'pageMetaExtracted', result } satisfies PageMetaExtractedMessage);
});
