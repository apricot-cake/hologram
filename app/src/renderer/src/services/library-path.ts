// ライブラリのパスの service（#37）＝get-library-status /
// pick-repoint-folder / apply-repoint を、平たい hologramIpc の呼び出しに被せた
// もの。純粋な1対1の転送（backup.ts / posts.ts と同じ形）で、empty/LibraryMissingState.tsx、
// hologramStore の 'libraryMissing' キーへ種を入れる App 階層の状態のゲート、
// settings/sections/Data.tsx の「ライブラリ」のカードが import する。
import { hologramIpc } from './ipc.ts';

// 必ずその場で調べる（main は statSync を走らせ、キャッシュしたフラグは使わない）＝押し込みを
// 期待せず、再試行や付け替えの後にもう一度これを呼ぶ。
export function getLibraryStatus() {
  return hologramIpc.getLibraryStatus();
}
// #71: 拡張機能が一度でも接触したか（導入され、確認か保存を少なくとも1回処理したか）＝
// App.tsx の起動時のゲートがこれで hologramStore の 'extensionContacted' に種を入れ、
// empty/EmptyState.tsx がそれを読んで、導入の案内と通常の firstRun の変種を選び分ける。
export function getExtensionContact() {
  return hologramIpc.getExtensionContact();
}
// ディレクトリの選択を開き、付け替え先として妥当かを、何も書き込まずに検証する＝
// `hasEvidence` が、そこが既存の Hologram のライブラリに見えるかを言う
// （main のフォルダ分類を参照）。呼び出し側は、それを見て
// applyRepoint を呼ぶ前に「空の新しいライブラリとして始めるか」を確認するかを決める。
export function pickRepointFolder() {
  return hologramIpc.pickRepointFolder();
}
// `dest` を復旧したライブラリとして開く＝アプリの足元で消えてしまった
// 保存フォルダのための脱出口（services/posts.ts の pickSaveFolder/moveSaveFolder は、今の
// フォルダがコピー元としてそこにあることを前提にしている）。
export function applyRepoint(dest: string) {
  return hologramIpc.applyRepoint(dest);
}
