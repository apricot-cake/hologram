import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

const { deployExtension, withDeployLock } = require('./deploy-extension.cts');
const { neverHappens } = require('./lib-wait.cts');

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(oldBuild = 'old') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-extension-deploy-'));
  roots.push(root);
  const output = path.join(root, 'chrome-mv3');
  const stamp = path.join(root, 'config', 'extension-build.json');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'build.txt'), oldBuild);
  fs.mkdirSync(path.dirname(stamp), { recursive: true });
  fs.writeFileSync(stamp, JSON.stringify({ build: oldBuild, outDir: output }));
  return { root, output, stamp };
}

function build(id: string, shape?: 'file' | 'directory') {
  return (stage: string) => {
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(path.join(stage, 'build.txt'), id);
    if (shape === 'file') fs.writeFileSync(path.join(stage, 'changing'), 'file');
    if (shape === 'directory') {
      fs.mkdirSync(path.join(stage, 'changing'));
      fs.writeFileSync(path.join(stage, 'changing', 'nested'), 'directory');
    }
    return { buildId: id, output: stage };
  };
}

function content(output: string): string {
  return fs.readFileSync(path.join(output, 'build.txt'), 'utf8');
}

function stamped(stamp: string): string {
  return JSON.parse(fs.readFileSync(stamp, 'utf8')).build;
}

