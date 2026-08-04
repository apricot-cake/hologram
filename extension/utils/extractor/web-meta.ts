// Generic page metadata extraction (#239) — the fallback layer for pages no
// site extractor recognizes. Absorbs and supersedes #195's extractOgp(): the
// same OGP fields it read (title/description/image/siteName/canonical) are
// now one tier of the richer chain below, which also reads schema.org
// (JSON-LD/microdata/RDFa), Dublin Core and Highwire.
//
// Design record: #239's 2026-08-03 "設計クローズ" comment is the closed
// design (replacing every earlier comment on the issue except the ones it
// names as still-live). The chain, node-selection rule, date validation and
// canonical-origin check below all come from there — see that comment for the
// "why", not repeated field-by-field here.
//
// Split like extractOgp/buildBookmarkMeta used to be:
//   chooseWebMeta() — pure. Takes the THIRD-PARTY PARSER'S OWN OUTPUT
//     (WaeParsed, from @marbec/web-auto-extractor) plus a few DOM-derived
//     context values, and picks which value wins per field. This module never
//     imports the parser itself — only its output SHAPE, as a type — so
//     scripts/web-meta.test.ts (the root-level suite; extension/ is not an npm
//     workspace of the root, so the root suite cannot resolve extension/'s own
//     node_modules) unit-tests it against hand-written WaeParsed fixtures with
//     no dependency on the package being installed there at all. Separately,
//     scripts/read-meta-bundle.test.ts loads the actual BUILT entrypoint
//     bundle (which DOES bundle the real parser) through jsdom, the same
//     technique scripts/capture-mode-select.test.ts uses for capture.js — that
//     is what actually exercises the real parser's output shape end to end.
//   buildWebMeta() — the composition step: a WebMetaResult -> the PostRecord
//     shape buildRecord() (background.ts) already knows how to turn into a
//     save. Mirrors buildBookmarkMeta's old role exactly.
//
// Neither function touches chrome.* or the DOM — the entrypoint that does
// (extension/entrypoints/read-meta.ts) is the file with the injection
// concerns (#759: it runs as a `files:` unlisted script, never `func:`,
// because bundling this module's third-party dependency is exactly what
// `func:`'s serialization can't carry across the injection boundary).
//
// #23 interaction (no code here, worth stating once): a name-only author
// (no stable url/@id) leaves PostRecord.userId null. app/src/renderer's
// buildUsers() (#760) only creates a poster when a record carries userId OR
// screenName, and a web record's screenName is always null (see
// buildWebMeta) — so a name-only author never reaches the poster grid, and
// therefore never reaches #23's alias-suggest candidates either, with no
// extra exclusion rule needed on this side of the boundary.

import type { WaeBucket, WaeNode, WaeParsed } from '@marbec/web-auto-extractor';
import { emptyRecord } from './record.ts';
import type { PostRecord } from './types.ts';
import type { AnnouncedMedia } from '../../../native-host/protocol.mts';

// Where a field's value came from — stored on the record as `metaSource`
// (design comment 7). 'meta' = a plain `<meta name="...">` with no format of
// its own (currently only author); 'ogp'/'dc'/'highwire' cover both the
// property-style (og:*, article:*) and name-style (DC.*, citation_*) meta
// tags those formats use; 'title'/'host' are the last-resort HTML fallbacks;
// 'canonical'/'tab' are `url`-only.
type WebMetaSourceKind = 'jsonld' | 'microdata' | 'rdfa' | 'ogp' | 'dc' | 'highwire' | 'meta' | 'title' | 'host' | 'canonical' | 'tab';

interface WebMetaAuthor {
  name: string;
  // Normalized to scheme+host+path (query/fragment dropped) — the same web
  // identity buildWebMeta copies onto PostRecord.userId. null when the author
  // is a bare name with no schema.org url/@id anywhere in the chain.
  url: string | null;
}

interface WebMetaResult {
  title: string | null;
  description: string | null;
  author: WebMetaAuthor | null;
  published: string | null;
  siteName: string | null;
  // og:image only, absolutized — unchanged from #195's extractOgp. schema.org
  // has no image chain of its own in this design (an ImageObject node is a
  // NODE CANDIDATE for the other fields, not a separate image source).
  image: string | null;
  url: string | null;
  // Field name (this interface's own keys, not PostRecord's) -> source. Only
  // ever has entries for fields that actually got a value.
  metaSource: Partial<Record<'title' | 'description' | 'author' | 'published' | 'siteName' | 'url', WebMetaSourceKind>>;
}

