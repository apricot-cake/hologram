import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const { assertSafeProbeRoot, resolveProbeRoot, validateProbeLabel } = require('./lib-probe-root.cts');

let temporaryRoot: string;

beforeEach(() => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-probe-root-'));
});

afterEach(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

describe('validateProbeLabel', () => {
  test.each(['prod', 'dev-empty', 'run_01', 'run.01'])('単一の安全な directory 要素 %s を許可する', (label) => {
    expect(() => validateProbeLabel(label)).not.toThrow();
  });

  test.each(['.', '..', '.. ', 'run.', 'run ', 'two words', 'a/b', 'a\\b', '/tmp/run', 'C:\\tmp', 'CON', 'con.txt', 'PRN', 'AUX', 'NUL', 'COM1', 'com9.log', 'LPT1', 'lpt9.txt'])('危険または Windows で別名になる label %s を拒否する', (label) => {
    expect(() => validateProbeLabel(label)).toThrow();
  });
});

describe('probe root containment', () => {
  test('一時 repo の .probe66 直下だけを解決する', () => {
    const target = resolveProbeRoot(temporaryRoot, 'prod-empty');
    expect(target).toBe(path.join(temporaryRoot, '.probe66', 'prod-empty'));
  });

  test('base 自身と直下でない絶対 target を拒否する', () => {
    const base = path.join(temporaryRoot, '.probe66');
    expect(() => assertSafeProbeRoot(temporaryRoot, base)).toThrow();
    expect(() => assertSafeProbeRoot(temporaryRoot, path.join(base, 'ok', 'nested'))).toThrow();
    expect(() => assertSafeProbeRoot(temporaryRoot, path.join(temporaryRoot, 'outside'))).toThrow();
  });

  test('既存の symlink/junction を再帰削除や保存の検査時に拒否する', () => {
    const base = path.join(temporaryRoot, '.probe66');
    const outside = path.join(temporaryRoot, 'outside');
    const target = path.join(base, 'linked');
    fs.mkdirSync(base);
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, target, process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => assertSafeProbeRoot(temporaryRoot, target)).toThrow(/symlink\/junction/);
  });

  test('.probe66 自体が symlink/junction なら拒否する', () => {
    const outside = path.join(temporaryRoot, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(temporaryRoot, '.probe66'), process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => resolveProbeRoot(temporaryRoot, 'prod')).toThrow(/symlink\/junction/);
  });
});
