// Sandbox instance identity (#640): scripts/lib-sandbox-instance.cts.
//
// The bug this covers returns a SUCCESS — a session drives another worktree's
// sandbox and every call answers — so the two properties that make it
// detectable are asserted directly: a tree's port is a function of the tree,
// and a live target's URL says which tree it came from.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';
import { PORT_MIN, PORT_SPAN, clearInstance, instanceFile, isSandboxPort, pageTargetOf, readInstance, sandboxPortBase, targetBelongsToTree, targetFilePath, writeInstance } from './lib-sandbox-instance.cts';

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

const rendererUrl = (tree: string) => `${pathToFileURL(path.join(tree, 'app', 'out', 'renderer', 'index.html')).href}?theme=auto`;

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

describe('target identity', () => {
  test("a renderer loaded from another tree is recognisable as another tree's", () => {
    const mine = mkdir();
    const theirs = mkdir();
    expect(targetBelongsToTree(rendererUrl(mine), mine)).toBe(true);
    expect(targetBelongsToTree(rendererUrl(theirs), mine)).toBe(false);
    expect(targetFilePath(rendererUrl(theirs))).toBe(path.join(theirs, 'app', 'out', 'renderer', 'index.html'));
  });

  test('a non-file target answers "cannot tell" rather than "fine"', () => {
    // `electron-vite dev` serves the renderer over http; there is no tree in the URL.
    expect(targetBelongsToTree('http://localhost:5173/index.html', mkdir())).toBeNull();
    expect(targetFilePath('http://localhost:5173/index.html')).toBeNull();
    expect(targetBelongsToTree('', mkdir())).toBeNull();
  });

  test('the page target is picked over devtools/worker targets', () => {
    const tree = mkdir();
    const url = rendererUrl(tree);
    expect(
      pageTargetOf([
        { type: 'service_worker', url: 'x' },
        { type: 'page', url },
      ]),
    ).toMatchObject({ url });
    expect(pageTargetOf([{ type: 'service_worker', url: 'x' }])).toBeNull();
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
