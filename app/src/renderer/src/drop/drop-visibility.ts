/**
 * dragleave は子要素の出入りでも発火する。relatedTarget が文書内なら、ファイルはまだ
 * ウィンドウ上にある。null（または文書外）だけを、OS へドラッグが戻った合図として扱う。
 */
export function dragLeavesWindow(relatedTarget: EventTarget | null): boolean {
  return !(relatedTarget instanceof Node && document.documentElement.contains(relatedTarget));
}
