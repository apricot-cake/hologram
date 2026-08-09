// #1009 のストレージリダイレクトの防ぎ
// （app/src/main/lib-storage-redirect-guard.ts）の単体テスト。
//
// 仮想化そのものはこの環境で再現できない（#1003 の結論）。本物の MSIX パッケージ無しに
// 固定できるのは、fs.realpathSync.native が返してきたものをモジュールがどう扱うか。
// それはまさに #1009 の受け入れ条件が求めていること＝「realpath の戻り値を差し替えた
// ユニットテストで、LocalCache を含むパスに対して検出が発火する」。`classifyRealPath`
// は純粋（文字列を入れて判定が出る）なので、差し替えはただの関数の引数になる＝この
// 半分に fs のモックは要らない。`checkForRedirect` 自身の fs 呼び出しは注入できる
// （RedirectCheckDeps）ので、3つの結果（ok / redirected / check-failed）はいずれも
// 本物のファイルシステムに触れずに動かせる。
import { describe, expect, test } from 'vitest';
import { checkForRedirect, classifyRealPath } from '../app/src/main/lib-storage-redirect-guard';

describe('classifyRealPath＝純粋な分類器', () => {
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

describe('checkForRedirect＝プローブの書き込み → realpath → 掃除', () => {
  // Windows 形式のリテラルにしてあるのは意図してのこと（この防ぎは Windows の壊れ方の
  // ためにある）。ただしアサーションは区切り文字に依存してはいけない。プローブのパスは
  // path.join で組むので、Linux の CI ランナーでは '/' になる。このファイルの最初の版は
  // startsWith('...\\') で見ていて、Windows では通り CI では落ちた（2026-08-07）。
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
          return f; // リダイレクトなし＝渡されたのと同じパスへ解決する
        },
        unlinkSync: (f) => calls.push(`unlink:${f}`),
      },
    });
    expect(result).toEqual({ status: 'ok' });
    // プローブが実際に対象のディレクトリへ書かれ、後で掃除されている
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
          throw new Error('ここへ到達してはいけない');
        },
        unlinkSync: () => {},
      },
    });
    expect(result.status).toBe('check-failed');
    expect(calls).toEqual([]); // 消えたフォルダは消えたまま＝それ自体が合図
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
          throw new Error('ここへ到達してはいけない');
        },
        realpathNative: () => {
          throw new Error('ここへ到達してはいけない');
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
    // 失敗しても、プローブの掃除はできる範囲で試みる
    expect(unlinked.length).toBe(1);
  });

  test('unlink（掃除）が失敗しても判定結果は変わらない（掃除はできる範囲で）', () => {
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
