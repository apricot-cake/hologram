// native-host/install.mts に対する純粋な単体テストの防ぎ。リンク worktree の Electron は
// 使い捨てであり、利用者が共有する Native Messaging のランチャへ焼き付く実行ファイルには
// 決してならない。本体の作業ツリーと、明示的に隔離した設定ディレクトリは、登録元として
// 有効なまま。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { HOST_NAME, isLinkedWorktreeRuntime, shouldPreserveSharedRegistration, unixManifestDirs, windowsRegistryKeys } from '../native-host/install.mts';

let root: string;
let mainExe: string;
let linkedExe: string;
let packagedExe: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-host-install-'));
  const main = path.join(root, 'main');
  const linked = path.join(root, 'linked');

  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  fs.mkdirSync(linked, { recursive: true });
  fs.writeFileSync(path.join(linked, '.git'), 'gitdir: ../main/.git/worktrees/linked\n');

  mainExe = path.join(main, 'app', 'node_modules', 'electron', 'dist', 'electron.exe');
  linkedExe = path.join(linked, 'app', 'node_modules', 'electron', 'dist', 'electron.exe');
  packagedExe = path.join(root, 'installed', 'Hologram.exe');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('isLinkedWorktreeRuntime', () => {
  test('本体作業ツリーは使い捨てでない', () => {
    expect(isLinkedWorktreeRuntime(mainExe)).toBe(false);
  });

  test('リンク worktree は .git ファイルから判別できる', () => {
    expect(isLinkedWorktreeRuntime(linkedExe)).toBe(true);
  });

  test('Git の外にあるパッケージ版は使い捨てでない', () => {
    expect(isLinkedWorktreeRuntime(packagedExe)).toBe(false);
  });
});

describe('shouldPreserveSharedRegistration', () => {
  test('共有登録はリンク worktree の Electron から守られる', () => {
    expect(shouldPreserveSharedRegistration({ exe: linkedExe, runAsNode: true, configDirOverride: '' })).toBe(true);
  });

  test('明示的に隔離した設定ならリンク worktree からでも書ける', () => {
    expect(shouldPreserveSharedRegistration({ exe: linkedExe, runAsNode: true, configDirOverride: path.join(root, 'sandbox') })).toBe(false);
  });

  test('素の Node CLI からの登録は従来どおり許す', () => {
    expect(shouldPreserveSharedRegistration({ exe: linkedExe, runAsNode: false })).toBe(false);
  });
});

describe('Chrome の Native Messaging 登録先', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  if (!originalPlatform) throw new Error('process.platform descriptor missing');
  const setPlatform = (value: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value });

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
  });

  test('Windows は Chrome のレジストリキーだけを使う', () => {
    setPlatform('win32');
    const keys = windowsRegistryKeys();
    expect(keys).toEqual([`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`]);
  });

  test('macOS は Chrome のマニフェスト配置先だけを使う', () => {
    setPlatform('darwin');
    const dirs = unixManifestDirs();
    expect(dirs).toEqual([path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts')]);
  });

  test('Linux は登録対象外', () => {
    setPlatform('linux');
    expect(() => unixManifestDirs()).toThrow('Unsupported platform');
  });
});
