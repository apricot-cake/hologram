// 個別の抽出機能テストで使う正常応答。契約違反のテストではこの補完を使わない。
export function apiFixture(url: string, raw: any): any {
  if (url.includes('syndication') && raw?.text !== undefined)
    return {
      id_str: '123',
      lang: 'en',
      created_at: '2026-01-01T00:00:00Z',
      favorite_count: 0,
      conversation_count: 0,
      ...raw,
      user: { id_str: '1', name: 'Alice', screen_name: 'alice', profile_image_url_https: 'https://example.com/avatar.png', ...raw.user },
    };
  if (url.includes('getPostThread') && raw?.thread?.post) {
    const post = raw.thread.post;
    return {
      ...raw,
      thread: {
        ...raw.thread,
        post: {
          uri: 'at://did:plc:abc/app.bsky.feed.post/rk',
          cid: 'test-cid',
          indexedAt: '2026-01-01T00:00:00Z',
          ...post,
          author: { did: 'did:plc:abc', handle: 'alice.bsky.social', ...post.author },
          record: { text: '', createdAt: '2026-01-01T00:00:00Z', ...post.record },
        },
      },
    };
  }
  if (url.includes('getProfile')) return { did: 'did:plc:abc', handle: 'alice.bsky.social', ...raw };
  if (url.includes('/illust/') && raw?.body && !Array.isArray(raw.body) && !raw.error)
    return {
      ...raw,
      body: {
        illustType: 0,
        pageCount: 1,
        width: 1,
        height: 1,
        urls: { original: 'https://i.pximg.net/fixture_p0.jpg' },
        tags: { tags: [] },
        createDate: '2026-01-01T00:00:00Z',
        uploadDate: '2026-01-01T00:00:00Z',
        illustId: '12345',
        illustTitle: '',
        userId: '1',
        userName: 'Artist',
        likeCount: 0,
        bookmarkCount: 0,
        viewCount: 0,
        commentCount: 0,
        ...raw.body,
      },
    };
  return raw;
}
