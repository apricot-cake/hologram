// プロバイダの表と、要求・応答まわりの純粋なヘルパ
// (app/src/main/lib-oauth-providers.ts)。
//
// ここに在るのは #233 の OAuth 設計のうち、一度決めたら実行時に二度と観測されない部分。
// 認可 URL が PKCE を運ぶか、リダイレクト先が IP リテラルか、refresh_token を返さない
// リフレッシュがアカウントを黙って切断しないか。どれも本番では一切音を立てずに失敗する
//（つないだ1時間後にバックアップが止まったアカウントは、ネットワークの問題に見える）
// ので、ここで押さえる。

import { describe, expect, test } from 'vitest';
import { EXPIRY_SKEW_MS, MICROSOFT_REDIRECT_PORT, PROVIDERS, buildAuthorizationUrl, codeExchangeBody, createAuthorizationRequest, getProvider, parseTokenResponse, redirectUri, refreshBody, tokensExpired } from '../app/src/main/lib-oauth-providers';
import crypto from 'node:crypto';

describe('認可リクエスト（PKCE と state）', () => {
  test('verifier から S256 で challenge が導かれる', () => {
    const req = createAuthorizationRequest();
    const expected = crypto.createHash('sha256').update(req.codeVerifier).digest('base64url');
    expect(req.codeChallenge).toBe(expected);
    // RFC 7636 §4.1: 43..128 文字で、値は推測できてはいけない。
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
    // #233 の 2/7: offline アクセスが無いと、接続は1時間のうちに死ぬ。
    expect(p.get('access_type')).toBe('offline');
    // verifier 自体は、ブラウザへ渡る URL に一切入れてはいけない。
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
    // 最小権限。利用者のドライブではなく、アプリのフォルダ。
    expect(ms.scopes).toContain('Files.ReadWrite.AppFolder');
    // Entra がポートを無視するのは `localhost` の時だけ。127.0.0.1 のリダイレクトは1つに固定する。
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
    // Google はリフレッシュのたびに再発行するわけではない。ここで手元のものを捨てると、
    // 次のリフレッシュでアカウントが黙って切れる。
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
    // 公開クライアントは、作りからして漏らす秘密を持たない。
    expect(body.get('client_secret')).toBeNull();
  });

  test('リフレッシュも公開クライアントのまま', () => {
    const body = refreshBody('client-1', 'rt-1');
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-1');
    expect(body.get('client_secret')).toBeNull();
  });
});
