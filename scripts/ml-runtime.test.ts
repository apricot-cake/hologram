// Unit side of the local inference runtime (#831). The parts that need a real
// process, a real model and a real .exe are scripts/test-ml-runtime.cts; what is
// pinned here is the logic that decides WHICH runtime is used and the packaging
// contract that decides whether the WASM one has anything to load.
//
// The packaging assertions are not decoration: the packaged build's first WASM
// run failed because ml-worker.ts asked for one ONNX Runtime wasm variant while
// package.json shipped another, and nothing outside a full `npm run dist` could
// see the mismatch.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { asarUnpackedPath, chooseMlBackend, serializeMlResult } from '../app/src/main/lib-ml-protocol';

const appPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'package.json'), 'utf8'));
const workerSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'main', 'ml-worker.ts'), 'utf8');

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

  test('ml-worker が名指しする wasm 変種が files に入っている', () => {
    // Both halves come from the source rather than a literal, so renaming the
    // variant in one place and not the other fails here instead of in dist/.
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
});
