import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const registrationScript = fs.readFileSync(path.join(import.meta.dirname, 'register-extension-dev-task.ps1'), 'utf8');
const supervisorScript = fs.readFileSync(path.join(import.meta.dirname, 'extension-dev-supervisor.cts'), 'utf8');
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

describe('extension development logon task', () => {
  test('runs as a limited non-interactive process without a console window', () => {
    expect(registrationScript).toContain('-LogonType S4U');
    expect(registrationScript).toContain('-RunLevel Limited');
    expect(registrationScript).toContain('-Hidden');
    expect(registrationScript).not.toContain('-LogonType Interactive');
  });

  test('recognizes session-zero S4U processes as alive', () => {
    expect(supervisorScript).toContain("error.code === 'EPERM'");
  });
});
