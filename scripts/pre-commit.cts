'use strict';

const cp = require('node:child_process') as typeof import('node:child_process');
const fs = require('node:fs/promises') as typeof import('node:fs/promises');
const os = require('node:os') as typeof import('node:os');
const path = require('node:path') as typeof import('node:path');

interface HookOptions {
  cwd?: string;
  formatter?: { command: string; args: string[] };
  timeoutMs?: number;
}

async function runPreCommit(options: HookOptions = {}): Promise<void> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const timeoutMs = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let temporary: string | undefined;

  const run = (command: string, args: string[], environment: NodeJS.ProcessEnv, directory = cwd, input?: Buffer): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const child = cp.spawn(command, args, { cwd: directory, env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const output: Buffer[] = [];
      const errors: Buffer[] = [];
      let bytes = 0;
      let failure: Error | undefined;
      const stop = (reason: string) => {
        failure ??= new Error(reason);
        if (child.pid && process.platform === 'win32') cp.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else child.kill('SIGKILL');
      };
      const onAbort = () => stop('pre-commit が中断されました');
      const timer = setTimeout(() => stop('pre-commit の子プロセスが制限時間を超えました'), timeoutMs);
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
      const collect = (target: Buffer[]) => (data: Buffer) => {
        bytes += data.length;
        if (bytes > 16 * 1024 * 1024) stop('pre-commit の出力が上限を超えました');
        else target.push(data);
      };
      child.stdout.on('data', collect(output));
      child.stderr.on('data', collect(errors));
      child.stdin.on('error', () => {});
      child.on('error', (error: Error) => {
        failure = error;
      });
      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
        if (failure) reject(failure);
        else if (code !== 0) reject(new Error(`${command} が失敗しました (${code}): ${Buffer.concat(errors).toString('utf8')}${Buffer.concat(output).toString('utf8')}`));
        else resolve(Buffer.concat(output));
      });
      child.stdin.end(input);
    });
  const git = (args: string[], environment = process.env, directory = cwd, input?: Buffer) => run('git', args, environment, directory, input);
  const readIndex = async (file: string): Promise<Buffer | null> => {
    try {
      return await fs.readFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };
  const withLock = async (index: string, action: (handle: import('node:fs/promises').FileHandle, lock: string, ownsLock: () => Promise<boolean>) => Promise<void>) => {
    const lock = `${index}.lock`;
    const handle = await fs.open(lock, 'wx');
    const identity = await handle.stat();
    const ownsLock = async () => {
      try {
        const current = await fs.lstat(lock);
        return current.dev === identity.dev && current.ino === identity.ino;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    };
    try {
      await action(handle, lock, ownsLock);
    } finally {
      await handle.close();
      if (await ownsLock()) await fs.unlink(lock);
    }
  };

  try {
    const defaultEnvironment = { ...process.env };
    delete defaultEnvironment.GIT_INDEX_FILE;
    const defaultIndex = path.resolve(cwd, (await git(['rev-parse', '--git-path', 'index'], defaultEnvironment)).toString('utf8').trim());
    const index = path.resolve(cwd, (await git(['rev-parse', '--git-path', 'index'])).toString('utf8').trim());
    const gitDir = (await git(['rev-parse', '--absolute-git-dir'])).toString('utf8').trim();
    const root = (await git(['rev-parse', '--show-toplevel'])).toString('utf8').trim();
    const normal = process.platform === 'win32' ? index.toLowerCase() === defaultIndex.toLowerCase() : index === defaultIndex;
    temporary = await fs.mkdtemp(path.join(path.resolve(os.tmpdir()), 'hologram-pre-commit-'));
    const snapshotIndex = path.join(temporary, 'index');
    const worktree = path.join(temporary, 'worktree');
    await fs.mkdir(worktree);
    let original: Buffer | null = null;
    const finish = async (updated?: Buffer) =>
      withLock(index, async (handle, lock, ownsLock) => {
        const current = await readIndex(index);
        if ((current === null) !== (original === null) || (current !== null && original !== null && !current.equals(original))) throw new Error('整形中にステージ内容が変更されました。変更を保持してコミットを中止します。');
        if (!updated) return;
        if (!(await ownsLock())) throw new Error('index lock の所有権が変更されました');
        await handle.writeFile(updated);
        await handle.sync();
        await handle.close();
        if (!(await ownsLock())) throw new Error('index lock の所有権が変更されました');
        await fs.rename(lock, index);
      });
    await withLock(index, async () => {
      original = await readIndex(index);
      if (original) await fs.writeFile(snapshotIndex, original);
    });
    const environment: NodeJS.ProcessEnv = { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: worktree, GIT_INDEX_FILE: snapshotIndex };
    if (original === null) await git(['read-tree', '--empty'], environment);
    const paths = await git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], environment);
    const modes = await git(['ls-files', '--stage', '-z'], environment);
    const regularFiles = new Set(
      modes
        .toString('utf8')
        .split('\0')
        .filter((entry) => /^(100644|100755) /.test(entry))
        .map((entry) => entry.slice(entry.indexOf('\t') + 1)),
    );
    const selectedFiles = paths
      .toString('utf8')
      .split('\0')
      .filter((file) => regularFiles.has(file));
    await run(process.execPath, [path.join(root, 'scripts', 'guard-repository-content.cts'), '--staged'], environment, root);
    if (!selectedFiles.length) {
      await finish();
      return;
    }
    await git(['checkout-index', '--all', '--force', `--prefix=${worktree.replaceAll('\\', '/')}/`], environment);
    const beforeTree = await git(['write-tree'], environment);
    let formatter = options.formatter;
    if (!formatter) {
      try {
        const libc = process.platform === 'linux' && !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime ? '-musl' : '';
        const binary = process.env.BIOME_BINARY || `@biomejs/cli-${process.platform}-${process.arch}${libc}/${process.platform === 'win32' ? 'biome.exe' : 'biome'}`;
        formatter = { command: require.resolve(binary, { paths: [root] }), args: [] };
      } catch {
        console.error('[hologram] Biome が未インストールのため整形を省略します。npm run setup を実行してください。');
        await finish();
        return;
      }
    }
    // NUL で得た通常ファイルだけを標準 CLI へ渡す。symlink/gitlink の先は整形しない。
    // Windows のコマンドライン上限を避けるため、引用を含めた最大長を保守的に制限する。
    let batch: string[] = [];
    let size = 0;
    const check = async () => run(formatter.command, [...formatter.args, 'check', ...(normal ? ['--write'] : []), '--no-errors-on-unmatched', '--', ...batch], environment, worktree);
    for (const file of selectedFiles) {
      const length = 2 * file.length + 4;
      if (length > 16_000) throw new Error('整形対象のパスがコマンドライン上限を超えています');
      if (size + length > 16_000) {
        await check();
        batch = [];
        size = 0;
      }
      batch.push(file);
      size += length;
    }
    if (batch.length) await check();
    if (!normal) {
      await finish();
      return;
    }
    await git(['--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul'], environment, worktree, Buffer.from(`${selectedFiles.join('\0')}\0`));
    // Git の stat 情報や拡張領域の差ではなく、ステージ内容が変わったときだけ反映する。
    const afterTree = await git(['write-tree'], environment);
    await finish(beforeTree.equals(afterTree) ? undefined : await fs.readFile(snapshotIndex));
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  }
}

module.exports = { runPreCommit };
if (require.main === module)
  runPreCommit().catch((error: Error) => {
    console.error(`[hologram] ${error.message}`);
    process.exitCode = 1;
  });
