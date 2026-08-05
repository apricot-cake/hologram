'use strict';

// Which destination a library's backup config names, and everything that has to
// be true before the engine may write to it (#909, parent #233).
//
// This module exists so that lib-backup.ts contains no provider branch. The
// engine asks for "the destination for this config" and gets back either an
// adapter it can drive or a reason it cannot run; the differences between a
// folder on a drive and an account reached over OAuth — is the drive plugged
// in, is the account still connected — are preflight, and preflight is here.
//
// The token side is here too, for the same reason and one more: an access token
// must never be handed to something that could pass it on, so the only thing
// that leaves this file is a closure that produces one on demand
// (#233's 2/7 item 2). The vault is read once per run; a refresh mid-run is
// written straight back, because a rotated refresh token that is not persisted
// kills the whole token family at the next run.

import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';

import { backupRoot, createLocalFolderDestination } from './lib-backup-destination.ts';
import type { BackupDestination } from './lib-backup-destination.ts';
import { GOOGLE_DESTINATION_KIND, createGoogleDriveDestination } from './lib-backup-cloud-google.ts';
import { MICROSOFT_DESTINATION_KIND, createOneDriveDestination } from './lib-backup-cloud-microsoft.ts';
import type { CloudAuth } from './lib-backup-cloud.ts';
import { createTokenVault } from './lib-oauth-vault.ts';
import type { VaultCipher } from './lib-oauth-vault.ts';
import { ensureAccessToken } from './lib-oauth.ts';
import type { OAuthProviderId } from './lib-oauth-providers.ts';

export type BackupDestinationKind = 'local-folder' | typeof GOOGLE_DESTINATION_KIND | typeof MICROSOFT_DESTINATION_KIND;

/** The library's backup settings, as far as picking a destination cares. */
export interface BackupDestinationConfig {
  kind?: string | null;
  dir?: string | null;
}

export interface ResolveDeps {
  /** The library being backed up, for the "destination inside the source" check. */
  saveFolder: string;
  /**
   * Where the vault lives and what encrypts it. Passed in rather than reached
   * for: both would be electron imports, and keeping them out is what lets the
   * decision this module makes be exercised by a plain Node suite (the same
   * split lib-oauth-vault.ts made for the same reason).
   */
  vaultDir: string;
  cipher: VaultCipher;
  fetch?: typeof globalThis.fetch;
}

export type ResolvedDestination = { ok: true; destination: BackupDestination } | { ok: false; error: string };

// Each cloud kind is one OAuth connection. The map is the ONLY place a
// destination kind meets a provider id, so a third provider is a row here plus
// its adapter — not a branch anywhere else.
const CLOUD_PROVIDERS: Readonly<Record<string, OAuthProviderId>> = {
  [GOOGLE_DESTINATION_KIND]: 'google',
  [MICROSOFT_DESTINATION_KIND]: 'microsoft',
};

const CLOUD_ADAPTERS: Readonly<Record<string, (auth: CloudAuth) => BackupDestination>> = {
  [GOOGLE_DESTINATION_KIND]: createGoogleDriveDestination,
  [MICROSOFT_DESTINATION_KIND]: createOneDriveDestination,
};

/** An absent kind is the local folder — every config written before #909 has one. */
function kindOf(config: BackupDestinationConfig): string {
  return typeof config.kind === 'string' && config.kind ? config.kind : 'local-folder';
}

function pathIsInside(child: string, parent: string): boolean {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}

/**
 * A destination folder nested inside (or holding) the save folder would make
 * the backup feed itself: the next run collects its own output as library
 * files.
 */
function overlaps(dir: string, saveFolder: string): boolean {
  return Boolean(saveFolder) && (pathIsInside(dir, saveFolder) || pathIsInside(saveFolder, dir));
}

// Pre-release only: the destination folder was called Hologram-mirror until
// #233 retired the word "mirror". Rename it in place rather than let a second
// tree grow beside it — no data is read from the old name, so this can go once
// no dev machine has one.
function migrateLegacyDestinationFolder(dir: string): void {
  const legacy = path.join(dir, 'Hologram-mirror');
  const current = backupRoot(dir);
  try {
    if (fs.existsSync(legacy) && !fs.existsSync(current)) {
      fs.renameSync(legacy, current);
      log.info(`renamed backup folder ${legacy} -> ${current}`);
    }
  } catch (err) {
    log.warn('could not rename the legacy backup folder:', err);
  }
}

/**
 * Has the user finished setting a destination up? A local one needs a folder,
 * a cloud one needs nothing beyond the kind (whether the connection still works
 * is a run-time question, answered by resolveBackupDestination).
 *
 * The scheduler asks this, so that "no destination" stays a quiet no-op rather
 * than a failed run every heartbeat.
 */
function isDestinationConfigured(config: BackupDestinationConfig): boolean {
  const kind = kindOf(config);
  return kind === 'local-folder' ? Boolean(config.dir) : Boolean(CLOUD_ADAPTERS[kind]);
}

/**
 * The token supply for one run.
 *
 * `ensureAccessToken` refreshes only when the token it holds is (nearly) spent;
 * `force` is the answer to a 401 from the API, where the token looked live but
 * was not. Either way a new refresh token is persisted immediately — the
 * providers disagree about whether they rotate, and reusing a rotated-away one
 * is what trips replay detection and revokes the family.
 *
 * openExternal throws on purpose: a backup run must never be able to put a
 * consent screen in front of the user. When the grant is gone the run fails and
 * #911's re-connect prompt is the way back.
 */
function connectionAuth(providerId: OAuthProviderId, deps: ResolveDeps): { ok: true; auth: CloudAuth } | { ok: false; error: string } {
  const vault = createTokenVault(deps.vaultDir, deps.cipher);
  const connection = vault.readConnection(providerId);
  if (!connection) return { ok: false, error: 'not-connected' };
  // The record exists but its secret half did not decrypt: a different machine
  // or a rotated key store. "Re-connect", not "never connected" (#233).
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
 * The destination this config names, or the reason there is not one yet.
 *
 * Everything kind-specific ends here. The engine's own preconditions (is the
 * library itself present, is a run already going) stay with the engine, because
 * they are about the SOURCE and hold for every destination alike.
 */
function resolveBackupDestination(config: BackupDestinationConfig, deps: ResolveDeps): ResolvedDestination {
  const kind = kindOf(config);
  if (kind === 'local-folder') {
    const dir = config.dir;
    if (!dir) return { ok: false, error: 'not-configured' };
    if (overlaps(dir, deps.saveFolder)) return { ok: false, error: 'overlap' };
    // #37: the destination's PARENT is gone (drive unplugged, folder renamed).
    // The adapter's mkdir would silently recreate the whole chain — exactly the
    // "looks fine, quietly starts over" failure that Issue closes.
    if (!fs.existsSync(dir)) return { ok: false, error: 'dest-missing' };
    migrateLegacyDestinationFolder(dir);
    return { ok: true, destination: createLocalFolderDestination(dir) };
  }
  const providerId = CLOUD_PROVIDERS[kind];
  const adapter = CLOUD_ADAPTERS[kind];
  if (!providerId || !adapter) return { ok: false, error: 'unknown-destination' };
  const auth = connectionAuth(providerId, deps);
  if (!auth.ok) return { ok: false, error: auth.error };
  return { ok: true, destination: adapter(auth.auth) };
}

export { CLOUD_PROVIDERS, isDestinationConfigured, kindOf, overlaps, pathIsInside, resolveBackupDestination };
