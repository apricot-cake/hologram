// Unit test for the stop handshake (app/src/main/restart-signal.ts). restart-app.ps1
// no longer picks the real instance out of the machine's electron.exe list; it
// launches a throwaway copy carrying --hologram-quit, which loses the single-instance
// lock and hands its argv to whoever holds it — the one instance on this config dir.
// Pure logic = no Electron needed. The end-to-end behaviour (does the running app
// actually quit) is verified by running restart-app.ps1, per docs/build.md.

import { describe, expect, test } from 'vitest';
import { EXIT_NO_INSTANCE, EXIT_SIGNALLED, QUIT_FLAG, hasQuitSignal } from '../app/src/main/restart-signal';

describe('終了の合図の検出', () => {
  test('実機の起動 argv には合図が無い', () => {
    expect(hasQuitSignal(['C:\\electron.exe', 'C:\\repo\\app', '--remote-debugging-port=9222'])).toBe(false);
  });

  test('合図つきの起動を検出する', () => {
    expect(hasQuitSignal(['C:\\electron.exe', 'C:\\repo\\app', QUIT_FLAG])).toBe(true);
  });

  test('空の argv は合図なし', () => {
    expect(hasQuitSignal([])).toBe(false);
  });

  // Exact match, not startsWith: this one decides whether a running app shuts
  // itself down, so a longer flag that merely begins the same way must not fire it.
  test('似た名前のフラグは合図ではない', () => {
    expect(hasQuitSignal(['--hologram-quit-later'])).toBe(false);
    expect(hasQuitSignal(['--hologram-quiet'])).toBe(false);
  });
});

describe('restart-app.ps1 が読む終了コード', () => {
  // restart-app.ps1 hard-codes these numbers — it is a PowerShell script on the
  // other side of a process boundary and cannot import them. Pinning the values
  // here is what turns "someone renumbered the codes" into a red test instead of
  // a restart that silently starts the new app while the old one is still up.
  test('値が固定されている', () => {
    expect(EXIT_NO_INSTANCE).toBe(0);
    expect(EXIT_SIGNALLED).toBe(3);
  });

  test('2つの結果は区別できる', () => {
    expect(EXIT_NO_INSTANCE).not.toBe(EXIT_SIGNALLED);
  });
});
