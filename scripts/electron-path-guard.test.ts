// Unit test for the real-Electron launch harness's build-artifact check
// (scripts/lib-electron-path.cts). If you spawn `electron .` in a work tree
// with no build artifacts, Electron itself brings an OS modal to the front, and
// it keeps appearing once per launched case, stealing the user's input (this
// actually happened on 2026-07-28). This guard (#460) stops it before spawning.
// The judgment part has no side effects = it can be verified without spinning
// up Electron or any temporary process.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { appEntryPath, buildArtifactError } from './lib-electron-path.cts';

let root: string;

// Builds the same shape as the real app/ (package.json's main points at a build artifact) under temp
const makeAppDir = (name: string, main?: string | number) => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  if (main !== undefined) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'hologram-app-fixture', main }));
  return dir;
};

const writeEntry = (dir: string, rel: string) => {
  const file = path.resolve(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '// built main entry');
  return file;
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-electron-path-'));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('appEntryPath', () => {
  test('package.json の main を絶対パスに解決する', () => {
    const dir = makeAppDir('resolves', './out/main/index.js');
    expect(appEntryPath(dir)).toBe(path.resolve(dir, 'out/main/index.js'));
  });

  // Since the main value isn't hardcoded and is read from package.json, it tracks changes to the output location
  test('main が既定と違ってもその値に従う', () => {
    const dir = makeAppDir('custom-main', './dist/electron/main.js');
    expect(appEntryPath(dir)).toBe(path.resolve(dir, 'dist/electron/main.js'));
  });

  test.each([
    ['package.json が無い', undefined],
    ['main が空', ''],
    ['main が文字列でない', 42],
  ])('%s なら既定の場所を報告する（読めないことを理由に素通ししない）', (_label, main) => {
    const dir = makeAppDir(`fallback-${String(main)}`, main);
    expect(appEntryPath(dir)).toBe(path.resolve(dir, 'out/main/index.js'));
  });
});

describe('buildArtifactError', () => {
  test('ビルド済みなら null（成果物のある作業ツリーでは何も変わらない）', () => {
    const dir = makeAppDir('built', './out/main/index.js');
    writeEntry(dir, 'out/main/index.js');
    expect(buildArtifactError(dir)).toBeNull();
  });

  test('成果物が無ければ、通すべきコマンドと欠けているパスを返す', () => {
    const dir = makeAppDir('unbuilt', './out/main/index.js');
    const message = buildArtifactError(dir);
    expect(message).toContain('npm run build --workspace=app');
    expect(message).toContain(path.resolve(dir, 'out/main/index.js'));
  });

  // app/out doesn't exist at all = the initial state of a fresh work tree. If this doesn't stop it, the harness pops a modal per case.
  test('out/ ディレクトリごと無い場合も止める', () => {
    const dir = makeAppDir('no-out-dir', './out/main/index.js');
    expect(buildArtifactError(dir)).not.toBeNull();
  });

  // Partial builds, like where only main exists but with different contents, are out of scope = only an existence check is done
  test('main が別の場所を指していればそちらを見る', () => {
    const dir = makeAppDir('custom-built', './dist/electron/main.js');
    expect(buildArtifactError(dir)).not.toBeNull();
    writeEntry(dir, 'dist/electron/main.js');
    expect(buildArtifactError(dir)).toBeNull();
  });
});
