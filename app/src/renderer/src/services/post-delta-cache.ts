import type { IpcPostRecord, PostsDelta } from '../../../main/ipc-payloads.ts';

export function applyPostsDeltaToCache<T extends { captureId: string }>(current: Map<string, T>, response: PostsDelta | null | undefined, stamp: (post: IpcPostRecord) => T): Map<string, T> {
  if (response?.paused) return current;
  if (!response || response.full) {
    const next = new Map<string, T>();
    for (const post of response?.posts || []) next.set(post.captureId, stamp(post));
    return next;
  }
  for (const id of response.removed || []) current.delete(id);
  for (const post of response.added || []) current.set(post.captureId, stamp(post));
  return current;
}
