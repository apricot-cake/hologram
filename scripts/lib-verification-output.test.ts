import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const { repoRoot, resolveVerificationOutput, verificationRoot } = require('./lib-verification-output.cts');

describe('検証成果物の出力先', () => {
  test('既定の出力先はリポジトリ外のユーザー領域になる', () => {
    expect(verificationRoot()).toBe(path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Hologram', 'verification'));
  });

  test('リポジトリ内への出力を拒否する', () => {
    expect(() => resolveVerificationOutput(path.join(repoRoot, 'tmp', 'capture.jpg'), 'ignored.jpg')).toThrow('リポジトリ内');
  });
});
