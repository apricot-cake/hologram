'use strict';

// Guard for "which renderer does the main window load", which is a trust boundary:
// that window's preload exposes window.hologram — delete-all, import, relocate the
// save folder — so whatever page we load inherits destructive IPC. electron-vite
// hands the dev server's address to the main process through ELECTRON_RENDERER_URL,
// an ordinary environment variable, and a build that trusted it unconditionally
// would let anyone who can set the app's environment aim that bridge at a page they
// control (#381; the issue predates the electron-vite move and calls the variable
// HOLOGRAM_DEV_SERVER, which is what this one replaced).
//
// Electron publishes app.isPackaged for exactly this dev/dist split, and its
// security guidance is to never hand Electron APIs to untrusted web content:
//   https://www.electronjs.org/docs/latest/api/app#appispackaged-readonly
//   https://www.electronjs.org/docs/latest/tutorial/security
//
// So: only a non-packaged build reads the variable at all, and even then only an
// http: loopback address passes. Everything else resolves to null and the caller
// loads the bundled renderer — fail-closed, never a fallback to some OTHER external
// URL. Pure function so the boundary can be regression-tested without Electron.

// Rejection reasons, for the caller's log line — a dev who typos the address should
// see why the page came from the bundle instead of silently debugging a stale build.
type DevServerRejection =
  | 'packaged' // a distributed build: the variable is not read at all
  | 'unset' // the normal production path, and `electron-vite build` in dev
  | 'malformed' // not a URL
  | 'not-http' // https:/file:/data:/… — the dev server speaks http
  | 'has-credentials' // user:pass@ — a shape only a crafted URL has
  | 'not-loopback'; // the actual attack: an address off this machine

type DevServerResolution = { url: string; rejected: null } | { url: null; rejected: DevServerRejection };

// The hosts a Vite dev server binds to. WHATWG URL canonicalizes the host before we
// look it up (http://127.1 and http://0x7f.0.0.1 both normalize to 127.0.0.1, and
// IPv6 stays bracketed), so shorthand spellings of loopback still match. Anything
// else in 127.0.0.0/8 is deliberately NOT accepted: nothing in this repo binds
// there, and the narrow set is the whole point of the guard.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Resolve the renderer dev-server URL to load, or null to load the bundled renderer.
//   rawUrl     — process.env.ELECTRON_RENDERER_URL, unvalidated
//   isPackaged — app.isPackaged (passed in rather than imported, to keep this pure)
function resolveDevServerUrl(rawUrl: string | undefined | null, isPackaged: boolean): DevServerResolution {
  if (isPackaged) return { url: null, rejected: 'packaged' };
  if (!rawUrl) return { url: null, rejected: 'unset' };
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { url: null, rejected: 'malformed' };
  }
  if (u.protocol !== 'http:') return { url: null, rejected: 'not-http' };
  if (u.username !== '' || u.password !== '') return { url: null, rejected: 'has-credentials' };
  if (!LOOPBACK_HOSTS.has(u.hostname)) return { url: null, rejected: 'not-loopback' };
  // Hand back the canonical form, so the caller's origin comparison in the
  // navigation guard and the URL it loads are derived from the same parse.
  return { url: u.href, rejected: null };
}

export { resolveDevServerUrl };
export type { DevServerRejection, DevServerResolution };
