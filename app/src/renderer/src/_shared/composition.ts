/** compositionend と Enter の順序が異なる IME も含め、変換中のキーを判定する。 */
export function isComposing(event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean {
  return event.isComposing || event.keyCode === 229;
}
