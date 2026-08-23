// metadata.ts の厄介な3つの事例が正しいこと(fetch は差し替えるのでネットワークは要らない):
//   - X: quoted_tweet の user に screen_name が無いとき、.../undefined/status/<id> の
//     ような quotedUrl を組み立ててはいけない
//   - Bluesky: embed.record はリスト・フィード・スターターパックも包む。引用と数えるのは
//     投稿(feed.post の uri)だけ
//   - Misskey: rec.url は素の https://<instance>/notes/<id>。保存元の URL からクエリと
//     ハッシュを落とす
// 投稿者プロフィール(アバター / フォロワー / アカウント作成日)と、#119 St1 の動画・GIF の
// 直リンク抽出も見る。

import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchBlueskyPost } from '../extension/utils/extractor/bluesky.ts';
import { fetchPostMetadata } from '../extension/utils/extractor/index.ts';
import { fetchMisskeyNote } from '../extension/utils/extractor/misskey.ts';
import { fetchPixivIllust } from '../extension/utils/extractor/pixiv.ts';
import { fetchXTweet } from '../extension/utils/extractor/x.ts';

function mockFetch(routes: [string, unknown][]) {
  vi.stubGlobal('fetch', async (url: unknown) => {
    const u = String(url);
    for (const [frag, body] of routes) {
      if (u.includes(frag)) return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const X_ID = { platform: 'x', id: '123', screenName: 'alice' };
const X_URL = 'https://x.com/alice/status/123';
const DID = 'did:plc:abc';
const BSKY_ID = { platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'rk' };
const BSKY_URL = 'https://bsky.app/profile/alice.bsky.social/post/rk';

describe('X: screen_name の無い引用', () => {
  test('引用のフラグは立つが quotedUrl は組み立てない', async () => {
    mockFetch([
      [
        'cdn.syndication.twimg.com',
        {
          text: 'hi',
          mediaDetails: [],
          user: { name: 'Alice', screen_name: 'alice', id_str: '1' },
          quoted_tweet: { id_str: '999', user: { name: 'NoHandle' } }, // user はあるが screen_name が無い
        },
      ],
    ]);

    const r = await fetchXTweet(X_ID, X_URL);
    expect(r.isQuote).toBe(true);
    expect(r.quotedUrl).toBeNull();
  });

  test('screen_name があれば quotedUrl を組む', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: 'hi', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' }, quoted_tweet: { id_str: '999', user: { screen_name: 'bob' } } }]]);

    expect((await fetchXTweet(X_ID, X_URL)).quotedUrl).toBe('https://x.com/bob/status/999');
  });
});

// #189: 本文中の t.co を entities.urls の expanded_url へ展開し、編集済みかどうかを
// edit_control から読む。どちらも実ライブラリの応答にあった実際の形に合わせて固定した
// (scripts/canary/snapshots/x.json、2026-07-29 に実測)。
describe('X: t.co 展開と編集済みフラグ（#189）', () => {
  test('entities.urls の expanded_url へ置換する（display_url ではない）', async () => {
    mockFetch([
      [
        'cdn.syndication.twimg.com',
        {
          text: 'see this https://t.co/abc123 for details',
          mediaDetails: [],
          user: { screen_name: 'alice', id_str: '1' },
          entities: {
            urls: [{ url: 'https://t.co/abc123', expanded_url: 'https://en.wikipedia.org/wiki/Very_Long_Article_Title', display_url: 'en.wikipedia.org/wiki/Very_Lo…', indices: [9, 32] }],
          },
        },
      ],
    ]);

    const r = await fetchXTweet(X_ID, X_URL);
    expect(r.text).toBe('see this https://en.wikipedia.org/wiki/Very_Long_Article_Title for details');
  });

  test('複数の短縮 URL をそれぞれの展開先へ置換する', async () => {
    mockFetch([
      [
        'cdn.syndication.twimg.com',
        {
          text: 'https://t.co/aaa and https://t.co/bbb',
          mediaDetails: [],
          user: { screen_name: 'alice', id_str: '1' },
          entities: {
            urls: [
              { url: 'https://t.co/aaa', expanded_url: 'https://example.com/first', display_url: 'example.com/first', indices: [0, 16] },
              { url: 'https://t.co/bbb', expanded_url: 'https://example.org/second', display_url: 'example.org/second', indices: [21, 38] },
            ],
          },
        },
      ],
    ]);

    expect((await fetchXTweet(X_ID, X_URL)).text).toBe('https://example.com/first and https://example.org/second');
  });

  test('entities が無ければ本文をそのまま通す', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: 'no links here', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' } }]]);

    expect((await fetchXTweet(X_ID, X_URL)).text).toBe('no links here');
  });

  test('edit_control.edit_tweet_ids が2件以上なら編集済み', async () => {
    mockFetch([
      [
        'cdn.syndication.twimg.com',
        {
          text: 'edited now',
          mediaDetails: [],
          user: { screen_name: 'alice', id_str: '1' },
          edit_control: { edit_tweet_ids: ['1', '2'], editable_until_msecs: '99999999999', edits_remaining: '4', is_edit_eligible: true },
        },
      ],
    ]);

    const r = await fetchXTweet(X_ID, X_URL);
    expect(r.isEdited).toBe(true);
    // X の edit_control に「いつ」を答える欄は無い
  });

  test('edit_tweet_ids が自分だけ（1件）なら未編集＝null のまま', async () => {
    mockFetch([
      [
        'cdn.syndication.twimg.com',
        {
          text: 'never touched',
          mediaDetails: [],
          user: { screen_name: 'alice', id_str: '1' },
          edit_control: { edit_tweet_ids: ['1'], editable_until_msecs: '99999999999', edits_remaining: '5', is_edit_eligible: true },
        },
      ],
    ]);

    expect((await fetchXTweet(X_ID, X_URL)).isEdited).toBeNull();
  });
});

// #178: 閲覧注意の文言と sensitive フラグの取得。プラットフォームごとに実在する欄に
// 合わせて固定した(scripts/canary/snapshots/{misskey,x}.json、2026-07-30 に
// 実測した応答の形)。Bluesky は自己ラベル(com.atproto.label.defs#selfLabels)を使い、
// この形は公式の lexicon で確認した。
describe('CW・センシティブフラグ（#178）', () => {
  test('Misskey: note.cw が CW 文言、note レベルのセンシティブ信号は無い', async () => {
    mockFetch([['/api/notes/show', { text: 'hi', cw: 'spider photo inside', user: { username: 'alice' }, createdAt: '2026-01-01T00:00:00Z' }]]);

    const r = await fetchMisskeyNote({ platform: 'misskey', host: 'misskey.io', noteId: 'cw1' }, 'https://misskey.io/notes/cw1');
    expect(r.cw).toBe('spider photo inside');
    expect(r.sensitive).toBeNull();
  });

  test('Misskey: cw が null なら CW 無し', async () => {
    mockFetch([['/api/notes/show', { text: 'hi', cw: null, user: { username: 'alice' }, createdAt: '2026-01-01T00:00:00Z' }]]);

    expect((await fetchMisskeyNote({ platform: 'misskey', host: 'misskey.io', noteId: 'cw2' }, 'https://misskey.io/notes/cw2')).cw).toBeNull();
  });

  test('X: possibly_sensitive をそのまま通す（CW 文言の欄は無い）', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: 'hi', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' }, possibly_sensitive: true }]]);

    const r = await fetchXTweet({ platform: 'x', id: 'cw1', screenName: 'alice' }, 'https://x.com/alice/status/cw1');
    expect(r.sensitive).toBe(true);
    expect(r.cw).toBeNull();
  });

  test('X: possibly_sensitive が無ければ null（false を捏造しない）', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: 'hi', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' } }]]);

    expect((await fetchXTweet({ platform: 'x', id: 'cw2', screenName: 'alice' }, 'https://x.com/alice/status/cw2')).sensitive).toBeNull();
  });

  describe('Bluesky: 自己ラベル（com.atproto.label.defs#selfLabels）から sensitive を導く', () => {
    const postWithLabels = (labelVals: string[] | null) => ({
      author: { handle: 'alice.bsky.social', did: DID, displayName: 'Alice' },
      record: {
        text: 'hi',
        createdAt: '2026-01-01T00:00:00Z',
        ...(labelVals ? { labels: { $type: 'com.atproto.label.defs#selfLabels', values: labelVals.map((val) => ({ val })) } } : {}),
      },
    });

    test('porn ラベルがあれば sensitive=true', async () => {
      mockFetch([
        ['resolveHandle', { did: DID }],
        ['getPostThread', { thread: { post: postWithLabels(['porn']) } }],
      ]);
      expect((await fetchBlueskyPost(BSKY_ID, BSKY_URL)).sensitive).toBe(true);
    });

    test('ラベルが無ければ sensitive=false（null ではない — 投稿は取得できている）', async () => {
      mockFetch([
        ['resolveHandle', { did: DID }],
        ['getPostThread', { thread: { post: postWithLabels(null) } }],
      ]);
      expect((await fetchBlueskyPost(BSKY_ID, BSKY_URL)).sensitive).toBe(false);
    });

    // 'bot' はアカウントの種類のラベルであって閲覧注意ではないので、sensitive を立てない
    test('bot ラベルだけでは sensitive=false（コンテンツの警告ではない）', async () => {
      mockFetch([
        ['resolveHandle', { did: DID }],
        ['getPostThread', { thread: { post: postWithLabels(['bot']) } }],
      ]);
      expect((await fetchBlueskyPost(BSKY_ID, BSKY_URL)).sensitive).toBe(false);
    });

    test('Bluesky には CW 自由記述欄が無い（cw は常に null）', async () => {
      mockFetch([
        ['resolveHandle', { did: DID }],
        ['getPostThread', { thread: { post: postWithLabels(['porn']) } }],
      ]);
      expect((await fetchBlueskyPost(BSKY_ID, BSKY_URL)).cw).toBeNull();
    });
  });
});

