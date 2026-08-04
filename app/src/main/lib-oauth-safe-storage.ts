'use strict';

// The electron half of the token vault (#233).
//
// Deliberately this small: lib-oauth-vault.ts holds every decision about what
// gets stored and when a write is refused, and this file only says which OS
// facility does the encrypting. Keeping the two apart is what lets the vault's
// rules be exercised by a plain Node suite — the piece that cannot be tested
// without electron is the piece with no logic in it.
//
// `backendIsSecure` is #233's 7/7. safeStorage on Linux falls back to
// `basic_text` — a hardcoded key, i.e. obfuscation — when no libsecret/kwallet
// backend is present, and it does so silently. Reporting that as "not secure"
// is what turns the fallback into a question the user gets asked instead of a
// hole nobody sees. Elsewhere (Windows DPAPI, macOS Keychain) there is no such
// degradation, and getSelectedStorageBackend is Linux-only, so the check is too.

import { safeStorage } from 'electron';

import type { VaultCipher } from './lib-oauth-vault.ts';

function createSafeStorageCipher(): VaultCipher {
  return {
    available: () => {
      try {
        return safeStorage.isEncryptionAvailable();
      } catch {
        return false;
      }
    },
    backendIsSecure: () => {
      if (process.platform !== 'linux') return true;
      try {
        // 'basic_text' is the degraded one. Anything else (gnome_libsecret,
        // kwallet*, …) is a real key store; an unrecognised value is treated as
        // secure rather than blocking a user on a backend added after this was
        // written.
        return safeStorage.getSelectedStorageBackend() !== 'basic_text';
      } catch {
        return true;
      }
    },
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (cipherText) => safeStorage.decryptString(cipherText),
  };
}

export { createSafeStorageCipher };
