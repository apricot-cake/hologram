'use strict';

// Is the extension dev server up? Shared by everything that either starts it
// (dev-extension.cts) or depends on it already running (open-dev-profile.cts),
// so the port lives in one place and "already running" is answered the same way
// everywhere.

const net = require('node:net');

// docs/build.md. Fixed rather than negotiated: a second server does not slip
// away to another port, it fails to bind — which is how a double start announces
// itself instead of quietly serving a stale build from somewhere else.
const DEV_SERVER_PORT = 51731;

// A TCP connect, not an HTTP request: WXT's dev server answers the extension's
// requests, and all this needs to know is whether something owns the port.
//
// `localhost`, NOT `127.0.0.1`. WXT binds what Vite gives it, and that listens on
// ::1 — so an IPv4-only probe reports a running server as down. That is not
// hypothetical: this check said "down" for every server it was ever pointed at
// (found 2026-08-04, after the same wrong probe was copied into the starter).
// `localhost` resolves to both, and Node tries them in turn (autoSelectFamily),
// which is also exactly what the extension's own fetches do — they ask for
// http://localhost:51731, so this now tests the address they actually use.
function devServerAlive(port: number = DEV_SERVER_PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: 'localhost' });
    const finish = (alive: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

module.exports = { DEV_SERVER_PORT, devServerAlive };
