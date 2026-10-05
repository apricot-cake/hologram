// 実 Electron を起動するハーネスの、ビルド成果物の確認(scripts/lib-electron-path.cts)
// の単体テスト。成果物の無い作業ツリーで `electron .` を起こすと、Electron 自身が
// OS のモーダルを前面に出す。しかも起動したケースごとに1回ずつ出続けて、利用者の
// 入力を奪う(2026-07-28 に実際に起きた)。この防ぎ(#460)は起こす前に止める。
// 判定の部分には副作用が無い＝Electron も一時プロセスも立ち上げずに確かめられる。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { appEntryPath, buildArtifactError } from './lib-electron-path.cts';

let root: string;

// 実物の app/ と同じ形(package.json の main がビルド成果物を指す)を一時領域に作る
const makeAppDir = (name: string, main?: string | number) => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  if (main !== undefined) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'hologram-fixture', main }));
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

  // main の値は決め打ちせず package.json から読むので、出力先が変わっても追随する
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
    expect(message).toContain('npm run app:build');
    expect(message).toContain(path.resolve(dir, 'out/main/index.js'));
  });

  // app/out がそもそも無い＝作りたての作業ツリーの初期状態。ここで止めないと、ハーネスがケースごとにモーダルを出す。
  test('out/ ディレクトリごと無い場合も止める', () => {
    const dir = makeAppDir('no-out-dir', './out/main/index.js');
    expect(buildArtifactError(dir)).not.toBeNull();
  });

  // main だけあって中身が違うような中途半端なビルドは対象外＝存在の確認しかしない
  test('main が別の場所を指していればそちらを見る', () => {
    const dir = makeAppDir('custom-built', './dist/electron/main.js');
    expect(buildArtifactError(dir)).not.toBeNull();
    writeEntry(dir, 'dist/electron/main.js');
    expect(buildArtifactError(dir)).toBeNull();
  });
});