describe('Bluesky: 引用と言えるのは投稿の埋め込みだけ', () => {
  const post = (embedRecord: unknown) => ({
    author: { handle: 'alice.bsky.social', did: DID, displayName: 'Alice' },
    record: { text: 'hi', createdAt: '2026-01-01T00:00:00Z' },
    embed: { $type: 'app.bsky.embed.record#view', record: embedRecord },
  });

  test('リストの埋め込みは引用ではない', async () => {
    mockFetch([
      ['resolveHandle', { did: DID }],
      ['getPostThread', { thread: { post: post({ uri: `at://${DID}/app.bsky.graph.list/xyz` }) } }],
    ]);

    const r = await fetchBlueskyPost(BSKY_ID, BSKY_URL);
    expect(r.isQuote).toBeFalsy();
    expect(r.quotedUrl).toBeNull();
  });

  test('投稿の埋め込みは引用で、quotedUrl も組む', async () => {
    mockFetch([
      ['resolveHandle', { did: DID }],
      ['getPostThread', { thread: { post: post({ uri: 'at://did:plc:zzz/app.bsky.feed.post/qpost', author: { handle: 'quoted.bsky.social' } }) } }],
    ]);

    const r = await fetchBlueskyPost(BSKY_ID, BSKY_URL);
    expect(r.isQuote).toBe(true);
    expect(r.quotedUrl).toBe('https://bsky.app/profile/quoted.bsky.social/post/qpost');
  });
});

