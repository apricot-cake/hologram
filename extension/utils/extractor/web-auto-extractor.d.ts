// Ambient types for @marbec/web-auto-extractor (#239) — the package ships no
// .d.ts of its own (verified against its published tarball, 2026-08-03). Typed
// loosely (WaeNode as a bag of unknown schema.org properties): the library's
// job is bucketing markup by format and @type, not describing every property
// schema.org allows, and web-meta.ts's own reads already narrow each field it
// touches.
declare module '@marbec/web-auto-extractor' {
  export type WaeNode = Record<string, unknown>;
  export type WaeBucket = Record<string, WaeNode[]>;

  export interface WaeHeading {
    tag: string;
    level: number;
    text: string;
    order: number;
  }

  export interface WaeError {
    message: string;
    format: string;
    source: string;
  }

  export interface WaeParsed {
    // Keyed by the exact attribute value the page wrote (`content`/`name`/
    // `property`), case as-is — e.g. both "DC.creator" and "citation_author"
    // read back under those exact spellings, never lowercased. Callers must
    // match case-insensitively (web-meta.ts's metaLookup does).
    metatags: Record<string, string[]>;
    microdata: WaeBucket;
    rdfa: WaeBucket;
    jsonld: WaeBucket;
    headings: WaeHeading[];
    // One entry per markup block the library could not parse (e.g. malformed
    // JSON-LD) — that block is simply absent from jsonld/microdata/rdfa above,
    // never thrown, so one broken block never costs the others.
    errors: WaeError[];
  }

  export interface WaeOptions {
    addLocation?: boolean;
    embedSource?: boolean | string[];
    skipEmptyHeadings?: boolean;
    skipLayoutElements?: boolean;
  }

  export default class WebAutoExtractor {
    constructor(options?: WaeOptions);
    parse(html: string): WaeParsed;
  }
}
