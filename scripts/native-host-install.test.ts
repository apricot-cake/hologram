// Pure unit guards for native-host/install.mts. A linked worktree's Electron is
// disposable, and must never become an executable that gets persisted into the
// user-shared Native Messaging launcher. The main tree, and an explicitly isolated
// config directory, remain valid registration sources.

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

// #210: Brave/Vivaldi は Chrome/Edge/Chromium と同じ「1ブラウザ1登録先」の並びに
// 追加された行であって、既存3件を置き換えたり順序を変えたりしないことを固定する。
describe('windowsRegistryKeys / unixManifestDirs（#210 Brave・Vivaldi）', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  if (!originalPlatform) throw new Error('process.platform descriptor missing');
  const setPlatform = (value: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value });

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
  });

  test('Windows レジストリキーに Brave・Vivaldi が既存3件を保ったまま追加される', () => {
    setPlatform('win32');
    const keys = windowsRegistryKeys();
    expect(keys).toEqual([
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
      `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
      `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`,
      `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${HOST_NAME}`,
      `HKCU\\Software\\Vivaldi\\NativeMessagingHosts\\${HOST_NAME}`,
    ]);
  });

  test('macOS のマニフェスト配置先も同じベンダー名の並びで増える', () => {
    setPlatform('darwin');
    const dirs = unixManifestDirs();
    expect(dirs).toEqual(['Google/Chrome', 'Microsoft Edge', 'Chromium', 'BraveSoftware/Brave-Browser', 'Vivaldi'].map((vendor) => path.join(os.homedir(), 'Library/Application Support', vendor, 'NativeMessagingHosts')));
  });

  test('Linux のマニフェスト配置先も同じベンダー名の並びで増える', () => {
    setPlatform('linux');
    const dirs = unixManifestDirs();
    expect(dirs).toEqual(['google-chrome', 'microsoft-edge', 'chromium', 'BraveSoftware/Brave-Browser', 'vivaldi'].map((vendor) => path.join(os.homedir(), '.config', vendor, 'NativeMessagingHosts')));
  });
});
