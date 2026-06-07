// SNS の公開系 API クライアント。
// fetch は DI (Node テストと Eagle plugin / browser 両対応)。
// Phase 1 の extension/background.js のロジックを engagement 取得に絞って再構成。

export function parsePostUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.x.com' || host === 'mobile.twitter.com') {
      const m = u.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
      if (m) return { platform: 'x', handle: m[1], postId: m[2] };
    } else if (host === 'bsky.app') {
      const m = u.pathname.match(/^\/profile\/([^/]+)\/post\/([^/]+)/);
      if (m) return { platform: 'bluesky', handle: m[1], postId: m[2] };
    } else if (host === 'www.pixiv.net' || host === 'pixiv.net') {
      // /artworks/123 / /en/artworks/123 / /ja/artworks/123
      const m = u.pathname.match(/^(?:\/[a-z]{2})?\/artworks\/(\d+)/);
      if (m) return { platform: 'pixiv', postId: m[1] };
    }
  } catch {
    // 不正な URL は null
  }
  return null;
}

// 各 fetcher は { status, engagement, meta } を返す。
//   status: 'synced' | 'deleted' | 'private' | 'error'
//   engagement: { likes, reposts, replies, quotes, views, bookmarks } の取れた分
//   meta: { displayName, author, text, title, hashtags } — 同じレスポンスから取れる人間情報。
//         リンクだけ (annotation 無し) の項目でも作者・本文・タグを埋められる。

// 429 (および X 旧来の 420) はレート制限シグナル。専用フラグ付きで投げ、
// 呼び出し側 (sync-engagement) が run を止められるようにする。error 印は付けない。
function rateLimitError(label, status) {
  const e = new Error(`${label} rate limited (${status})`);
  e.rateLimited = true;
  return e;
}

export async function fetchXEngagement({ postId, fetch }) {
  const res = await fetch(
    `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(postId)}&token=0`
  );
  if (res.status === 429 || res.status === 420) throw rateLimitError('X', res.status);
  if (res.status === 404) return { status: 'deleted', engagement: {} };
  if (res.status === 401 || res.status === 403) return { status: 'private', engagement: {} };
  if (!res.ok) throw new Error(`X Syndication API ${res.status}`);
  const data = await res.json();
  // 削除/凍結/非公開/センシティブ等で利用不可のツイートは tombstone を返す (200 だが engagement なし)。
  // synced+null にせず deleted (利用不可) として扱う。
  if (data.__typename === 'TweetTombstone' || data.tombstone) {
    return { status: 'deleted', engagement: {} };
  }
  return {
    status: 'synced',
    engagement: {
      likes: data.favorite_count ?? null,
      replies: data.conversation_count ?? null
      // reposts/views/bookmarks/quotes は GraphQL 認証が必要 (Phase 2 範囲外)
    },
    meta: {
      displayName: data.user?.name ?? null,
      author: data.user?.screen_name ?? null,
      text: (data.text || '').replace(/https?:\/\/t\.co\/\S+/g, '').trim() || null,
      title: null,
      hashtags: (data.entities?.hashtags || []).map((h) => h.text)
    }
  };
}

export async function fetchBlueskyEngagement({ handle, postId, fetch }) {
  const uri = `at://${handle}/app.bsky.feed.post/${postId}`;
  const res = await fetch(
    `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0`
  );
  if (res.status === 429) throw rateLimitError('Bluesky', res.status);
  if (res.status === 400 || res.status === 404) return { status: 'deleted', engagement: {} };
  if (!res.ok) throw new Error(`Bluesky API ${res.status}`);
  const data = await res.json();
  const post = data.thread?.post;
  if (!post) return { status: 'deleted', engagement: {} };
  return {
    status: 'synced',
    engagement: {
      likes: post.likeCount ?? null,
      reposts: post.repostCount ?? null,
      replies: post.replyCount ?? null,
      quotes: post.quoteCount ?? null
      // views は Bluesky 自体が未計測
    },
    meta: {
      displayName: post.author?.displayName ?? null,
      author: post.author?.handle ?? null,
      text: post.record?.text ?? null,
      title: null,
      hashtags: (post.record?.facets || [])
        .flatMap((f) => f.features || [])
        .filter((x) => x.$type === 'app.bsky.richtext.facet#tag')
        .map((x) => x.tag)
    }
  };
}

export async function fetchPixivEngagement({ postId, fetch }) {
  const res = await fetch(
    `https://www.pixiv.net/ajax/illust/${encodeURIComponent(postId)}`,
    { credentials: 'include' }
  );
  if (res.status === 429) throw rateLimitError('pixiv', res.status);
  if (res.status === 404) return { status: 'deleted', engagement: {} };
  if (!res.ok) throw new Error(`pixiv API ${res.status}`);
  const data = await res.json();
  // pixiv は 200 OK + error body を返すことがある (R-18 ログアウト、削除済み、鍵)
  if (data.error) return { status: 'private', engagement: {} };
  const illust = data.body;
  return {
    status: 'synced',
    engagement: {
      likes: illust.likeCount ?? null,
      replies: illust.commentCount ?? null,
      views: illust.viewCount ?? null,
      bookmarks: illust.bookmarkCount ?? null
    },
    meta: {
      displayName: illust.userName ?? null,
      author: illust.userId ?? null,
      text: null,
      title: illust.illustTitle ?? null,
      hashtags: (illust.tags?.tags || []).map((t) => t.tag)
    }
  };
}