interface WebMetaContext {
  // The tab's current location.href — what a schema.org node's own url/
  // mainEntityOfPage is compared against for the "does this node describe
  // THIS page" check, and the last-resort value for the record's own `url`
  // when no same-origin canonical exists.
  pageUrl: string;
  // <link rel="canonical"> href, already resolved to absolute, or null.
  canonicalHref: string | null;
  // document.baseURI — almost always equal to pageUrl, but a page with a
  // <base href> tag can differ, and that is what relative og:image/author
  // URLs resolve against in a real browser.
  baseURI: string;
}

// schema.org type names this design treats as "the page's own content",
// highest confidence first (design comment 4's node-selection rule). Tried
// per FORMAT (jsonld/microdata/rdfa each pick their own node independently —
// see selectSchemaNode) so a field one format's node lacks can still be
// answered by another format's node before falling to OGP/DC/Highwire (the
// YouTube case design comment 2026-08-02 found: JSON-LD's VideoObject has no
// author, microdata's does).
const ARTICLE_TYPES = ['Article', 'NewsArticle', 'BlogPosting', 'ScholarlyArticle', 'TechArticle', 'SocialMediaPosting', 'DiscussionForumPosting'];
const TYPE_PRIORITY = [...ARTICLE_TYPES, 'CreativeWork', 'VideoObject', 'ImageObject'];

// `datePublished`/`uploadDate` must read back as ISO 8601 / RFC 3339 AND
// start with YYYY-MM-DD (design comment 6) — a free-text date like "July 3,
// 2025" is never guessed into a wrong ISO value, it is simply not accepted at
// this tier (the chain below still tries the remaining tiers).
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function validIsoDate(s: string | null): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!ISO_DATE_RE.test(trimmed)) return null;
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function absolutize(u: string | null, base: string): string | null {
  if (!u) return null;
  try {
    return new URL(u, base).href;
  } catch {
    return null;
  }
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function hostnameOf(u: string): string | null {
  try {
    return new URL(u).hostname || null;
  } catch {
    return null;
  }
}

// scheme+host+path only — the same normalization the design gives for
// PostRecord.userId (query/fragment carry no identity, just tracking noise
// and in-page anchors).
function normalizeIdentityUrl(raw: string | null, base: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, base);
    return u.origin + u.pathname;
  } catch {
    return null;
  }
}

// One `<meta name>`/`<meta property>` name -> its first non-empty value,
// matched CASE-INSENSITIVELY: the library returns metatags keyed by the
// page's own attribute spelling as-is (verified 2026-08-03 against the
// published package — "DC.creator", "Dc.Creator" and "dc.creator" all read
// back under whatever the page wrote), and real pages spell Dublin Core /
// Highwire tags inconsistently. Built once per parse (chooseWebMeta) rather
// than scanning metatags' keys on every lookup.
function lowerMetaMap(metatags: Record<string, string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, values] of Object.entries(metatags || {})) {
    const v = values?.[0];
    const lower = key.toLowerCase();
    if (typeof v === 'string' && v.trim() && !(lower in out)) out[lower] = v.trim();
  }
  return out;
}

function metaLookup(map: Record<string, string>, names: string[]): string | null {
  for (const name of names) {
    const v = map[name.toLowerCase()];
    if (v) return v;
  }
  return null;
}

// A schema.org node's own `url`/`mainEntityOfPage` value, whichever shape the
// format handed back — a plain string, or an object carrying `@id`/`url`
// (mainEntityOfPage is often `{"@type":"WebPage","@id":"..."}`).
function urlishOf(v: unknown): string | null {
  if (typeof v === 'string') return v || null;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o['@id'] === 'string') return o['@id'];
    if (typeof o.url === 'string') return o.url;
  }
  return null;
}

function resolvedLocation(raw: string | null, base: string): { origin: string; pathname: string } | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, base);
    return { origin: u.origin, pathname: u.pathname };
  } catch {
    return null;
  }
}

// The one rule this design adds ON TOP OF Readability's own chain (design
// comment 5): a node that EXPLICITLY names a different page is rejected — a
// listing page routinely carries several Article nodes, one per teaser, and
// picking the first regardless would be the "唯一の実害ある壊れ方"
// (mis-filling from a different post/article) #202 already guards against
// elsewhere. A node with NO url/mainEntityOfPage at all makes no claim either
// way and is never rejected on that account alone — most single-item pages'
// JSON-LD omits both fields entirely (the YouTube VideoObject fixture design
// comment 2026-08-02 found is one such case).
function nodeMismatchesPage(node: WaeNode, ctx: WebMetaContext): boolean {
  const claims = [urlishOf(node.url), urlishOf(node.mainEntityOfPage)].filter((v): v is string => !!v);
  if (!claims.length) return false;
  const page = resolvedLocation(ctx.pageUrl, ctx.pageUrl);
  if (!page) return false; // can't resolve the page itself -- fail open, same as "no claim"
  return !claims.some((c) => {
    const loc = resolvedLocation(c, ctx.baseURI);
    return !!loc && loc.origin === page.origin && loc.pathname === page.pathname;
  });
}

