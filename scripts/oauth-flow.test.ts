// 認可の流れを、代役のプロバイダ相手に端から端まで通す
// （app/src/main/lib-oauth.ts）。
//
// モジュールの境界では何もモックしない。本物のループバックの待ち受けを開き、本物の
// HTTP サーバーがプロバイダを演じ、code は本物のリダイレクトに乗って運ばれる。これは
// 意図してそうしている＝この流れが起こしうる失敗（verifier がトークンの口まで届かない、
// state を検査していない、リフレッシュが refresh token を捨てる）は、どれも単体の粒度
// では正しく見え、部品どうしをつないだときにだけ現れる。
//
// 代役のプロバイダは何でも受け付けるのではなく PKCE を検証する＝/authorize で来た
// challenge を覚えておき、verifier のハッシュがそれに一致しない限り交換を断る。だから
// ここが通ることは、引数が揃っているという話ではなく、S256 の結び付きが効いている証拠
// になる。

import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { OAuthGrantExpiredError, authorize, ensureAccessToken, refreshTokens, revokeTokens } from '../app/src/main/lib-oauth';

interface FakeProvider {
  base: string;
  close(): void;
  /** 設定すると /token が代わりにエラーの本文を返す。 */
  tokenError: { status: number; body: unknown } | null;
  /** 設定すると /revoke がこのステータスで答える。 */
  revokeStatus: number;
  seen: { challenge: string | null; verifier: string | null; refreshToken: string | null; revoked: string | null };
  /** リフレッシュのとき /token が返すものを上書きする。 */
  refreshResponse: Record<string, unknown>;
  /** リダイレクトに足す（発行者を騙るのに使う）。 */
  extraRedirectParams: Record<string, string>;
}

const running: FakeProvider[] = [];
afterEach(() => {
  for (const p of running.splice(0)) p.close();
});

async function startFakeProvider(): Promise<FakeProvider> {
  const state: FakeProvider = {
    base: '',
    close: () => server.close(),
    tokenError: null,
    revokeStatus: 200,
    seen: { challenge: null, verifier: null, refreshToken: null, revoked: null },
    refreshResponse: { access_token: 'refreshed', expires_in: 3600 },
    extraRedirectParams: {},
  };
  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/authorize') {
      state.seen.challenge = url.searchParams.get('code_challenge');
      const back = new URL(url.searchParams.get('redirect_uri') || '');
      back.searchParams.set('code', 'granted-code');
      back.searchParams.set('state', url.searchParams.get('state') || '');
      for (const [k, v] of Object.entries(state.extraRedirectParams)) back.searchParams.set(k, v);
      res.writeHead(302, { location: back.toString() });
      res.end();
      return;
    }
    if (url.pathname === '/token') {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        const form = new URLSearchParams(body);
        if (state.tokenError) return json(res, state.tokenError.status, state.tokenError.body);
        if (form.get('grant_type') === 'refresh_token') {
          state.seen.refreshToken = form.get('refresh_token');
          return json(res, 200, state.refreshResponse);
        }
        const verifier = form.get('code_verifier') || '';
        state.seen.verifier = verifier;
        const hashed = crypto.createHash('sha256').update(verifier).digest('base64url');
        // PKCE の要点そのもの＝verifier の伴わない code には何の価値も無い。
        if (!verifier || hashed !== state.seen.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
        return json(res, 200, { access_token: 'issued', expires_in: 3600, refresh_token: 'rt-1', scope: 'test' });
      });
      return;
    }
    if (url.pathname === '/revoke') {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        state.seen.revoked = new URLSearchParams(body).get('token');
        res.writeHead(state.revokeStatus, { 'content-type': 'application/json' });
        res.end('{}');
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen({ host: '127.0.0.1', port: 0 }, () => resolve()));
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  running.push(state);
  return state;
}

/** 流れの中のプロバイダ呼び出しを、本物のホストではなく代役へ向ける。 */
function routedFetch(fake: FakeProvider): typeof globalThis.fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const target = url.pathname.includes('revoke') ? `${fake.base}/revoke` : `${fake.base}/token`;
    return globalThis.fetch(target, init);
  }) as typeof globalThis.fetch;
}

/** ブラウザを演じる＝同意後のリダイレクトをループバックまでたどる。 */
function browserThatConsents(fake: FakeProvider) {
  return async (consentUrl: string) => {
    const url = new URL(consentUrl);
    const at = new URL(`${fake.base}/authorize`);
    at.search = url.search;
    const res = await fetch(at, { redirect: 'manual' });
    const location = res.headers.get('location');
    await res.text();
    if (!location) throw new Error('代役のプロバイダがリダイレクトしなかった');
    await fetch(location).then((r) => r.text());
  };
}

