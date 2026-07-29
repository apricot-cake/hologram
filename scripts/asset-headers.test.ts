// asset:// 応答が必ず載せるセキュリティヘッダ（app/src/main/asset-headers.ts, #215）の
// ユニットテスト。純ロジック＝Electron 不要。ここで賭かっているのは「送っている文字列が
// スクリプトを許していないこと」で、Chromium が実際にそれを守るかは実 Electron 側
// （scripts/test-app-asset-csp.cts）の担当。
//
// CSP は「ディレクティブが在ること」ではなく「script が落ちること」で見る＝
// default-src 'none' に script-src のフォールバックが効いている状態を、後から
// 誰かが script-src を足して緩めた時に落ちる形で固定する。

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
