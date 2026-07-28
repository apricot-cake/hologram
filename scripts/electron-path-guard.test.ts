// 実 Electron 起動ハーネスのビルド成果物チェック（scripts/lib-electron-path.cts）の
// ユニットテスト。成果物の無い作業ツリーで `electron .` を spawn すると、Electron 自身が
// OS のモーダルを最前面に出し、ケースごとに起動する分だけ出続けてユーザーの操作を奪う
// （2026-07-28 に実際に発生）。spawn する前に止めるのがこのガード（#460）。
// 判定部分は副作用なし＝Electron も一時プロセスも起こさずに検証できる。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { appEntryPath, buildArtifactError } from './lib-electron-path.cts';

let root: string;

// 本物の app/ と同じ形（package.json の main がビルド成果物を指す）を temp に作る
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

  // main の値を焼き付けず package.json から読むので、出力先を変えても追随する
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

  // app/out ごと無い＝新しい作業ツリーの初期状態。ここで止まらないと
  // ハーネスがケース数だけモーダルを出す
  test('out/ ディレクトリごと無い場合も止める', () => {
    const dir = makeAppDir('no-out-dir', './out/main/index.js');
    expect(buildArtifactError(dir)).not.toBeNull();
  });

  // main だけ作られていて中身が別物、のような部分ビルドは対象外＝存在確認だけ行う
  test('main が別の場所を指していればそちらを見る', () => {
    const dir = makeAppDir('custom-built', './dist/electron/main.js');
    expect(buildArtifactError(dir)).not.toBeNull();
    writeEntry(dir, 'dist/electron/main.js');
    expect(buildArtifactError(dir)).toBeNull();
  });
});
