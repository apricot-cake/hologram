// ライブラリのバックアップ設定がどの宛先を名指ししているか
// （app/src/main/lib-backup-destinations.ts）。
//
// 「ローカルフォルダ」と「クラウドのアカウント」を見分けるのはここ1か所だけで、#909 の
// 受け入れ条件もそこに乗っている。エンジンは返ってきたものを、どの種別かを知らないまま
// 動かす。だから run を始められない理由は必ずここで決め、run の途中の例外ではなく
// コードとして返さなければいけない。
//
// クラウドの場合は代わりの cipher と vault ディレクトリを使う。これは同時に、ローカル
// フォルダの宛先が鍵のストアへ手を伸ばさないことの主張でもある。伸ばしていたら、この
// スイートは electron の外では一切動かない。

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

/** `providerId` の生きている接続を1件だけ持つ vault。 */
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
    // 知らない kind は「設定済み」ではない。そうしないと heartbeat が毎分 run を試みて、
    // 毎分それを失敗させる。
    expect(isDestinationConfigured({ kind: 'dropbox', dir: null })).toBe(false);
  });
});
