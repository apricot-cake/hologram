// Sandbox instance identity (#640): scripts/lib-sandbox-instance.cts.
//
// The bug this covers returns a SUCCESS — a session drives another worktree's
// sandbox and every call answers — so the two properties that make it
// detectable are asserted directly: a tree's port is a function of the tree,
// and the process holding that port is compared with the pid the tree recorded.
//
// The identity used to be read out of the CDP target URL, which named the tree
// while the renderer was a file:// document. #7 put it on app://bundle/index.html
// — one string for every tree — so the check moved to the listening pid.

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
      /* best-effort */
    }
  }
});

describe('port assignment', () => {
  test('a tree always gets the same port, inside the sandbox range', () => {
    const tree = path.join('a', 'b', 'tree-one');
    const port = sandboxPortBase(tree);
    expect(sandboxPortBase(tree)).toBe(port);
    expect(port).toBeGreaterThanOrEqual(PORT_MIN);
    expect(port).toBeLessThan(PORT_MIN + PORT_SPAN);
    expect(isSandboxPort(port)).toBe(true);
  });

  test('sibling worktrees do not start from the same port', () => {
    // The two trees #640 actually saw collide on 9333 differ only in the leaf.
    const base = path.join('repo', '.claude', 'worktrees');
    const a = sandboxPortBase(path.join(base, 'agent-aca6b2840368f2288'));
    const b = sandboxPortBase(path.join(base, 'agent-af0d29123f450f7ca'));
    expect(a).not.toBe(b);
  });

  test('the same tree spelled differently is the same tree', () => {
    const tree = path.resolve(path.join('some', 'tree'));
    expect(sandboxPortBase(`${tree}${path.sep}`)).toBe(sandboxPortBase(tree));
    expect(sandboxPortBase(tree.toUpperCase())).toBe(sandboxPortBase(tree.toLowerCase()));
  });

  test('the real app port is not a sandbox port', () => {
    expect(isSandboxPort(9222)).toBe(false);
    expect(isSandboxPort(PORT_MIN + PORT_SPAN)).toBe(false);
  });
});

describe('port ownership', () => {
  // The port is only ever compared against a pid this tree wrote down, so the
  // lookup is injected: the comparison is what has to hold, on every platform.
  const held = (pid: number | null) => () => pid;

  test('the recorded pid holding the port is ours', () => {
    const tree = mkdir();
    writeInstance(tree, { pid: 4242, port: 9350 });
    expect(foreignSandboxAt(9350, tree, held(4242))).toBeNull();
  });

  test("another process on the port is reported as another tree's", () => {
    const tree = mkdir();
    writeInstance(tree, { pid: 4242, port: 9350 });
    expect(foreignSandboxAt(9350, tree, held(777))).toBe(777);
  });

  test('nothing listening, or no record, is "no reason to refuse"', () => {
    const tree = mkdir();
    // No record at all: a tree that never started an instance has nothing to defend.
    expect(foreignSandboxAt(9350, tree, held(777))).toBeNull();
    writeInstance(tree, { pid: 4242, port: 9350 });
    // Lookup unavailable (non-Windows) or the port is free — cannot tell, do not accuse.
    expect(foreignSandboxAt(9350, tree, held(null))).toBeNull();
  });

  test('a free port has no listener', () => {
    // 1 is never a sandbox port and nothing can be listening on it here; on a
    // platform without the lookup this is the same null for the other reason.
    expect(listeningPid(1)).toBeNull();
  });
});

describe('instance record', () => {
  test('records the tree it belongs to and reads back', () => {
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

  test('a malformed record reads as no instance', () => {
    const tree = mkdir();
    fs.mkdirSync(path.dirname(instanceFile(tree)), { recursive: true });
    fs.writeFileSync(instanceFile(tree), '{"pid":"nope"}');
    expect(readInstance(tree)).toBeNull();
  });
});
