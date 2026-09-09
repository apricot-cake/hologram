import { z } from 'zod';
import { postKeyOf } from '../../../native-host/post-key.mts';

export const POST_LINK_SCHEME = 'hologram';
const webUrl = z.url({ protocol: /^https?$/ });
export const PostLinkSchema = z.object({
  url: webUrl.refine((url) => postKeyOf(url) !== null),
  mediaUrl: webUrl.optional(),
});
export type PostLink = z.output<typeof PostLinkSchema>;

export function makePostLink(target: PostLink): string {
  const parsed = PostLinkSchema.parse(target);
  const link = new URL(`${POST_LINK_SCHEME}://post`);
  link.searchParams.set('url', parsed.url);
  if (parsed.mediaUrl) link.searchParams.set('media', parsed.mediaUrl);
  return link.href;
}

export function parsePostLink(value: string): PostLink | null {
  try {
    const link = new URL(value);
    if (link.protocol !== `${POST_LINK_SCHEME}:` || link.hostname !== 'post' || link.username || link.password || link.port || (link.pathname && link.pathname !== '/') || link.hash) return null;
    if ([...link.searchParams.keys()].some((key) => key !== 'url' && key !== 'media') || link.searchParams.getAll('url').length !== 1 || link.searchParams.getAll('media').length > 1) return null;
    const result = PostLinkSchema.safeParse({ url: link.searchParams.get('url'), mediaUrl: link.searchParams.get('media') ?? undefined });
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
