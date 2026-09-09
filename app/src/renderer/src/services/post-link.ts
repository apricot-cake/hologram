import { postKeyOf } from '../../../../../native-host/post-key.mts';
import type { PostLink } from '../../../shared/post-link.ts';

export function findLinkedPost<T extends { url?: string | null; saveScope?: string; media?: Array<{ url?: string | null }> }>(posts: T[], target: PostLink): T | undefined {
  const key = postKeyOf(target.url);
  if (!key) return undefined;
  return posts.find((post) => postKeyOf(post.url) === key && (target.mediaUrl ? post.saveScope === 'media' && post.media?.some((item) => item.url === target.mediaUrl) : post.saveScope !== 'media'));
}
