// Unit test for the stop handshake (app/src/main/restart-signal.ts). restart-app.ps1
// no longer picks the real instance out of the machine's electron.exe list; it
// launches a throwaway copy carrying --hologram-quit, which loses the single-instance
// lock and hands its argv to whoever holds it — the one instance on this config dir.
// Pure logic = no Electron needed. The end-to-end behaviour (does the running app
// actually quit) is verified by running restart-app.ps1, per docs/build.md.

import fs from 'node:fs';
import path from 'node:path';
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

// The other half of the contract. test-app-restart-signal.cts proves the APP holds up its
// end against a real Electron; nothing there reads restart-app.ps1, so the script could
// stop matching the numbers it branches on and every test would stay green while a
// restart quietly started the new instance on top of the old one. These assertions are
// static on purpose — the script is Windows-only PowerShell and ci.yml is Linux.
describe('scripts/restart-app.ps1 との取り決め', () => {
  const file = path.join(__dirname, 'restart-app.ps1');
  const bytes = fs.readFileSync(file);
  const source = bytes.toString('utf8');

  // Measured on 2026-08-07: saving this file WITHOUT a BOM made every Japanese string in
  // it fail to parse under powershell.exe (Windows PowerShell 5.1 reads a .ps1 as ANSI
  // unless a BOM says otherwise), and 5.1 is what docs/build.md and skill run-hologram
  // tell people to launch it with. The failure is total — the script does not run at all
  // — and an editor or an agent rewriting the file drops the BOM silently.
  test('UTF-8 BOM 付きで保存されている', () => {
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  test('終了の合図として QUIT_FLAG を渡している', () => {
    expect(source).toContain(QUIT_FLAG);
  });

  test('「誰も居ない」の終了コードで停止ループを抜けている', () => {
    expect(source).toMatch(new RegExp(`ExitCode -eq ${EXIT_NO_INSTANCE}\\b`));
  });

  test('「居た」以外の終了コードを異常として扱っている', () => {
    expect(source).toMatch(new RegExp(`ExitCode -ne ${EXIT_SIGNALLED}\\b`));
  });

  // docs/build.md's "CDP で繋ぐ先の選び方" table calls :9222 fixed for the real instance,
  // and scripts/cdp-verify.cts defaults to it. This script is the only thing that opens it.
  test('実機の CDP ポートは 9222 で固定されている', () => {
    expect(source).toMatch(/\$port\s*=\s*9222/);
    expect(source).toContain('--remote-debugging-port=$port');
  });
});
