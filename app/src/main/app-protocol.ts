'use strict';

// The app:// scheme the packaged renderer is served from (#7).
//
// Why not file://. Electron's security checklist is explicit (18. "Avoid usage
// of the file:// protocol and prefer usage of custom protocols"): file:// holds
// privileges in Electron that a browser does not grant it, and a local page
// should be served from a custom protocol instead. Concretely, file:// pages get
// fetch access to other file:// assets, service workers, and universal access to
// file:// child frames — the `grantFileProtocolExtraPrivileges` fuse, which
// app/package.json now burns off in the packaged build. Serving the renderer
// from this scheme is what makes turning that fuse off survivable.
//
// It also creates the delivery channel #683 could not have: a Response carries
// headers, so the renderer's CSP stops being a <meta> tag (renderer-csp.ts).
//
// The shape follows Electron's own `app://bundle` example in the protocol docs:
// registered `standard` + `secure` + `supportFetchAPI`, one host, and a
// directory-escape check inside the handler. Two deliberate departures:
//
//   - NO corsEnabled. app://bundle and asset://img are different origins, and
//     that is the point: without CORS the renderer cannot read library bytes
//     directly, so the IPC allow-list stays the only way in (ADR 0012).
//   - fs.readFile rather than net.fetch(pathToFileURL(...)). The docs' example
//     uses net.fetch; whether its file:// path reads THROUGH an asar archive is
//     not stated there, and the packaged renderer lives inside app.asar. Node's
//     fs is patched by Electron to see into asar, so it is the one that is
//     certain to work.

import { protocol, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEV_RENDERER_CSP, rendererSecurityHeaders } from './renderer-csp.ts';
import { APP_HOST, APP_SCHEME, mimeForBundleFile, resolveInRenderer } from './renderer-files.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** out/renderer — electron-vite's renderer output, alongside out/main. */
function rendererRoot(): string {
  return path.resolve(__dirname, '..', 'renderer');
}

function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    // Answering another host would hand out a second origin nobody designed.
    if (url.hostname !== APP_HOST) return new Response('Not found', { status: 404 });
    const file = resolveInRenderer(rendererRoot(), url.pathname);
    if (!file) return new Response('Forbidden', { status: 403 });
    const type = mimeForBundleFile(file);
    if (!type) return new Response('Unsupported media type', { status: 415 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { ...rendererSecurityHeaders(), 'content-type': type } });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') return new Response('Not found', { status: 404 });
      return new Response('Error', { status: 500 });
    }
  });
}

// The other half of the same delivery: `electron-vite dev` serves the renderer
// over http from Vite, so those responses never reach the handler above. Pin the
// dev policy onto them instead — a dev server running a laxer policy than
// production means violations are only discovered in production, which is
// precisely how #683's style-src finding could have been missed. Scoped to the
// dev origin so nothing else in the session is touched, and never called in a
// packaged build (devOrigin is null there — lib-window.ts).
function installDevRendererCsp(devOrigin: string | null): void {
  if (!devOrigin) return;
  session.defaultSession.webRequest.onHeadersReceived({ urls: [`${devOrigin}/*`] }, (details, callback) => {
    const headers: Record<string, string | string[]> = { ...details.responseHeaders };
    // Case-insensitive: Vite may already have sent one under another spelling,
    // and two policies would intersect rather than replace.
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-security-policy') delete headers[key];
    }
    headers['content-security-policy'] = [DEV_RENDERER_CSP];
    callback({ responseHeaders: headers });
  });
}

export { installDevRendererCsp, registerAppProtocol, rendererRoot };