// One node per format, tried in TYPE_PRIORITY order and skipping any node
// that fails nodeMismatchesPage. null when the format has nothing usable at
// all (most pages: no microdata, no RDFa).
function selectSchemaNode(bucket: WaeBucket | undefined, ctx: WebMetaContext): WaeNode | null {
  if (!bucket) return null;
  for (const type of TYPE_PRIORITY) {
    const nodes = bucket[type];
    if (!nodes || !nodes.length) continue;
    const hit = nodes.find((n) => !nodeMismatchesPage(n, ctx));
    if (hit) return hit;
  }
  return null;
}

// itemprop repetition and JSON-LD's own array-valued properties (multiple
// authors, etc.) both land here as a plain array — the first entry is what
// every field below reads, per design comment 4's "著者が配列のときは先頭の
// 1名だけ" (a joined "A, B" would read as one fabricated poster).
function firstOf(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

function schemaText(node: WaeNode | null, keys: string[]): string | null {
  if (!node) return null;
  for (const key of keys) {
    const v = firstOf(node[key]);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function schemaAuthor(node: WaeNode | null, ctx: WebMetaContext): WebMetaAuthor | null {
  if (!node) return null;
  const raw = firstOf(node.author) ?? firstOf(node.creator);
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const name = raw.trim();
    return name ? { name, url: null } : null;
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const name = schemaText({ name: o.name } as WaeNode, ['name']);
    if (!name) return null;
    const rawUrl = typeof o.url === 'string' ? o.url : typeof o['@id'] === 'string' ? (o['@id'] as string) : null;
    return { name, url: normalizeIdentityUrl(rawUrl, ctx.baseURI) };
  }
  return null;
}

function schemaDate(node: WaeNode | null): string | null {
  if (!node) return null;
  return validIsoDate(schemaText(node, ['datePublished'])) || validIsoDate(schemaText(node, ['uploadDate']));
}

function schemaSiteName(node: WaeNode | null): string | null {
  if (!node) return null;
  const p = firstOf(node.publisher);
  if (typeof p === 'string') return p.trim() || null;
  if (p && typeof p === 'object' && !Array.isArray(p)) return schemaText(p as WaeNode, ['name']);
  return null;
}

// The pure decision function: given the third-party parser's own output for
// this page (unchanged, uninterpreted) and a few DOM-derived context values,
// pick one value per field and say where it came from. No chrome.*, no
// Document — see this file's header for why that split matters for testing
// and for the injection boundary.
function chooseWebMeta(parsed: WaeParsed, ctx: WebMetaContext): WebMetaResult {
  // One node per schema.org format, each independently selected — NOT one
  // shared node across formats. A field the JSON-LD node lacks still gets a
  // chance from the microdata/RDFa node before falling out of schema.org
  // entirely (design comment 2026-08-02's YouTube fix).
  const schemaNodes: Array<[WaeNode | null, WebMetaSourceKind]> = [
    [selectSchemaNode(parsed.jsonld, ctx), 'jsonld'],
    [selectSchemaNode(parsed.microdata, ctx), 'microdata'],
    [selectSchemaNode(parsed.rdfa, ctx), 'rdfa'],
  ];
  const meta = lowerMetaMap(parsed.metatags);
  const metaSource: WebMetaResult['metaSource'] = {};

  let title: string | null = null;
  for (const [node, src] of schemaNodes) {
    title = schemaText(node, ['headline', 'name']);
    if (title) {
      metaSource.title = src;
      break;
    }
  }
  if (!title) {
    title = metaLookup(meta, ['og:title']);
    if (title) metaSource.title = 'ogp';
  }
  if (!title) {
    title = metaLookup(meta, ['dc.title', 'dcterms.title']);
    if (title) metaSource.title = 'dc';
  }
  if (!title) {
    // The library captures the <title> tag's own text under this key.
    title = metaLookup(meta, ['title']);
    if (title) metaSource.title = 'title';
  }

  let description: string | null = null;
  for (const [node, src] of schemaNodes) {
    description = schemaText(node, ['description']);
    if (description) {
      metaSource.description = src;
      break;
    }
  }
  if (!description) {
    description = metaLookup(meta, ['og:description']);
    if (description) metaSource.description = 'ogp';
  }
  if (!description) {
    description = metaLookup(meta, ['dc.description']);
    if (description) metaSource.description = 'dc';
  }

  let author: WebMetaAuthor | null = null;
  for (const [node, src] of schemaNodes) {
    author = schemaAuthor(node, ctx);
    if (author) {
      metaSource.author = src;
      break;
    }
  }
  if (!author) {
    const name = metaLookup(meta, ['author']);
    if (name) {
      author = { name, url: null };
      metaSource.author = 'meta';
    }
  }
  if (!author) {
    const name = metaLookup(meta, ['dc.creator', 'dcterms.creator']);
    if (name) {
      author = { name, url: null };
      metaSource.author = 'dc';
    }
  }
  if (!author) {
    const name = metaLookup(meta, ['citation_author']);
    if (name) {
      author = { name, url: null };
      metaSource.author = 'highwire';
    }
  }
  if (!author) {
    // #202-style guard, and the last tier of this chain (design comment 5): a
    // URL-valued article:author is a Facebook profile link, not a name — never
    // accepted here, and nothing lower to fall through to.
    const raw = metaLookup(meta, ['article:author']);
    if (raw && !looksLikeUrl(raw)) {
      author = { name: raw, url: null };
      metaSource.author = 'ogp';
    }
  }

  let published: string | null = null;
  for (const [node, src] of schemaNodes) {
    published = schemaDate(node);
    if (published) {
      metaSource.published = src;
      break;
    }
  }
  if (!published) {
    published = validIsoDate(metaLookup(meta, ['article:published_time']));
    if (published) metaSource.published = 'ogp';
  }
  if (!published) {
    published = validIsoDate(metaLookup(meta, ['citation_date', 'citation_publication_date']));
    if (published) metaSource.published = 'highwire';
  }
  if (!published) {
    published = validIsoDate(metaLookup(meta, ['dc.date']));
    if (published) metaSource.published = 'dc';
  }

  let siteName: string | null = null;
  for (const [node, src] of schemaNodes) {
    siteName = schemaSiteName(node);
    if (siteName) {
      metaSource.siteName = src;
      break;
    }
  }
  if (!siteName) {
    siteName = metaLookup(meta, ['og:site_name']);
    if (siteName) metaSource.siteName = 'ogp';
  }
  if (!siteName) {
    siteName = hostnameOf(ctx.pageUrl);
    if (siteName) metaSource.siteName = 'host';
  }

  const image = absolutize(metaLookup(meta, ['og:image']), ctx.baseURI);

  // Design comment 5: canonical wins only when it stays on the tab's own
  // origin — a bookmark's card opens what this field says, and a page is free
  // to write ANY canonical/og:url, so an off-origin one is treated as not
  // naming this save's own permalink at all.
  let url: string;
  if (ctx.canonicalHref && sameOrigin(ctx.canonicalHref, ctx.pageUrl)) {
    url = ctx.canonicalHref;
    metaSource.url = 'canonical';
  } else {
    url = ctx.pageUrl;
    metaSource.url = 'tab';
  }

  return { title, description, author, published, siteName, image, url, metaSource };
}

// Compose a chooseWebMeta() read into the PostRecord shape buildRecord()
// (background.ts) already knows how to save. platform stays null — same
// reasoning as #195's old buildBookmarkMeta (2026-08-02 design comment #2):
// the sidebar's site facet gives a platform-less record its own row per
// resolvable domain (#253), a better fit for a bookmark's origin than the
// fixed platform list.
function buildWebMeta(meta: WebMetaResult, tabUrl: string): PostRecord {
  const url = meta.url || tabUrl;
  const rec = emptyRecord(url, null);
  rec.title = meta.title || url;
  rec.text = meta.description || null;
  rec.date = meta.published || null;
  // #239 revises #195's confirmed default (2026-08-02 "ブックマークの主役表示
  // の決定", forward-linked from #195's own thread): an author, when found, is
  // the record's face — same "who made this" primacy an SNS post's
  // displayName already has. Falls back to the pre-#239 rule (site name, then
  // hostname) unchanged when no author is found, so an OGP-only page's save
  // is byte-for-byte what #195 already produced (no regression).
  rec.displayName = meta.author?.name || meta.siteName || hostnameOf(url) || url;
  // Only a STABLE web identity earns userId — a name-only author leaves this
  // null (see this file's header comment for what that buys for free on the
  // #23/poster-grid side).
  rec.userId = meta.author?.url || null;
  rec.screenName = null;
  if (Object.keys(meta.metaSource).length) rec.metaSource = meta.metaSource;
  if (meta.image) {
    rec.mediaType = 'image';
    rec.media = [{ url: meta.image, alt: null, width: null, height: null } as AnnouncedMedia];
  }
  return rec;
}

export { buildWebMeta, chooseWebMeta };
export type { WebMetaAuthor, WebMetaContext, WebMetaResult, WebMetaSourceKind };
