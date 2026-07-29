'use strict';

// Security headers every asset:// response carries (#215).
//
// asset:// is registered `standard: true, secure: true, supportFetchAPI: true`,
// so asset://img/* is ONE origin holding the whole library. A document served
// from it can therefore read every other library file with a same-origin fetch.
// `sandbox: true` on the viewer window does not help: it drops Node/IPC, not
// page script. Without a policy on the response, a scripted SVG opened as a
// top-level document would have had both halves of an exfiltration — read the
// library, then POST it out.
//
// So the response itself carries the policy, which makes it independent of who
// opened the document: a caller wired up later inherits it for free. Subresource
// loads (<img>, CSS backgrounds, <video>) are unaffected — a response CSP binds
// the document made FROM that response, never the document that embeds it.
//
// The allowances are what a legitimate picture still needs when it IS the
// document: itself as an image, inline presentational CSS (SVG carries <style>),
// data: for embedded glyphs/bitmaps. Everything else — script, fetch/XHR,
// frames, form posts — falls through to `default-src 'none'`.
const ASSET_CSP = ["default-src 'none'", "img-src 'self' data: blob:", "media-src 'self' blob:", "style-src 'unsafe-inline'", 'font-src data:', "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join('; ');

// nosniff pins the declared content-type. mimeForFile derives the type from the
// extension, so without it a library file whose bytes disagree with its name
// could be sniffed into a different (active) type than the one we picked.
export function assetSecurityHeaders(): Record<string, string> {
  return { 'content-security-policy': ASSET_CSP, 'x-content-type-options': 'nosniff' };
}
