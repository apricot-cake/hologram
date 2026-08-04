// Token storage (app/src/main/lib-oauth-vault.ts).
//
// Two properties carry the weight here. The vault must never write a token in
// the clear — including on the Linux systems where safeStorage silently falls
// back to a hardcoded key (#233's 7/7) — and an unreadable secret must degrade
// to "reconnect this account" rather than to "no account was ever connected",
// because the second one loses the user's setup without telling them.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { VAULT_FILE, createTokenVault, vaultStatus } from '../app/src/main/lib-oauth-vault';
import type { VaultCipher } from '../app/src/main/lib-oauth-vault';

const dirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-vault-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Stands in for safeStorage: reversible, and obviously not the plaintext. */
function fakeCipher(overrides: Partial<VaultCipher> = {}): VaultCipher {
  return {
    available: () => true,
    backendIsSecure: () => true,
    encrypt: (plain) => Buffer.from(`enc:${Buffer.from(plain).toString('hex')}`),
    decrypt: (buf) => {
      const s = buf.toString();
      if (!s.startsWith('enc:')) throw new Error('not ours');
      return Buffer.from(s.slice(4), 'hex').toString();
    },
    ...overrides,
  };
}

const tokens = { accessToken: 'at-secret', expiresAt: 1_800_000_000_000, refreshToken: 'rt-secret', scope: 'drive.file' };
const connection = { providerId: 'google' as const, clientId: 'client-1', connectedAt: '2026-08-05T00:00:00.000Z', account: 'me@example.com', tokens };

describe('保管と読み戻し', () => {
  test('書いたものが戻る', () => {
    const dir = tempDir();
    const vault = createTokenVault(dir, fakeCipher());
    expect(vault.readConnection('google')).toBeNull();
    vault.writeConnection(connection);
    expect(vault.readConnection('google')).toEqual(connection);
    expect(vault.connectedProviders()).toEqual(['google']);
  });

  test('ファイルにトークンが平文で出ない', () => {
    const dir = tempDir();
    createTokenVault(dir, fakeCipher()).writeConnection(connection);
    const raw = fs.readFileSync(path.join(dir, VAULT_FILE), 'utf8');
    expect(raw).not.toContain('at-secret');
    expect(raw).not.toContain('rt-secret');
    // The non-secret half stays readable: which provider, which client id.
    expect(raw).toContain('client-1');
  });

  test('リフレッシュ後の差し替えは接続の identity を保つ', () => {
    const dir = tempDir();
    const vault = createTokenVault(dir, fakeCipher());
    vault.writeConnection(connection);
    vault.updateTokens('google', { ...tokens, accessToken: 'at-2', refreshToken: 'rt-2' });
    const read = vault.readConnection('google');
    expect(read?.tokens?.accessToken).toBe('at-2');
    expect(read?.account).toBe('me@example.com');
  });

  test('切断すると記録ごと消える', () => {
    const dir = tempDir();
    const vault = createTokenVault(dir, fakeCipher());
    vault.writeConnection(connection);
    vault.deleteConnection('google');
    expect(vault.readConnection('google')).toBeNull();
    expect(vault.connectedProviders()).toEqual([]);
  });

  test('復号できない秘密は「接続なし」でなく「読めない接続」', () => {
    const dir = tempDir();
    createTokenVault(dir, fakeCipher()).writeConnection(connection);
    // Another machine's key store: the record is intact, the secret is not ours.
    const foreign = createTokenVault(
      dir,
      fakeCipher({
        decrypt: () => {
          throw new Error('wrong key');
        },
      }),
    );
    const read = foreign.readConnection('google');
    expect(read?.tokens).toBeNull();
    expect(read?.clientId).toBe('client-1');
  });

  test('壊れたファイルは接続なしとして読む（以後を拒み続けない）', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, VAULT_FILE), 'not json');
    const vault = createTokenVault(dir, fakeCipher());
    expect(vault.readConnection('google')).toBeNull();
    vault.writeConnection(connection); // and writing recovers it
    expect(vault.readConnection('google')?.tokens?.accessToken).toBe('at-secret');
  });
});

describe('保管先が安全でないとき（#233 の 7/7）', () => {
  test('鍵ストアが無ければ書かない', () => {
    const cipher = fakeCipher({ available: () => false });
    expect(vaultStatus(cipher)).toBe('unavailable');
    expect(() => createTokenVault(tempDir(), cipher).writeConnection(connection)).toThrow();
  });

  test('バックエンドが劣化していれば、既定では書かない', () => {
    // Linux `basic_text`: encryption with a hardcoded key is storage, not
    // protection — writing anyway is the silent hole #233 refuses.
    const cipher = fakeCipher({ backendIsSecure: () => false });
    expect(vaultStatus(cipher)).toBe('insecure-backend');
    const dir = tempDir();
    expect(() => createTokenVault(dir, cipher).writeConnection(connection)).toThrow(/keyring/);
    expect(fs.existsSync(path.join(dir, VAULT_FILE))).toBe(false);
  });

  test('ユーザーが承知のうえなら書ける', () => {
    const dir = tempDir();
    const vault = createTokenVault(dir, fakeCipher({ backendIsSecure: () => false }));
    vault.writeConnection(connection, true);
    expect(vault.readConnection('google')?.tokens?.accessToken).toBe('at-secret');
  });
});

describe('失効待ち（切断がオフラインだったとき）', () => {
  test('接続とは別に持ち、暗号化されている', () => {
    const dir = tempDir();
    const vault = createTokenVault(dir, fakeCipher());
    vault.addPendingRevocation({ providerId: 'google', clientId: 'client-1', since: '2026-08-05T00:00:00.000Z', tokens });
    // Never reachable as a connection — a backup run must not find it.
    expect(vault.readConnection('google')).toBeNull();
    expect(vault.connectedProviders()).toEqual([]);
    expect(fs.readFileSync(path.join(dir, VAULT_FILE), 'utf8')).not.toContain('rt-secret');
    const pending = vault.pendingRevocations();
    expect(pending).toHaveLength(1);
    expect(pending[0].tokens.refreshToken).toBe('rt-secret');
  });

  test('片付けると消える', () => {
    const dir = tempDir();
    const vault = createTokenVault(dir, fakeCipher());
    vault.addPendingRevocation({ providerId: 'google', clientId: 'c', since: '', tokens });
    vault.addPendingRevocation({ providerId: 'microsoft', clientId: 'c', since: '', tokens });
    vault.clearPendingRevocations('google');
    expect(vault.pendingRevocations().map((p) => p.providerId)).toEqual(['microsoft']);
  });
});
