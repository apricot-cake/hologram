// captureId の単一の命名契約。ページ／拡張機能が要求として発行する ID は基本形だけを
// 受け付け、bridge が保存先で衝突を見つけた場合に限り `-<n>` を付けた保存済み ID にする。
// 後者は DB、items、旧 sidecar、inbox envelope が共有する永続 identity である。
export const CAPTURE_ID_PATTERN = /^[0-9]{1,20}-[0-9a-f]{1,8}$/i;
export const STORED_CAPTURE_ID_PATTERN = /^([0-9]{1,20})-[0-9a-f]{1,8}(?:-\d+)?$/i;

export function isStoredCaptureId(id: unknown): id is string {
  return typeof id === 'string' && STORED_CAPTURE_ID_PATTERN.test(id);
}
