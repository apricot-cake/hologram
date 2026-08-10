// サンドボックスのインスタンスの身元（#640）＝scripts/lib-sandbox-instance.cts。
//
// ここで見る不具合は成功を返す＝あるセッションが別の worktree のサンドボックスを操って
// いるのに、どの呼び出しも応答する。だから、それを見つけられるようにする2つの性質を直に
// 確かめる。木のポートはその木の関数であること。そのポートを掴んでいるプロセスを、木が
// 記録した pid と突き合わせること。
//
// 身元はかつて CDP のターゲット URL から読んでいた。レンダラーが file:// の文書だった頃は
// そこに木の名前が入っていたからだ。#7 がそれを app://bundle/index.html にした＝どの木でも
// 同じ1つの文字列になったので、検査は待ち受けている pid へ移った。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { PORT_MIN, PORT_SPAN, clearInstance, foreignSandboxAt, instanceFile, isSandboxPort, listeningPid, readInstance, sandboxPortBase, writeInstance } from './lib-sandbox-instance.cts';

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

describe('ポートの割り当て', () => {
  test('同じ木には常に同じポートが割り当たり、サンドボックスの範囲に収まる', () => {
    const tree = path.join('a', 'b', 'tree-one');
    const port = sandboxPortBase(tree);
    expect(sandboxPortBase(tree)).toBe(port);
    expect(port).toBeGreaterThanOrEqual(PORT_MIN);
    expect(port).toBeLessThan(PORT_MIN + PORT_SPAN);
    expect(isSandboxPort(port)).toBe(true);
  });

  test('隣り合う worktree は同じポートから始まらない', () => {
    // #640 が実際に 9333 でぶつかるのを見た2つの木は、末端しか違わない。
    // 相対の `path.join` ではなく絶対パスのリテラルを使う＝sandboxPortBase は入力を
    // 解決するので、相対パスだと呼び出し元の cwd がハッシュに混ざり、`npm test` を
    // どこから走らせたかでこの例が通ったり落ちたりする（#839）。この2つは今のところ
    // 別のポートに落ちる。sandboxPortBase のハッシュを変えたら、今も違う対を選び直すこと。
    const base = path.resolve('/', 'repo', '.claude', 'worktrees');
    const a = sandboxPortBase(path.join(base, 'agent-aca6b2840368f2288'));
    const b = sandboxPortBase(path.join(base, 'agent-af0d29123f450f7ca'));
    expect(a).not.toBe(b);
  });

  test('綴りが違っても同じ木なら同じ木として扱う', () => {
    const tree = path.resolve(path.join('some', 'tree'));
    expect(sandboxPortBase(`${tree}${path.sep}`)).toBe(sandboxPortBase(tree));
    expect(sandboxPortBase(tree.toUpperCase())).toBe(sandboxPortBase(tree.toLowerCase()));
  });

  test('本物のアプリのポートはサンドボックスのポートではない', () => {
    expect(isSandboxPort(9222)).toBe(false);
    expect(isSandboxPort(PORT_MIN + PORT_SPAN)).toBe(false);
  });
});

describe('ポートの持ち主', () => {
  // ポートは、この木が書き留めた pid とだけ突き合わせる。だから引き当ての方を差し込む＝
  // どのプラットフォームでも成り立たなければならないのは突き合わせの側。
  const held = (pid: number | null) => () => pid;

  test('ポートを掴んでいるのが記録した pid なら自分のもの', () => {
    const tree = mkdir();
    writeInstance(tree, { pid: 4242, port: 9350 });
    expect(foreignSandboxAt(9350, tree, held(4242))).toBeNull();
  });

  test('ポートに別のプロセスが居れば別の木のものとして報告する', () => {
    const tree = mkdir();
    writeInstance(tree, { pid: 4242, port: 9350 });
    expect(foreignSandboxAt(9350, tree, held(777))).toBe(777);
  });

  test('2つの木が同じポートに落ちても（ハッシュ衝突）間違った方は拒む', () => {
    // sandboxPortBase の枠は PORT_SPAN 個しかないので、2つの木が同じ数を出すのは
    // 想定どおりで不具合ではない（#839）＝#640 の本当の防ぎは上の pid の突き合わせで
    // あって、ポートの一意性ではない。
    const treeA = mkdir();
    const treeB = mkdir();
    const sharedPort = 9350;
    writeInstance(treeA, { pid: 4242, port: sharedPort });
    writeInstance(treeB, { pid: 5555, port: sharedPort });
    // 実際に待ち受けているのは treeA 自身のプロセス＝treeA はそのまま進む……
    expect(foreignSandboxAt(sharedPort, treeA, held(4242))).toBeNull();
    // ……が、treeB の記録した pid はそれと一致しないので、treeB は拒まれる。
    expect(foreignSandboxAt(sharedPort, treeB, held(4242))).toBe(4242);
  });

  test('誰も待ち受けていない・記録が無いなら「拒む理由が無い」', () => {
    const tree = mkdir();
    // 記録がそもそも無い＝インスタンスを一度も起こしていない木には守るものが無い。
    expect(foreignSandboxAt(9350, tree, held(777))).toBeNull();
    writeInstance(tree, { pid: 4242, port: 9350 });
    // 引き当てが使えない（Windows 以外）か、ポートが空いている＝判断できないので責めない。
    expect(foreignSandboxAt(9350, tree, held(null))).toBeNull();
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
    writeInstance(tree, { pid: 4242, port: 9350 });
    const inst = readInstance(tree);
    expect(inst).toMatchObject({ pid: 4242, port: 9350, tree });
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
