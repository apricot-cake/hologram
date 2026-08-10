// トークンの保管庫（app/src/main/lib-oauth-vault.ts）。
//
// ここで効いている性質は2つ。保管庫はトークンを平文で書いてはいけない（safeStorage が
// 黙って埋め込みの鍵に退避する Linux 環境も含めて。#233 の 7/7）。そして読めない秘密は
//「アカウントは一度もつながっていない」ではなく「このアカウントをつなぎ直す」へ落ちな
// ければならない。後者は利用者の設定を、何も告げずに失わせるため。

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

/** safeStorage の代役。可逆で、しかも明らかに平文ではないもの。 */
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
    // 秘密でない側は読めるまま＝どのプロバイダか、どの client id か。
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
    // 別のマシンの鍵ストア。レコードは無傷だが、秘密はこちらのものではない。
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
    vault.writeConnection(connection); // そして書けば直る
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
    // Linux の `basic_text`。埋め込みの鍵での暗号化は保管であって保護ではない＝それでも
    // 書くのは、#233 が退けた黙った穴。
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
    // 接続としては決して届かない＝バックアップの実行がこれを見つけてはいけない。
    expect(vault.readConnection('google')).toBeNull();
    expect(vault.connectedProviders()).toEqual([]);
    expect(fs.readFileSync(path.join(dir, VAULT_FILE), 'utf8')).not.toContain('rt-secret');
    const pending = vault.pendingRevocations();
    expect(pending).toHaveLength(1);
    expect(pending[0].tokens.refreshToken).toBe('rt-secret');
  });

  test('どのプロバイダのものか分からない失効待ちは捨てる', () => {
    // 当て推量をすれば、リフレッシュトークンを別会社のエンドポイントへ送ることになる。
    const dir = tempDir();
    const vault = createTokenVault(dir, fakeCipher());
    vault.addPendingRevocation({ providerId: 'google', clientId: 'c', since: '', tokens });
    const raw = JSON.parse(fs.readFileSync(path.join(dir, VAULT_FILE), 'utf8'));
    raw.pendingRevocations[0].providerId = 'dropbox';
    fs.writeFileSync(path.join(dir, VAULT_FILE), JSON.stringify(raw));
    expect(vault.pendingRevocations()).toEqual([]);
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
