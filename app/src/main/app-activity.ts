// 更新通知は処理の終了イベントで再判定する。定期ポーリングは行わない。
export function createActivityGate() {
  let active = 0;
  let pending: (() => void) | null = null;
  let scheduled = false;
  function check() {
    if (active || !pending || scheduled) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      if (active || !pending) return;
      const action = pending;
      pending = null;
      action();
    });
  }
  return {
    begin() {
      active++;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        active--;
        check();
      };
    },
    whenIdle(action: () => void) {
      pending = action;
      check();
    },
    cancel() {
      pending = null;
    },
  };
}

export const appActivity = createActivityGate();
