'use strict';

// The loopback redirect listener (#233, RFC 8252 §7.3).
//
// A desktop app cannot keep a client secret, so the authorization code comes
// back to a socket on this machine instead. Three properties matter and each is
// enforced here rather than by the caller:
//
//   bound to 127.0.0.1   the IP literal, never the name `localhost`: a hosts
//                        entry can move the name, and both providers document
//                        the literal as the one to register (§8.3).
//   open only while the authorization is in flight   the window in which
//                        anything can reach this port is the window the user
//                        spends in the consent screen, and it closes on the
//                        first accepted response, on timeout, or on cancel.
//   state must match     a response whose `state` is not the one this listener
//                        was opened with is discarded WITHOUT ending the wait
//                        (§8.9 / RFC 9700 §2.1) — a forged redirect must not be
//                        able to cancel the real one either.
//
// What #233's 6/7 asked for and this cannot do:
//   * SO_EXCLUSIVEADDRUSE on Windows. Node exposes no setsockopt, and libuv
//     deliberately sets neither SO_REUSEADDR nor SO_EXCLUSIVEADDRUSE on Windows
//     (src/win/tcp.c says SO_EXCLUSIVEADDRUSE "does check all sockets,
//     regardless of state", i.e. it would fail on TIME_WAIT). Adding a native
//     addon for one socket option is a worse trade than the exposure it closes,
//     so the defence in depth is the other three properties above plus PKCE: a
//     code delivered to a hijacked listener is not exchangeable without the
//     verifier, which never leaves this process.
//   * Listening on [::1] as well. Microsoft does not support the IPv6 loopback
//     as a redirect URI at all, and Google's redirect is the v4 literal we
//     build, so the browser has nowhere else to arrive. A second family would
//     be an unused socket.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** How long the user has in the consent screen before the listener gives up. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface LoopbackCallback {
  readonly code: string;
  /** RFC 9207 issuer, when the provider sends one. */
  readonly iss: string | null;
}

export interface LoopbackListener {
  /** The port actually bound — the redirect URI is built from it. */
  readonly port: number;
  /** Resolves with the code once a response carrying `state` arrives. */
  waitForCallback(state: string, timeoutMs?: number): Promise<LoopbackCallback>;
  /** Idempotent; safe to call from a finally. */
  close(): void;
}

// The pages the browser lands on. Self-contained (a redirect target that pulls
// in a stylesheet would be a request to somewhere else at the worst moment) and
// in Japanese, because they are UI.
function page(title: string, body: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title><style>
body{font-family:system-ui,"Segoe UI",sans-serif;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f6f7f9;color:#1c1e21}
main{max-width:28rem;padding:2rem;text-align:center}
h1{font-size:1.25rem;margin:0 0 .75rem}p{margin:0;line-height:1.7;color:#4b5563}
</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

const PAGE_OK = page('接続しました', 'このタブを閉じて Hologram に戻ってください。');
const PAGE_DENIED = page('接続をキャンセルしました', 'Hologram に戻って、もう一度お試しください。');
const PAGE_STRAY = page('この応答は受け付けられません', 'Hologram が待っている認可の応答ではありません。このタブを閉じてください。');

function send(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    // Nothing here should be cached or reachable from another page: the URL
    // being served carries an authorization code.
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  });
  res.end(html);
}

/**
 * Binds the listener. `port` is a provider's fixed registration port, or null
 * for an ephemeral one (Google ignores the port when matching; Microsoft does
 * not — see lib-oauth-providers.ts).
 */
async function startLoopbackListener(port: number | null): Promise<LoopbackListener> {
  const server = http.createServer();
  // A stalled connection must not hold the port after the flow is over.
  server.keepAliveTimeout = 1000;

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      // A fixed-port provider whose port is taken cannot fall back to another
      // one: the registered redirect URI names this port. Say so plainly rather
      // than let "EADDRINUSE" surface as the whole explanation.
      if (err.code === 'EADDRINUSE' && port) reject(new Error(`loopback port ${port} is already in use`));
      else reject(err);
    };
    server.once('error', onError);
    server.listen({ host: '127.0.0.1', port: port ?? 0, exclusive: true }, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });

  const bound = (server.address() as AddressInfo).port;
  let settled = false;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    server.closeAllConnections?.();
    server.close();
  };

  return {
    port: bound,
    waitForCallback(state, timeoutMs = DEFAULT_TIMEOUT_MS) {
      return new Promise<LoopbackCallback>((resolve, reject) => {
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn();
          // The listener's job ends with the first accepted response; the
          // socket closes with it rather than lingering for the app's life.
          close();
        };
        const timer = setTimeout(() => finish(() => reject(new Error('timed out waiting for the authorization response'))), timeoutMs);

        server.on('request', (req, res) => {
          // The code arrives in the query string of a GET; anything else is not
          // the provider.
          const url = new URL(req.url || '/', `http://127.0.0.1:${bound}`);
          const params = url.searchParams;
          const got = params.get('state');
          if (!got || got !== state) {
            // Discarded, and the wait continues: a forged response must not be
            // able to end the real authorization either.
            send(res, 400, PAGE_STRAY);
            return;
          }
          const error = params.get('error');
          if (error) {
            const description = params.get('error_description');
            send(res, 200, PAGE_DENIED);
            finish(() => reject(new Error(description ? `${error}: ${description}` : error)));
            return;
          }
          const code = params.get('code');
          if (!code) {
            send(res, 400, PAGE_STRAY);
            return;
          }
          send(res, 200, PAGE_OK);
          finish(() => resolve({ code, iss: params.get('iss') }));
        });
      });
    },
    close,
  };
}

export { DEFAULT_TIMEOUT_MS, startLoopbackListener };
