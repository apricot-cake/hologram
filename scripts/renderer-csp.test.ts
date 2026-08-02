// レンダラ文書の CSP（app/src/main/renderer-csp.ts、#7）の単体テスト。
// asset-headers.test.ts と同じ立て付け＝「送っている文字列が何を許すか」までで、
// Chromium が実際に強制するかは実機側（scripts/test-app-renderer-origin.cts）。

import { describe, expect, test } from 'vitest';
import { DEV_CSP_NONCE, DEV_RENDERER_CSP, RENDERER_CSP, rendererSecurityHeaders } from '../app/src/main/renderer-csp';

const directive = (csp: string, name: string) =>
  csp
    .split(';')
    .map((s) => s.trim())
    .find((s) => s === name || s.startsWith(`${name} `));

describe('RENDERER_CSP（製品版）', () => {
  test('frame-ancestors none＝#683 が配信路の無さで見送った1本（<meta> では無視される）', () => {
    expect(directive(RENDERER_CSP, 'frame-ancestors')).toBe("frame-ancestors 'none'");
  });

  test("既定は 'self'＝app://bundle 以外からは何も来ない", () => {
    expect(directive(RENDERER_CSP, 'default-src')).toBe("default-src 'self'");
    expect(directive(RENDERER_CSP, 'script-src')).toBe("script-src 'self'");
    expect(directive(RENDERER_CSP, 'object-src')).toBe("object-src 'none'");
    expect(directive(RENDERER_CSP, 'base-uri')).toBe("base-uri 'none'");
    expect(directive(RENDERER_CSP, 'form-action')).toBe("form-action 'none'");
  });

  test('connect-src に asset: を入れない＝ライブラリのバイト列は IPC 越しだけ（ADR 0012）', () => {
    expect(directive(RENDERER_CSP, 'connect-src')).toBe("connect-src 'self' data:");
    expect(directive(RENDERER_CSP, 'connect-src')).not.toContain('asset:');
  });

  test('asset: を許すのは絵と動画の読み込みだけ', () => {
    expect(directive(RENDERER_CSP, 'img-src')).toBe("img-src 'self' asset: data: blob:");
    expect(directive(RENDERER_CSP, 'media-src')).toBe("media-src 'self' asset: blob:");
  });

  test('unsafe-inline は style だけ（React の style={{…}}）／eval は許さない', () => {
    const inline = RENDERER_CSP.split(';')
      .map((s) => s.trim())
      .filter((s) => s.includes("'unsafe-inline'"));
    expect(inline).toEqual(["style-src 'self' 'unsafe-inline'"]);
    expect(RENDERER_CSP).not.toContain('unsafe-eval');
  });

  test('nonce は製品版のポリシーに出てこない（dev 限定の逃がし道）', () => {
    expect(RENDERER_CSP).not.toContain('nonce');
  });
});

describe('DEV_RENDERER_CSP（dev サーバーへ載せる方）', () => {
  test('script-src 以外は製品版と1文字も違わない＝違反が prod でだけ出る状態を作らない', () => {
    const strip = (csp: string) => csp.replace(/script-src[^;]*/, 'script-src X');
    expect(strip(DEV_RENDERER_CSP)).toBe(strip(RENDERER_CSP));
  });

  test('Vite が出すタグだけを nonce で通す＝script-src を unsafe-inline へ倒さない', () => {
    expect(directive(DEV_RENDERER_CSP, 'script-src')).toBe(`script-src 'self' 'nonce-${DEV_CSP_NONCE}'`);
    expect(directive(DEV_RENDERER_CSP, 'script-src')).not.toContain('unsafe-inline');
  });
});

describe('rendererSecurityHeaders', () => {
  test('nosniff＝拡張子から決めた content-type を読み替えさせない', () => {
    expect(rendererSecurityHeaders()['x-content-type-options']).toBe('nosniff');
    expect(rendererSecurityHeaders()['content-security-policy']).toBe(RENDERER_CSP);
  });

  test('呼ぶたびに新しいオブジェクト＝呼び出し側が spread で足しても共有物を汚さない', () => {
    const a = rendererSecurityHeaders();
    a['content-type'] = 'text/html';
    expect(rendererSecurityHeaders()['content-type']).toBeUndefined();
  });
});