test('Misskey: rec.url は素のパーマリンク（クエリ・ハッシュを落とす）', async () => {
  mockFetch([['/api/notes/show', { text: 'hi', user: { username: 'alice' }, createdAt: '2026-01-01T00:00:00Z' }]]);

  const r = await fetchMisskeyNote({ platform: 'misskey', host: 'misskey.io', noteId: 'abc123' }, 'https://misskey.io/notes/abc123?foo=bar#frag');
  expect(r.url).toBe('https://misskey.io/notes/abc123');
});

describe('投稿者プロフィール（アバター・フォロワー・アカウント作成日）', () => {
  // X: アバターは syndication の user から取り、_normal を _400x400 へ上げる。フォロワー数も
  // アカウント作成日も公開されていないので、どちらも null のまま(黙って隠す)
  test('X: アバターは _400x400 へ、フォロワーと作成日は null', async () => {
    mockFetch([['cdn.syndication.twimg.com', { text: 'hi', mediaDetails: [], user: { name: 'Alice', screen_name: 'alice', id_str: '1', profile_image_url_https: 'https://pbs.twimg.com/profile_images/9/abc_normal.jpg' } }]]);

    const r = await fetchXTweet(X_ID, X_URL);
    expect(r.avatar).toBe('https://pbs.twimg.com/profile_images/9/abc_400x400.jpg');
    expect(r.followers).toBeNull();
    expect(r.authorCreatedAt).toBeNull();
  });

  test('Bluesky: getProfile がアバターを上書きし、フォロワーと作成日を運ぶ', async () => {
    mockFetch([
      ['resolveHandle', { did: DID }],
      ['getPostThread', { thread: { post: { author: { handle: 'alice.bsky.social', did: DID, displayName: 'Alice', avatar: 'https://cdn.bsky/basic.jpg' }, record: { text: 'hi', createdAt: '2026-01-01T00:00:00Z' } } } }],
      ['getProfile', { followersCount: 4242, createdAt: '2023-05-06T07:08:09.000Z', avatar: 'https://cdn.bsky/full.jpg' }],
    ]);

    const r = await fetchBlueskyPost(BSKY_ID, BSKY_URL);
    expect(r).toMatchObject({ avatar: 'https://cdn.bsky/full.jpg', followers: 4242, authorCreatedAt: '2023-05-06T07:08:09.000Z' });
  });

  test('Bluesky: getProfile が落ちたら投稿側のアバターを保ち、残りは null', async () => {
    mockFetch([
      ['resolveHandle', { did: DID }],
      ['getPostThread', { thread: { post: { author: { handle: 'alice.bsky.social', did: DID, avatar: 'https://cdn.bsky/basic.jpg' }, record: { text: 'hi', createdAt: '2026-01-01T00:00:00Z' } } } }],
      // getProfile の経路は用意しない → 404
    ]);

    const r = await fetchBlueskyPost(BSKY_ID, BSKY_URL);
    expect(r.avatar).toBe('https://cdn.bsky/basic.jpg');
    expect(r.followers).toBeNull();
  });

  test('Misskey: users/show からアバター・フォロワー・作成日', async () => {
    mockFetch([
      ['/api/notes/show', { text: 'hi', user: { id: 'u1', username: 'alice', avatarUrl: 'https://mi/lite.png' }, createdAt: '2026-01-01T00:00:00Z' }],
      ['/api/users/show', { followersCount: 99, createdAt: '2022-02-02T00:00:00.000Z', avatarUrl: 'https://mi/full.png' }],
    ]);

    const r = await fetchMisskeyNote({ platform: 'misskey', host: 'misskey.io', noteId: 'abc' }, 'https://misskey.io/notes/abc');
    expect(r).toMatchObject({ avatar: 'https://mi/full.png', followers: 99, authorCreatedAt: '2022-02-02T00:00:00.000Z' });
  });

  // pixiv: アバターは /ajax/user の imageBig。フォロワー数も作成日も公開されていない(X と同じ)
  test('pixiv: アバターは imageBig、フォロワーと作成日は null', async () => {
    mockFetch([
      ['/ajax/illust/', { error: false, body: { illustTitle: 'T', userName: 'P', userId: '42', pageCount: 1, urls: { original: 'https://i.pximg/p0.jpg' }, tags: { tags: [] } } }],
      ['/ajax/user/', { error: false, body: { userId: '42', name: 'P', image: 'https://i.pximg/small.jpg', imageBig: 'https://i.pximg/big.jpg' } }],
    ]);

    const r = await fetchPixivIllust({ platform: 'pixiv', id: '555' }, 'https://www.pixiv.net/artworks/555');
    expect(r.avatar).toBe('https://i.pximg/big.jpg');
    expect(r.followers).toBeNull();
    expect(r.authorCreatedAt).toBeNull();
  });
});

