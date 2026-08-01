import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const patch = require('./patch-crxjs-runtime-reload.cts') as {
  verify(): void;
  expectedVersion: string;
  packageFile: string;
  bundleFile: string;
};

describe('CRXJS development client contract', () => {
  test('runtime reload stays enabled without reloading content pages', () => {
    expect(patch.expectedVersion).toBe('2.7.1');
    expect(() => patch.verify()).not.toThrow();
  });

  test('the pinned patch is applied automatically after install', () => {
    expect(patch.packageFile).toContain('@crxjs');
    expect(patch.bundleFile).toContain('dist');
  });
});
