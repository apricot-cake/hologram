import { expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({ generation: 1, search: vi.fn() }));
vi.mock('./posts-data.ts', () => ({ getGeneration: () => state.generation }));
vi.mock('./ipc.ts', () => ({ hologramIpc: { searchFullText: state.search } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
import { matchingIds, postQueriesReady } from './search-results.ts';
test('同じ検索を共有し、ライブラリ更新前の応答を使わない', async () => {
  let resolveOld!: (value: unknown) => void;
  state.search.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  expect(matchingIds('posts', '猫').size).toBe(0);
  const node = { kind: 'cond', type: 'text', value: '猫' } as HologramQueryNode;
  expect(postQueriesReady(node)).toBe(false);
  expect(state.search).toHaveBeenCalledTimes(1);
  state.generation++;
  state.search.mockResolvedValueOnce([{ postId: 'new', rank: 0 }]);
  matchingIds('posts', '猫');
  resolveOld([{ postId: 'old', rank: 0 }]);
  await vi.waitFor(() => expect(postQueriesReady(node)).toBe(true));
  expect([...matchingIds('posts', '猫')]).toEqual(['new']);
});
