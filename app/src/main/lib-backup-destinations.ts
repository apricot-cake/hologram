'use strict';

// ライブラリのバックアップ設定が名指しする置き場と、エンジンがそこへ書き込む
// 前に真でなければならないすべてのこと（#909、親 #233）。
//
// このモジュールが存在するのは、lib-backup.ts にプロバイダごとの分岐を持ち込ま
// ないため。エンジンは「この設定の置き場」を尋ね、動かせるアダプタか、動かせない
// 理由のどちらかを受け取る。OAuth 接続がまだ使えるかどうかは事前確認であり、
// 事前確認はここにある。
//
// トークン周りもここにある。同じ理由、そしてもう1つ: アクセストークンは、
// それを他へ渡しうる何かに絶対に手渡してはいけない。だからこのファイルから
// 出ていくものは、要求に応じてトークンを生成するクロージャだけ（#233 の
// 2/7 項目2）。vault は実行ごとに1回読む。実行の途中でのリフレッシュはその場で
// 書き戻す。ローテーションされたリフレッシュトークンを永続化しないと、次の
// 実行でトークンの系列全体が死ぬため。

import type { BackupDestination } from './lib-backup-destination.ts';
import { GOOGLE_DESTINATION_KIND, createGoogleDriveDestination } from './lib-backup-cloud-google.ts';
import type { CloudAuth } from './lib-backup-cloud.ts';
import { createTokenVault } from './lib-oauth-vault.ts';
import type { VaultCipher } from './lib-oauth-vault.ts';
import { ensureAccessToken } from './lib-oauth.ts';
import type { OAuthProviderId } from './lib-oauth-providers.ts';

export type BackupDestinationKind = typeof GOOGLE_DESTINATION_KIND;

/** ライブラリのバックアップ設定のうち、置き場を選ぶのに関係する範囲。 */
export interface BackupDestinationConfig {
  kind?: string | null;
}

export interface ResolveDeps {
  /**
   * vault がどこに住み、何がそれを暗号化するか。手を伸ばして取得するのではなく
   * 引数で渡す: どちらも electron の import になるところで、それらを持ち込まない
   * ことが、このモジュールが下す判断を素の Node のテストスイートで動かせる
   * ようにしている（lib-oauth-vault.ts が同じ理由でした分割と同じ）。
   */
  vaultDir: string;
  cipher: VaultCipher;
  fetch?: typeof globalThis.fetch;
}

export type ResolvedDestination = { ok: true; destination: BackupDestination } | { ok: false; error: string };

// 置き場の種別と OAuth 接続が出会う唯一の場所。
const CLOUD_PROVIDERS: Readonly<Record<string, OAuthProviderId>> = {
  [GOOGLE_DESTINATION_KIND]: 'google',
};

const CLOUD_ADAPTERS: Readonly<Record<string, (auth: CloudAuth) => BackupDestination>> = {
  [GOOGLE_DESTINATION_KIND]: createGoogleDriveDestination,
};

/** kind が無ければ、唯一の継続バックアップ先である Google Drive。 */
function kindOf(config: BackupDestinationConfig): string {
  return typeof config.kind === 'string' && config.kind ? config.kind : GOOGLE_DESTINATION_KIND;
}

/**
 * Google Drive は種別以上の設定を必要としない（接続がまだ機能しているかは実行時の問いで、
 * resolveBackupDestination が答える）。
 *
 * スケジューラはこれを尋ねる。「置き場が無い」が、ハートビートのたびに失敗した
 * 実行としてではなく、静かな無処理のままでいられるように。
 */
function isDestinationConfigured(config: BackupDestinationConfig): boolean {
  const kind = kindOf(config);
  return Boolean(CLOUD_ADAPTERS[kind]);
}

/**
 * 1回の実行分のトークン供給。
 *
 * `ensureAccessToken` は、保持しているトークンが（ほぼ）使い切られた時だけ
 * リフレッシュする。`force` は API からの 401 への答えで、トークンは有効に
 * 見えたが実際はそうでなかった場合。どちらの経路でも、新しいリフレッシュ
 * トークンは即座に永続化される——プロバイダによってローテーションするかどうかの
 * 扱いが異なり、ローテーションで捨てられたものを再利用すると再送検出に
 * 引っかかり、系列全体が失効する。
 *
 * openExternal は意図して例外を投げる: バックアップの実行が、利用者の前に
 * 同意画面を出せてしまうことは絶対にあってはならない。権限が失われていれば
 * 実行は失敗し、#911 の再接続プロンプトが復帰の道になる。
 */
function connectionAuth(providerId: OAuthProviderId, deps: ResolveDeps): { ok: true; auth: CloudAuth } | { ok: false; error: string } {
  const vault = createTokenVault(deps.vaultDir, deps.cipher);
  const connection = vault.readConnection(providerId);
  if (!connection) return { ok: false, error: 'not-connected' };
  // レコードは存在するが、その秘密の半分が復号できなかった: 別のマシンか、
  // ローテーションされた鍵ストア。「一度も接続していない」ではなく「再接続」
  // （#233）。
  if (!connection.tokens) return { ok: false, error: 'connection-unreadable' };
  let tokens = connection.tokens;
  const oauth = {
    openExternal: async () => {
      throw new Error('a backup run never opens a consent screen');
    },
    fetch: deps.fetch,
  };
  return {
    ok: true,
    auth: {
      fetch: deps.fetch,
      async accessToken(force = false) {
        const result = await ensureAccessToken(providerId, connection.clientId, force ? { ...tokens, expiresAt: 0 } : tokens, oauth);
        if (result.refreshed) {
          tokens = result.tokens;
          vault.updateTokens(providerId, tokens);
        }
        return result.tokens.accessToken;
      },
    },
  };
}

/**
 * この設定が名指しする置き場。まだ無ければその理由。
 *
 * 種別固有のものはすべてここで終わる。エンジン自身の前提条件（ライブラリ自体が
 * 存在するか、既に実行中か）はエンジン側に残る。それらは「元データ」についての
 * ものであり、どの置き場に対しても等しく成り立つため。
 */
function resolveBackupDestination(config: BackupDestinationConfig, deps: ResolveDeps): ResolvedDestination {
  const kind = kindOf(config);
  const providerId = CLOUD_PROVIDERS[kind];
  const adapter = CLOUD_ADAPTERS[kind];
  if (!providerId || !adapter) return { ok: false, error: 'unknown-destination' };
  const auth = connectionAuth(providerId, deps);
  if (!auth.ok) return { ok: false, error: auth.error };
  return { ok: true, destination: adapter(auth.auth) };
}

export { CLOUD_PROVIDERS, isDestinationConfigured, kindOf, resolveBackupDestination };
