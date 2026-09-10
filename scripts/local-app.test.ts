import { afterEach, expect, test, vi } from 'vitest';
const { personalEnv, snapshotPath, verificationTarget, assertSchema } = require('./local-app.cts');

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