describe('#119 St1: 動画・GIF の直リンク抽出', () => {
  // X: video は最高ビットレートの mp4 バリアントを選ぶ(mp4 でない HLS のプレイリストは無視)。
  // poster は写真と同じ静止画の URL(末尾に ?name=orig を付けたもの)。
  test('X: video は最高ビットレートの mp4＋?name=orig のポスター', async () => {
    mockFetch([
      [
        'cdn.syndication.twimg.com',
        {
          text: 'hi',
          user: { screen_name: 'alice', id_str: '1' },
          mediaDetails: [
            {
              type: 'video',
              media_url_https: 'https://pbs.twimg.com/tweet_video_thumb/abc.jpg',
              video_info: {
                variants: [
                  { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/x.m3u8' },
                  { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/low.mp4' },
                  { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/high.mp4' },
                ],
              },
            },
          ],
        },
      ],
    ]);

    const r = await fetchXTweet({ platform: 'x', id: '1', screenName: 'alice' }, 'https://x.com/alice/status/1');
    expect(r.media).toHaveLength(1);
    expect(r.media[0]).toMatchObject({ type: 'video', url: 'https://video.twimg.com/high.mp4', poster: 'https://pbs.twimg.com/tweet_video_thumb/abc.jpg?name=orig' });
  });

  test('X: animated_gif は type gif で、唯一の mp4 バリアントを使う', async () => {
    mockFetch([
      [
        'cdn.syndication.twimg.com',
        {
          text: 'hi',
          user: { screen_name: 'alice', id_str: '1' },
          mediaDetails: [{ type: 'animated_gif', media_url_https: 'https://pbs.twimg.com/tweet_video_thumb/g.jpg', video_info: { variants: [{ content_type: 'video/mp4', url: 'https://video.twimg.com/g.mp4' }] } }],
        },
      ],
    ]);

    const r = await fetchXTweet({ platform: 'x', id: '2', screenName: 'alice' }, 'https://x.com/alice/status/2');
    expect(r.media[0]).toMatchObject({ type: 'gif', url: 'https://video.twimg.com/g.mp4' });
  });

  test('Misskey: DriveFile の直 url と thumbnailUrl のポスター', async () => {
    mockFetch([['/api/notes/show', { text: 'hi', user: { username: 'alice' }, createdAt: '2026-01-01T00:00:00Z', files: [{ type: 'video/mp4', url: 'https://mi/clip.mp4', thumbnailUrl: 'https://mi/clip-thumb.jpg', comment: null }] }]]);

    const r = await fetchMisskeyNote({ platform: 'misskey', host: 'misskey.io', noteId: 'v1' }, 'https://misskey.io/notes/v1');
    expect(r.media).toHaveLength(1);
    expect(r.media[0]).toMatchObject({ type: 'video', url: 'https://mi/clip.mp4', poster: 'https://mi/clip-thumb.jpg' });
  });

  // Misskey の本物の image/gif は静止画として運ばれる(mp4 で裏打ちされた X の
  // 「gif」とは違う)。ダウンロードの type は undefined のままにして、native host が静止画
  // として取りに行くようにする(MEDIA_MIME_EXT は image/gif を扱える)。動画の経路へ流しては
  // いけない。
  test('Misskey: 本物の image/gif は静止画の経路（type も poster も付かない）', async () => {
    mockFetch([['/api/notes/show', { text: 'hi', user: { username: 'alice' }, createdAt: '2026-01-01T00:00:00Z', files: [{ type: 'image/gif', url: 'https://mi/anim.gif', thumbnailUrl: 'https://mi/anim-thumb.jpg', comment: null }] }]]);

    const r = await fetchMisskeyNote({ platform: 'misskey', host: 'misskey.io', noteId: 'v2' }, 'https://misskey.io/notes/v2');
    expect(r.mediaType).toBe('gif'); // note の階層で表示に使うラベルは gif のまま
    expect(r.media).toHaveLength(1);
    expect(r.media[0].url).toBe('https://mi/anim.gif');
    expect(r.media[0].type).toBeUndefined();
    expect(r.media[0].poster).toBeUndefined();
  });
});

// Bluesky の動画は HLS のプレイリストとして配られるが、投稿者が上げた原本は repo に
// blob として残っていて誰でも取れる＝PDS を1回引けば、St1 と同じ「直リンクの URL を
// 組み立てる」やり方に持ち込める。
describe('#119 St2: Bluesky の動画は原本 blob を直接取る', () => {
  const VIDEO_CID = 'bafkreivideo';
  const videoView = {
    $type: 'app.bsky.embed.video#view',
    cid: VIDEO_CID,
    playlist: 'https://video.bsky.app/watch/did/cid/playlist.m3u8',
    thumbnail: 'https://video.bsky.app/watch/did/cid/thumbnail.jpg',
    alt: 'a clip',
    aspectRatio: { width: 1280, height: 720 },
  };
  const videoPost = (embed: unknown) => ({
    author: { handle: 'alice.bsky.social', did: DID, displayName: 'Alice' },
    record: { text: 'hi', createdAt: '2026-01-01T00:00:00Z' },
    embed,
  });
  const DID_DOC = { service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://enoki.example.host/' }] };

  test('DID ドキュメントの PDS から getBlob の URL を組み、poster はサムネイル', async () => {
    mockFetch([
      ['resolveHandle', { did: DID }],
      ['getPostThread', { thread: { post: videoPost(videoView) } }],
      ['plc.directory', DID_DOC],
    ]);

    const r = await fetchBlueskyPost(BSKY_ID, BSKY_URL);
    expect(r.mediaType).toBe('video');
    expect(r.media).toHaveLength(1);
    expect(r.media[0]).toMatchObject({
      type: 'video',
      url: `https://enoki.example.host/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(DID)}&cid=${VIDEO_CID}`,
      poster: videoView.thumbnail,
      alt: 'a clip',
      width: 1280,
      height: 720,
    });
  });

  test('recordWithMedia の中の動画も同じ扱い', async () => {
    mockFetch([
      ['resolveHandle', { did: DID }],
      ['getPostThread', { thread: { post: videoPost({ $type: 'app.bsky.embed.recordWithMedia#view', record: {}, media: videoView }) } }],
      ['plc.directory', DID_DOC],
    ]);

    expect((await fetchBlueskyPost(BSKY_ID, BSKY_URL)).media[0]).toMatchObject({ type: 'video', url: expect.stringContaining('com.atproto.sync.getBlob') });
  });

  // PDS を引けない＝原本の在り処が分からない。動画は諦めるが、サムネイルは普通の静止画
  // として残す(その投稿が何だったかの絵は手元に残る／note の階層のラベルは video のまま)
  test('PDS が引けなければサムネイルを静止画として残す', async () => {
    mockFetch([
      ['resolveHandle', { did: DID }],
      ['getPostThread', { thread: { post: videoPost(videoView) } }],
      // plc.directory の経路は用意しない → 404
    ]);

    const r = await fetchBlueskyPost(BSKY_ID, BSKY_URL);
    expect(r.mediaType).toBe('video');
    expect(r.media).toHaveLength(1);
    expect(r.media[0].url).toBe(videoView.thumbnail);
    expect(r.media[0].type).toBeUndefined();
  });

  test('画像だけの投稿は DID ドキュメントを引かない', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: unknown) => {
      const u = String(url);
      seen.push(u);
      if (u.includes('resolveHandle')) return Response.json({ did: DID });
      if (u.includes('getPostThread')) {
        return Response.json({ thread: { post: videoPost({ $type: 'app.bsky.embed.images#view', images: [{ fullsize: 'https://cdn.bsky/full.jpg', alt: null }] }) } });
      }
      return new Response('{}', { status: 404 });
    });

    const r = await fetchBlueskyPost(BSKY_ID, BSKY_URL);
    expect(r.media[0].url).toBe('https://cdn.bsky/full.jpg');
    expect(seen.some((u) => u.includes('plc.directory'))).toBe(false);
  });

  test('did:web は .well-known/did.json から引く', async () => {
    const webDid = 'did:web:pds.example.com';
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: unknown) => {
      const u = String(url);
      seen.push(u);
      if (u.includes('resolveHandle')) return Response.json({ did: webDid });
      if (u.includes('getPostThread')) return Response.json({ thread: { post: { ...videoPost(videoView), author: { handle: 'alice.example.com', did: webDid } } } });
      if (u.includes('did.json')) return Response.json(DID_DOC);
      return new Response('{}', { status: 404 });
    });

    const r = await fetchBlueskyPost(BSKY_ID, BSKY_URL);
    expect(seen).toContain('https://pds.example.com/.well-known/did.json');
    expect(r.media[0].url).toBe(`https://enoki.example.host/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(webDid)}&cid=${VIDEO_CID}`);
  });

  test('DID ドキュメントも取得原本として積む（#292）', async () => {
    mockFetch([
      ['resolveHandle', { did: DID }],
      ['getPostThread', { thread: { post: videoPost(videoView) } }],
      ['getProfile', { followersCount: 1 }],
      ['plc.directory', DID_DOC],
    ]);

    const r = await fetchBlueskyPost(BSKY_ID, BSKY_URL);
    expect(r.raw.map((x: any) => x.sourceKind)).toEqual(['api:bluesky/resolveHandle', 'api:bluesky/getPostThread', 'api:bluesky/getProfile', 'api:bluesky/didDocument']);
  });
});

