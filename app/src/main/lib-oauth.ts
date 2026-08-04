'use strict';

// The authorization flow for cloud backup destinations (#233).
//
// Public client, authorization code + PKCE, response delivered to a loopback
// socket (RFC 8252). There is no client secret anywhere in this file and there
// cannot be one: an OSS desktop app ships its client id in the open, which is
// exactly the case RFC 8252 §8.5 and #233's design are written for.
//
// The three rules this module exists to keep:
//   1. The consent screen opens in the SYSTEM browser. Never a BrowserWindow,
//      never a WebView (RFC 8252 §5 MUST; Google rejects WebView authorization
//      outright). `openExternal` is injected rather than imported so that stays
//      true by construction here and testable from a plain Node suite.
//   2. Tokens never leave the main process. Nothing in this file returns a
//      token toward IPC, and the disk side is lib-oauth-vault.ts.
//   3. Nothing here logs a token, a code, or a verifier — not even truncated.
//      #237 audits this; error messages carry the provider's error CODE only.
//
// Refreshing follows #233's 2/7: keep whatever refresh token comes back (the
// providers disagree on whether they rotate), and surface an expired grant as
// its own outcome so the UI can offer a re-connect instead of going quiet.

import { getProvider, buildAuthorizationUrl, codeExchangeBody, createAuthorizationRequest, parseTokenResponse, refreshBody, tokensExpired } from './lib-oauth-providers.ts';
import type { OAuthProviderId, OAuthTokens } from './lib-oauth-providers.ts';
import { startLoopbackListener } from './lib-oauth-loopback.ts';

export interface OAuthDeps {
  /** Opens the consent URL in the user's own browser. */
  openExternal(url: string): Promise<void>;
  /** Injected so a suite can stand up a fake provider; defaults to global. */
  fetch?: typeof globalThis.fetch;
  /** Overrides the consent timeout (tests use a short one). */
  timeoutMs?: number;
}

/** An expired/revoked grant, told apart from every other failure. */
export class OAuthGrantExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthGrantExpiredError';
  }
}

/**
 * Reads a token endpoint failure. The body is a JSON object with `error` and
 * optionally `error_description` (RFC 6749 §5.2); `invalid_grant` is the one
 * that means "the user's grant is gone", which is a re-connect prompt rather
 * than a retry.
 */
function tokenError(status: number, body: unknown): Error {
  const parsed = (body ?? {}) as Record<string, unknown>;
  const code = typeof parsed.error === 'string' ? parsed.error : `HTTP ${status}`;
  const description = typeof parsed.error_description === 'string' ? parsed.error_description : '';
  const message = description ? `${code}: ${description}` : code;
  return code === 'invalid_grant' ? new OAuthGrantExpiredError(message) : new Error(message);
}

async function postForm(url: string, body: URLSearchParams, deps: OAuthDeps): Promise<unknown> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });
  // A provider that answers an error with a non-JSON body still has to produce
  // an error, not a parse crash.
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (!res.ok) throw tokenError(res.status, parsed);
  return parsed;
}

/**
 * Runs one interactive authorization and returns the tokens it produced.
 *
 * The listener is opened BEFORE the browser, because the redirect URI has to
 * name the port that was actually bound, and it is closed in a finally: a
 * cancelled consent must not leave a socket listening on this machine.
 */
async function authorize(providerId: OAuthProviderId, clientId: string, deps: OAuthDeps): Promise<OAuthTokens> {
  if (!clientId) throw new Error('no OAuth client id is configured for this provider');
  const provider = getProvider(providerId);
  const request = createAuthorizationRequest();
  const listener = await startLoopbackListener(provider.redirectPort);
  try {
    const url = buildAuthorizationUrl(provider, clientId, listener.port, request);
    const waiting = listener.waitForCallback(request.state, deps.timeoutMs);
    await deps.openExternal(url);
    const callback = await waiting;
    // RFC 9207: when the provider names itself in the response, it has to be
    // the one we asked. When it does not, the binding is the listener itself —
    // this response can only be the answer to the request that opened it
    // (#233's 5/7 rules out a shared handler that guesses the provider).
    if (callback.iss && provider.expectedIssuer && callback.iss !== provider.expectedIssuer) {
      throw new Error(`authorization response came from an unexpected issuer (${callback.iss})`);
    }
    const body = codeExchangeBody(clientId, callback.code, listener.port, request.codeVerifier);
    return parseTokenResponse(await postForm(provider.tokenUrl, body, deps));
  } finally {
    listener.close();
  }
}

