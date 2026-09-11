import { afterEach, expect, test, vi } from 'vitest';
const { personalEnv, snapshotPath, verificationTarget, assertSchema, isFixedAppProcess } = require('./local-app.cts');

test('同じElectronで動く通信ホストを固定版アプリと誤認しない', () => {
  const runtime = { exe: 'C:\\Hologram 固定版\\electron.exe', app: 'C:\\Hologram 固定版\\app' };
  const process = (args: string) => ({ ExecutablePath: runtime.exe, CommandLine: `"${runtime.exe}" ${args}` });
  expect(isFixedAppProcess(process(`"${runtime.app}" --remote-debugging-port=9222`), runtime)).toBe(true);
  expect(isFixedAppProcess(process('"C:\\Users\\apricot\\AppData\\Roaming\\Hologram\\bridge.js" chrome-extension://example/ --parent-window=0'), runtime)).toBe(false);
  expect(isFixedAppProcess(process(`"${runtime.app}" --hologram-quit`), runtime)).toBe(false);
  expect(isFixedAppProcess(process(`--type=renderer --app-path="${runtime.app}"`), runtime)).toBe(false);
  expect(() => isFixedAppProcess({ ExecutablePath: runtime.exe }, runtime)).toThrow('起動引数');
});

test('引用符のないパスとWindowsのパス表記の違いを扱う', () => {
  const runtime = { exe: 'C:\\fixed\\electron.exe', app: 'C:\\fixed\\app' };
  expect(isFixedAppProcess({ ExecutablePath: runtime.exe.toUpperCase(), CommandLine: 'C:\\fixed\\electron.exe C:/FIXED/app/ --remote-debugging-port=9222' }, runtime)).toBe(true);
  expect(isFixedAppProcess({ ExecutablePath: 'C:\\dev\\electron.exe', CommandLine: 'C:\\dev\\electron.exe C:\\dev\\app' }, runtime)).toBe(false);
});

afterEach(() => vi.unstubAllEnvs());

test('固定版の使用中だけ検証を隔離し、それ以外は普段の開発版を使う', () => {
  expect(verificationTarget(true)).toBe('sandbox');
  expect(verificationTarget(false)).toBe('development');
});

test('私用の起動が検証用の保存先やHMR設定を引き継がない', () => {
  vi.stubEnv('HOLOGRAM_CONFIG_DIR', 'test-library');
  vi.stubEnv('HOLOGRAM_SANDBOX', '1');
  vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
  vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');
  expect(personalEnv()).not.toHaveProperty('HOLOGRAM_CONFIG_DIR');
  expect(personalEnv()).not.toHaveProperty('HOLOGRAM_SANDBOX');
  expect(personalEnv()).not.toHaveProperty('ELECTRON_RENDERER_URL');
  expect(personalEnv()).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
});

test('DB形式が変わった場合は古い固定版への切り替えを拒否する', () => {
  expect(() => assertSchema(45, 45)).not.toThrow();
  expect(() => assertSchema(46, 45)).toThrow('固定版を作り直してください');
});

test('固定版の保存先が私用ディレクトリの外へ出ない', () => {
  expect(() => snapshotPath('../app')).toThrow();
  expect(() => snapshotPath('C:\\Users')).toThrow();
  expect(snapshotPath('fixed-12345678-1234-1234-1234-123456789abc')).toContain('.local-app');
});
