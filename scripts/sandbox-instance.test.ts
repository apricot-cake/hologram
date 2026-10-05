import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { SANDBOX_PORT, assertMainWorkingTree, clearInstance, foreignSandboxAt, instanceFile, isSandboxPort, listeningPid, readInstance, writeInstance } from './lib-sandbox-instance.cts';

const dirs: string[] = [];
function mkdir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-sbx-'));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* できる範囲で */
    }
  }
});

describe('単一の検証環境', () => {
  test('検証用ポートだけを識別する', () => {
    expect(isSandboxPort(SANDBOX_PORT)).toBe(true);
    expect(isSandboxPort(9222)).toBe(false);
    expect(isSandboxPort(SANDBOX_PORT + 1)).toBe(false);
  });

  test('主作業ツリーから操作できる', () => {
    const tree = mkdir();
    fs.mkdirSync(path.join(tree, '.git'));
    expect(() => assertMainWorkingTree(tree)).not.toThrow();
  });

  test('リンク worktree からの操作を拒否する', () => {
    const tree = mkdir();
    fs.writeFileSync(path.join(tree, '.git'), 'gitdir: ../main/.git/worktrees/linked');
    expect(() => assertMainWorkingTree(tree)).toThrow('主作業ツリー');
  });
});

describe('ポートの持ち主', () => {
  // ポートは、この木が書き留めた pid とだけ突き合わせる。だから引き当ての方を差し込む＝
  // どのプラットフォームでも成り立たなければならないのは突き合わせの側。
  const held = (pid: number | null) => () => pid;

  test('ポートを掴んでいるのが記録した pid なら自分のもの', () => {
    const tree = mkdir();
    writeInstance(tree, { pid: 4242, port: SANDBOX_PORT });
    expect(foreignSandboxAt(SANDBOX_PORT, tree, held(4242))).toBeNull();
  });

  test('ポートに別のプロセスが居れば別の木のものとして報告する', () => {
    const tree = mkdir();
    writeInstance(tree, { pid: 4242, port: SANDBOX_PORT });
    expect(foreignSandboxAt(SANDBOX_PORT, tree, held(777))).toBe(777);
  });

  test('誰も待ち受けていない・記録が無いなら「拒む理由が無い」', () => {
    const tree = mkdir();
    // 記録がそもそも無い＝インスタンスを一度も起こしていない木には守るものが無い。
    expect(foreignSandboxAt(SANDBOX_PORT, tree, held(777))).toBeNull();
    writeInstance(tree, { pid: 4242, port: SANDBOX_PORT });
    // 引き当てが使えない（Windows 以外）か、ポートが空いている＝判断できないので責めない。
    expect(foreignSandboxAt(SANDBOX_PORT, tree, held(null))).toBeNull();
  });

  test('空いているポートには待ち受けが無い', () => {
    // 1 はサンドボックスのポートには決してならず、ここで何かが待ち受けることもない。
    // 引き当ての無いプラットフォームでは、別の理由で同じく null になる。
    expect(listeningPid(1)).toBeNull();
  });
});

describe('インスタンスの記録', () => {
  test('どの木のものかを記録し、読み戻せる', () => {
    const tree = mkdir();
    expect(readInstance(tree)).toBeNull();
    writeInstance(tree, { pid: 4242, port: SANDBOX_PORT });
    const inst = readInstance(tree);
    expect(inst).toMatchObject({ pid: 4242, port: SANDBOX_PORT, tree });
    expect(typeof inst?.startedAt).toBe('string');
    clearInstance(tree);
    expect(readInstance(tree)).toBeNull();
    expect(fs.existsSync(instanceFile(tree))).toBe(false);
  });

  test('壊れた記録はインスタンス無しとして読む', () => {
    const tree = mkdir();
    fs.mkdirSync(path.dirname(instanceFile(tree)), { recursive: true });
    fs.writeFileSync(instanceFile(tree), '{"pid":"nope"}');
    expect(readInstance(tree)).toBeNull();
  });
});
