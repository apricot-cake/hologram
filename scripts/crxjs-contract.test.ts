import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const registrationScript = fs.readFileSync(path.join(import.meta.dirname, 'register-extension-dev-task.ps1'), 'utf8');
const supervisorScript = fs.readFileSync(path.join(import.meta.dirname, 'extension-dev-supervisor.cts'), 'utf8');
const viteConfig = fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', 'vite.config.ts'), 'utf8');
const preview = require('./extension-preview-control.cts') as {
  PreviewBusyError: new (state: Record<string, unknown>) => Error;
  claimTransition(existing: Record<string, unknown> | null, request: Record<string, string>): Record<string, unknown>;
  governedByPreview(worktrees: string[], target: string | null): boolean;
  releaseTransition(existing: Record<string, unknown> | null, request: Record<string, string | boolean>): Record<string, unknown>;
};
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
    expect(supervisorScript).toContain("error.code !== 'EPERM'");
    expect(supervisorScript).toContain("'tasklist.exe'");
    expect(supervisorScript).toContain("'schtasks.exe'");
    expect(supervisorScript).toContain('isDescendant(collision, orphanAncestorPid)');
  });

  test('keeps the Chrome output fixed while serving the selected worktree', () => {
    expect(supervisorScript).toContain('HOLOGRAM_EXTENSION_DEV_OUTPUT');
    expect(supervisorScript).toContain('sourceRoot');
    expect(viteConfig).toContain('process.env.HOLOGRAM_EXTENSION_DEV_OUTPUT');
    expect(viteConfig).toContain("readFile(resolve(developmentOutput, 'manifest.json'))");
    expect(viteConfig).not.toContain("readFile(resolve(import.meta.dirname, '.output/chrome-mv3/manifest.json'))");
  });
});

describe('extension preview ownership', () => {
  const request = {
    ownerId: 'session-a',
    mainRoot: 'C:\\repo',
    sourceRoot: 'C:\\repo-wt-a',
    now: '2026-08-01T00:00:00.000Z',
  };

  test('is idempotent for the same session and worktree', () => {
    const first = preview.claimTransition(null, request);
    expect(preview.claimTransition(first, { ...request, now: '2026-08-01T00:01:00.000Z' })).toMatchObject({
      ownerId: 'session-a',
      sourceRoot: request.sourceRoot,
      acquiredAt: request.now,
    });
  });

  test('does not let another session steal the shared Chrome preview', () => {
    const first = preview.claimTransition(null, request);
    expect(() => preview.claimTransition(first, { ...request, ownerId: 'session-b' })).toThrow(preview.PreviewBusyError);
  });

  test('governs repository writes only', () => {
    const worktrees = [request.mainRoot, request.sourceRoot];
    expect(preview.governedByPreview(worktrees, 'C:\\repo\\scripts\\extension-dev-supervisor.cts')).toBe(true);
    expect(preview.governedByPreview(worktrees, 'C:\\repo-wt-a\\extension\\entrypoints\\capture.ts')).toBe(true);
    expect(preview.governedByPreview(worktrees, 'C:\\Users\\dev\\.claude\\CLAUDE.md')).toBe(false);
    // A sibling directory that merely starts with the repository path is outside it.
    expect(preview.governedByPreview(worktrees, 'C:\\repo-notes\\todo.md')).toBe(false);
    // Bash apply_patch carries no path, so it stays governed.
    expect(preview.governedByPreview(worktrees, null)).toBe(true);
  });

  test('only the owner can return the preview to main', () => {
    const first = preview.claimTransition(null, request);
    expect(() =>
      preview.releaseTransition(first, {
        ownerId: 'session-b',
        mainRoot: request.mainRoot,
        force: false,
        now: request.now,
      }),
    ).toThrow(preview.PreviewBusyError);
    expect(
      preview.releaseTransition(first, {
        ownerId: 'session-a',
        mainRoot: request.mainRoot,
        force: false,
        now: request.now,
      }),
    ).toMatchObject({ ownerId: null, sourceRoot: request.mainRoot });
  });
});
