// 保存フォルダのクラウド同期検出（app/src/main/save-folder-guard.ts, #95）の
// ユニットテスト。純ロジック＝Electron 不要。検出は警告を出すだけなので、求める水準は
// 「既定のインストール配置を捉える」ことと「普通のフォルダでは黙っている」ことの2点。

import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { cloudSyncProviderOf } from '../app/src/main/save-folder-guard';

// win32 でも posix でも意味を持つよう、プラットフォーム native なパスで組む
const home = path.resolve(path.sep === '\\' ? 'C:\\Users\\alice' : '/home/alice');
const at = (...seg: string[]) => path.join(home, ...seg);
const NO_ENV = {};

describe('検出できるプロバイダ', () => {
  test('OneDrive 個人（既定の配置）', () => {
    expect(cloudSyncProviderOf(at('OneDrive', 'Hologram-library'), NO_ENV)).toBe('OneDrive');
  });

  test('OneDrive 職場・学校（OneDrive - テナント名）', () => {
    expect(cloudSyncProviderOf(at('OneDrive - Contoso Ltd', 'pics'), NO_ENV)).toBe('OneDrive');
  });

  test('Dropbox（素の名前と接尾辞つき）', () => {
    expect(cloudSyncProviderOf(at('Dropbox', 'Hologram-library'), NO_ENV)).toBe('Dropbox');
    expect(cloudSyncProviderOf(at('Dropbox (Personal)', 'lib'), NO_ENV)).toBe('Dropbox');
  });

  test('Google Drive（My Drive マウント込み）', () => {
    expect(cloudSyncProviderOf(at('Google Drive', 'lib'), NO_ENV)).toBe('Google Drive');
    expect(cloudSyncProviderOf(at('Google Drive', 'My Drive', 'lib'), NO_ENV)).toBe('Google Drive');
  });

  test('iCloud Drive', () => {
    expect(cloudSyncProviderOf(at('iCloudDrive', 'lib'), NO_ENV)).toBe('iCloud Drive');
  });

  test('Nextcloud / ownCloud', () => {
    expect(cloudSyncProviderOf(at('Nextcloud', 'lib'), NO_ENV)).toBe('Nextcloud');
    expect(cloudSyncProviderOf(at('ownCloud', 'lib'), NO_ENV)).toBe('ownCloud');
  });

  test('大小文字は区別しない', () => {
    expect(cloudSyncProviderOf(at('ONEDRIVE', 'lib'), NO_ENV)).toBe('OneDrive');
    expect(cloudSyncProviderOf(at('dropbox', 'lib'), NO_ENV)).toBe('Dropbox');
  });

  test('同期ルートはパスのどこにあっても効く（末端だけではない）', () => {
    expect(cloudSyncProviderOf(at('Dropbox', 'a', 'b', 'c', 'Hologram-library'), NO_ENV)).toBe('Dropbox');
  });
});

// 名前を変えた OneDrive フォルダでも %OneDrive% は出ている
describe('環境変数からの検出', () => {
  test('フォルダ名が手がかりにならなくても env のルートで当たる', () => {
    const root = at('CloudStuff');
    expect(cloudSyncProviderOf(path.join(root, 'lib'), { OneDrive: root })).toBe('OneDrive');
  });

  test('ルートそのものにも当たる', () => {
    const root = at('CloudStuff');
    expect(cloudSyncProviderOf(root, { OneDrive: root })).toBe('OneDrive');
  });

  test('別の場所を指す env 変数では当たらない', () => {
    expect(cloudSyncProviderOf(at('Hologram', 'library'), { OneDrive: at('CloudStuff') })).toBeNull();
  });

  test('空・空白だけの env 変数は無視する', () => {
    expect(cloudSyncProviderOf(at('Hologram', 'library'), { OneDrive: '' })).toBeNull();
    expect(cloudSyncProviderOf(at('Hologram', 'library'), { OneDrive: '   ' })).toBeNull();
  });
});

// 誤検出こそがここでのコスト
describe('普通のフォルダでは黙る', () => {
  test('既定のライブラリ位置', () => {
    expect(cloudSyncProviderOf(at('Hologram', 'library'), NO_ENV)).toBeNull();
  });

  test.each([[at('Projects', 'dropbox-clone', 'lib')], [at('my-onedrive-backup', 'lib')], [at('Pictures', 'GoogleDriveExports')]])('紛らわしい部分文字列では反応しない（セグメント一致であって部分文字列一致ではない）: %s', (p) => {
    expect(cloudSyncProviderOf(p, NO_ENV)).toBeNull();
  });

  test.each(['Box', 'Sync', 'Mega'])('ありふれた単独名は黙る: %s', (name) => {
    expect(cloudSyncProviderOf(at(name, 'lib'), NO_ENV)).toBeNull();
  });

  test('…ただし修飾された形は本物の同期ルート', () => {
    expect(cloudSyncProviderOf(at('Box Sync', 'lib'), NO_ENV)).toBe('Box');
    expect(cloudSyncProviderOf(at('MEGAsync', 'lib'), NO_ENV)).toBe('MEGA');
  });
});

describe('壊れた入力', () => {
  test.each([['', '   ', null, undefined, 42]].flat())('null を返し、throw しない: %s', (v) => {
    expect(cloudSyncProviderOf(v, NO_ENV)).toBeNull();
  });
});
