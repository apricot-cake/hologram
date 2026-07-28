// 開発サーバー URL の検証（app/src/main/dev-server-guard.ts）のユニットテスト。
// メインウィンドウの preload は破壊的な IPC（全削除・インポート・保存先の変更）を
// 公開するので、「どこを読み込むか」は信頼境界そのもの。環境変数
// ELECTRON_RENDERER_URL を無検証で loadURL へ渡すと、アプリの起動環境を書き換え
// られるだけでその橋を外部ページへ渡せてしまう（#381）。純ロジック＝Electron 不要。

import { describe, expect, test } from 'vitest';
import { resolveDevServerUrl } from '../app/src/main/dev-server-guard';

const dev = (raw: string | undefined | null) => resolveDevServerUrl(raw, false);
const packaged = (raw: string | undefined | null) => resolveDevServerUrl(raw, true);

describe('配布版（app.isPackaged === true）', () => {
  // 受け入れ条件そのもの: 配布物を HOLOGRAM_DEV_SERVER=1 相当の値や外部 URL 付きで
  // 起動しても、同梱レンダラーを読む
  test.each(['1', 'http://localhost:5173', 'http://evil.example/', ''])('値 %j にかかわらず読み込まない', (raw) => {
    expect(packaged(raw)).toEqual({ url: null, rejected: 'packaged' });
  });

  test('未設定でも同じ（判定は値より前に打ち切る）', () => {
    expect(packaged(undefined)).toEqual({ url: null, rejected: 'packaged' });
  });
});

describe('開発時に許可するもの', () => {
  test.each([
    ['http://localhost:5173', 'http://localhost:5173/'],
    ['http://127.0.0.1:5173', 'http://127.0.0.1:5173/'],
    ['http://[::1]:5173', 'http://[::1]:5173/'],
    // Vite が既定で出す形（末尾スラッシュ付き）とサブパス付き
    ['http://localhost:5173/', 'http://localhost:5173/'],
    ['http://localhost:5173/app/', 'http://localhost:5173/app/'],
    // WHATWG URL が正規化する短縮表記・16進表記もループバックとして通る
    ['http://127.1:5173', 'http://127.0.0.1:5173/'],
    ['http://0x7f.0.0.1:5173', 'http://127.0.0.1:5173/'],
  ])('%s は正規化した %s を返す', (raw, href) => {
    expect(dev(raw)).toEqual({ url: href, rejected: null });
  });
});

describe('開発時でも拒否するもの', () => {
  test('未設定は拒否ではなく通常経路（配布版と同じく同梱レンダラー）', () => {
    expect(dev(undefined)).toEqual({ url: null, rejected: 'unset' });
    expect(dev('')).toEqual({ url: null, rejected: 'unset' });
  });

  // URL でない値。`HOLOGRAM_DEV_SERVER=1` のような真偽値のつもりの指定もここ＝
  // 「値が入っている＝開発サーバーがある」とは解釈しない
  test.each(['1', 'true', 'localhost:5173', 'まだ URL ではない'])('URL として壊れている %j', (raw) => {
    expect(dev(raw)).toEqual({ url: null, rejected: 'malformed' });
  });

  // http: 以外は、ループバックであっても通さない（fail-closed の境界を
  // スキームで先に閉じる）
  test.each(['https://localhost:5173/', 'file:///C:/tmp/evil.html', 'data:text/html,<h1>x', 'ws://localhost:5173/'])('http: ではない %j', (raw) => {
    expect(dev(raw)).toEqual({ url: null, rejected: 'not-http' });
  });

  // 認証情報付き。2件目は「ホスト名がループバックに見える」細工＝実際のホストは
  // evil.example で、localhost:5173 はユーザー名とパスワードとして解釈される
  test.each(['http://user:pass@localhost:5173/', 'http://localhost:5173@evil.example/'])('認証情報を含む %j', (raw) => {
    expect(dev(raw)).toEqual({ url: null, rejected: 'has-credentials' });
  });

  test.each([
    'http://evil.example/',
    'http://192.168.1.10:5173/',
    'http://10.0.0.1:5173/',
    // 前方一致・サフィックスでループバックに見せかける形
    'http://localhost.evil.example/',
    'http://evil.example/localhost:5173',
    // ループバック帯（127.0.0.0/8）でも 127.0.0.1 以外は通さない
    'http://127.0.0.2:5173/',
  ])('ループバックではない %j', (raw) => {
    expect(dev(raw)).toEqual({ url: null, rejected: 'not-loopback' });
  });
});