describe('拡張機能のトランザクション配備', () => {
  test.each([
    ['file→directory', 'file', 'directory'],
    ['directory→file', 'directory', 'file'],
  ] as const)('%s の形状変更を再試行可能なディレクトリ交換で公開する', async (_name, before, after) => {
    const { output, stamp } = fixture();
    if (before === 'file') fs.writeFileSync(path.join(output, 'changing'), 'old');
    else fs.mkdirSync(path.join(output, 'changing'));

    await deployExtension({ output, stamp, build: build('new', after) });

    expect(content(output)).toBe('new');
    expect(stamped(stamp)).toBe('new');
    expect(fs.statSync(path.join(output, 'changing')).isDirectory()).toBe(after === 'directory');
  });

  test('同時配備を backup から stamp・CDP reload まで直列化する', async () => {
    const { output, stamp } = fixture();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const pause = new Promise<void>((resolve) => (releaseFirst = resolve));
    const first = deployExtension({
      output,
      stamp,
      build: build('first'),
      onStep: (step) => events.push(`first:${step}`),
      configure: async () => pause,
      reloadPages: async () => void events.push('first:cdp-reload'),
    });
    await vi.waitFor(() => expect(events).toContain('first:swapped'));
    const second = deployExtension({
      output,
      stamp,
      build: build('second'),
      onStep: (step) => events.push(`second:${step}`),
    });
    await neverHappens('second deploy entering the held lock', () => events.includes('second:locked'), 75, { pollMs: 5 });
    releaseFirst();
    await Promise.all([first, second]);

    expect(events.indexOf('second:locked')).toBeGreaterThan(events.indexOf('first:reloaded'));
    expect(content(output)).toBe('second');
    expect(stamped(stamp)).toBe('second');
  });

  test.each(['configured'])('%s で失敗すると stamp と内容を旧正常ビルドへ戻す', async (failureStep) => {
    const { output, stamp } = fixture();
    await expect(
      deployExtension({
        output,
        stamp,
        build: build('new'),
        configure: async () => {},
        reloadPages: async () => {},
        onStep: (step) => {
          if (step === failureStep) throw new Error(`fault:${step}`);
        },
      }),
    ).rejects.toThrow(`fault:${failureStep}`);
    expect(content(output)).toBe('old');
    expect(stamped(stamp)).toBe('old');
  });

  test.each(['configure', 'publish'] as const)('既存outputありの%s実処理失敗では旧build・stamp・CDPへ戻す', async (failure) => {
    const { output, stamp } = fixture();
    let configureCalls = 0;
    let stampCalls = 0;
    await expect(
      deployExtension({
        output,
        stamp,
        build: build('new'),
        configure: async () => {
          configureCalls++;
          if (failure === 'configure' && configureCalls === 1) throw new Error('configure fault');
        },
        writeStamp: (file: string, body: string) => {
          stampCalls++;
          if (failure === 'publish' && stampCalls === 1) throw new Error('publish fault');
          fs.writeFileSync(file, body);
        },
        reloadPages: async () => {
          throw new Error('reload fault');
        },
      }),
    ).rejects.toThrow(`${failure} fault`);
    expect(content(output)).toBe('old');
    expect(stamped(stamp)).toBe('old');
    expect(configureCalls).toBe(2);
  });

  test('swap の部分失敗時は旧ビルドを戻して再試行できる', async () => {
    const { output, stamp } = fixture();
    const rename = fs.renameSync.bind(fs);
    let failed = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (!failed && String(from).includes('-stage-') && to === output) {
        failed = true;
        throw Object.assign(new Error('locked'), { code: 'EPERM' });
      }
      return rename(from, to);
    });
    await expect(deployExtension({ output, stamp, build: build('broken') })).rejects.toThrow('locked');
    expect(content(output)).toBe('old');
    expect(stamped(stamp)).toBe('old');
    vi.restoreAllMocks();
    await deployExtension({ output, stamp, build: build('retry') });
    expect(content(output)).toBe('retry');
    expect(stamped(stamp)).toBe('retry');
  });

  test('rollback 最初の output rename がロックされても新版・stamp・CDPを揃えてbackupを保持する', async () => {
    const { root, output, stamp } = fixture();
    const rename = fs.renameSync.bind(fs);
    let configured = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (from === output && String(to).includes('-failed-')) throw Object.assign(new Error('rollback locked'), { code: 'EBUSY' });
      return rename(from, to);
    });

    await expect(
      deployExtension({
        output,
        stamp,
        build: build('new'),
        configure: async () => void configured++,
        onStep: (step) => {
          if (step === 'configured') throw new Error('after configure');
        },
      }),
    ).rejects.toThrow(/検証済み新版を保持.*backup=/);
    expect(content(output)).toBe('new');
    expect(stamped(stamp)).toBe('new');
    expect(configured).toBe(2);
    expect(fs.readdirSync(root).some((name) => name.includes('-backup-'))).toBe(true);
  });

  test.each(['configure', 'publish', 'reload'] as const)('既存outputなしで%s失敗後も登録pathの検証済新版を保持して整合させる', async (failure) => {
    const { output, stamp } = fixture();
    fs.rmSync(output, { recursive: true });
    fs.rmSync(stamp);
    let configureCalls = 0;
    let stampCalls = 0;
    const configure = async () => {
      configureCalls++;
      if (failure === 'configure' && configureCalls === 1) throw new Error('configure fault');
    };
    const writeStamp = (file: string, body: string) => {
      stampCalls++;
      if (failure === 'publish' && stampCalls === 1) throw new Error('publish fault');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    };

    await expect(
      deployExtension({
        output,
        stamp,
        build: build('first'),
        configure,
        writeStamp,
        reloadPages: async () => {
          if (failure === 'reload') throw new Error('reload fault');
        },
      }),
    ).rejects.toThrow(failure === 'reload' ? /新版を保持.*backup=なし/ : /検証済み新版を保持.*backup=なし/);
    expect(content(output)).toBe('first');
    expect(stamped(stamp)).toBe('first');
    expect(configureCalls).toBe(failure === 'reload' ? 1 : 2);
  });

  test('復旧失敗時は backup を保持し、cleanup 失敗は成功した公開を覆さない', async () => {
    const { root, output, stamp } = fixture();
    const rename = fs.renameSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from).includes('-backup-') && to === output) throw new Error('restore locked');
      return rename(from, to);
    });
    await expect(
      deployExtension({
        output,
        stamp,
        build: build('broken'),
        onStep: (step) =>
          step === 'configured' &&
          (() => {
            throw new Error('publish fault');
          })(),
      }),
    ).rejects.toThrow('検証済み新版を保持しました');
    expect(fs.readdirSync(root).some((name) => name.includes('-backup-'))).toBe(true);
    expect(content(output)).toBe('broken');
    expect(stamped(stamp)).toBe('broken');

    vi.restoreAllMocks();
    const originalRm = fs.rmSync.bind(fs);
    vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
      if (String(target).includes('-backup-')) throw new Error('cleanup locked');
      return originalRm(target, options);
    });
    const result = await deployExtension({ output, stamp, build: build('successful') });
    expect(result.backup).toContain('-backup-');
    expect(content(output)).toBe('successful');
    expect(stamped(stamp)).toBe('successful');
  });

  test('旧ディレクトリロックはOS管理ロックの取得を妨げず、削除もしない', async () => {
    const { output } = fixture();
    const lock = path.join(path.dirname(output), `.${path.basename(output)}-deploy.lock`);
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: 2_147_483_647, hostname: os.hostname(), token: 'dead', createdAt: '2020-01-01T00:00:00.000Z' }));

    await expect(withDeployLock(output, async () => 'acquired', 100)).resolves.toBe('acquired');
    expect(fs.existsSync(lock)).toBe(true);
  });

  test('生存中のOSロックはtimeoutしても解放しない', async () => {
    const { output } = fixture();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const paused = new Promise<void>((resolve) => (release = resolve));
    const owner = withDeployLock(output, async () => {
      entered();
      await paused;
    });
    await started;
    try {
      await expect(withDeployLock(output, async () => {}, 30)).rejects.toThrow('配備ロックを取得できません');
      await expect(withDeployLock(output, async () => {}, 30)).rejects.toThrow('配備ロックを取得できません');
    } finally {
      release();
      await owner;
    }
    await expect(withDeployLock(output, async () => 'acquired', 100)).resolves.toBe('acquired');
  });

  test('交換と復元の二重失敗では両方の復旧用ビルドと元エラーを保持する', async () => {
    const { root, output, stamp } = fixture();
    const rename = fs.renameSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (to === output && String(from).includes('-stage-')) throw new Error('stage locked');
      if (to === output && String(from).includes('-backup-')) throw new Error('backup locked');
      return rename(from, to);
    });
    let failure: AggregateError | undefined;
    try {
      await deployExtension({ output, stamp, build: build('new') });
    } catch (error) {
      failure = error as AggregateError;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure?.errors.map((e: Error) => e.message)).toEqual(['stage locked', 'backup locked']);
    expect(failure?.message).toContain('backup=');
    expect(failure?.message).toContain('stage=');
    expect(fs.existsSync(output)).toBe(false);
    const files = fs.readdirSync(root);
    expect(content(path.join(root, files.find((f) => f.includes('-stage-'))!))).toBe('new');
    expect(content(path.join(root, files.find((f) => f.includes('-backup-'))!))).toBe('old');
    expect(stamped(stamp)).toBe('old');
  });

  test('ページ更新の部分失敗は公開済みの新版を逆戻りさせない', async () => {
    const { output, stamp } = fixture();
    const pages: string[] = [];
    let configured = 0;
    await expect(
      deployExtension({
        output,
        stamp,
        build: build('new'),
        configure: async () => {
          configured++;
        },
        reloadPages: async () => {
          pages.push(content(output));
          throw new Error('second page failed');
        },
      }),
    ).rejects.toThrow('配備は完了しましたがページ更新に失敗');
    expect(pages).toEqual(['new']);
    expect(configured).toBe(1);
    expect(content(output)).toBe('new');
    expect(stamped(stamp)).toBe('new');
  });
});
