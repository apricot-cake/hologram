// DB と inbox watcher を停止するライブラリ移動の境界。移動処理が通常の失敗結果を返す場合も
// throw する場合も finish を必ず通し、現在設定されている側を再初期化できるようにする。
export async function withLibraryRelocationPaused<T>(pause: () => Promise<void>, operation: () => Promise<T>, finish: () => Promise<void>): Promise<T> {
  await pause();
  try {
    return await operation();
  } finally {
    await finish();
  }
}
