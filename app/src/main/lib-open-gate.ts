'use strict';

// 完全版の「開く」ゲート（#236、2026-07-27 のセキュリティレビュー）: 拡張子の
// 許可リストに加え、それを持つ形式に対するマジックバイトのチェック（native-
// host/open-allowlist.mts）を、「開く」がクリックされた瞬間に評価する——
// インポート時ではない。ディスク上のファイルは収集後に差し替えられうるため。
// 純粋な半分（許可リスト、拡張子の正規化、シグネチャの照合）は
// native-host/open-allowlist.mts にあり、レンダラーのボタンラベルの判定と
// 共有する。このファイルは、それを実際に動かすために main が必要とする
// fs.readFile を提供するだけ。
//
// Electron に依存しない（fs のみ）ので、lib-card-dims.ts と同様に素の node で
// 単体テストできる。

import fs from 'node:fs';
import { MAGIC_REQUIRED_EXTS, extensionAllowed, matchesMagicBytes, normalizeFinalExt } from '../../../native-host/open-allowlist.mts';

const HEAD_BYTES = 64;

/**
 * `filePath` のシグネチャを確認するのに必要な分だけ読む。読み取りの失敗
 * （消えている、権限が無い）はすべて安全側＝拒否に倒れる——lib-card-dims.ts の
 * readImageDims と同じ「読めない→拒む」という規約。
 */
export async function isOpenAllowed(filePath: string): Promise<boolean> {
  if (!extensionAllowed(filePath)) return false;
  const ext = normalizeFinalExt(filePath);
  if (!MAGIC_REQUIRED_EXTS.has(ext)) return true;
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return matchesMagicBytes(ext, buf.subarray(0, n));
  } catch {
    return false;
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* 既に閉じている */
      }
    }
  }
}

export { extensionAllowed };
