// native-host/install.cts の純ユニットガード。リンク worktree の Electron は使い捨てで
// あり、ユーザー共有の Native Messaging ランチャーへ永続化される実行体になってはいけない。
// 本体ツリーと、明示的に隔離された設定ディレクトリは登録元として有効なまま。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { isLinkedWorktreeRuntime, shouldPreserveSharedRegistration } from '../native-host/install.cts';

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
