'use strict';

// The renderer document's Content-Security-Policy (#7, finishing what #683 had
// to leave open). Strings only — app-protocol.ts is what delivers them, and
// keeping the electron import out of here is what lets the policy itself be
// unit-tested in plain Node (scripts/renderer-csp.test.ts).
//
// It used to live in a <meta http-equiv> inside src/renderer/index.html. Two
// directives cannot be delivered that way at all — frame-ancestors and sandbox
// are ignored in <meta> (CSP spec / MDN) — and the production build was a
// file:// document, where Electron's own security checklist says HTTP-header
// delivery "is not possible" (electron/electron#23485). So #683 measured the
// policy it could and left frame-ancestors out, because no channel existed.
//
// Now the renderer is served by protocol.handle('app'), which returns a real
// Response: the policy rides on the response headers, exactly as the asset://
// responses already do (#215, where removing it was measured to let a beacon
// out). The <meta> is gone — one copy, in one place, for both the packaged
// renderer and the dev server.
//
// What each directive is for:
//   default-src 'self'   — everything not named below comes from app://bundle.
//   connect-src 'self' data: — there is no network client in this app; data: is
//     what the bundled sources fetch (inlined assets). asset: is deliberately
//     ABSENT: the library stays reachable through IPC only, never as bytes the
//     renderer can read directly (ADR 0012 — asset:// has no corsEnabled either,
//     so this is the second lock on the same door, not the only one).
//   img-src / media-src  — the library's pictures and video ARE loaded as
//     subresources from the asset:// scheme, plus blob:/data: for what the
//     renderer builds itself (ugoira frames arrive over IPC as bytes).
//   style-src 'unsafe-inline' — required by React's style={{…}} prop, which
//     writes the DOM style attribute (panel widths, drag offsets, toasts).
//     Measured in #683 by removing it; a nonce/hash rewrite is out of scope.
//   frame-ancestors 'none' — new here, and half the reason this module exists:
//     the renderer holds the preload bridge, so nothing may embed it.

function rendererCsp(nonce?: string): string {
  return [
    "default-src 'self'",
    "connect-src 'self' data:",
    "img-src 'self' asset: data: blob:",
    "media-src 'self' asset: blob:",
    "style-src 'self' 'unsafe-inline'",
    nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** What the packaged renderer runs under. */
const RENDERER_CSP = rendererCsp();

// The one directive dev cannot share. `@vitejs/plugin-react` injects its Fast
// Refresh preamble as an INLINE module script, and Vite injects inline scripts
// of its own; under `script-src 'self'` Chromium drops them and the renderer
// throws "@vitejs/plugin-react can't detect preamble" before it mounts anything
// (measured 2026-08-02 — one violation, script-src-elem, and nothing else).
//
// The fix is Vite's own answer to this: `html.cspNonce` puts a nonce on every
// tag Vite emits (vite/dist/node — injectNonceAttributeTagHook), so naming that
// nonce here allows Vite's tooling and NOTHING else. An inline script written by
// this app still fails in dev exactly as it would in production, which is the
// property the shared policy exists for; `'unsafe-inline'` would have thrown
// that away to fix the same symptom. A fixed string is fine because it never
// leaves the dev machine — the packaged policy above has no nonce at all.
// electron.vite.config.ts reads this constant so the two cannot drift.
const DEV_CSP_NONCE = 'hologram-dev';
const DEV_RENDERER_CSP = rendererCsp(DEV_CSP_NONCE);

/** Headers every app:// response carries: the policy above, plus nosniff. */
function rendererSecurityHeaders(): Record<string, string> {
  return { 'content-security-policy': RENDERER_CSP, 'x-content-type-options': 'nosniff' };
}

export { DEV_CSP_NONCE, DEV_RENDERER_CSP, RENDERER_CSP, rendererSecurityHeaders };
