// Unit test for the launch-marker check (app/src/main/startup-debug-port.ts).
// --remote-debugging-port is the only thing restart-app.ps1 adds that lets
// scripts/cdp-verify.cts and the marker-based stop command in docs/build.md pick
// this app's real instance out of every electron.exe on the machine. A Start Menu
// shortcut with stale arguments turned out to launch the app without it — silently,
// with no error (#1004). Pure logic = no Electron needed.

import { describe, expect, test } from 'vitest';
import { shouldWarnMissingDebugPort } from '../app/src/main/startup-debug-port';

describe('配布版（app.isPackaged === true）', () => {
  // The acceptance criterion itself: a packaged build never warns, marker or not.
  test('argv が空でも warn しない', () => {
    expect(shouldWarnMissingDebugPort([], true)).toBe(false);
  });

  test('マーカーが有っても無くても warn しない', () => {
    expect(shouldWarnMissingDebugPort(['C:\\Hologram.exe'], true)).toBe(false);
    expect(shouldWarnMissingDebugPort(['C:\\Hologram.exe', '--remote-debugging-port=9222'], true)).toBe(false);
  });
});

describe('開発時（app.isPackaged === false）', () => {
  test('マーカーが無ければ warn する', () => {
    expect(shouldWarnMissingDebugPort(['C:\\electron.exe', 'C:\\repo\\app'], false)).toBe(true);
  });

  test('マーカーが有れば warn しない', () => {
    expect(shouldWarnMissingDebugPort(['C:\\electron.exe', 'C:\\repo\\app', '--remote-debugging-port=9222'], false)).toBe(false);
  });

  // startsWith, not an exact match — Electron's actual argv carries the flag with
  // its value attached (`--remote-debugging-port=9222`), never as two tokens.
  test('値が付いた形（=9222）も検出する', () => {
    expect(shouldWarnMissingDebugPort(['--remote-debugging-port=9223'], false)).toBe(false);
  });

  test('空の argv は warn する', () => {
    expect(shouldWarnMissingDebugPort([], false)).toBe(true);
  });
});
