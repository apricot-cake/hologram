import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

const { runPreCommit } = require('./pre-commit.cts') as { runPreCommit(options?: { cwd?: string; formatter?: { command: string; args: string[] }; timeoutMs?: number }): Promise<void> };
const ROOT = path.resolve(__dirname, '..');
const fixtures: string[] = [];
const environment = { ...process.env };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete environment[key];

function git(cwd: string, args: string[], env = environment): string {
  return cp.execFileSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
}

function fixture(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-precommit-test-'));
  fixtures.push(directory);
  git(directory, ['init', '--quiet']);
  git(directory, ['config', 'user.name', 'Hologram Test']);
  git(directory, ['config', 'user.email', 'test@example.invalid']);
  git(directory, ['config', 'commit.gpgsign', 'false']);
  git(directory, ['config', 'core.autocrlf', 'false']);
  fs.mkdirSync(path.join(directory, 'scripts'));
  for (const file of ['pre-commit.cts', 'guard-repository-content.cts']) fs.copyFileSync(path.join(ROOT, 'scripts', file), path.join(directory, 'scripts', file));
  fs.writeFileSync(path.join(directory, 'biome.json'), JSON.stringify({ vcs: { enabled: true, clientKind: 'git' }, formatter: { indentStyle: 'space', indentWidth: 2 }, linter: { enabled: false }, assist: { enabled: false } }));
  fs.writeFileSync(path.join(directory, '.gitignore'), 'node_modules\n');
  fs.writeFileSync(path.join(directory, 'entry.ts'), 'export const a = 1;\nexport const b = 1;\n');
  git(directory, ['add', '.']);
  // 初期状態の後に作者 hook を接続する。利用者の共通 dispatcher は変更しない。
  git(directory, ['commit', '--quiet', '-m', 'テストの初期状態']);
  fs.mkdirSync(path.join(directory, '.githooks'));
  fs.copyFileSync(path.join(ROOT, '.githooks', 'pre-commit'), path.join(directory, '.githooks', 'pre-commit'));
  fs.chmodSync(path.join(directory, '.githooks', 'pre-commit'), 0o755);
  git(directory, ['config', 'hooks.previousPath', path.join(directory, '.githooks').replaceAll('\\', '/')]);
  let dispatcher = '';
  try {
    dispatcher = git(directory, ['config', '--get', 'core.hooksPath']).trim();
  } catch {
    /* CI では作者 hook を直接使う。 */
  }
  if (!dispatcher) git(directory, ['config', 'core.hooksPath', '.githooks']);
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return directory;
}

