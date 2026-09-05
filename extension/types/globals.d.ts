// 動的に注入される1回分のキャプチャセッションと、内部の診断ページが持つ状
// 態。共有アプリケーションコードは代わりに ESM の import を使う。
interface Window {
  __snsPostSaveActive?: boolean;
  __snsPostSaveCleanup?: () => void;
  __hologramDiag?: Record<string, unknown>;
}