describe('認可（コード交換まで）', () => {
  test('同意からトークンまで通り、verifier は URL でなくトークン要求で送られる', async () => {
    const fake = await startFakeProvider();
    const tokens = await authorize('google', 'client-1', { openExternal: browserThatConsents(fake), fetch: routedFetch(fake), timeoutMs: 5000 });
    expect(tokens.accessToken).toBe('issued');
    expect(tokens.refreshToken).toBe('rt-1');
    expect(fake.seen.verifier).toBeTruthy();
    expect(fake.seen.challenge).toBe(
      crypto
        .createHash('sha256')
        .update(fake.seen.verifier || '')
        .digest('base64url'),
    );
  });

  test('client id が無ければブラウザすら開かない', async () => {
    let opened = false;
    await expect(
      authorize('google', '', {
        openExternal: async () => {
          opened = true;
        },
      }),
    ).rejects.toThrow(/client id/);
    expect(opened).toBe(false);
  });

  test('別の発行者を名乗る応答は受け付けない（mix-up 防御）', async () => {
    const fake = await startFakeProvider();
    fake.extraRedirectParams = { iss: 'https://evil.example' };
    await expect(authorize('google', 'client-1', { openExternal: browserThatConsents(fake), fetch: routedFetch(fake), timeoutMs: 5000 })).rejects.toThrow(/unexpected issuer/);
  });

  test('ブラウザを開けなかった場合、その理由のまま失敗する', async () => {
    // そのうえで、すでに走っていた待ち受け自身の待ちが、finally で閉じられたときに
    // 拾われない rejection にならないこと。
    const fake = await startFakeProvider();
    await expect(
      authorize('google', 'client-1', {
        openExternal: async () => {
          throw new Error('no browser');
        },
        fetch: routedFetch(fake),
        timeoutMs: 60_000,
      }),
    ).rejects.toThrow(/no browser/);
  });

  test('同意を閉じただけならタイムアウトで終わる（待ち続けない）', async () => {
    const fake = await startFakeProvider();
    await expect(authorize('google', 'client-1', { openExternal: async () => {}, fetch: routedFetch(fake), timeoutMs: 40 })).rejects.toThrow(/timed out/);
  });
});

describe('リフレッシュ', () => {
  const stored = { accessToken: 'old', expiresAt: 0, refreshToken: 'rt-1', scope: null };

  test('新しい refresh_token が返れば置き換え、返らなければ手元を保つ', async () => {
    const fake = await startFakeProvider();
    const deps = { openExternal: async () => {}, fetch: routedFetch(fake) };
    const kept = await refreshTokens('google', 'c', stored, deps);
    expect(kept.refreshToken).toBe('rt-1'); // 応答が返さなかった場合
    fake.refreshResponse = { access_token: 'refreshed', expires_in: 3600, refresh_token: 'rt-2' };
    const rotated = await refreshTokens('google', 'c', stored, deps);
    expect(rotated.refreshToken).toBe('rt-2');
  });

  test('期限切れのときだけ実際に更新する', async () => {
    const fake = await startFakeProvider();
    const deps = { openExternal: async () => {}, fetch: routedFetch(fake) };
    const live = { ...stored, expiresAt: Date.now() + 3_600_000 };
    expect(await ensureAccessToken('google', 'c', live, deps)).toEqual({ tokens: live, refreshed: false });
    const stale = await ensureAccessToken('google', 'c', stored, deps);
    expect(stale.refreshed).toBe(true);
    expect(stale.tokens.accessToken).toBe('refreshed');
  });

  test('許可の取り消しは他の失敗と区別できる（再接続の導線用）', async () => {
    const fake = await startFakeProvider();
    fake.tokenError = { status: 400, body: { error: 'invalid_grant', error_description: 'token revoked' } };
    const deps = { openExternal: async () => {}, fetch: routedFetch(fake) };
    await expect(refreshTokens('google', 'c', stored, deps)).rejects.toBeInstanceOf(OAuthGrantExpiredError);
    fake.tokenError = { status: 500, body: { error: 'server_error' } };
    await expect(refreshTokens('google', 'c', stored, deps)).rejects.not.toBeInstanceOf(OAuthGrantExpiredError);
  });

  test('refresh token を持たない接続は「失効」として扱う', async () => {
    await expect(refreshTokens('google', 'c', { ...stored, refreshToken: null }, { openExternal: async () => {} })).rejects.toBeInstanceOf(OAuthGrantExpiredError);
  });
});

describe('失効（切断）', () => {
  const stored = { accessToken: 'at', expiresAt: 0, refreshToken: 'rt-1', scope: null };

  test('refresh token を失効させる', async () => {
    const fake = await startFakeProvider();
    expect(await revokeTokens('google', 'c', stored, { openExternal: async () => {}, fetch: routedFetch(fake) })).toBe('revoked');
    expect(fake.seen.revoked).toBe('rt-1');
  });

  test('すでに無効なトークンは成功として扱う（RFC 7009 §2.2）', async () => {
    const fake = await startFakeProvider();
    fake.revokeStatus = 400;
    expect(await revokeTokens('google', 'c', stored, { openExternal: async () => {}, fetch: routedFetch(fake) })).toBe('already-invalid');
  });

  test('オフラインは失敗でなく「保留」として返る', async () => {
    const deps = {
      openExternal: async () => {},
      fetch: (() => Promise.reject(new Error('offline'))) as unknown as typeof globalThis.fetch,
    };
    expect(await revokeTokens('google', 'c', stored, deps)).toBe('offline');
  });
});
