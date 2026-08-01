// The acquisition-original layer's wire shape (#292): one row per payload that
// arrived FOR a record, kept unmodified so a field nobody normalizes today can
// still be recovered from a post saved years ago — including from a post the
// platform has since deleted.
//
// Why the layer exists (#292's "the acquisition principle"): surfaces (facets, queries, UI) are
// reversible — not building one costs nothing, because it can be added the day a
// real need appears. Acquisition is not: a post gets deleted, an account
// disappears, and whatever was not kept at save time is gone for good. So the
// default for data ALREADY in hand is "keep all of it", while promotion into the
// normalized columns stays demand-driven. This module is the "keep all of it"
// half.
//
// The boundary (#292 2026-07-25 design comment) is "the payload that arrived for
// the record being saved". Cookies, Authorization/request headers, and the page
// DOM are never part of it — this module only ever sees a RESPONSE BODY that the
// acquisition code chose to hand over, so those cannot leak in by accident.
//
// Kept Electron-free (node builtins only) and .mts for the same reason as
// post-record.mts and inbox.mts: native-host/bridge.cts require()s it from CJS
// and app/src/main imports it as ESM, and both sides must agree on ONE shape.

import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

// Per-RECORD budget on UNCOMPRESSED bytes (#292: "the per-record pre-compression cap").
// Two orders of magnitude above a real post payload (a tweet-result body is
// ~5-20 KB, the largest pixiv illust response ~30 KB), so this never fires on
// ordinary saves — it exists to bound a pathological response, not to ration.
const RAW_PAYLOAD_MAX_BYTES = 2 * 1024 * 1024;

// Recorded in `encoding` when the cap dropped the bytes. Deliberately NOT a
// save failure (#292): losing the post to protect a KB-level budget would
// invert the whole point of the layer. The row is still written, so the fact
// that an acquisition happened — and its identity (sourceKind/sha256/size) —
// survives even though the bytes did not.
const OMITTED_OVERSIZE = 'omitted:oversize';
const ENCODING_GZIP = 'gzip';

// What an acquisition site hands in: the body exactly as received.
interface RawPayloadInput {
  // Which acquisition produced it. 'api:<platform>/<endpoint>' for a response
  // body; 'dom:<platform>/v<n>' is reserved for a DOM extractor's versioned
  // intermediate representation (the form #292 designates as the original on
  // that route — no DOM route feeds record fields today, see the ADR).
  sourceKind: string;
  acquiredAt?: string;
  contentType?: string | null;
  body: string;
}

// What travels in the inbox envelope / export sidecar and lands in raw_payloads.
// sha256 is over the UNCOMPRESSED bytes (#292) so it identifies the payload
// itself, not one particular compression of it.
interface RawPayloadShape {
  sourceKind: string;
  acquiredAt: string;
  contentType: string | null;
  encoding: string; // 'gzip' | 'omitted:oversize'
  sha256: string;
  byteLength: number; // uncompressed
  payloadBase64: string | null; // null when omitted
}

function normStr(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

// Compresses and hashes each input, spending a shared per-record budget in the
// order the acquisitions happened. A payload that does not fit (alone, or in
// what is left) is recorded as omitted rather than dropped silently or retried
// smaller — v1 does no re-compression and no cross-record dedup (#292).
function packRawPayloads(inputs: unknown, opts: { maxBytes?: number; now?: () => string } = {}): RawPayloadShape[] {
  if (!Array.isArray(inputs)) return [];
  const maxBytes = opts.maxBytes ?? RAW_PAYLOAD_MAX_BYTES;
  const now = opts.now || (() => new Date().toISOString());
  const out: RawPayloadShape[] = [];
  let spent = 0;
  for (const item of inputs) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const sourceKind = normStr(raw.sourceKind);
    if (!sourceKind || typeof raw.body !== 'string') continue;
    const bytes = Buffer.from(raw.body, 'utf8');
    const fits = bytes.length <= maxBytes - spent;
    if (fits) spent += bytes.length;
    out.push({
      sourceKind,
      acquiredAt: normStr(raw.acquiredAt) || now(),
      contentType: normStr(raw.contentType),
      encoding: fits ? ENCODING_GZIP : OMITTED_OVERSIZE,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length,
      payloadBase64: fits ? gzipSync(bytes).toString('base64') : null,
    });
  }
  return out;
}

// Validates an already-packed list coming back off the wire (an inbox envelope,
// an export sidecar). Anything malformed is dropped rather than throwing: one
// bad entry must not cost the post it belongs to.
function normalizeRawPayloads(v: unknown): RawPayloadShape[] {
  if (!Array.isArray(v)) return [];
  const out: RawPayloadShape[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const sourceKind = normStr(raw.sourceKind);
    const sha256 = normStr(raw.sha256);
    if (!sourceKind || !sha256) continue;
    const payloadBase64 = normStr(raw.payloadBase64);
    const encoding = normStr(raw.encoding) || (payloadBase64 ? ENCODING_GZIP : OMITTED_OVERSIZE);
    out.push({
      sourceKind,
      acquiredAt: normStr(raw.acquiredAt) || '',
      contentType: normStr(raw.contentType),
      encoding,
      sha256,
      byteLength: typeof raw.byteLength === 'number' && Number.isFinite(raw.byteLength) ? raw.byteLength : 0,
      payloadBase64: encoding === ENCODING_GZIP ? payloadBase64 : null,
    });
  }
  return out;
}

// The read side, for whoever eventually surfaces an original (an inspector, a
// backfill pass): returns the original body text, or null when the bytes were
// never stored / no longer verify. The sha256 check is the point — a payload
// that does not hash back to what was received is not an original.
function unpackRawPayload(row: { encoding: string; sha256: string; payload: Buffer | Uint8Array | null }): string | null {
  if (row.encoding !== ENCODING_GZIP || !row.payload) return null;
  let bytes: Buffer;
  try {
    bytes = gunzipSync(Buffer.from(row.payload));
  } catch {
    return null;
  }
  if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) return null;
  return bytes.toString('utf8');
}

export { RAW_PAYLOAD_MAX_BYTES, ENCODING_GZIP, OMITTED_OVERSIZE, packRawPayloads, normalizeRawPayloads, unpackRawPayload };
export type { RawPayloadInput, RawPayloadShape };
