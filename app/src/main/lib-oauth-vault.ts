'use strict';

// クラウド接続のトークンが住む場所（#233）。
//
// config.json の隣にある1つのファイルで、プロバイダごとに1レコードを持つ。
// 暗号化されるのは、そうしなければならない部分だけ: リフレッシュトークン、
// アクセストークン、それらの有効期限。クライアント id は秘密ではなく
// （パブリッククライアントはそれを公然と同梱する）、接続日時は UI 表示用
// なので、どちらも読める形のまま残す——平文側が空の vault は、復号に失敗
// した時に何も語らないし、「どのプロバイダが接続済みか」は、それを言う
// ためにマシンの変更を生き延びる必要がある。
//
// 暗号処理は import ではなく注入する。このモジュールを Electron に依存しないままにし、
// テストスイートがモックではなく本物の読み書き経路を走らせるため。
//
// このファイルに無いもの: ここからレンダラーへ向かう経路。トークンは IPC を
// 越えない（#233 の 2/7 項目2）ので、vault にはメインプロセスの外の
// 呼び出し元が届く「トークンを取得する」手段が無い。

import fs from 'node:fs';
import path from 'node:path';

import { commitFileAtomicSync } from './lib-atomic.ts';
import type { OAuthProviderId, OAuthTokens } from './lib-oauth-providers.ts';

/** vault が委ねる暗号処理（アプリ内では electron の safeStorage）。 */
export interface VaultCipher {
  /** プラットフォームに鍵ストアが無ければ false——何も書き込んではいけない。 */
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(cipherText: Buffer): string;
}

/** アプリの他の部分から見た1つの接続。 */
export interface CloudConnection {
  readonly providerId: OAuthProviderId;
  readonly clientId: string;
  readonly connectedAt: string;
  /** 取得できた時に、プロバイダが報告したアカウントのラベル。 */
  readonly account: string | null;
  readonly tokens: OAuthTokens;
}

/** 秘密の半分を読み戻せなかった接続。 */
export interface UnreadableConnection {
  readonly providerId: OAuthProviderId;
  readonly clientId: string;
  readonly connectedAt: string;
  readonly account: string | null;
  readonly tokens: null;
}

/**
 * 切断時に完了できなかった失効。接続レコードの「外側」に暗号化して保持する
 * ので、バックアップの実行がこれを稼働中の置き場として拾い上げることは
 * 絶対に無い（#233 の 2026-07-27 レビュー:「保留中の失効はバックアップ処理から
 * 隔離する」）。
 */
export interface PendingRevocation {
  readonly providerId: OAuthProviderId;
  readonly clientId: string;
  readonly since: string;
  readonly tokens: OAuthTokens;
}

const VAULT_FILE = 'cloud-connections.json';
const VAULT_VERSION = 1;

interface StoredRecord {
  clientId?: unknown;
  connectedAt?: unknown;
  account?: unknown;
  secret?: unknown;
}
interface StoredVault {
  version?: unknown;
  connections?: Record<string, StoredRecord>;
  pendingRevocations?: StoredRecord[];
}

function vaultPath(dir: string): string {
  return path.join(dir, VAULT_FILE);
}

