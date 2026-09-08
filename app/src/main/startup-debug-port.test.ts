// 起動マーカーの検査 (app/src/main/startup-debug-port.ts) の単体テスト。
// --remote-debugging-port は、restart-app.ps1 が足すもののうち、scripts/cdp-verify.cts が
// このアプリの実個体へ接続できるようにする唯一のもの。引数が古くなったスタートメニューの
// ショートカットが、それを付けずにアプリを起こしていた＝黙って、エラーも出さずに (#1004)。
// アプリの停止はもうこれに依存していない（app/src/main/restart-signal.test.ts を参照）。純粋な
// ロジック＝Electron は要らない。

import { describe, expect, test } from 'vitest';
import { shouldWarnMissingDebugPort } from './startup-debug-port';

describe('配布版（app.isPackaged === true）', () => {
  // 受け入れ条件そのもの。パッケージ済みのビルドは、マーカーの有無によらず一切 warn しない。
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

  // 完全一致ではなく startsWith で見る。Electron の実際の argv は、このフラグを値付きの形
  // (`--remote-debugging-port=9222`) で運び、2つのトークンに分けることはない。
  test('値が付いた形（=9222）も検出する', () => {
    expect(shouldWarnMissingDebugPort(['--remote-debugging-port=9223'], false)).toBe(false);
  });

  test('空の argv は warn する', () => {
    expect(shouldWarnMissingDebugPort([], false)).toBe(true);
  });
});