/** Trades a refresh token for a live access token, keeping rotation in step. */
async function refreshTokens(providerId: OAuthProviderId, clientId: string, tokens: OAuthTokens, deps: OAuthDeps): Promise<OAuthTokens> {
  if (!tokens.refreshToken) throw new OAuthGrantExpiredError('no refresh token is stored for this connection');
  const provider = getProvider(providerId);
  const body = await postForm(provider.tokenUrl, refreshBody(clientId, tokens.refreshToken), deps);
  // The previous refresh token is carried forward when the response omits one;
  // when the response DOES carry one, the new value replaces it and has to be
  // persisted by the caller — reusing a rotated-away token is what trips a
  // provider's replay detection and kills the whole token family.
  return parseTokenResponse(body, tokens.refreshToken);
}

/**
 * The call sites use this, not refreshTokens: it hands back a token that is
 * good right now, and reports whether anything changed so the caller knows when
 * it has to write the vault.
 */
async function ensureAccessToken(providerId: OAuthProviderId, clientId: string, tokens: OAuthTokens, deps: OAuthDeps): Promise<{ tokens: OAuthTokens; refreshed: boolean }> {
  if (!tokensExpired(tokens)) return { tokens, refreshed: false };
  return { tokens: await refreshTokens(providerId, clientId, tokens, deps), refreshed: true };
}

/**
 * What disconnecting managed to do on the provider's side.
 *
 * Deleting the local tokens is not disconnecting (#233's 2026-07-27 security
 * review): the grant lives on the provider until it is revoked, so every
 * outcome except 'revoked' is something the UI has to say out loud rather than
 * a silent success.
 */
export type RevokeOutcome = 'revoked' | 'already-invalid' | 'unsupported' | 'offline' | 'failed';

/**
 * RFC 7009 revocation. Revoking the refresh token is what matters — providers
 * that honour the spec drop the whole grant with it; the access token dies on
 * its own within the hour either way.
 */
async function revokeTokens(providerId: OAuthProviderId, clientId: string, tokens: OAuthTokens, deps: OAuthDeps): Promise<RevokeOutcome> {
  const provider = getProvider(providerId);
  // Not every provider offers an endpoint (Microsoft's primary docs describe no
  // RFC 7009 endpoint). 'unsupported' is honest: the user has to withdraw the
  // permission in their account settings, and the UI says so.
  if (!provider.revokeUrl) return 'unsupported';
  const token = tokens.refreshToken || tokens.accessToken;
  if (!token) return 'already-invalid';
  const doFetch = deps.fetch ?? globalThis.fetch;
  try {
    const res = await doFetch(provider.revokeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ token, client_id: clientId, token_type_hint: tokens.refreshToken ? 'refresh_token' : 'access_token' }).toString(),
    });
    if (res.ok) return 'revoked';
    // RFC 7009 §2.2: a token that is already invalid is a successful
    // revocation, and several providers answer 400 invalid_token for it. The
    // user's intent ("this device is disconnected") is satisfied either way.
    if (res.status === 400) return 'already-invalid';
    return 'failed';
  } catch {
    // No network. The caller keeps the revocation pending rather than dropping
    // it, so the grant is not orphaned by a disconnect made offline.
    return 'offline';
  }
}

export { authorize, ensureAccessToken, refreshTokens, revokeTokens };
