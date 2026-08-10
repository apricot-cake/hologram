// すべての asset:// 応答が載せなければならないセキュリティヘッダ
// （app/src/main/asset-headers.ts, #215）の単体テスト。純粋なロジックなので Electron は要らない。
// ここで賭けているのは「送っている文字列が script を許していない」ことだけ＝Chromium が
// 実際にそれを守るかどうかは実 Electron 側（scripts/test-app-asset-csp.cts）の担当。
//
// CSP は「ディレクティブがあるか」ではなく「script が実際に落ちるか」で見る＝
// default-src 'none' へのフォールバックが script-src を覆っている状態を固定するので、
// 後から script-src を足して緩めると落ちる。

import { describe, expect, test } from 'vitest';
import { assetSecurityHeaders } from '../app/src/main/asset-headers';

const csp = () => assetSecurityHeaders()['content-security-policy'] as string;
const directive = (name: string) =>
  csp()
    .split(';')
    .map((s) => s.trim())
    .find((s) => s === name || s.startsWith(`${name} `));

describe('assetSecurityHeaders（CSP）', () => {
  test("既定は default-src 'none'＝挙げていないものは全部落ちる", () => {
    expect(directive('default-src')).toBe("default-src 'none'");
  });

  test('script を許すディレクティブが一つも無い（default-src へのフォールバックを塞がない）', () => {
    for (const d of ['script-src', 'script-src-elem', 'script-src-attr']) expect(directive(d)).toBeUndefined();
  });

  test('unsafe-inline を許すのは style だけ（インライン CSS は SVG の見た目に要る／script には効かせない）', () => {
    const inline = csp()
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.includes("'unsafe-inline'"));
    expect(inline).toEqual(["style-src 'unsafe-inline'"]);
  });

  test('eval も許さない', () => {
    expect(csp()).not.toContain('unsafe-eval');
  });

  test('外への通信路が開いていない＝connect/frame/form/base はどれも default-src へ落ちるか none', () => {
    for (const d of ['connect-src', 'child-src', 'worker-src', 'object-src']) expect(directive(d)).toBeUndefined();
    expect(directive('form-action')).toBe("form-action 'none'");
    expect(directive('base-uri')).toBe("base-uri 'none'");
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
  });

  test('画像・動画・フォントは自分自身と data:/blob: に限って許す（絵として成立させるための最小）', () => {
    expect(directive('img-src')).toBe("img-src 'self' data: blob:");
    expect(directive('media-src')).toBe("media-src 'self' blob:");
    expect(directive('font-src')).toBe('font-src data:');
  });
});

describe('assetSecurityHeaders（その他）', () => {
  test('nosniff＝拡張子から決めた content-type を Chromium に読み替えさせない', () => {
    expect(assetSecurityHeaders()['x-content-type-options']).toBe('nosniff');
  });

  test('呼ぶたびに新しいオブジェクト＝呼び出し側が spread で足しても共有物を汚さない', () => {
    const a = assetSecurityHeaders();
    a['content-type'] = 'image/png';
    expect(assetSecurityHeaders()['content-type']).toBeUndefined();
  });
});