function stage(directory: string, text: string, file = 'entry.ts') {
  fs.writeFileSync(path.join(directory, file), text);
  git(directory, ['--literal-pathspecs', 'add', '--', file]);
}
function index(directory: string) {
  return fs.readFileSync(path.join(directory, '.git', 'index'));
}
function commit(directory: string, args: string[] = []) {
  return git(directory, ['commit', '--quiet', '-m', 'ステージの検証', ...args]);
}
function fakeFormatter(directory: string, source: string) {
  const file = path.join(directory, 'formatter.cjs');
  fs.writeFileSync(file, source);
  return { command: process.execPath, args: [file] };
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of fixtures.splice(0)) fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('実 Git とステージ済み内容の整形', () => {
  test('部分 stage のみ整形し、未 stage 編集と実ファイルを維持する', () => {
    const directory = fixture();
    stage(directory, 'export const a=2;\nexport const b = 1;\n');
    const worktree = 'export const a=2;\nexport const b=3;\n';
    fs.writeFileSync(path.join(directory, 'entry.ts'), worktree);
    commit(directory);
    expect(git(directory, ['show', 'HEAD:entry.ts'])).toBe('export const a = 2;\nexport const b = 1;\n');
    expect(git(directory, ['show', ':entry.ts'])).toBe(git(directory, ['show', 'HEAD:entry.ts']));
    expect(fs.readFileSync(path.join(directory, 'entry.ts'), 'utf8')).toBe(worktree);
    expect(fs.existsSync(path.join(directory, '.git', 'index.lock'))).toBe(false);
  }, 30_000);

  test('他プロセスの lock の内容・identity を保持する', async () => {
    const directory = fixture();
    stage(directory, 'export const a=2;\n');
    const before = index(directory);
    const lock = path.join(directory, '.git', 'index.lock');
    fs.writeFileSync(lock, 'foreign owner');
    const identity = fs.statSync(lock);
    await expect(runPreCommit({ cwd: directory })).rejects.toThrow();
    expect(index(directory)).toEqual(before);
    expect(fs.readFileSync(lock, 'utf8')).toBe('foreign owner');
    expect(fs.statSync(lock).ino).toBe(identity.ino);
  }, 30_000);

  test.each(['--only', '--all'])(
    '%s は不整形を無変更で拒否し、整形済みなら index == HEAD で完了する',
    (mode) => {
      const directory = fixture();
      stage(directory, 'export const a=2;\n');
      const before = git(directory, ['rev-parse', 'HEAD']);
      const tree = git(directory, ['write-tree']);
      const args = mode === '--only' ? ['--only', 'entry.ts'] : ['--all'];
      expect(() => commit(directory, args)).toThrow();
      expect(git(directory, ['rev-parse', 'HEAD'])).toBe(before);
      expect(git(directory, ['write-tree'])).toBe(tree);
      expect(fs.readFileSync(path.join(directory, 'entry.ts'), 'utf8')).toBe('export const a=2;\n');
      stage(directory, 'export const a = 2;\n');
      commit(directory, args);
      expect(git(directory, ['diff', '--cached', '--exit-code'])).toBe('');
      // 次の通常 commit へ整形を戻す差分を残さない。
      expect(git(directory, ['show', ':entry.ts'])).toBe(git(directory, ['show', 'HEAD:entry.ts']));
    },
    30_000,
  );

  test('カスタム index を検証だけに使い、既定 index を変更しない', () => {
    const directory = fixture();
    const before = index(directory);
    const custom = path.join(directory, '.git', 'custom-index');
    fs.copyFileSync(path.join(directory, '.git', 'index'), custom);
    const env = { ...environment, GIT_INDEX_FILE: custom };
    fs.writeFileSync(path.join(directory, 'entry.ts'), 'export const a=2;\n');
    git(directory, ['add', 'entry.ts'], env);
    const customBefore = git(directory, ['write-tree'], env);
    expect(() => git(directory, ['commit', '--quiet', '-m', '別 index'], env)).toThrow();
    expect(index(directory)).toEqual(before);
    expect(git(directory, ['write-tree'], env)).toEqual(customBefore);
    fs.writeFileSync(path.join(directory, 'entry.ts'), 'export const a = 2;\n');
    git(directory, ['add', 'entry.ts'], env);
    git(directory, ['commit', '--quiet', '-m', '別 index'], env);
    expect(git(directory, ['diff', '--cached', '--exit-code'], env)).toBe('');
    expect(index(directory)).toEqual(before);
  }, 30_000);

  test('NUL と literal pathspec で空白・日本語・角括弧の名前を扱う', () => {
    const directory = fixture();
    const names = ['space name.ts', '日本語.ts', '[literal].ts'];
    if (process.platform !== 'win32') names.push('line\nbreak.ts', ':(glob).ts');
    for (const name of names) stage(directory, 'export const value=2;\n', name);
    fs.writeFileSync(path.join(directory, 'literal.ts'), 'untracked bytes');
    commit(directory);
    for (const name of names) expect(git(directory, ['show', `HEAD:${name}`]), name).toBe('export const value = 2;\n');
    expect(git(directory, ['ls-files', 'literal.ts'])).toBe('');
  }, 30_000);

  test('大量の staged path を上限内の一度の整形で処理する', () => {
    const directory = fixture();
    fs.mkdirSync(path.join(directory, 'many'));
    for (let i = 0; i < 300; i++) fs.writeFileSync(path.join(directory, 'many', `${i}.ts`), `export const value=${i};\n`);
    git(directory, ['add', 'many']);
    commit(directory);
    expect(git(directory, ['show', 'HEAD:many/299.ts'])).toBe('export const value = 299;\n');
    expect(git(directory, ['diff', '--cached', '--exit-code'])).toBe('');
  }, 30_000);

  test('staged symlink が指す元 worktree の実ファイルを整形しない', async (context) => {
    const directory = fixture();
    git(directory, ['config', 'core.symlinks', 'true']);
    const target = path.join(directory, 'original.ts');
    fs.writeFileSync(target, 'export const original=7;\n');
    try {
      fs.symlinkSync(target, path.join(directory, 'linked.ts'), 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') context.skip();
      throw error;
    }
    git(directory, ['add', 'linked.ts']);
    expect(git(directory, ['ls-files', '--stage', 'linked.ts'])).toMatch(/^120000 /);
    const before = index(directory);
    await runPreCommit({ cwd: directory });
    expect(index(directory)).toEqual(before);
    expect(fs.readFileSync(target, 'utf8')).toBe('export const original=7;\n');
  }, 30_000);

  test.each([true, false])(
    '整形中の concurrent git add を CAS で保持する（整形変更: %s）',
    async (changesFormatting) => {
      const directory = fixture();
      stage(directory, changesFormatting ? 'export const a=2;\n' : 'export const a = 2;\n');
      const ready = path.join(directory, 'ready');
      const release = path.join(directory, 'release');
      const formatter = fakeFormatter(
        directory,
        `const fs=require('node:fs'); fs.writeFileSync('entry.ts','export const a = 2;\\n'); fs.writeFileSync(${JSON.stringify(ready)},'ready'); const finish=()=>{if(fs.existsSync(${JSON.stringify(release)})){watcher.close();}}; const watcher=fs.watch(${JSON.stringify(directory)},finish); finish();`,
      );
      const running = runPreCommit({ cwd: directory, formatter });
      const result = running.catch((error: Error) => error);
      try {
        await vi.waitFor(() => expect(fs.existsSync(ready)).toBe(true), { timeout: 10_000 });
        stage(directory, 'export const a = 9;\n');
        const concurrent = index(directory);
        fs.writeFileSync(release, 'continue');
        expect(await result).toBeInstanceOf(Error);
        expect(index(directory)).toEqual(concurrent);
        expect(git(directory, ['show', ':entry.ts'])).toBe('export const a = 9;\n');
        expect(fs.existsSync(path.join(directory, '.git', 'index.lock'))).toBe(false);
      } finally {
        fs.writeFileSync(release, 'continue');
        await result;
      }
    },
    30_000,
  );

  test('反映前に他プロセスが作った lock は削除せず保持する', async () => {
    const directory = fixture();
    stage(directory, 'export const a=2;\n');
    const before = index(directory);
    const lock = path.join(directory, '.git', 'index.lock');
    const formatter = fakeFormatter(directory, `const fs=require('node:fs'); fs.writeFileSync('entry.ts','export const a = 2;\\n'); fs.writeFileSync(${JSON.stringify(lock)},'late foreign owner',{flag:'wx'});`);
    await expect(runPreCommit({ cwd: directory, formatter })).rejects.toThrow();
    expect(index(directory)).toEqual(before);
    expect(fs.readFileSync(lock, 'utf8')).toBe('late foreign owner');
  }, 30_000);

  test('相対 TEMP を絶対化し、整形不要なら元 index bytes を更新しない', async () => {
    const directory = fixture();
    stage(directory, 'export const a = 2;\n');
    const before = index(directory);
    const temporary = path.join(directory, 'temporary');
    fs.mkdirSync(temporary);
    for (const name of ['TMP', 'TEMP', 'TMPDIR']) vi.stubEnv(name, path.relative(process.cwd(), temporary));
    await runPreCommit({ cwd: directory });
    expect(index(directory)).toEqual(before);
    expect(fs.readdirSync(temporary)).toEqual([]);
  }, 30_000);

  test('formatter・guard の失敗では元 index と worktree を保持する', async () => {
    const directory = fixture();
    stage(directory, 'export const a=2;\n');
    const before = index(directory);
    const formatter = fakeFormatter(directory, 'process.exit(7);');
    await expect(runPreCommit({ cwd: directory, formatter })).rejects.toThrow();
    expect(index(directory)).toEqual(before);
    expect(fs.readFileSync(path.join(directory, 'entry.ts'), 'utf8')).toBe('export const a=2;\n');
    stage(directory, 'private data', 'private.jpg');
    const guarded = index(directory);
    await expect(runPreCommit({ cwd: directory })).rejects.toThrow('許可されていない');
    expect(index(directory)).toEqual(guarded);
    expect(fs.existsSync(path.join(directory, '.git', 'index.lock'))).toBe(false);
  }, 30_000);

  test('終了しない child を timeout で終了し index・所有 lock を保つ', async () => {
    const directory = fixture();
    stage(directory, 'export const a=2;\n');
    const before = index(directory);
    const pidFile = path.join(directory, 'pid');
    const formatter = fakeFormatter(directory, `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); setInterval(()=>{},1000);`);
    await expect(runPreCommit({ cwd: directory, formatter, timeoutMs: 1500 })).rejects.toThrow('制限時間');
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
    expect(index(directory)).toEqual(before);
    expect(fs.existsSync(path.join(directory, '.git', 'index.lock'))).toBe(false);
  }, 30_000);
});
