// Unit tests for app/src/main/lib-model-registry.ts (#832, parent #98): the
// pure data + path helpers the fetch/manager layers build on.
//
// The cross-check against test-ml-runtime.cts matters on its own: that script
// cannot import this ESM module (it runs as a standalone CJS/.cts harness, see
// its own header comment), so it keeps an independent copy of the same
// id/rev/files. Nothing stops the two from drifting except this test.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { MODEL_REGISTRY, findModelEntry, modelDirFor, modelFileUrl } from '../app/src/main/lib-model-registry';

describe('findModelEntry', () => {
  test('id で引ける', () => {
    expect(findModelEntry('Xenova/all-MiniLM-L6-v2')?.rev).toBe('751bff37182d3f1213fa05d7196b954e230abad9');
  });

  test('無い id は undefined', () => {
    expect(findModelEntry('nope/nope')).toBeUndefined();
  });
});

describe('modelDirFor', () => {
  test('"<org>/<name>@<rev>" に分かれる（Hugging Face 側のディレクトリ形に合わせる）', () => {
    const entry = { id: 'Xenova/all-MiniLM-L6-v2', rev: 'abc123' };
    expect(modelDirFor(entry, '/root')).toBe(path.join('/root', 'Xenova', 'all-MiniLM-L6-v2@abc123'));
  });
});

describe('modelFileUrl', () => {
  test('huggingface.co の resolve URL を組み立てる', () => {
    const entry = { id: 'Xenova/all-MiniLM-L6-v2', rev: 'abc123' };
    expect(modelFileUrl(entry, { path: 'onnx/model_quantized.onnx' })).toBe('https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/abc123/onnx/model_quantized.onnx');
  });
});

describe('レジストリの値そのもの', () => {
  test('各ファイルの sha256 は64桁の16進文字列', () => {
    for (const entry of MODEL_REGISTRY) {
      for (const f of entry.files) {
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  test('rev はコミットハッシュの見た目（40桁の16進）＝タグやブランチ名でない', () => {
    for (const entry of MODEL_REGISTRY) {
      expect(entry.rev).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  test('licenseNote が空でない（設定「AI機能」ページと THIRD-PARTY-NOTICES.md の表示元）', () => {
    for (const entry of MODEL_REGISTRY) {
      expect(entry.licenseNote.length).toBeGreaterThan(0);
    }
  });
});

describe('scripts/test-ml-runtime.cts の埋め込みコピーとの一致', () => {
  const src = fs.readFileSync(path.join(__dirname, 'test-ml-runtime.cts'), 'utf8');
  const repo = /const MODEL_REPO = '([^']+)'/.exec(src)?.[1];
  const rev = /const MODEL_REV = '([^']+)'/.exec(src)?.[1];
  const filesMatch = /const MODEL_FILES = \[([^\]]+)\]/.exec(src)?.[1];
  const files = filesMatch ? [...filesMatch.matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];

  test('id・rev・files の並びが一致する', () => {
    const entry = findModelEntry(repo ?? '');
    expect(entry, `test-ml-runtime.cts の MODEL_REPO='${repo}' がレジストリに無い`).toBeDefined();
    expect(entry?.rev).toBe(rev);
    expect(entry?.files.map((f) => f.path)).toEqual(files);
  });
});

describe('THIRD-PARTY-NOTICES.md との一致', () => {
  const notices = fs.readFileSync(path.join(__dirname, '..', 'THIRD-PARTY-NOTICES.md'), 'utf8');

  test('レジストリの各モデルの id と licenseNote が配布物の表記に載っている', () => {
    for (const entry of MODEL_REGISTRY) {
      expect(notices, `${entry.id} の id が THIRD-PARTY-NOTICES.md に無い`).toContain(entry.id);
      expect(notices, `${entry.id} の licenseNote が THIRD-PARTY-NOTICES.md に無い`).toContain(entry.licenseNote);
    }
  });
});
