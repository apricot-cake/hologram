// Which destination a library's backup config names
// (app/src/main/lib-backup-destinations.ts).
//
// This is the one place where "local folder" and "cloud account" are told
// apart, and #909's acceptance condition rests on it: the engine drives
// whatever comes back without knowing which kind it got, so every reason a run
// cannot start has to be decided HERE and come back as a code rather than as an
// exception halfway through a run.
//
// The cloud cases use a stand-in cipher and vault directory, which is also the
// assertion that a local-folder destination never reaches for a key store: if
// resolving one did, these suites could not run outside electron at all.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { isDestinationConfigured, kindOf, resolveBackupDestination } from '../app/src/main/lib-backup-destinations';
import { createTokenVault } from '../app/src/main/lib-oauth-vault';
import type { VaultCipher } from '../app/src/main/lib-oauth-vault';

const made: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-resolve-'));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const plainCipher: VaultCipher = {
  available: () => true,
  backendIsSecure: () => true,
  encrypt: (plain) => Buffer.from(plain, 'utf8'),
  decrypt: (cipherText) => cipherText.toString('utf8'),
};
const brokenCipher: VaultCipher = {
  ...plainCipher,
  decrypt: () => {
    throw new Error('this vault was written on another machine');
  },
};

/** A vault holding one live connection for `providerId`. */
function vaultWith(providerId: 'google' | 'microsoft'): string {
  const dir = tempDir();
  createTokenVault(dir, plainCipher).writeConnection({
    providerId,
    clientId: 'client-1',
    connectedAt: '2026-08-05T00:00:00.000Z',
    account: null,
    tokens: { accessToken: 'at', expiresAt: Date.now() + 3_600_000, refreshToken: 'rt', scope: null },
  });
  return dir;
}

const deps = (over: { vaultDir?: string; cipher?: VaultCipher; saveFolder?: string } = {}) => ({
  saveFolder: over.saveFolder ?? path.join(os.tmpdir(), 'hologram-library-that-is-elsewhere'),
  vaultDir: over.vaultDir ?? tempDir(),
  cipher: over.cipher ?? plainCipher,
});

describe('ローカルフォルダ宛先', () => {
  test('kind の無い設定は従来どおりローカルフォルダ（#909 より前の config）', () => {
    const dir = tempDir();
    expect(kindOf({ dir })).toBe('local-folder');
    const resolved = resolveBackupDestination({ dir }, deps());
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.destination.kind).toBe('local-folder');
  });

  test('宛先フォルダが未設定なら not-configured', () => {
    expect(resolveBackupDestination({ kind: 'local-folder', dir: null }, deps())).toEqual({ ok: false, error: 'not-configured' });
  });

  test('ライブラリと重なる宛先は overlap（バックアップが自分を食う）', () => {
    const saveFolder = tempDir();
    expect(resolveBackupDestination({ kind: 'local-folder', dir: path.join(saveFolder, 'inside') }, deps({ saveFolder }))).toEqual({ ok: false, error: 'overlap' });
  });

  test('宛先の親が消えていたら dest-missing（黙って作り直さない）', () => {
    const dir = tempDir();
    fs.rmSync(dir, { recursive: true, force: true });
    made.length = 0;
    expect(resolveBackupDestination({ kind: 'local-folder', dir }, deps())).toEqual({ ok: false, error: 'dest-missing' });
  });
});

describe('クラウド宛先', () => {
  test('接続が無ければ not-connected（run は始まらない）', () => {
    expect(resolveBackupDestination({ kind: 'google-drive' }, deps())).toEqual({ ok: false, error: 'not-connected' });
  });

  test('秘密の側が読めない接続は「未接続」ではなく connection-unreadable', () => {
    expect(resolveBackupDestination({ kind: 'google-drive' }, deps({ vaultDir: vaultWith('google'), cipher: brokenCipher }))).toEqual({ ok: false, error: 'connection-unreadable' });
  });

  test('接続があれば、その provider のアダプタが返る', () => {
    const google = resolveBackupDestination({ kind: 'google-drive' }, deps({ vaultDir: vaultWith('google') }));
    expect(google.ok && google.destination.kind).toBe('google-drive');
    const onedrive = resolveBackupDestination({ kind: 'onedrive' }, deps({ vaultDir: vaultWith('microsoft') }));
    expect(onedrive.ok && onedrive.destination.kind).toBe('onedrive');
  });

  test('接続は provider ごと＝別の provider の接続では代用されない', () => {
    expect(resolveBackupDestination({ kind: 'onedrive' }, deps({ vaultDir: vaultWith('google') }))).toEqual({ ok: false, error: 'not-connected' });
  });

  test('知らない kind は unknown-destination（勝手にローカルへ落とさない）', () => {
    expect(resolveBackupDestination({ kind: 'dropbox' }, deps())).toEqual({ ok: false, error: 'unknown-destination' });
  });
});

describe('設定済みかどうか（スケジューラが見る述語）', () => {
  test('ローカルはフォルダが要る／クラウドは kind だけで足りる', () => {
    expect(isDestinationConfigured({ kind: 'local-folder', dir: null })).toBe(false);
    expect(isDestinationConfigured({ dir: null })).toBe(false);
    expect(isDestinationConfigured({ kind: 'local-folder', dir: 'C:/x' })).toBe(true);
    expect(isDestinationConfigured({ kind: 'google-drive', dir: null })).toBe(true);
    expect(isDestinationConfigured({ kind: 'onedrive', dir: null })).toBe(true);
    // An unknown kind is not "configured": the heartbeat would otherwise try a
    // run every minute and fail it every minute.
    expect(isDestinationConfigured({ kind: 'dropbox', dir: null })).toBe(false);
  });
});
