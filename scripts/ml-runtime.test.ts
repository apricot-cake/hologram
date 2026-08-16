// ローカル推論ランタイム (#831) の単体側。本物のプロセス・本物のモデル・本物の .exe が要る部分
// は scripts/test-ml-runtime.cts の担当。ここで固定するのは、どのランタイムを使うかを決めるロジ
// ックと、WASM の側に読み込むものがあるかどうかを決める同梱の取り決め。
//
// 同梱についてのアサーションは飾りではない。パッケージ版の最初の WASM 実行は、ml-worker.ts が
// ONNX Runtime のある wasm バリアントを要求する一方で package.json は別のバリアントを同梱していたために失敗
// し、そのずれは `npm run dist` を通しで走らせない限りどこからも見えなかった。

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { asarUnpackedPath, chooseMlBackend, serializeMlResult } from '../app/src/main/lib-ml-protocol';

const appPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'package.json'), 'utf8'));
const workerSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'main', 'ml-worker.ts'), 'utf8');
const nativeLicenseDir = path.join(__dirname, '..', 'app', 'third-party-licenses');
const nativeNotice = fs.readFileSync(path.join(nativeLicenseDir, 'SHARP-LIBVIPS-NOTICE.md'), 'utf8');
const thirdPartyNotices = fs.readFileSync(path.join(__dirname, '..', 'docs', 'THIRD-PARTY-NOTICES.md'), 'utf8');

describe('chooseMlBackend', () => {
  test('ネイティブが読めたら onnxruntime-node', () => {
    expect(chooseMlBackend({ forceWasm: false, nativeError: null })).toEqual({ backend: 'onnxruntime-node', nativeError: null, forced: false });
  });

  test('ネイティブが落ちたら WASM へ落ち、理由を持ち回る（黙って落ちない）', () => {
    const c = chooseMlBackend({ forceWasm: false, nativeError: 'The specified module could not be found.' });
    expect(c.backend).toBe('onnxruntime-web-wasm');
    expect(c.forced).toBe(false);
    expect(c.nativeError).toMatch(/could not be found/);
  });

  test('強制 WASM は「落ちた」と区別できる＝forced が立ち nativeError は空', () => {
    const c = chooseMlBackend({ forceWasm: true, nativeError: null });
    expect(c).toEqual({ backend: 'onnxruntime-web-wasm', nativeError: null, forced: true });
  });
});

describe('asarUnpackedPath', () => {
  test('app.asar の中を指すパスは app.asar.unpacked へ向け直す', () => {
    expect(asarUnpackedPath(String.raw`C:\app\resources\app.asar\node_modules\onnxruntime-web\dist\x.wasm`)).toBe(String.raw`C:\app\resources\app.asar.unpacked\node_modules\onnxruntime-web\dist\x.wasm`);
  });

  test('asar を通らない開発ツリーのパスはそのまま', () => {
    const p = String.raw`C:\repo\node_modules\onnxruntime-web\dist\x.wasm`;
    expect(asarUnpackedPath(p)).toBe(p);
  });
});

describe('serializeMlResult', () => {
  test('テンソルは dims ごと素の配列になる（構造化クローンは prototype を落とす）', () => {
    class FakeTensor {
      type = 'float32';
      dims = [1, 3];
      data = new Float32Array([1, 2, 3]);
    }
    expect(serializeMlResult(new FakeTensor())).toEqual({ __mlTensor: true, type: 'float32', dims: [1, 3], data: [1, 2, 3] });
  });

  test('分類結果のような素のオブジェクト・配列はそのまま通す', () => {
    expect(serializeMlResult([{ label: 'a', score: 0.5 }])).toEqual([{ label: 'a', score: 0.5 }]);
  });

  test('入れ子のテンソルも変換される', () => {
    const out = serializeMlResult({ pooled: { type: 'float32', dims: [2], data: new Float32Array([4, 5]) } });
    expect(out.pooled).toEqual({ __mlTensor: true, type: 'float32', dims: [2], data: [4, 5] });
  });
});

describe('配布物の中身（app/package.json の build）', () => {
  const files: string[] = appPkg.build.files;
  const asarUnpack: string[] = appPkg.build.asarUnpack;

  test('ml-worker が名指しする wasm バリアントが files に入っている', () => {
    // どちらの側もリテラルではなくソースから取る。片方だけバリアントを改名したら、dist/ ではなくここ
    // で落ちる。
    const named = [...workerSrc.matchAll(/ort-wasm-simd-threaded\.[\w.]+?\.(?:mjs|wasm)/g)].map((m) => m[0]);
    expect(named.length).toBeGreaterThan(0);
    for (const f of new Set(named)) {
      expect(files, `${f} は worker が読むのに files に無い`).toContain(`**/node_modules/onnxruntime-web/dist/${f}`);
    }
  });

  test('onnxruntime-web の dist は名指ししたファイル以外を落とす（125MB を丸ごと積まない）', () => {
    expect(files).toContain('!**/node_modules/onnxruntime-web/dist/**');
  });

  test('onnxruntime-node のプリビルドは win32-x64 だけ', () => {
    for (const excluded of ['darwin', 'linux']) {
      expect(files).toContain(`!**/node_modules/onnxruntime-node/bin/napi-v6/${excluded}/**`);
    }
    expect(files).toContain('!**/node_modules/onnxruntime-node/bin/napi-v6/win32/arm64/**');
    expect(files.some((f) => /^!.*onnxruntime-node\/bin\/napi-v6\/win32\/x64/.test(f))).toBe(false);
  });

  test('ネイティブを持つパッケージは asar の外へ出す（asar 内の .node と .wasm は開けない）', () => {
    for (const pkg of ['onnxruntime-node', 'onnxruntime-web/dist', 'sharp', '@img']) {
      expect(asarUnpack.some((p) => p.includes(pkg))).toBe(true);
    }
  });

  test('sharp/libvips の LGPL 通知とライセンス本文を配布物へ入れる', () => {
    expect(appPkg.build.extraResources).toContainEqual({ from: 'third-party-licenses', to: 'licenses' });
    expect(fs.readFileSync(path.join(nativeLicenseDir, 'LGPL-3.0.txt'), 'utf8')).toContain('GNU LESSER GENERAL PUBLIC LICENSE');
    expect(fs.readFileSync(path.join(nativeLicenseDir, 'GPL-3.0.txt'), 'utf8')).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(nativeNotice).toContain('@img/sharp-win32-x64');
    expect(nativeNotice).toContain('0.34.5');
    expect(nativeNotice).toContain('libvips-42.dll');
    expect(nativeNotice).toContain('app.asar.unpacked');
    expect(nativeNotice).toContain('https://github.com/lovell/sharp-libvips/tree/v8.17.3');
    expect(thirdPartyNotices).toContain('Native libraries in the Windows desktop app');
  });
});
