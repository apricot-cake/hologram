'use strict';

// クラウドのバックアップ先に対する認可の流れ（#233）。
//
// パブリッククライアント、認可コード＋PKCE、応答はループバックのソケットで受け取る（RFC 8252）。
// このファイルのどこにもクライアントシークレットは無いし、あり得ない。OSS のデスクトップアプリは
// クライアント id を公開のまま配るし、それこそ RFC 8252 §8.5 と #233 の設計が想定している状況。
//
// このモジュールが守るために在る3つの規則:
//   1. 同意の画面はシステムのブラウザで開く。BrowserWindow は決して使わないし、WebView も決して
//      使わない（RFC 8252 §5 の MUST。Google は WebView での認可をきっぱり拒否する）。
//      `openExternal` を import ではなく注入にしてあるので、ここではそれが作りから保たれるし、
//      素の Node のスイートから試験できる。
//   2. トークンはメインプロセスから出ない。このファイルには IPC 側へトークンを返すものが1つも
//      無いし、ディスク側は lib-oauth-vault.ts。
//   3. ここでトークン・コード・verifier をログへ出すものは無い。切り詰めた形でも出さない。
//      #237 がこれを監査する。エラーの文言が載せるのは提供元のエラーのコードだけ。
//
// 取り直しは #233 の 2/7 に従う。返ってきたリフレッシュトークンは何であれ保つ（入れ替えるか
// どうかは提供元によって言い分が違う）。そして期限切れの許可は、それ自体を1つの結末として外へ
// 出す。UI が黙り込まずに再接続を差し出せるように。

import { getProvider, buildAuthorizationUrl, codeExchangeBody, createAuthorizationRequest, parseTokenResponse, refreshBody, tokensExpired } from './lib-oauth-providers.ts';
import type { OAuthProviderId, OAuthTokens } from './lib-oauth-providers.ts';
import { startLoopbackListener } from './lib-oauth-loopback.ts';

export interface OAuthDeps {
  /** 同意の URL を利用者自身のブラウザで開く。 */
  openExternal(url: string): Promise<void>;
  /** テストのスイートが偽の提供元を立てられるよう注入する。既定はグローバルのもの。 */
  fetch?: typeof globalThis.fetch;
  /** 同意のタイムアウトを上書きする（テストは短いものを使う）。 */
  timeoutMs?: number;
}

/** 期限切れか取り消された許可。ほかのあらゆる失敗と区別する。 */
export class OAuthGrantExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthGrantExpiredError';
  }
}

/**
 * トークンのエンドポイントの失敗を読む。本体は `error` と、場合により `error_description` を
 * 持つ JSON のオブジェクト（RFC 6749 §5.2）。「利用者の許可が無くなった」を意味するのは
 * `invalid_grant` で、これは再試行ではなく再接続を促すもの。
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
  // JSON でない本体でエラーを返してくる提供元も、解析でのクラッシュではなく、やはりエラーに
  // なってもらう必要がある。
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
 * 対話的な認可を1回走らせ、そこで得たトークンを返す。
 *
 * リスナーはブラウザより前に開く。リダイレクトの URI が、実際に束縛したポートを名指しする必要が
 * あるため。そして finally で閉じる。取り消された同意が、このマシンに待ち受けのソケットを残しては
 * いけない。
 */
async function authorize(providerId: OAuthProviderId, clientId: string, deps: OAuthDeps): Promise<OAuthTokens> {
  if (!clientId) throw new Error('no OAuth client id is configured for this provider');
  const provider = getProvider(providerId);
  const request = createAuthorizationRequest();
  const listener = await startLoopbackListener(provider.redirectPort);
  try {
    const url = buildAuthorizationUrl(provider, clientId, listener.port, request);
    const waiting = listener.waitForCallback(request.state, deps.timeoutMs);
    // 待ちはブラウザより先に始まる（リダイレクトはそれくらい速く届き得る）。つまり、誰かが
    // await するより前に失敗し得るということ＝下の finally がリスナーを閉じ、閉じたリスナーは
    // 待ちを終わらせる。何もしないハンドラは、それが未処理の拒否として表に出ないようにする。
    // 下で await する `waiting` は今までどおり普通に例外を投げる。
    waiting.catch(() => {});
    await deps.openExternal(url);
    const callback = await waiting;
    // RFC 9207: 提供元が応答の中で自分を名乗るなら、それはこちらが尋ねた相手でなければならない。
    // 名乗らない場合、結び付けはリスナー自身が担う＝この応答は、それを開かせたリクエストへの
    // 答え以外にはなり得ない（#233 の 5/7 は、提供元を推測する共有のハンドラを退けている）。
    if (callback.iss && provider.expectedIssuer && callback.iss !== provider.expectedIssuer) {
      throw new Error(`authorization response came from an unexpected issuer (${callback.iss})`);
    }
    const body = codeExchangeBody(clientId, callback.code, listener.port, request.codeVerifier);
    return parseTokenResponse(await postForm(provider.tokenUrl, body, deps));
  } finally {
    listener.close();
  }
}

