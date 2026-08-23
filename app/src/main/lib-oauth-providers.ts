'use strict';

// クラウドバックアップの各プロバイダを、データとして表したもの（#233）。
//
// プロバイダと話すのに必要なものはすべて、ここに素のオブジェクトとして住む。
// このファイルのすべての関数は純粋: ソケットも electron もディスクも無い。
// フロー（lib-oauth.ts）と loopback リスナー（lib-oauth-loopback.ts）は、
// Google の URL をハードコードせず、この定義から読む。
//
// 下のプロバイダごとの事実は、2026-08-05 に一次情報源に対して再確認した
// （#233 が「実装時点で」それを求めている）。プロバイダが #233 の設計コメントと
// 食い違う箇所は、それが当てはまるフィールドに逸脱として記録し、Issue へ
// 報告してある。
//
// プロバイダの SDK は使わない: #233 が「素の fetch のみ、ベンダー SDK 無し」と
// 決めたので、OAuth の面は監査可能なまま保たれ（#237 がまさにこのコードを
// レビューする）、実行時の依存一覧も増えない。

import crypto from 'node:crypto';

export type OAuthProviderId = 'google';

export interface OAuthProvider {
  readonly id: OAuthProviderId;
  /** システムブラウザが送られる認可エンドポイント。 */
  readonly authorizeUrl: string;
  /** コード交換と、その後のリフレッシュ両方のためのトークンエンドポイント。 */
  readonly tokenUrl: string;
  /**
   * RFC 7009 の失効エンドポイント。プロバイダがそれを提供しない時は null。
   * null は「無視してよい」という意味ではない: 切断は、権限がプロバイダ側には
   * 残ることを利用者へ伝える必要がある（#233 の 2026-07-27 セキュリティ
   * レビュー）。
   */
  readonly revokeUrl: string | null;
  /** 最小権限——アプリ専用のフォルダであって、利用者のドライブ全体では決してない。 */
  readonly scopes: readonly string[];
  /**
   * 認可応答が `iss`（RFC 9207）を持つ時に期待される値。比較対象にできる
   * 定数ではない時は null。なりすまし対策はどちらにせよこれには依存しない:
   * 応答は、リスナーを開いた要求の文脈の中でだけ処理される（#233 の 5/7）。
   */
  readonly expectedIssuer: string | null;
  /** プロバイダ固有の認可パラメータ（主にオフラインアクセス）。 */
  readonly extraAuthParams: Readonly<Record<string, string>>;
  /**
   * このプロバイダのために空いていなければならない loopback ポート。一時的な
   * ポートを取ってよいなら null。
   */
  readonly redirectPort: number | null;
}

// Google。情報源（2026-08-05）:
//   developers.google.com/identity/protocols/oauth2/native-app
//     ——サポートされる loopback リダイレクトは「http://127.0.0.1:port または
//       http://[::1]:port」、OOB のコピー＆ペーストフローは「もうサポート
//       されていない」、「インストール型アプリケーションにはリフレッシュ
//       トークンが常に返される」。
//   developers.google.com/workspace/drive/api/guides/api-specific-auth
//     ——drive.file は「機微でない」スコープ（基本的な確認のみ）。サード
//       パーティのセキュリティ審査を引き込む制限リストは drive、
//       drive.readonly、drive.metadata* など。#233 の「最小権限はレビュー
//       コストの判断でもある」は今も成り立つ。
const GOOGLE: OAuthProvider = {
  id: 'google',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  // このアプリが作成したファイル——バックアップの置き場が触れるのはこれだけ。
  scopes: ['https://www.googleapis.com/auth/drive.file'],
  expectedIssuer: 'https://accounts.google.com',
  extraAuthParams: {
    // #233 の 2/7: インストール型アプリの既定値に頼るのではなく、明示的に
    // オフラインアクセスを求める。リフレッシュトークンを「持たない」時の
    // 失敗モードが「バックアップが1時間後に静かに止まる」だから。
    access_type: 'offline',
    // これが無いと、再接続がリフレッシュトークンを一切持たずに返ってくる
    // ことがある（Google は同意を再度促さない限り、最初の同意時にしか
    // それを発行しない）。
    prompt: 'consent',
  },
  // RFC 8252 §7.3: ポートは Google が照合する対象に含まれないので、リスナーは
  // OS が与えるものを何でも取ってよく、事前にどのポートも空けておく必要は
  // ない。
  redirectPort: null,
};

