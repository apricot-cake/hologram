'use strict';

// The cloud backup providers, as data (#233).
//
// Everything a provider needs to be talked to lives here as a plain object, and
// every function in this file is pure: no sockets, no electron, no disk. The
// flow (lib-oauth.ts) and the loopback listener (lib-oauth-loopback.ts) read
// from these definitions rather than hard-coding a company's URLs, so adding
// the third provider #233 deferred (Dropbox) is a table entry plus its adapter.
//
// The per-provider facts below were re-checked against the primary sources on
// 2026-08-05 (#233 requires it "at the time of implementation"); where a
// provider disagrees with #233's design comments, the deviation is recorded on
// the field it applies to and reported back to the Issue.
//
// No provider SDK: #233 fixed "plain fetch, no vendor SDKs" so the OAuth surface
// stays auditable (#237 reviews exactly this code) and the runtime dependency
// list does not grow.

import crypto from 'node:crypto';

export type OAuthProviderId = 'google' | 'microsoft';

export interface OAuthProvider {
  readonly id: OAuthProviderId;
  /** Authorization endpoint the system browser is sent to. */
  readonly authorizeUrl: string;
  /** Token endpoint for both the code exchange and later refreshes. */
  readonly tokenUrl: string;
  /**
   * RFC 7009 revocation endpoint, or null when the provider does not offer one.
   * null is not "skip it": disconnecting has to tell the user that the grant
   * survives on the provider's side (#233's 2026-07-27 security review).
   */
  readonly revokeUrl: string | null;
  /** Least privilege — an app-private folder, never the user's whole drive. */
  readonly scopes: readonly string[];
  /**
   * Expected `iss` (RFC 9207) when the authorization response carries one, or
   * null when the value is not a constant we can compare against. Mix-up
   * defence does NOT rest on this either way: a response is only ever processed
   * in the context of the request that opened the listener (#233's 5/7).
   */
  readonly expectedIssuer: string | null;
  /** Provider-specific authorization parameters (offline access, mainly). */
  readonly extraAuthParams: Readonly<Record<string, string>>;
  /**
   * The loopback port that must be free for this provider, or null to take an
   * ephemeral one. Fixed ports are a cost, not a preference — see microsoft.
   */
  readonly redirectPort: number | null;
}

// Google. Sources (2026-08-05):
//   developers.google.com/identity/protocols/oauth2/native-app
//     — "http://127.0.0.1:port or http://[::1]:port" are the supported loopback
//       redirects, the OOB copy/paste flow "is no longer supported", and
//       "refresh tokens are always returned for installed applications".
//   developers.google.com/workspace/drive/api/guides/api-specific-auth
//     — drive.file is a NON-SENSITIVE scope (basic verification only); the
//       restricted list that pulls in a third-party security assessment is
//       drive, drive.readonly, drive.metadata* and friends. #233's "minimum
//       privilege is also a review-cost decision" still holds.
const GOOGLE: OAuthProvider = {
  id: 'google',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  // Files this app created — which is all a backup destination ever touches.
  scopes: ['https://www.googleapis.com/auth/drive.file'],
  expectedIssuer: 'https://accounts.google.com',
  extraAuthParams: {
    // #233's 2/7: ask for offline access explicitly rather than relying on the
    // installed-app default, because the failure mode of NOT having a refresh
    // token is "backups quietly stop an hour later".
    access_type: 'offline',
    // Without it a re-connect can come back without a refresh token at all
    // (Google only issues one on first consent unless consent is re-prompted).
    prompt: 'consent',
  },
  // RFC 8252 §7.3: the port is not part of what Google matches, so the listener
  // can take whatever the OS gives it and no port has to be free in advance.
  redirectPort: null,
};

// Microsoft. Sources (2026-08-05):
//   learn.microsoft.com/entra/identity-platform/reply-url
//     — "Prefer 127.0.0.1 over localhost" (matches #233's 6/7 item 1), BUT:
//       * "The IPv6 loopback address ([::1]) isn't currently supported."
//         → #233's 6/7 item 2 (listen on both families) cannot apply here.
//       * the port is ignored ONLY for `localhost` redirects — "In all other
//         cases, the port component is not ignored" — so a 127.0.0.1 redirect
//         pins one port for the whole app.
//       * an http:// loopback URI cannot be added through the portal's text
//         box; it has to go in via the application manifest
//         (replyUrlsWithType). That is a step the registration cannot skip.
//   learn.microsoft.com/graph/permissions-reference
//     — Files.ReadWrite.AppFolder: delegated only, admin consent NOT required,
//       "read and write files in the application folder". The App Folder型
//       minimum privilege #233 asked for.
//   learn.microsoft.com/entra/identity-platform/refresh-tokens
//     — "doesn't revoke old refresh tokens when used to fetch new access
//       tokens", i.e. rotation is NOT guaranteed on every refresh (#233's 2/7
//       assumed it was). Carrying the previous refresh token forward when the
//       response omits one — what parseTokenResponse does — covers both.
//
// Not found in the primary sources: an RFC 7009 revocation endpoint. Recorded
// as "unsupported" rather than "unverified" would be too strong — see revokeUrl
// and the Issue comment; the disconnect path treats null as "tell the user the
// grant remains" either way.
const MICROSOFT_AUTHORITY = 'https://login.microsoftonline.com/common';
// Chosen once and permanent: it is what the user registers in Entra, so it can
// never be renegotiated at runtime. High, outside IANA's registered range, and
// not rclone's 53682 — two backup tools should not fight over one socket.
const MICROSOFT_REDIRECT_PORT = 53617;
const MICROSOFT: OAuthProvider = {
  id: 'microsoft',
  authorizeUrl: `${MICROSOFT_AUTHORITY}/oauth2/v2.0/authorize`,
  tokenUrl: `${MICROSOFT_AUTHORITY}/oauth2/v2.0/token`,
  revokeUrl: null,
  // offline_access is a scope here rather than a parameter (#233's 2/7).
  scopes: ['Files.ReadWrite.AppFolder', 'offline_access'],
  // The issuer carries the tenant id (…/{tenantid}/v2.0), so there is no
  // constant to compare against for a /common app.
  expectedIssuer: null,
  extraAuthParams: {},
  redirectPort: MICROSOFT_REDIRECT_PORT,
};