/** リフレッシュトークンを、生きているアクセストークンと交換する。入れ替えにも歩調を合わせる。 */
async function refreshTokens(providerId: OAuthProviderId, clientId: string, tokens: OAuthTokens, deps: OAuthDeps): Promise<OAuthTokens> {
  if (!tokens.refreshToken) throw new OAuthGrantExpiredError('no refresh token is stored for this connection');
  const provider = getProvider(providerId);
  const body = await postForm(provider.tokenUrl, refreshBody(clientId, tokens.refreshToken), deps);
  // 応答がリフレッシュトークンを省いたときは、前のものを持ち越す。応答が載せてきたときは、
  // 新しい値がそれに取って代わり、呼び出し元がそれを永続化しなければならない＝入れ替えで
  // 用済みになったトークンを使い回すと、提供元の再送検知に引っ掛かり、そのトークンの一族が
  // 丸ごと死ぬ。
  return parseTokenResponse(body, tokens.refreshToken);
}

/**
 * 呼び出し箇所は refreshTokens ではなくこちらを使う。今この瞬間に有効なトークンを返し、何かが
 * 変わったかどうかも報告するので、呼び出し元はいつ金庫を書けばよいかが分かる。
 */
async function ensureAccessToken(providerId: OAuthProviderId, clientId: string, tokens: OAuthTokens, deps: OAuthDeps): Promise<{ tokens: OAuthTokens; refreshed: boolean }> {
  if (!tokensExpired(tokens)) return { tokens, refreshed: false };
  return { tokens: await refreshTokens(providerId, clientId, tokens, deps), refreshed: true };
}

/**
 * 切断が提供元の側で何をやり遂げたか。
 *
 * ローカルのトークンを消すことは切断ではない（#233 の 2026-07-27 のセキュリティレビュー）。許可は
 * 取り消されるまで提供元の側で生き続けるので、'revoked' 以外の結末は、黙って成功とせず UI が
 * はっきり口に出さなければならないもの。
 */
export type RevokeOutcome = 'revoked' | 'already-invalid' | 'unsupported' | 'offline' | 'failed';

/**
 * RFC 7009 の取り消し。効くのはリフレッシュトークンを取り消すこと＝仕様に従う提供元は、それと
 * 一緒に許可を丸ごと落とす。アクセストークンはどちらにせよ1時間以内に自分で死ぬ。
 */
async function revokeTokens(providerId: OAuthProviderId, clientId: string, tokens: OAuthTokens, deps: OAuthDeps): Promise<RevokeOutcome> {
  const provider = getProvider(providerId);
  // どの提供元もエンドポイントを備えているわけではない（Microsoft の主なドキュメントは
  // RFC 7009 のエンドポイントを記していない）。'unsupported' は正直な答え＝利用者は自分の
  // アカウントの設定で許可を取り下げる必要があり、UI はそう言う。
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
    // RFC 7009 §2.2: 既に無効なトークンは、取り消しとして成功。いくつかの提供元はそれに
    // 400 invalid_token を返す。利用者の意図（「この端末は切り離した」）はどちらにせよ果たされる。
    if (res.status === 400) return 'already-invalid';
    return 'failed';
  } catch {
    // ネットワークが無い。呼び出し元は取り消しを捨てずに保留のまま持つので、オフラインで行った
    // 切断によって許可が孤児になることはない。
    return 'offline';
  }
}

export { authorize, ensureAccessToken, refreshTokens, revokeTokens };
