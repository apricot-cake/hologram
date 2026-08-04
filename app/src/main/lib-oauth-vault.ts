'use strict';

// Where a cloud connection's tokens live (#233).
//
// One file next to config.json, holding one record per provider. What is
// encrypted is only the part that has to be: the refresh token, the access
// token and their expiry. The client id is not a secret (a public client ships
// it in the open) and the connected-at timestamp is UI, so both stay readable —
// a vault whose plaintext half is empty tells you nothing when it fails to
// decrypt, and "which providers are connected" has to survive a machine change
// in order to say so.
//
// The cipher is injected rather than imported. Two reasons, in order:
//   * #233's 7/7 — safeStorage silently degrades to `basic_text` (a hardcoded
//     key, i.e. plaintext) on Linux systems with no keyring. A vault that just
//     calls safeStorage cannot refuse that; one that asks a cipher whether its
//     backend is secure can, and REFUSES TO WRITE rather than pretend.
//   * this module stays electron-free, so the suites run the real read/write
//     paths instead of a mock of them.
//
// Not in this file: any path from here toward the renderer. Tokens do not cross
// IPC (#233's 2/7 item 2), so the vault has no "get the token" for a caller
// outside the main process to reach.

import fs from 'node:fs';
import path from 'node:path';

import { commitFileAtomicSync } from './lib-atomic.ts';
import type { OAuthProviderId, OAuthTokens } from './lib-oauth-providers.ts';

/** The encryption the vault delegates to (electron's safeStorage in the app). */
export interface VaultCipher {
  /** False when the platform has no key store — nothing may be written. */
  available(): boolean;
  /**
   * False when the backend exists but is not actually protecting anything
   * (Linux `basic_text`). Split from `available` on purpose: the two need
   * different words in front of the user, and only this one is a decision
   * ("store it anyway?") rather than a hard stop.
   */
  backendIsSecure(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(cipherText: Buffer): string;
}

/** A connection as the rest of the app sees it. */
export interface CloudConnection {
  readonly providerId: OAuthProviderId;
  readonly clientId: string;
  readonly connectedAt: string;
  /** The account label the provider reported, when one was fetched. */
  readonly account: string | null;
  readonly tokens: OAuthTokens;
}

/** A connection whose secret half could not be read back. */
export interface UnreadableConnection {
  readonly providerId: OAuthProviderId;
  readonly clientId: string;
  readonly connectedAt: string;
  readonly account: string | null;
  readonly tokens: null;
}

/**
 * A revocation that could not be completed at disconnect time. Held encrypted
 * and OUTSIDE the connection record, so no backup run can ever pick it up as a
 * live destination (#233's 2026-07-27 review: "isolate the pending revocation
 * from backup processing").
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
    // Absent or unparseable both mean "nothing is connected". A corrupt vault
    // is not a reason to refuse forever — reconnecting rewrites it.
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
    // Wrong machine, reinstalled OS, rotated keychain entry: the record is real
    // but its secret is not ours to read. The caller re-connects.
    return null;
  }
}

function encodeTokens(cipher: VaultCipher, tokens: OAuthTokens): string {
  return cipher.encrypt(JSON.stringify(tokens)).toString('base64');
}

/**
 * The one guard in front of every write. `insecure-backend` is the Linux case
 * from #233's 7/7 — a real key store is missing and safeStorage would encrypt
 * with a hardcoded key, which is storage, not protection.
 */
export type VaultStatus = 'ready' | 'unavailable' | 'insecure-backend';

function vaultStatus(cipher: VaultCipher): VaultStatus {
  if (!cipher.available()) return 'unavailable';
  if (!cipher.backendIsSecure()) return 'insecure-backend';
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

  /**
   * `allowInsecureBackend` is the user's answer to the Linux warning, and it is
   * the only way past it: the default is to throw rather than write a token
   * that is not actually protected.
   */
  function writeConnection(connection: CloudConnection, allowInsecureBackend = false): void {
    const status = vaultStatus(cipher);
    if (status === 'unavailable') throw new Error('this system has no secure storage for the connection');
    if (status === 'insecure-backend' && !allowInsecureBackend) throw new Error('secure storage is unavailable on this system (no keyring backend)');
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

  /** Replaces the stored tokens of an existing connection (post-refresh). */
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
      // An unreadable pending revocation can never be retried, so keeping it
      // would only ever be a token sitting in a file for nothing. Same for one
      // that does not say which provider to revoke against — guessing would
      // send a token to the wrong company.
      if (!tokens || typeof record.clientId !== 'string' || (providerId !== 'google' && providerId !== 'microsoft')) continue;
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

  /** Drops every pending revocation for a provider (retry succeeded, or the
   * user chose to forget it — which means the grant can no longer be revoked
   * from here, and the UI has to have said so). */
  function clearPendingRevocations(providerId: OAuthProviderId): void {
    const vault = readRaw(dir);
    if (!Array.isArray(vault.pendingRevocations)) return;
    const list = vault.pendingRevocations.filter((r) => (r as { providerId?: string }).providerId !== providerId);
    writeRaw(dir, { ...vault, version: VAULT_VERSION, pendingRevocations: list });
  }

  return { readConnection, connectedProviders, writeConnection, updateTokens, deleteConnection, pendingRevocations, addPendingRevocation, clearPendingRevocations };
}

export { VAULT_FILE, VAULT_VERSION, createTokenVault, vaultPath, vaultStatus };
