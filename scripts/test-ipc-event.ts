/** Electron の配送だけを代替し、本物の送信元・入力検証を通す。 */
export function trustedIpcEvent() {
  const frame = { url: 'app://bundle/index.html' };
  return { senderFrame: frame, sender: { id: 1, mainFrame: frame } };
}
