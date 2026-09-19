// @vitest-environment jsdom

import { describe, expect, test } from 'vitest';
import { dragLeavesWindow } from './drop-visibility.ts';

describe('dragLeavesWindow', () => {
  test('ウィンドウ外へ出た dragleave で閉じる', () => {
    expect(dragLeavesWindow(null)).toBe(true);
  });

  test('文書内の子要素へ移っただけでは閉じない', () => {
    const child = document.createElement('div');
    document.body.append(child);
    expect(dragLeavesWindow(child)).toBe(false);
    child.remove();
  });
});
