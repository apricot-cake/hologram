// app:// のアドレスとファイル関門（app/src/main/renderer-files.ts、#7）の単体テスト。
// Electron 抜きで測れるのはここまで＝「文字列としてどこを指すか」で、Chromium が
// 実際にその通り扱うか（module script の MIME 判定・オリジン）は実機側
// scripts/test-app-renderer-origin.cts の担当。

import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { APP_INDEX_URL, appIndexUrl, isAppRendererUrl, mimeForBundleFile, resolveInRenderer } from '../app/src/main/renderer-files';

const root = path.resolve(path.join('C:', 'tree', 'app', 'out', 'renderer'));

describe('resolveInRenderer（ルート外へ出さない）', () => {
  test('普通のバンドル資産はルート内の絶対パスになる', () => {
    expect(resolveInRenderer(root, '/index.html')).toBe(path.join(root, 'index.html'));
    expect(resolveInRenderer(root, '/assets/index-abc123.js')).toBe(path.join(root, 'assets', 'index-abc123.js'));
  });

  test('パーセントエンコードされた .. は展開後に弾かれる（Chromium の正規化を通り抜けるのはこの形）', () => {
    expect(resolveInRenderer(root, '/%2e%2e/%2e%2e/secret.txt')).toBeNull();
    expect(resolveInRenderer(root, '/assets/%2e%2e%2f%2e%2e%2fsecret.txt')).toBeNull();
  });

  test('生の .. も弾く（ハンドラの手前を信用しない）', () => {
    expect(resolveInRenderer(root, '/../index.html')).toBeNull();
    expect(resolveInRenderer(root, '/a/../../index.html')).toBeNull();
  });

  test('絶対パス・ドライブレターは root を無視させない', () => {
    expect(resolveInRenderer(root, '/C:/Windows/win.ini')).toBeNull();
    // 先頭スラッシュは剥がすので UNC にはならない＝root の中の（存在しない）パスに落ちる。
    expect(resolveInRenderer(root, '//server/share/x.js')).toBe(path.join(root, 'server', 'share', 'x.js'));
  });

  test('空パスと壊れたエンコードは null', () => {
    expect(resolveInRenderer(root, '/')).toBeNull();
    expect(resolveInRenderer(root, '')).toBeNull();
    expect(resolveInRenderer(root, '/%')).toBeNull();
  });
});

describe('mimeForBundleFile', () => {
  test('module script は JavaScript の型で返す（違うと描画側が丸ごと死ぬ）', () => {
    expect(mimeForBundleFile('index-abc.js')).toBe('text/javascript');
    expect(mimeForBundleFile('index.html')).toBe('text/html');
    expect(mimeForBundleFile('index-abc.css')).toBe('text/css');
    expect(mimeForBundleFile('geist-latin.woff2')).toBe('font/woff2');
  });

  test('知らない拡張子は推測しない＝null（nosniff と組で「読めない」に倒す）', () => {
    expect(mimeForBundleFile('hologram.db')).toBeNull();
    expect(mimeForBundleFile('LICENSE')).toBeNull();
    expect(mimeForBundleFile('')).toBeNull();
  });
});

describe('レンダラの入口 URL', () => {
  test('入口だけが真＝スキームを丸ごと通さない', () => {
    expect(isAppRendererUrl(new URL(APP_INDEX_URL))).toBe(true);
    expect(isAppRendererUrl(new URL(`${APP_INDEX_URL}?theme=dark#x`))).toBe(true);
    expect(isAppRendererUrl(new URL('app://bundle/other.html'))).toBe(false);
    expect(isAppRendererUrl(new URL('app://bundle/assets/index.js'))).toBe(false);
    expect(isAppRendererUrl(new URL('app://elsewhere/index.html'))).toBe(false);
    expect(isAppRendererUrl(new URL('asset://img/a.png'))).toBe(false);
  });

  test('起動クエリはクエリ欄に載る（テーマは初回描画前に読まれる）', () => {
    expect(appIndexUrl({ theme: 'dark' })).toBe('app://bundle/index.html?theme=dark');
    expect(appIndexUrl({ theme: 'auto', smoke: '1' })).toBe('app://bundle/index.html?theme=auto&smoke=1');
    expect(isAppRendererUrl(new URL(appIndexUrl({ theme: 'auto' })))).toBe(true);
  });
});