const PROVIDERS: Readonly<Record<OAuthProviderId, OAuthProvider>> = { google: GOOGLE, microsoft: MICROSOFT };

function getProvider(id: OAuthProviderId): OAuthProvider {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`unknown OAuth provider: ${id}`);
  return p;
}

/** The redirect URI for a listener that ended up on `port`. */
function redirectUri(port: number): string {
  // 127.0.0.1, never `localhost`: a hosts-file entry can point the name
  // somewhere else, and both providers document the IP literal as the one to
  // use (RFC 8252 §8.3).
  return `http://127.0.0.1:${port}/`;
}

/** One authorization attempt's secrets — never logged, never sent to renderer. */
export interface AuthorizationRequest {
  readonly state: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/**
 * PKCE (RFC 7636) plus `state` (RFC 8252 §8.9 / RFC 9700 §2.1). The two are
 * complementary, not alternatives: PKCE keeps a stolen code from being
 * exchanged, `state` keeps a forged response from being processed at all.
 */
function createAuthorizationRequest(): AuthorizationRequest {
  // 32 bytes → 43 base64url chars, the length RFC 7636 §4.1 allows at minimum.
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  return { state: base64url(crypto.randomBytes(32)), codeVerifier, codeChallenge };
}

/** The URL the SYSTEM browser is sent to (RFC 8252 §5 — never a WebView). */
function buildAuthorizationUrl(provider: OAuthProvider, clientId: string, port: number, req: AuthorizationRequest): string {
  const url = new URL(provider.authorizeUrl);
  const params: Record<string, string> = {
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(port),
    scope: provider.scopes.join(' '),
    state: req.state,
    code_challenge: req.codeChallenge,
    code_challenge_method: 'S256',
    ...provider.extraAuthParams,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/** What a successful exchange or refresh leaves us holding. */
export interface OAuthTokens {
  readonly accessToken: string;
  /** Epoch ms. Treated as expired a minute early so a run does not start on a
   * token that dies mid-upload. */
  readonly expiresAt: number;
  readonly refreshToken: string | null;
  readonly scope: string | null;
}

/** Refresh this long before the access token actually expires. */
const EXPIRY_SKEW_MS = 60 * 1000;

function tokensExpired(tokens: Pick<OAuthTokens, 'expiresAt'>, now = Date.now()): boolean {
  return now >= tokens.expiresAt - EXPIRY_SKEW_MS;
}

/**
 * Reads a token endpoint response.
 *
 * `previous` is the refresh token we already hold, and carrying it forward when
 * the response omits one is the whole point of this function: Google does not
 * re-issue a refresh token on every refresh, Microsoft documents that it does
 * not necessarily rotate either, and Dropbox does. Dropping ours whenever a
 * response happens to omit the field would disconnect the account silently at
 * the next refresh — the exact "quietly stops" failure #233's 2/7 is about.
 */
function parseTokenResponse(json: unknown, previousRefreshToken: string | null = null, now = Date.now()): OAuthTokens {
  const body = (json ?? {}) as Record<string, unknown>;
  const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
  if (!accessToken) throw new Error('token response carried no access_token');
  const expiresIn = Number(body.expires_in);
  const refreshToken = typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : previousRefreshToken;
  return {
    accessToken,
    // A provider that omits expires_in gets the conservative reading (already
    // expired), so the next call refreshes rather than gambling on the token.
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : now,
    refreshToken: refreshToken || null,
    scope: typeof body.scope === 'string' ? body.scope : null,
  };
}

/** Form body for the authorization-code exchange (RFC 6749 §4.1.3 + PKCE). */
function codeExchangeBody(clientId: string, code: string, port: number, codeVerifier: string): URLSearchParams {
  return new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(port),
    code_verifier: codeVerifier,
  });
}

/** Form body for a refresh (RFC 6749 §6). Public client — no secret. */
function refreshBody(clientId: string, refreshToken: string): URLSearchParams {
  return new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken });
}

export { EXPIRY_SKEW_MS, MICROSOFT_REDIRECT_PORT, PROVIDERS, buildAuthorizationUrl, codeExchangeBody, createAuthorizationRequest, getProvider, parseTokenResponse, redirectUri, refreshBody, tokensExpired };
