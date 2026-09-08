// dev サーバー URL の検証（app/src/main/dev-server-guard.ts）の単体テスト。
// メインウィンドウの preload は破壊的な IPC（全削除・取り込み・保存先の変更）を露出する
// ので、「何を読み込むか」それ自体が信頼の境界になる。ELECTRON_RENDERER_URL 環境変数を
// 検証せずに loadURL へ渡すと、アプリの起動環境を書き換えるだけで、そのブリッジを外部の
// ページへ明け渡すことになる (#381)。純粋なロジックなので Electron は要らない。

import { describe, expect, test } from 'vitest';
import { resolveDevServerUrl } from './dev-server-guard';

const dev = (raw: string | undefined | null) => resolveDevServerUrl(raw, false);
const packaged = (raw: string | undefined | null) => resolveDevServerUrl(raw, true);

describe('配布版（app.isPackaged === true）', () => {
  // 受け入れ条件そのもの。配布版を HOLOGRAM_DEV_SERVER=1 相当の値や外部の URL で起動しても、
  // 同梱のレンダラーを読み込む
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
    // Vite が既定で出す形（末尾にスラッシュ）と、サブパス付きのもの
    ['http://localhost:5173/', 'http://localhost:5173/'],
    ['http://localhost:5173/app/', 'http://localhost:5173/app/'],
    // WHATWG URL が正規化する短縮表記・16進表記も、ループバックとして通る
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

  // URL ではない値。`HOLOGRAM_DEV_SERVER=1` のような真偽値めいた値もここに入る＝
  // 「値が入っている」を「dev サーバーがある」と読み替えることは一切しない
  test.each(['1', 'true', 'まだ URL ではない'])('URL として壊れている %j', (raw) => {
    expect(dev(raw)).toEqual({ url: null, rejected: 'malformed' });
  });

  // http: 以外はループバックでも通らない（fail-closed の境界は、まずスキームで閉じる）。
  // 最後の `localhost:5173` はスキームを書いていないので、WHATWG URL はこれを
  // 「スキームが localhost: の URL」と読む＝ホスト名が空になり、先に http: の判定で弾かれる。
  test.each(['https://localhost:5173/', 'file:///C:/tmp/evil.html', 'data:text/html,<h1>x', 'ws://localhost:5173/', 'localhost:5173'])('http: ではない %j', (raw) => {
    expect(dev(raw)).toEqual({ url: null, rejected: 'not-http' });
  });

  // 認証情報が付いている場合。2つ目は「ホスト名がループバックに見える」ように作ってある＝
  // 実際のホストは evil.example で、localhost:5173 はユーザー名とパスワードとして読まれる
  test.each(['http://user:pass@localhost:5173/', 'http://localhost:5173@evil.example/'])('認証情報を含む %j', (raw) => {
    expect(dev(raw)).toEqual({ url: null, rejected: 'has-credentials' });
  });

  test.each([
    'http://evil.example/',
    'http://192.168.1.10:5173/',
    'http://10.0.0.1:5173/',
    // 前方一致や接尾辞でループバックに見せかける形
    'http://localhost.evil.example/',
    'http://evil.example/localhost:5173',
    // ループバックの範囲 (127.0.0.0/8) の中でも、127.0.0.1 以外は通さない
    'http://127.0.0.2:5173/',
  ])('ループバックではない %j', (raw) => {
    expect(dev(raw)).toEqual({ url: null, rejected: 'not-loopback' });
  });
});
