import { makeGroupRecords, makeGallery, postKeyOf } from './records.ts';
import { get, getGeneration } from './posts-data.ts';

const groupReplies = makeGroupRecords({ manualGroups: () => [], ungrouped: () => new Set(), joinReplies: true });
const groupPosts = makeGroupRecords({ manualGroups: () => [], ungrouped: () => new Set() });
const gallery = makeGallery({ fileSrc: (file: string) => file });
let generation = -1;
let threads = new Map<string, HologramPostGroup>();

export function replyThreadOf(post: HologramPost): HologramPostGroup | undefined {
  if (generation !== getGeneration()) {
    generation = getGeneration();
    threads = new Map();
    for (const group of groupReplies(get())) {
      if (new Set(group.records.map((p) => postKeyOf(p.url))).size < 2) continue;
      for (const p of group.records) threads.set(p.captureId, group);
    }
  }
  return threads.get(post.captureId);
}

export function replyPostsOf(post: HologramPost): HologramPostGroup[] {
  const thread = replyThreadOf(post);
  return thread ? groupPosts(thread.records) : [];
}

export function imageEntrySelection(group: HologramPostGroup) {
  const thread = group.key?.startsWith('manual:') ? group : replyThreadOf(group.rep) || group;
  const items = gallery.buildGroupGalleryItems(thread);
  const idx = Math.max(
    0,
    items.findIndex((item) => item.postId === group.rep.captureId),
  );
  return { recs: thread.records.map((p) => p.captureId), idx };
}

export function galleryPosition(items: { postId?: string }[], index: number, getPost: (id: string) => HologramPost | undefined) {
  const keys = items.map((item) => {
    const p = getPost(item.postId || '');
    return (p && postKeyOf(p.url)) || item.postId;
  });
  const posts = [...new Set(keys)];
  const key = keys[index];
  return { post: posts.indexOf(key) + 1, posts: posts.length, image: keys.slice(0, index + 1).filter((k) => k === key).length, images: keys.filter((k) => k === key).length };
}
