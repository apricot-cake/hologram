// The loopback redirect listener (app/src/main/lib-oauth-loopback.ts).
//
// This socket is the one place an outsider can reach during an authorization,
// so the suite exercises it the way an attacker would: wrong state, no state,
// a second response after the first, a request to a port that is already taken.
// The listener is real here (a real bind, real HTTP) rather than mocked — the
// properties being checked ARE socket behaviour.

import http from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';
import { startLoopbackListener } from '../app/src/main/lib-oauth-loopback';

const open: Array<{ close(): void }> = [];
afterEach(() => {
  for (const l of open.splice(0)) l.close();
});

async function start(port: number | null = null) {
  const listener = await startLoopbackListener(port);
  open.push(listener);
  return listener;
}

/** Hits the listener the way the browser would after a redirect. */
async function callback(port: number, query: Record<string, string>): Promise<number> {
  const url = new URL(`http://127.0.0.1:${port}/`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url);
  await res.text();
  return res.status;
}

describe('ループバック待受', () => {
  test('state が一致する応答から code を取り出す', async () => {
    const listener = await start();
    const waiting = listener.waitForCallback('state-1');
    expect(await callback(listener.port, { code: 'the-code', state: 'state-1' })).toBe(200);
    expect(await waiting).toEqual({ code: 'the-code', iss: null });
  });

  test('iss（RFC 9207）が付いていれば拾う', async () => {
    const listener = await start();
    const waiting = listener.waitForCallback('s');
    await callback(listener.port, { code: 'c', state: 's', iss: 'https://accounts.google.com' });
    expect((await waiting).iss).toBe('https://accounts.google.com');
  });

  test('state が違う応答は破棄され、待受は本物を待ち続ける', async () => {
    const listener = await start();
    const waiting = listener.waitForCallback('state-1');
    // A forged redirect must not be able to cancel the real authorization.
    expect(await callback(listener.port, { code: 'forged', state: 'state-2' })).toBe(400);
    expect(await callback(listener.port, { state: 'state-1' })).toBe(400); // no code
    expect(await callback(listener.port, { code: 'real', state: 'state-1' })).toBe(200);
    expect((await waiting).code).toBe('real');
  });

  test('error 応答（同意のキャンセル）は失敗として返る', async () => {
    const listener = await start();
    const waiting = listener.waitForCallback('s');
    // The assertion is attached BEFORE the response arrives: the rejection
    // happens inside the server's request handler, so a handler added
    // afterwards would leave one tick of unhandled rejection behind.
    const rejects = expect(waiting).rejects.toThrow(/access_denied/);
    await callback(listener.port, { error: 'access_denied', error_description: 'user cancelled', state: 's' });
    await rejects;
  });

  test('応答を受けた時点で待受は閉じる（あとから届いても届かない）', async () => {
    const listener = await start();
    const waiting = listener.waitForCallback('s');
    await callback(listener.port, { code: 'c', state: 's' });
    await waiting;
    await expect(fetch(`http://127.0.0.1:${listener.port}/?code=x&state=s`)).rejects.toThrow();
  });

  test('閉じると待ちも終わる（タイムアウトまで宙に浮かない）', async () => {
    // The cancel path: a caller closes in a finally, and the pending wait has
    // to fail there and then — otherwise it rejects minutes later with nobody
    // listening, which is an unhandled rejection in the main process.
    const listener = await start();
    const waiting = listener.waitForCallback('s', 60_000);
    const rejects = expect(waiting).rejects.toThrow(/closed/);
    listener.close();
    await rejects;
  });

  test('待ちきれなければタイムアウトし、ポートを手放す', async () => {
    const listener = await start();
    await expect(listener.waitForCallback('s', 30)).rejects.toThrow(/timed out/);
    await expect(fetch(`http://127.0.0.1:${listener.port}/`)).rejects.toThrow();
  });

  test('固定ポートが埋まっていれば、そのポート名で失敗する', async () => {
    // Microsoft's redirect URI names one port, so there is no fallback to
    // report — the message has to say which port to free.
    const blocker = http.createServer();
    await new Promise<void>((resolve) => blocker.listen({ host: '127.0.0.1', port: 0 }, () => resolve()));
    const taken = (blocker.address() as { port: number }).port;
    try {
      await expect(startLoopbackListener(taken)).rejects.toThrow(new RegExp(`port ${taken} is already in use`));
    } finally {
      blocker.close();
    }
  });

  test('待受は 127.0.0.1 だけ（他のインターフェースには出ない）', async () => {
    const listener = await start();
    // Same port on the IPv6 loopback must be free — nothing is bound there.
    const probe = http.createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen({ host: '::1', port: listener.port, ipv6Only: true }, () => resolve());
    }).catch((err: NodeJS.ErrnoException) => {
      // A machine with no IPv6 at all is not a failure of this property.
      if (err.code !== 'EAFNOSUPPORT' && err.code !== 'EADDRNOTAVAIL') throw err;
    });
    probe.close();
  });
});