// #292 の原本保存の原則。正規化した欄へ引き上げたかどうかに関わらず、届いた応答は
// そのまま残す(投稿は消えてもライブラリは残る＝後から取り直しはできない)。ここで見るのは
// 「受け取った本文が一字一句そのまま raw へ積まれるか」だけで、DB へ入れるための圧縮・
// ハッシュ・容量上限は native-host 側の仕事(raw-payload.test.ts)。
describe('取得原本（#292）', () => {
  test('応答本文が一字一句そのまま積まれる（正規化が読まないフィールドごと）', async () => {
    const body = { text: 'hi', mediaDetails: [], user: { name: 'Alice', screen_name: 'alice', id_str: '1' }, unknown_future_field: { nested: [1, 2] } };
    mockFetch([['cdn.syndication.twimg.com', body]]);

    const r = await fetchXTweet(X_ID, X_URL);

    expect(r.raw).toHaveLength(1);
    expect(r.raw[0].sourceKind).toBe('api:x/tweet-result');
    expect(r.raw[0].contentType).toBe('application/json');
    expect(JSON.parse(r.raw[0].body).unknown_future_field).toEqual({ nested: [1, 2] });
  });

  // 1レコードで取得が複数回になることがある(投稿そのもの＋投稿者のプロフィール)＝raw も取得ごとに残す
  test('投稿者プロフィールなど付随の取得も別の原本として積む', async () => {
    mockFetch([
      ['resolveHandle', { did: DID }],
      ['getPostThread', { thread: { post: { record: { text: 'hi' }, author: { did: DID, handle: 'alice.bsky.social' } } } }],
      ['getProfile', { followersCount: 5, createdAt: '2020-01-01T00:00:00Z' }],
    ]);

    const r = await fetchBlueskyPost(BSKY_ID, BSKY_URL);

    expect(r.raw.map((x: any) => x.sourceKind)).toEqual(['api:bluesky/resolveHandle', 'api:bluesky/getPostThread', 'api:bluesky/getProfile']);
  });

  // メタデータを取り出せなかった保存こそ raw が要る場面＝後から中身を読み直す唯一の手がかり
  test('壊れて解釈できない応答でも本文は残る（metaError になっても捨てない）', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>rate limited</html>', { status: 200, headers: { 'content-type': 'text/html' } }));

    const r = await fetchXTweet(X_ID, X_URL);

    expect(r.metaError).toBe('fetchFailed');
    expect(r.raw[0].body).toBe('<html>rate limited</html>');
    expect(r.raw[0].contentType).toBe('text/html');
  });

  test('そもそも取得しなかった経路の原本は空（対応外プラットフォーム）', async () => {
    mockFetch([]);
    expect((await fetchPostMetadata('https://example.com/whatever')).raw).toEqual([]);
  });

  // 境界は「そのレコードのために届いた payload」＝隣の投稿は raw に含めない。これは応答を
  // 削って守るのではなく、そもそも要求しないことで守る。
  test('Bluesky は先祖投稿を要求しない（応答に混ざりようがない）', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: unknown) => {
      calls.push(String(url));
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });

    await fetchBlueskyPost({ platform: 'bluesky', handle: DID, rkey: 'rk' }, BSKY_URL);

    expect(calls.find((u) => u.includes('getPostThread'))).toContain('parentHeight=0');
  });
});

