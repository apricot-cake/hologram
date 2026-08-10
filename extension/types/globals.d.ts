// 動的に注入される1回分のキャプチャセッションと、内部の診断ページが持つ状
// 態。共有アプリケーションコードは代わりに ESM の import を使う。
interface Window {
  __snsPostSaveActive?: boolean;
  __snsPostSaveCleanup?: () => void;
  // ユーザーが単発ではなく自動キャプチャ（#362）を求めたとき、background.ts
  // がキャプチャのエントリポイントを注入する直前にセットする。capture.ts が
  // 1回だけ読んでクリアするため、古くなったフラグが後の Alt+S を自動モード
  // にしてしまうことはない。
  __hologramAutoCapture?: boolean;
  __hologramDiag?: Record<string, unknown>;
  // #311: overlay.ts（常駐する content script）がセットし、capture.ts が画
  // 面を撮る前に保存済みマーク／保存ボタンのオーバーレイを隠せるようにす
  // る。復元用の関数を返す。このページで overlay.ts が動いていなければ
  // undefined（overlay.ts の matches は capture.ts のものより狭い）。
  __hologramPrepareOverlayForCapture?: () => () => void;
}