const PROVIDERS: Readonly<Record<OAuthProviderId, OAuthProvider>> = { google: GOOGLE };

function getProvider(id: OAuthProviderId): OAuthProvider {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`unknown OAuth provider: ${id}`);
  return p;
}

/** `port` に落ち着いたリスナーのリダイレクト URI。 */
function redirectUri(port: number): string {
  // `localhost` は使わない。hosts ファイルが別の場所へ向けうるし、Google も
  // IP リテラルを使う形を文書化している（RFC 8252 §8.3）。
  return `http://127.0.0.1:${port}/`;
}

/** 認可の試み1回分の秘密——決してログに出さず、決してレンダラーへ送らない。 */
export interface AuthorizationRequest {
  readonly state: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/**
 * PKCE（RFC 7636）に加えて `state`（RFC 8252 §8.9 / RFC 9700 §2.1）。この2つは
 * 代替ではなく補完し合う: PKCE は盗まれたコードが交換されるのを防ぎ、
 * `state` は偽造された応答がそもそも処理されるのを防ぐ。
 */
function createAuthorizationRequest(): AuthorizationRequest {
  // 32バイト → base64url で43文字。RFC 7636 §4.1 が許す最小の長さ。
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  return { state: base64url(crypto.randomBytes(32)), codeVerifier, codeChallenge };
}

/** 「システム」ブラウザが送られる URL（RFC 8252 §5——WebView では決してない）。 */
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

/** 交換やリフレッシュが成功した後、こちらの手元に残るもの。 */
export interface OAuthTokens {
  readonly accessToken: string;
  /** エポック ms。1分早く期限切れとして扱うので、実行がアップロードの途中で
   * 死ぬトークンで始まることはない。 */
  readonly expiresAt: number;
  readonly refreshToken: string | null;
  readonly scope: string | null;
}

/** アクセストークンが実際に期限切れになるより、これだけ前にリフレッシュする。 */
const EXPIRY_SKEW_MS = 60 * 1000;

function tokensExpired(tokens: Pick<OAuthTokens, 'expiresAt'>, now = Date.now()): boolean {
  return now >= tokens.expiresAt - EXPIRY_SKEW_MS;
}

/**
 * トークンエンドポイントの応答を読む。
 *
 * `previous` は既に手元にあるリフレッシュトークンで、応答がそれを省略した時に
 * 持ち越すことこそがこの関数の要点: Google はリフレッシュのたびにリフレッシュ
 * トークンを再発行するわけではない。応答がたまたま
 * その欄を省略するたびにこちらのものを捨てていたら、次のリフレッシュで
 * アカウントが静かに切断されてしまう——まさに #233 の 2/7 が言う「静かに
 * 止まる」という失敗そのもの。
 */
function parseTokenResponse(json: unknown, previousRefreshToken: string | null = null, now = Date.now()): OAuthTokens {
  const body = (json ?? {}) as Record<string, unknown>;
  const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
  if (!accessToken) throw new Error('token response carried no access_token');
  const expiresIn = Number(body.expires_in);
  const refreshToken = typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : previousRefreshToken;
  return {
    accessToken,
    // expires_in を省略するプロバイダは、安全側の読み（既に期限切れ）を
    // 受け取る。だから次の呼び出しは、そのトークンに賭けるのではなく
    // リフレッシュする。
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : now,
    refreshToken: refreshToken || null,
    scope: typeof body.scope === 'string' ? body.scope : null,
  };
}

/** 認可コード交換のフォーム本体（RFC 6749 §4.1.3 + PKCE）。 */
function codeExchangeBody(clientId: string, code: string, port: number, codeVerifier: string): URLSearchParams {
  return new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(port),
    code_verifier: codeVerifier,
  });
}

/** リフレッシュのフォーム本体（RFC 6749 §6）。パブリッククライアント——secret は無い。 */
function refreshBody(clientId: string, refreshToken: string): URLSearchParams {
  return new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken });
}

export { EXPIRY_SKEW_MS, PROVIDERS, buildAuthorizationUrl, codeExchangeBody, createAuthorizationRequest, getProvider, parseTokenResponse, redirectUri, refreshBody, tokensExpired };