// #505: X の embed API は、投稿情報を出せない理由を tombstone のテキストで名乗る。
// 年齢制限のときだけ何も名乗らず {} を返す。空であること自体が合図なので、
// 「テキストを読めなかった」を unavailable(＝削除)へ流してはいけない。
// 実ライブラリの X の投稿 951件で観測した4つの形を並べて固定する(2026-07-29)。
describe('X: 投稿情報が出せない理由の分類', () => {
  const tombstone = (text?: string) => ({ __typename: 'TweetTombstone', tombstone: text ? { text: { text } } : {} });
  // 実在の id(snowflake＝上位ビットに投稿の時刻を含む)。X_ID の '123' は snowflake 形式より
  // 前のものなので日時を復元できず、このテストで見たい性質を測れない。
  const RESTRICTED = { platform: 'x', id: '2069378728497746227', screenName: 'alice' };

  test.each([
    ['空の tombstone＝年齢制限（Xは理由を名乗らない）', undefined, 'ageRestricted'],
    ['Age-restricted adult content. Learn more', 'Age-restricted adult content. Learn more', 'ageRestricted'],
    ['投稿者が削除', 'This Post was deleted by the Post author. Learn more', 'unavailable'],
    ['アカウント消滅', 'This Post is from an account that no longer exists. Learn more', 'unavailable'],
    ['鍵付き', 'You’re unable to view this Post because this account owner limits who can view their Posts. Learn more', 'protected'],
  ])('%s → %s', async (_name, text, expected) => {
    mockFetch([['tweet-result', tombstone(text as string | undefined)]]);

    const r = await fetchXTweet(RESTRICTED, X_URL);

    expect(r.metaError).toBe(expected);
    // 投稿の id が時刻を持つ＝本文を取れなくても日付は復元できる
    expect(r.date).toBeTruthy();
  });

  // HTTP 404 は、その id の投稿が存在しないという意味(削除ではなく、そもそも存在しない)。
  // 200＋tombstone とは別の経路なので、年齢制限へ流れ込まないことを見る。
  test('HTTP 404 は unavailable のまま', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>not found</html>', { status: 404 }));

    expect((await fetchXTweet(X_ID, X_URL)).metaError).toBe('unavailable');
  });
});
