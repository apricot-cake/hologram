import { expect, test, vi } from 'vitest';
import { runFullTextSearch } from './fulltext.ts';
const search = vi.hoisted(() => vi.fn());
vi.mock('./ipc.ts', () => ({ hologramIpc: { searchFullText: search } }));
test('あいまい一致を部分一致で除外せず、エンジンの順位を保つ', async () => {
  search.mockResolvedValue([
    { postId: 'b', rank: 0, field: 'text', snippetText: 'illustration', matchStart: 0, matchEnd: 12 },
    { postId: 'a', rank: 1 },
  ]);
  const posts = [
    { captureId: 'a', text: 'a' },
    { captureId: 'b', text: 'illustration' },
  ] as HologramPost[];
  const result = await runFullTextSearch('illustraton', posts, 1);
  expect(result.total).toBe(2);
  expect(result.hits[0].post.captureId).toBe('b');
  expect(result.hits[0].matchEnd).toBe(12);
});
test('検索失敗を全件表示に置き換えない', async () => {
  search.mockRejectedValue(new Error('unavailable'));
  await expect(runFullTextSearch('x', [], 50)).rejects.toThrow('unavailable');
});
