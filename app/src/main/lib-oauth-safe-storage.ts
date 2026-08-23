'use strict';

// トークンの金庫の electron 側の半分（#233）。
//
// 意図してこれだけ小さくしてある。何を保存するか、どういうときに書き込みを断るかの判断は全部
// lib-oauth-vault.ts が持ち、このファイルはどの OS の仕組みが暗号化するかを言うだけ。両者を
// 分けているからこそ、金庫の規則を素の Node のスイートで動かせる＝electron 無しに試験できない
// 部分は、ロジックを1つも持たない部分。

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
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (cipherText) => safeStorage.decryptString(cipherText),
  };
}

export { createSafeStorageCipher };
