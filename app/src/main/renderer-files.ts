'use strict';

// The app:// scheme's addresses and the file gate behind it (#7) — everything
// about serving the built renderer that does NOT need Electron, so the escape
// cases are unit-testable without booting one. app-protocol.ts is the handler
// that uses it; this is the same split library-files.ts already has against the
// asset:// handler.

import path from 'node:path';

const APP_SCHEME = 'app';
/** One host. `app://anything-else/…` is not ours. */
const APP_HOST = 'bundle';
/** The ONE document this scheme is allowed to make: the renderer's entry. */
const APP_INDEX_PATH = '/index.html';
const APP_INDEX_URL = `${APP_SCHEME}://${APP_HOST}${APP_INDEX_PATH}`;

// Build products only. Deliberately NOT the asset:// mime table
// (lib-thumbnails.ts): that one serves library media, this one serves a compiled
// bundle, and sharing them would let a need on one side quietly widen the other.
// An unlisted extension gets no type at all rather than a guess — with nosniff on
// every response, it then fails to load instead of being interpreted as something
// nobody intended.
const BUNDLE_MIME: Record<string, string> = {
  '.html': 'text/html',
  // A module script is subject to a strict MIME check: anything but a JavaScript
  // type and the whole renderer refuses to start.
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function mimeForBundleFile(name: string): string | null {
  return BUNDLE_MIME[path.extname(name || '').toLowerCase()] || null;
}

// A URL path → an absolute path strictly inside `root`, or null.
//
// Chromium normalizes `..` before a request reaches the handler (app:// is a
// standard scheme, so it parses like http), which is exactly why the check
// cannot stop there: percent-encoded segments survive that normalization and
// only become `..` here, after decodeURIComponent.
function resolveInRenderer(root: string, urlPath: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null; // malformed percent-encoding
  }
  rel = rel.replace(/^\/+/, '');
  if (!rel) return null;
  // A drive letter or a UNC/absolute path would make path.resolve ignore root.
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null;
  const resolved = path.resolve(root, rel);
  const inside = path.relative(root, resolved);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return null;
  return resolved;
}

/** The renderer entry, carrying the boot query the window passes it. */
function appIndexUrl(query: Record<string, string>): string {
  const u = new URL(APP_INDEX_URL);
  u.search = new URLSearchParams(query).toString();
  return u.href;
}

/** true only for the renderer's own entry document (query/hash ignored). */
function isAppRendererUrl(u: URL): boolean {
  return u.protocol === `${APP_SCHEME}:` && u.hostname === APP_HOST && u.pathname === APP_INDEX_PATH;
}

export { APP_HOST, APP_INDEX_PATH, APP_INDEX_URL, APP_SCHEME, appIndexUrl, isAppRendererUrl, mimeForBundleFile, resolveInRenderer };
