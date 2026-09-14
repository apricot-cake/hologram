import { hologramIpc } from './ipc.ts';
import type { SearchCandidate } from '../../../shared/search-fields.ts';
import { getGeneration } from './posts-data.ts';
import { toast } from 'sonner';

// 同期的なフィルタ評価から非同期検索を共有する。世代の違う応答は公開しない。
const cache = new Map<string, { ids?: Set<string>; pending: boolean }>();
const listeners = new Set<() => void>();
let revision = 0;
export const searchRevision = () => revision;
export const subscribeSearch = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
function notify() {
  revision++;
  for (const fn of listeners) fn();
}
export function matchingIds(kind: string, query: string, entries?: SearchCandidate[]): Set<string> {
  const generation = getGeneration();
  const key = JSON.stringify([generation, kind, query, entries]);
  const old = cache.get(key);
  if (old) return old.ids || new Set();
  if (cache.size > 100) cache.clear();
  const state = { pending: true, ids: undefined as Set<string> | undefined };
  cache.set(key, state);
  const request = entries ? hologramIpc.searchCandidates(query, entries) : hologramIpc.searchFullText(query).then((hits) => hits.map((hit) => hit.postId));
  void request
    .then((ids) => {
      if (getGeneration() !== generation || cache.get(key) !== state) return;
      state.ids = new Set(ids);
      state.pending = false;
      notify();
    })
    .catch((error) => {
      state.pending = false;
      console.error('検索に失敗しました', error);
      toast.error('検索できませんでした', {
        action: {
          label: '再試行',
          onClick: () => {
            cache.delete(key);
            notify();
          },
        },
      });
    });
  return new Set();
}
export function matchesPost(query: string, post: HologramPost) {
  return matchingIds('posts', query).has(post.captureId);
}

export function postQueriesReady(node: HologramQueryNode | undefined): boolean {
  if (!node) return true;
  if (node.kind === 'group') {
    const ready = node.children.map(postQueriesReady);
    return ready.every(Boolean);
  }
  if (node.type !== 'text' || !String(node.value || '').trim()) return true;
  const query = String(node.value).trim();
  matchingIds('posts', query);
  return cache.get(JSON.stringify([getGeneration(), 'posts', query, undefined]))?.ids !== undefined;
}
