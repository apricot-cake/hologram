// "Is the native host answering right now, and are the two halves the same
// generation?" — asked by both extension-owned pages that have a reason to ask
// (#124).
//
// EXTRACTED rather than copied. The diagnostics page built this first (#203's
// connection test, #205's version comparison), and the toolbar popup has to
// answer the same question on every open. Two independent measurements would
// let the two pages disagree — "green in the popup, red in diagnostics" is a
// state nobody could explain, and neither reading would be trustworthy again.
//
// MEASURED FROM THE PAGE, never from the service worker. Two reasons, and both
// are about the answer being the same fact a save depends on:
//   - the connection is opened from the extension's own origin, so the host's
//     allowed_origins check applies exactly as it does on a real save;
//   - the worker's remembered protocol version (background.ts's hostSkew) is
//     the memory of the LAST reply it happened to get. That is an answer to
//     "what did the host say when it last spoke", not to "is it there now".
//
// Every call launches one host process — Chrome spawns one per connection and
// this host is short-lived. That is the diagnostics page's existing cost, paid
// once per popup open as well.
import { PROTOCOL_VERSION, hostProtocolVersion, protocolSkewOf } from '../../native-host/protocol.mts';
import type { HostRequest, ProtocolSkew } from '../../native-host/protocol.mts';
import { NATIVE_HOST } from './native-host.ts';

// Long enough that a cold host process (the first launch after a boot) is not
// called dead, short enough that a page waiting on it is still a page.
const HOST_PING_TIMEOUT_MS = 5000;

// WHERE it went wrong, not what Chrome's wording for it was. The four values
// are the four distinguishable mechanisms, and they lead to different advice:
// connect-threw means Chrome could not even find the host's registration
// (nothing was installed, or the registry entry is gone), while disconnect
// means it was found and the process died — usually with lastError carrying
// the reason.
export type HostPingWhere = 'connect-threw' | 'timeout' | 'disconnect' | 'post-threw';

export interface HostPing {
  ok: boolean;
  where?: HostPingWhere;
  error?: string | null;
  // The host's answer, kept raw: protocolReportOf reads its version stamp, and
  // the diagnostics page prints the whole thing.
  msg?: unknown;
}

export function pingNativeHost(): Promise<HostPing> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: HostPing) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (e: any) {
      done({ ok: false, where: 'connect-threw', error: String((e && e.message) || e) });
      return;
    }
    const timer = setTimeout(() => {
      try {
        port.disconnect();
      } catch {
        /* */
      }
      done({ ok: false, where: 'timeout' });
    }, HOST_PING_TIMEOUT_MS);
    port.onMessage.addListener((m: unknown) => {
      clearTimeout(timer);
      try {
        port.disconnect();
      } catch {
        /* */
      }
      done({ ok: true, msg: m });
    });
    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      done({ ok: false, where: 'disconnect', error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || null });
    });
    try {
      port.postMessage({ type: 'ping' } satisfies HostRequest);
    } catch (e: any) {
      clearTimeout(timer);
      done({ ok: false, where: 'post-threw', error: String((e && e.message) || e) });
    }
  });
}

export interface ProtocolReport {
  extension: number;
  host: number | null;
  hostAnswered: boolean;
  skew: ProtocolSkew | null;
}

// The two halves' contract versions side by side (#205).
//
// `host` is null when the ping never got an answer (the host could not be
// launched — the ping's `where` says which) AND when it answered without a
// stamp, which is a host from before this handshake existed. Those two are not
// the same thing, so `hostAnswered` keeps them apart rather than making the
// reader infer it from the ping.
export function protocolReportOf(ping: HostPing): ProtocolReport {
  const answered = ping.ok === true;
  const host = answered ? hostProtocolVersion(ping.msg) : null;
  return {
    extension: PROTOCOL_VERSION,
    host,
    hostAnswered: answered,
    // Only meaningful once the host has answered: an unreachable host has no
    // version to be behind or ahead of.
    skew: answered ? protocolSkewOf(host) : null,
  };
}