function readRaw(dir: string): StoredVault {
  try {
    const parsed = JSON.parse(fs.readFileSync(vaultPath(dir), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as StoredVault;
  } catch {
    // 無いこともパースできないことも、どちらも「何も接続されていない」を
    // 意味する。壊れた vault は永遠に拒む理由にはならない——再接続すれば
    // 書き直される。
    return {};
  }
}

function writeRaw(dir: string, vault: StoredVault): void {
  fs.mkdirSync(dir, { recursive: true });
  commitFileAtomicSync(vaultPath(dir), (tmp) => fs.writeFileSync(tmp, `${JSON.stringify(vault, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flush: true }), {
    tmpSuffix: `.tmp-${process.pid}`,
  });
}

function decodeTokens(cipher: VaultCipher, secret: unknown): OAuthTokens | null {
  if (typeof secret !== 'string' || !secret) return null;
  try {
    const plain = JSON.parse(cipher.decrypt(Buffer.from(secret, 'base64'))) as Record<string, unknown>;
    const accessToken = typeof plain.accessToken === 'string' ? plain.accessToken : '';
    if (!accessToken) return null;
    return {
      accessToken,
      expiresAt: Number(plain.expiresAt) || 0,
      refreshToken: typeof plain.refreshToken === 'string' && plain.refreshToken ? plain.refreshToken : null,
      scope: typeof plain.scope === 'string' ? plain.scope : null,
    };
  } catch {
    // 違うマシン、OS の再インストール、ローテーションされたキーチェーンの
    // エントリ: レコードは本物だが、その秘密はこちらが読めるものではない。
    // 呼び出し元は再接続する。
    return null;
  }
}

function encodeTokens(cipher: VaultCipher, tokens: OAuthTokens): string {
  return cipher.encrypt(JSON.stringify(tokens)).toString('base64');
}

/** すべての書き込みの手前にある唯一の番人。 */
export type VaultStatus = 'ready' | 'unavailable';

function vaultStatus(cipher: VaultCipher): VaultStatus {
  if (!cipher.available()) return 'unavailable';
  return 'ready';
}

function createTokenVault(dir: string, cipher: VaultCipher) {
  function readConnection(providerId: OAuthProviderId): CloudConnection | UnreadableConnection | null {
    const record = readRaw(dir).connections?.[providerId];
    if (!record || typeof record.clientId !== 'string' || !record.clientId) return null;
    const head = {
      providerId,
      clientId: record.clientId,
      connectedAt: typeof record.connectedAt === 'string' ? record.connectedAt : '',
      account: typeof record.account === 'string' ? record.account : null,
    };
    const tokens = decodeTokens(cipher, record.secret);
    return tokens ? { ...head, tokens } : { ...head, tokens: null };
  }

  function connectedProviders(): OAuthProviderId[] {
    return Object.keys(readRaw(dir).connections ?? {}) as OAuthProviderId[];
  }

  function writeConnection(connection: CloudConnection): void {
    const status = vaultStatus(cipher);
    if (status === 'unavailable') throw new Error('this system has no secure storage for the connection');
    const vault = readRaw(dir);
    const connections = { ...(vault.connections ?? {}) };
    connections[connection.providerId] = {
      clientId: connection.clientId,
      connectedAt: connection.connectedAt,
      account: connection.account,
      secret: encodeTokens(cipher, connection.tokens),
    };
    writeRaw(dir, { ...vault, version: VAULT_VERSION, connections });
  }

  /** 既存の接続の保存済みトークンを置き換える（リフレッシュ後）。 */
  function updateTokens(providerId: OAuthProviderId, tokens: OAuthTokens): void {
    const vault = readRaw(dir);
    const record = vault.connections?.[providerId];
    if (!record) return;
    const connections = { ...vault.connections };
    connections[providerId] = { ...record, secret: encodeTokens(cipher, tokens) };
    writeRaw(dir, { ...vault, version: VAULT_VERSION, connections });
  }

  function deleteConnection(providerId: OAuthProviderId): void {
    const vault = readRaw(dir);
    if (!vault.connections?.[providerId]) return;
    const connections = { ...vault.connections };
    delete connections[providerId];
    writeRaw(dir, { ...vault, version: VAULT_VERSION, connections });
  }

  function pendingRevocations(): PendingRevocation[] {
    const list = readRaw(dir).pendingRevocations;
    if (!Array.isArray(list)) return [];
    const out: PendingRevocation[] = [];
    for (const record of list) {
      const providerId = (record as { providerId?: unknown }).providerId;
      const tokens = decodeTokens(cipher, record?.secret);
      // 読めない保留中の失効は決してリトライできないので、それを残しておいて
      // も、ファイルの中に何の意味もなくトークンが座っているだけになる。
      // どのプロバイダに対して失効させるべきか語らないものも同じ——推測すれば
      // トークンを間違った会社へ送ってしまう。
      if (!tokens || typeof record.clientId !== 'string' || providerId !== 'google') continue;
      out.push({
        providerId,
        clientId: record.clientId,
        since: typeof record.connectedAt === 'string' ? record.connectedAt : '',
        tokens,
      });
    }
    return out;
  }

  function addPendingRevocation(entry: PendingRevocation): void {
    const vault = readRaw(dir);
    const list = Array.isArray(vault.pendingRevocations) ? [...vault.pendingRevocations] : [];
    list.push({
      providerId: entry.providerId,
      clientId: entry.clientId,
      connectedAt: entry.since,
      account: null,
      secret: encodeTokens(cipher, entry.tokens),
    } as StoredRecord);
    writeRaw(dir, { ...vault, version: VAULT_VERSION, pendingRevocations: list });
  }

  /** あるプロバイダの保留中の失効をすべて落とす（リトライが成功した、または
   * 利用者が忘れることを選んだ——つまり権限はもうここからは失効できず、
   * UI がそれを伝えていなければならない）。 */
  function clearPendingRevocations(providerId: OAuthProviderId): void {
    const vault = readRaw(dir);
    if (!Array.isArray(vault.pendingRevocations)) return;
    const list = vault.pendingRevocations.filter((r) => (r as { providerId?: string }).providerId !== providerId);
    writeRaw(dir, { ...vault, version: VAULT_VERSION, pendingRevocations: list });
  }

  return { readConnection, connectedProviders, writeConnection, updateTokens, deleteConnection, pendingRevocations, addPendingRevocation, clearPendingRevocations };
}

export { VAULT_FILE, VAULT_VERSION, createTokenVault, vaultPath, vaultStatus };
