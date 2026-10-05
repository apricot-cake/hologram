// DB と inbox watcher を停止するライブラリ移動の境界。移動処理が通常の失敗結果を返す場合も
// throw する場合も finish を必ず通し、現在設定されている側を再初期化できるようにする。
export async function withLibraryRelocationPaused<T, Owner>(begin: () => Promise<Owner | null>, operation: (owner: Owner) => Promise<T>, finish: (owner: Owner) => Promise<void>, busy: T): Promise<T> {
  let owner: Owner | null = null;
  try {
    owner = await begin();
    if (owner === null) return busy;
    return await operation(owner);
  } finally {
    // begin が状態を取得した後、その途中で throw しても同じ owner で復旧する。
    if (owner !== null) await finish(owner);
  }
}

// ignoreInitial watcher の ready 直前に既存扱いになった inbox 項目を、ready 後の drain で必ず拾う。
export async function establishWatcherAndFinalDrain(startWatcher: () => Promise<void>, drain: () => Promise<void>): Promise<void> {
  await startWatcher();
  await drain();
}

export function waitForWatcherReady(watcher: { once(event: 'ready' | 'error' | 'close', listener: () => void): unknown }): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    watcher.once('ready', done);
    watcher.once('error', done);
    watcher.once('close', done);
  });
}

export function notifyOrganizationAfterRelocation(send: (channel: string, kind: string) => void): void {
  for (const kind of ['folders', 'tag-groups', 'poster-tags', 'manual-groups', 'ungrouped']) send('org-changed', kind);
}
