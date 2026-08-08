// Unit tests for save-folder recovery and the destructive-operation gate
// (native-host/config-recovery.mts). Added in response to the 2026-06-23 library loss incident.
// Pure logic — no Electron needed.

import { describe, expect, test } from 'vitest';
import { clearAllBlockReason, libraryIsMissing, resolveSaveFolder } from '../native-host/config-recovery.mts';

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
    expect(clearAllBlockReason({ configCorrupt: false, hasExplicitSaveFolder: true, hasPointer: true, libraryMissing: false })).toBeNull();
  });

  test('config 破損は全消しを止める', () => {
    expect(clearAllBlockReason({ configCorrupt: true, hasExplicitSaveFolder: false, hasPointer: true, libraryMissing: false })).toBe('corrupt');
  });

  test('saveFolder 消失（pointer が存在した証拠）は全消しを止める', () => {
    expect(clearAllBlockReason({ configCorrupt: false, hasExplicitSaveFolder: false, hasPointer: true, libraryMissing: false })).toBe('lost');
  });

  test('新規インストール（フォルダも pointer も無し）は全消しを許す', () => {
    expect(clearAllBlockReason({ configCorrupt: false, hasExplicitSaveFolder: false, hasPointer: false, libraryMissing: false })).toBeNull();
  });

  test('破損は明示フォルダより優先する', () => {
    expect(clearAllBlockReason({ configCorrupt: true, hasExplicitSaveFolder: true, hasPointer: true, libraryMissing: false })).toBe('corrupt');
  });

  test('#37: 明示フォルダが実在しない（外部で移動/削除）と全消しを止める', () => {
    expect(clearAllBlockReason({ configCorrupt: false, hasExplicitSaveFolder: true, hasPointer: true, libraryMissing: true })).toBe('missing');
  });

  test('#37: missing は破損より後（破損の方が根が深い）', () => {
    expect(clearAllBlockReason({ configCorrupt: true, hasExplicitSaveFolder: true, hasPointer: true, libraryMissing: true })).toBe('corrupt');
  });
});

describe('libraryIsMissing (#37)', () => {
  test('明示フォルダが実在しない → missing', () => {
    expect(libraryIsMissing({ hasExplicitSaveFolder: true, folderExists: false })).toBe(true);
  });

  test('明示フォルダが実在する → missing ではない', () => {
    expect(libraryIsMissing({ hasExplicitSaveFolder: true, folderExists: true })).toBe(false);
  });

  test('フォルダを明示していない（既定値解決）は folderExists に関わらず missing ではない', () => {
    expect(libraryIsMissing({ hasExplicitSaveFolder: false, folderExists: false })).toBe(false);
    expect(libraryIsMissing({ hasExplicitSaveFolder: false, folderExists: true })).toBe(false);
  });
});
