// 保存フォルダの復旧と破壊的操作のゲート（native-host/config-recovery.cts）の
// ユニットテスト。2026-06-23 のライブラリ消失事故を受けて追加したもの。純ロジック＝
// Electron 不要。

import { describe, expect, test } from 'vitest';
import { clearAllBlockReason, resolveSaveFolder } from '../native-host/config-recovery.cts';

const DEFAULT = 'C:/default/lib';

describe('resolveSaveFolder', () => {
  test('config に明示されたフォルダが勝つ', () => {
    expect(resolveSaveFolder({ configSaveFolder: 'D:/mine', pointer: 'E:/old', pointerExists: true, defaultDir: DEFAULT })).toEqual({ folder: 'D:/mine', source: 'config' });
  });

  test('config を失っても pointer が実在すれば復旧する', () => {
    expect(resolveSaveFolder({ configSaveFolder: undefined, pointer: 'E:/lib', pointerExists: true, defaultDir: DEFAULT })).toEqual({ folder: 'E:/lib', source: 'pointer' });
  });

  test('pointer の指す先が消えていれば無視する', () => {
    expect(resolveSaveFolder({ configSaveFolder: '', pointer: 'E:/lib', pointerExists: false, defaultDir: DEFAULT })).toEqual({ folder: DEFAULT, source: 'default' });
  });

  test('新規インストール（config も pointer も無し）は既定値', () => {
    expect(resolveSaveFolder({ configSaveFolder: null, pointer: null, pointerExists: false, defaultDir: DEFAULT })).toEqual({ folder: DEFAULT, source: 'default' });
  });

  test('空白だけの config は空とみなす', () => {
    expect(resolveSaveFolder({ configSaveFolder: '   ', pointer: 'E:/lib', pointerExists: true, defaultDir: DEFAULT }).source).toBe('pointer');
  });
});

describe('clearAllBlockReason', () => {
  test('健全な明示フォルダなら全消しを許す', () => {
    expect(clearAllBlockReason({ configCorrupt: false, hasExplicitSaveFolder: true, hasPointer: true })).toBeNull();
  });

  test('config 破損は全消しを止める', () => {
    expect(clearAllBlockReason({ configCorrupt: true, hasExplicitSaveFolder: false, hasPointer: true })).toBe('corrupt');
  });

  test('saveFolder 消失（pointer が存在した証拠）は全消しを止める', () => {
    expect(clearAllBlockReason({ configCorrupt: false, hasExplicitSaveFolder: false, hasPointer: true })).toBe('lost');
  });

  test('新規インストール（フォルダも pointer も無し）は全消しを許す', () => {
    expect(clearAllBlockReason({ configCorrupt: false, hasExplicitSaveFolder: false, hasPointer: false })).toBeNull();
  });

  test('破損は明示フォルダより優先する', () => {
    expect(clearAllBlockReason({ configCorrupt: true, hasExplicitSaveFolder: true, hasPointer: true })).toBe('corrupt');
  });
});
