'use strict';

// トークンの金庫の electron 側の半分（#233）。
//
// 意図してこれだけ小さくしてある。何を保存するか、どういうときに書き込みを断るかの判断は全部
// lib-oauth-vault.ts が持ち、このファイルはどの OS の仕組みが暗号化するかを言うだけ。両者を
// 分けているからこそ、金庫の規則を素の Node のスイートで動かせる＝electron 無しに試験できない
// 部分は、ロジックを1つも持たない部分。
//
// `backendIsSecure` は #233 の 7/7。Linux の safeStorage は、libsecret や kwallet のバックエンドが
// 無いとき `basic_text`＝ハードコードした鍵、つまり難読化＝を代わりに使い、しかも黙ってそうする。
// それを「安全ではない」と報告することが、代わりの手段を、誰にも見えない穴ではなく利用者へ尋ねる
// 問いに変える。ほかの環境（Windows の DPAPI、macOS のキーチェーン）にそういう劣化は無いし、
// getSelectedStorageBackend は Linux 専用なので、この確認もそうしてある。

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
        // 劣化しているのは 'basic_text'。それ以外（gnome_libsecret、kwallet*、…）は本物の鍵の
        // ストア。知らない値は、これを書いた後に追加されたバックエンドで利用者を塞き止めるので
        // はなく、安全として扱う。
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
