// Unit test for validating the dev server URL (app/src/main/dev-server-guard.ts).
// Since the main window's preload exposes destructive IPC (delete everything,
// import, change the save destination), "what gets loaded" is a trust boundary
// in itself. Passing the ELECTRON_RENDERER_URL environment variable to loadURL
// without validation would hand that bridge to an external page just by
// rewriting the app's launch environment (#381). Pure logic = no Electron needed.

import { describe, expect, test } from 'vitest';
import { resolveDevServerUrl } from '../app/src/main/dev-server-guard';

const dev = (raw: string | undefined | null) => resolveDevServerUrl(raw, false);
const packaged = (raw: string | undefined | null) => resolveDevServerUrl(raw, true);

describe('配布版（app.isPackaged === true）', () => {
  // The acceptance criterion itself: even if a distributed build is launched
  // with a value equivalent to HOLOGRAM_DEV_SERVER=1 or with an external URL, it loads the bundled renderer
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
    // The shape Vite gives by default (with a trailing slash), and one with a subpath
    ['http://localhost:5173/', 'http://localhost:5173/'],
    ['http://localhost:5173/app/', 'http://localhost:5173/app/'],
    // Shorthand and hex notation that WHATWG URL normalizes also pass through as loopback
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

  // A value that isn't a URL. A boolean-looking value like `HOLOGRAM_DEV_SERVER=1`
  // also belongs here = "a value is set" is never interpreted as "a dev server exists"
  test.each(['1', 'true', 'まだ URL ではない'])('URL として壊れている %j', (raw) => {
    expect(dev(raw)).toEqual({ url: null, rejected: 'malformed' });
  });

  // Anything other than http: doesn't get through even if it's loopback (the
  // fail-closed boundary is closed by scheme first). The last one,
  // `localhost:5173`, is written without a scheme, and WHATWG URL interprets
  // it as "a URL with the scheme localhost:" = the hostname ends up empty, so it's rejected by the http: check first.
  test.each(['https://localhost:5173/', 'file:///C:/tmp/evil.html', 'data:text/html,<h1>x', 'ws://localhost:5173/', 'localhost:5173'])('http: ではない %j', (raw) => {
    expect(dev(raw)).toEqual({ url: null, rejected: 'not-http' });
  });

  // With credentials attached. The second case is crafted so "the hostname
  // looks like loopback" = the actual host is evil.example, and
  // localhost:5173 gets interpreted as a username and password
  test.each(['http://user:pass@localhost:5173/', 'http://localhost:5173@evil.example/'])('認証情報を含む %j', (raw) => {
    expect(dev(raw)).toEqual({ url: null, rejected: 'has-credentials' });
  });

  test.each([
    'http://evil.example/',
    'http://192.168.1.10:5173/',
    'http://10.0.0.1:5173/',
    // Shapes that fake being loopback via a prefix match or a suffix
    'http://localhost.evil.example/',
    'http://evil.example/localhost:5173',
    // Even within the loopback range (127.0.0.0/8), nothing but 127.0.0.1 gets through
    'http://127.0.0.2:5173/',
  ])('ループバックではない %j', (raw) => {
    expect(dev(raw)).toEqual({ url: null, rejected: 'not-loopback' });
  });
});
