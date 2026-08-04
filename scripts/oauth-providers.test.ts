// The provider table and the pure request/response helpers
// (app/src/main/lib-oauth-providers.ts).
//
// These are the parts of #233's OAuth design that are decided once and then
// never observed again at runtime: whether the authorization URL carries PKCE,
// whether the redirect is the IP literal, whether a refresh that omits a
// refresh_token silently disconnects the account. Each of those fails QUIETLY
// in production — an account that stops backing up an hour after connecting
// looks like a network problem — so they are pinned here.

import { describe, expect, test } from 'vitest';
import { EXPIRY_SKEW_MS, MICROSOFT_REDIRECT_PORT, PROVIDERS, buildAuthorizationUrl, codeExchangeBody, createAuthorizationRequest, getProvider, parseTokenResponse, redirectUri, refreshBody, tokensExpired } from '../app/src/main/lib-oauth-providers';
import crypto from 'node:crypto';

describe('認可リクエスト（PKCE と state）', () => {
  test('verifier から S256 で challenge が導かれる', () => {
    const req = createAuthorizationRequest();
    const expected = crypto.createHash('sha256').update(req.codeVerifier).digest('base64url');
    expect(req.codeChallenge).toBe(expected);
    // RFC 7636 §4.1: 43..128 characters, and the value must not be guessable.
    expect(req.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(req.codeVerifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  test('毎回ちがう state と verifier が出る', () => {
    const a = createAuthorizationRequest();
    const b = createAuthorizationRequest();
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.state.length).toBeGreaterThanOrEqual(43);
  });
});

describe('認可 URL', () => {
  test('必須パラメータが全部載る（Google）', () => {
    const req = createAuthorizationRequest();
    const url = new URL(buildAuthorizationUrl(getProvider('google'), 'client-1', 51000, req));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const p = url.searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('client_id')).toBe('client-1');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toBe(req.codeChallenge);
    expect(p.get('state')).toBe(req.state);
    expect(p.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    // #233's 2/7: without offline access the connection dies within the hour.
    expect(p.get('access_type')).toBe('offline');
    // The verifier itself must never be in the URL that goes to the browser.
    expect(url.toString()).not.toContain(req.codeVerifier);
  });

  test('リダイレクト先は 127.0.0.1 リテラル（localhost にしない）', () => {
    const req = createAuthorizationRequest();
    for (const id of ['google', 'microsoft'] as const) {
      const url = new URL(buildAuthorizationUrl(getProvider(id), 'c', 51000, req));
      expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:51000/');
    }
    expect(redirectUri(1234)).toBe('http://127.0.0.1:1234/');
  });

  test('Microsoft は offline_access をスコープで要求し、固定ポートを使う', () => {
    const ms = getProvider('microsoft');
    expect(ms.scopes).toContain('offline_access');
    // Least privilege: the app folder, not the user's drive.
    expect(ms.scopes).toContain('Files.ReadWrite.AppFolder');
    // Entra ignores the port only for `localhost`; a 127.0.0.1 redirect pins one.
    expect(ms.redirectPort).toBe(MICROSOFT_REDIRECT_PORT);
    expect(getProvider('google').redirectPort).toBeNull();
  });

  test('プロバイダは取り違えない（未知の id は落ちる）', () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual(['google', 'microsoft']);
    // @ts-expect-error deliberately outside the union
    expect(() => getProvider('dropbox')).toThrow();
  });
});

describe('トークン応答の解釈', () => {
  const now = 1_800_000_000_000;

  test('refresh_token が返らない応答では手元のものを持ち越す', () => {
    // Google does not re-issue on every refresh; dropping ours here would
    // disconnect the account at the NEXT refresh, silently.
    const tokens = parseTokenResponse({ access_token: 'at-2', expires_in: 3600 }, 'rt-1', now);
    expect(tokens.refreshToken).toBe('rt-1');
    expect(tokens.accessToken).toBe('at-2');
    expect(tokens.expiresAt).toBe(now + 3_600_000);
  });

  test('返ってきた refresh_token は毎回置き換える（ローテーション追随）', () => {
    const tokens = parseTokenResponse({ access_token: 'at-2', expires_in: 3600, refresh_token: 'rt-2' }, 'rt-1', now);
    expect(tokens.refreshToken).toBe('rt-2');
  });

  test('expires_in が無い応答は「すでに期限切れ」として読む', () => {
    const tokens = parseTokenResponse({ access_token: 'at' }, null, now);
    expect(tokens.expiresAt).toBe(now);
    expect(tokensExpired(tokens, now)).toBe(true);
  });

  test('access_token の無い応答は成功として扱わない', () => {
    expect(() => parseTokenResponse({ token_type: 'Bearer' })).toThrow();
  });

  test('期限は少し手前で切れたことにする（実行中に死なせない）', () => {
    const tokens = parseTokenResponse({ access_token: 'at', expires_in: 3600 }, null, now);
    expect(tokensExpired(tokens, now)).toBe(false);
    expect(tokensExpired(tokens, tokens.expiresAt - EXPIRY_SKEW_MS)).toBe(true);
    expect(tokensExpired(tokens, tokens.expiresAt - EXPIRY_SKEW_MS - 1)).toBe(false);
  });
});

describe('トークンエンドポイントへ送る本文', () => {
  test('コード交換は verifier と redirect_uri を伴い、client_secret を持たない', () => {
    const body = codeExchangeBody('client-1', 'the-code', 51000, 'the-verifier');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('code_verifier')).toBe('the-verifier');
    expect(body.get('redirect_uri')).toBe('http://127.0.0.1:51000/');
    // A public client has no secret to leak, by construction.
    expect(body.get('client_secret')).toBeNull();
  });

  test('リフレッシュも公開クライアントのまま', () => {
    const body = refreshBody('client-1', 'rt-1');
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-1');
    expect(body.get('client_secret')).toBeNull();
  });
});
