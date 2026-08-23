// ライブラリのバックアップ設定がどの宛先を名指ししているか
// （app/src/main/lib-backup-destinations.ts）。
//
// Google Drive の接続状態をエンジンへ渡す境界。
// 動かす。だから run を始められない理由は必ずここで決め、run の途中の例外ではなく
// コードとして返さなければいけない。

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
  encrypt: (plain) => Buffer.from(plain, 'utf8'),
  decrypt: (cipherText) => cipherText.toString('utf8'),
};
const brokenCipher: VaultCipher = {
  ...plainCipher,
  decrypt: () => {
    throw new Error('this vault was written on another machine');
  },
};

/** `providerId` の生きている接続を1件だけ持つ vault。 */
function vaultWith(providerId: 'google'): string {
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

const deps = (over: { vaultDir?: string; cipher?: VaultCipher } = {}) => ({
  vaultDir: over.vaultDir ?? tempDir(),
  cipher: over.cipher ?? plainCipher,
});

describe('クラウド宛先', () => {
  test('kind の無い設定も Google Drive として扱う', () => {
    expect(kindOf({})).toBe('google-drive');
  });
  test('接続が無ければ not-connected（run は始まらない）', () => {
    expect(resolveBackupDestination({ kind: 'google-drive' }, deps())).toEqual({ ok: false, error: 'not-connected' });
  });

  test('秘密の側が読めない接続は「未接続」ではなく connection-unreadable', () => {
    expect(resolveBackupDestination({ kind: 'google-drive' }, deps({ vaultDir: vaultWith('google'), cipher: brokenCipher }))).toEqual({ ok: false, error: 'connection-unreadable' });
  });

  test('接続があれば、その provider のアダプタが返る', () => {
    const google = resolveBackupDestination({ kind: 'google-drive' }, deps({ vaultDir: vaultWith('google') }));
    expect(google.ok && google.destination.kind).toBe('google-drive');
  });

  test('知らない kind は unknown-destination（勝手にローカルへ落とさない）', () => {
    expect(resolveBackupDestination({ kind: 'dropbox' }, deps())).toEqual({ ok: false, error: 'unknown-destination' });
  });
});

describe('設定済みかどうか', () => {
  test('Google Drive だけを受け付ける', () => {
    expect(isDestinationConfigured({})).toBe(true);
    expect(isDestinationConfigured({ kind: 'google-drive' })).toBe(true);
    // 知らない kind は「設定済み」ではない。そうしないと heartbeat が毎分 run を試みて、
    // 毎分それを失敗させる。
    expect(isDestinationConfigured({ kind: 'dropbox' })).toBe(false);
  });
});
