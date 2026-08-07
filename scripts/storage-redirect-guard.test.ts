// Unit tests for the #1009 storage-redirect guard
// (app/src/main/lib-storage-redirect-guard.ts).
//
// The virtualization itself cannot be reproduced in this environment (#1003's
// conclusion) — what CAN be pinned down without a real MSIX package is what the
// module does with whatever fs.realpathSync.native HANDS BACK, which is exactly
// what #1009's acceptance criteria ask for: "realpath の戻り値を差し替えたユニッ
// トテストで、LocalCache を含むパスに対して検出が発火する". `classifyRealPath` is
// pure (a string in, a verdict out), so the swap is a plain function argument —
// no fs mocking needed for that half. `checkForRedirect`'s own fs calls are
// injectable (RedirectCheckDeps) so its three outcomes (ok / redirected /
// check-failed) are each exercised without touching a real filesystem.
import { describe, expect, test } from 'vitest';
import { checkForRedirect, classifyRealPath } from '../app/src/main/lib-storage-redirect-guard';

describe('classifyRealPath — pure classifier', () => {
  test('MSIX の per-package LocalCache へ解決されたパスは redirected', () => {
    const real = 'C:\\Users\\me\\AppData\\Local\\Packages\\AnthropicPBC.ClaudeDesktop_abc123\\LocalCache\\Roaming\\Hologram\\config.json';
    expect(classifyRealPath(real)).toBe('redirected');
  });

  test('通常のホーム直下は ok（偽陽性ゼロ＝#1009 の受け入れ条件1）', () => {
    expect(classifyRealPath('C:\\Users\\me\\.hologram\\config.json')).toBe('ok');
    expect(classifyRealPath('C:\\Users\\me\\Hologram\\library\\hologram.db')).toBe('ok');
  });

  test('大文字小文字が違っても検出する（Windows のパスは大小無視）', () => {
    expect(classifyRealPath('C:\\Users\\me\\AppData\\Local\\packages\\Foo_x\\localcache\\Roaming\\Hologram')).toBe('redirected');
  });

  test('片方の segment しか無ければ redirected ではない（誤検出しない語の一致）', () => {
    expect(classifyRealPath('C:\\Users\\me\\Documents\\Packages\\notes\\readme.txt')).toBe('ok');
    expect(classifyRealPath('C:\\Users\\me\\Backups\\LocalCache\\old-config.json')).toBe('ok');
  });

  test('macOS/Linux スタイルのパスはそもそもマッチしない', () => {
    expect(classifyRealPath('/Users/me/Library/Application Support/Hologram/config.json')).toBe('ok');
  });
});

describe('checkForRedirect — probe write → realpath → cleanup', () => {
  // A Windows-style literal on purpose (this guard exists for a Windows failure
  // mode), but the ASSERTIONS must not depend on the separator: the probe path is
  // built with path.join, which yields '/' on the Linux CI runner. The first cut
  // of this file asserted startsWith('...\\') and so passed on Windows and failed
  // in CI (2026-08-07).
  const DIR = 'C:\\Users\\me\\.hologram';
  const probed = (calls: string[], kind: string) => calls.some((c) => c.startsWith(`${kind}:${DIR}`) && c.includes('.hologram-realpath-probe-'));

  test('ensureDir 付き: mkdir/write/realpath が全部そのまま返り、redirected を含まなければ ok', () => {
    const calls: string[] = [];
    const result = checkForRedirect(DIR, {
      ensureDir: true,
      deps: {
        mkdirSync: (d) => calls.push(`mkdir:${d}`),
        writeFileSync: (f) => calls.push(`write:${f}`),
        realpathNative: (f) => {
          calls.push(`realpath:${f}`);
          return f; // no redirection — resolves to the same path it was given
        },
        unlinkSync: (f) => calls.push(`unlink:${f}`),
      },
    });
    expect(result).toEqual({ status: 'ok' });
    // probe was actually written into the target dir and cleaned up afterward
    expect(calls[0]).toBe(`mkdir:${DIR}`);
    expect(probed(calls, 'write')).toBe(true);
    expect(probed(calls, 'unlink')).toBe(true);
  });

  test('⚠️ 既定では mkdir しない（保存先を作り直すと #37 の欠落検知が死ぬ）', () => {
    const calls: string[] = [];
    checkForRedirect(DIR, {
      deps: {
        mkdirSync: (d) => calls.push(`mkdir:${d}`),
        writeFileSync: () => {},
        realpathNative: (f) => f,
        unlinkSync: () => {},
      },
    });
    expect(calls).toEqual([]);
  });

  test('保存先が消えていたら check-failed で、フォルダは作り直さない', () => {
    const calls: string[] = [];
    const result = checkForRedirect('D:\\gone-library', {
      deps: {
        mkdirSync: (d) => calls.push(`mkdir:${d}`),
        writeFileSync: () => {
          throw new Error('ENOENT: no such file or directory');
        },
        realpathNative: () => {
          throw new Error('should not be reached');
        },
        unlinkSync: () => {},
      },
    });
    expect(result.status).toBe('check-failed');
    expect(calls).toEqual([]); // the missing folder stays missing — that IS the signal
  });

  test('realpath が LocalCache 配下を返したら redirected（#1009 の核心のテスト）', () => {
    const result = checkForRedirect(DIR, {
      deps: {
        writeFileSync: () => {},
        realpathNative: () => 'C:\\Users\\me\\AppData\\Local\\Packages\\Some.Package_xyz\\LocalCache\\Roaming\\Hologram\\probe',
        unlinkSync: () => {},
      },
    });
    expect(result.status).toBe('redirected');
    expect(result).toMatchObject({ realPath: expect.stringContaining('LocalCache') });
  });

  test('ensureDir 付きで mkdir が失敗したら check-failed であって redirected ではない（受け入れ条件3）', () => {
    const result = checkForRedirect('Z:\\does-not-exist', {
      ensureDir: true,
      deps: {
        mkdirSync: () => {
          throw new Error('ENOENT: no such directory');
        },
        writeFileSync: () => {
          throw new Error('should not be reached');
        },
        realpathNative: () => {
          throw new Error('should not be reached');
        },
        unlinkSync: () => {},
      },
    });
    expect(result.status).toBe('check-failed');
  });

  test('write は成功したが realpath が失敗しても check-failed（redirected を騙らない）', () => {
    const unlinked: string[] = [];
    const result = checkForRedirect(DIR, {
      deps: {
        writeFileSync: () => {},
        realpathNative: () => {
          throw new Error('permission denied');
        },
        unlinkSync: (f) => unlinked.push(f),
      },
    });
    expect(result.status).toBe('check-failed');
    // even on failure, cleanup of the probe is still attempted
    expect(unlinked.length).toBe(1);
  });

  test('unlink（掃除）が失敗しても判定結果は変わらない（best-effort cleanup）', () => {
    const result = checkForRedirect(DIR, {
      deps: {
        writeFileSync: () => {},
        realpathNative: (f) => f,
        unlinkSync: () => {
          throw new Error('locked by another process');
        },
      },
    });
    expect(result).toEqual({ status: 'ok' });
  });
});
