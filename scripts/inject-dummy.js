// Paste this into the viewer page's DevTools console (F12) to inject dummy data.
// To remove: Settings tab > "Delete all data"

(async () => {
  // 1x1 colored JPEG placeholders (platform-colored)
  function makeImg(hex, label) {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 300;
    const ctx = c.getContext('2d');
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, 400, 300);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label || 'Dummy', 200, 160);
    return c.toDataURL('image/jpeg', 0.8);
  }

  const imgX = makeImg('#14171a', 'X');
  const imgBsky = makeImg('#0085ff', 'Bluesky');
  const imgMk = makeImg('#96d04a', 'Misskey');
  const imgVid = makeImg('#900', 'VIDEO');
  const imgGif = makeImg('#660', 'GIF');

  const posts = [
    // --- X: normal post with image ---
    {
      url: 'https://x.com/testuser1/status/100000001',
      platform: 'x', text: 'TypeScriptの型パズル、解けた時の快感がすごい。再帰型テンプレートリテラル最高 #typescript #programming',
      displayName: 'てすと太郎', screenName: 'testuser1', userId: '111111',
      likes: 24853, reposts: 3210, replies: 142, bookmarks: 891, views: 580000,
      date: '2026-04-04T10:30:00Z', capturedAt: '2026-04-04T12:00:00Z',
      mediaType: 'image', lang: 'ja', isReply: null, isQuote: null, isThread: null,
      tags: ['TypeScript', 'プログラミング'],
      image: imgX
    },
    // --- X: English reply ---
    {
      url: 'https://x.com/testuser2/status/100000002',
      platform: 'x', text: 'Good morning! Starting the day with coffee and code.',
      displayName: 'Dev Jane', screenName: 'testuser2', userId: '222222',
      likes: 5, reposts: 0, replies: 1, bookmarks: 0, views: 230,
      date: '2026-04-03T01:15:00Z', capturedAt: '2026-04-03T08:00:00Z',
      mediaType: 'none', lang: 'en', isReply: true, isQuote: null, isThread: null,
      tags: [],
      image: imgX
    },
    // --- X: quote tweet ---
    {
      url: 'https://x.com/testuser3/status/100000003',
      platform: 'x', text: 'これは面白い視点。引用元の投稿も見てほしい',
      displayName: 'サンプル花子', screenName: 'testuser3', userId: '333333',
      likes: 48, reposts: 12, replies: 3, bookmarks: 5, views: 8900,
      date: '2026-03-28T15:00:00Z', capturedAt: '2026-03-29T03:00:00Z',
      mediaType: 'none', lang: 'ja', isReply: null, isQuote: true, isThread: null,
      quotedUrl: 'https://x.com/someone/status/99999999',
      tags: [],
      image: imgX
    },
    // --- X: self-thread ---
    {
      url: 'https://x.com/testuser1/status/100000005',
      platform: 'x', text: '続き）さらに詳しく説明すると、型レベルプログラミングはこういう場面で役立ちます',
      displayName: 'てすと太郎', screenName: 'testuser1', userId: '111111',
      likes: 892, reposts: 45, replies: 8, bookmarks: 120, views: 32000,
      date: '2026-04-04T10:35:00Z', capturedAt: '2026-04-04T12:01:00Z',
      mediaType: 'none', lang: 'ja', isReply: null, isQuote: null, isThread: true,
      tags: ['TypeScript'],
      image: imgX
    },
    // --- X: video post, big numbers ---
    {
      url: 'https://x.com/bigaccount/status/100000004',
      platform: 'x', text: '100万いいね目指してます',
      displayName: 'バズりたい', screenName: 'bigaccount', userId: '444444',
      likes: 987654, reposts: 123456, replies: 45678, bookmarks: 12345, views: 45000000,
      date: '2026-04-05T00:00:00Z', capturedAt: '2026-04-05T01:00:00Z',
      mediaType: 'video', lang: 'ja', isReply: null, isQuote: null, isThread: null,
      tags: ['バズ'],
      image: imgVid
    },
    // --- X: GIF post ---
    {
      url: 'https://x.com/gifuser/status/100000006',
      platform: 'x', text: 'This reaction GIF is perfect 😂',
      displayName: 'GIF Master', screenName: 'gifuser', userId: '555555',
      likes: 210, reposts: 15, replies: 4, bookmarks: 8, views: 12000,
      date: '2026-04-03T18:00:00Z', capturedAt: '2026-04-03T18:05:00Z',
      mediaType: 'gif', lang: 'en', isReply: null, isQuote: null, isThread: null,
      tags: ['GIF', 'reaction'],
      image: imgGif
    },
    // --- Bluesky: normal post, image ---
    {
      url: 'https://bsky.app/profile/dummy.bsky.social/post/abc001',
      platform: 'bluesky', text: 'Blueskyの空は今日も青い。分散SNSの未来を感じる投稿テストです 🦋✨ #bluesky',
      displayName: 'あおぞら', screenName: 'dummy.bsky.social', userId: 'did:plc:dummy001',
      likes: 347, reposts: 28, replies: 12, bookmarks: null, views: null,
      date: '2026-04-02T08:45:00Z', capturedAt: '2026-04-02T09:00:00Z',
      mediaType: 'image', lang: 'ja', isReply: null, isQuote: null, isThread: null,
      tags: ['Bluesky'],
      image: imgBsky
    },
    // --- Bluesky: text-only post ---
    {
      url: 'https://bsky.app/profile/skytest.bsky.social/post/abc002',
      platform: 'bluesky', text: 'Interesting take on decentralized social media. The future is federated.',
      displayName: 'Sky Tester', screenName: 'skytest.bsky.social', userId: 'did:plc:dummy002',
      likes: 15, reposts: 3, replies: 1, bookmarks: null, views: null,
      date: '2026-03-20T22:00:00Z', capturedAt: '2026-03-21T06:30:00Z',
      mediaType: 'none', lang: 'en', isReply: null, isQuote: null, isThread: null,
      tags: [],
      image: imgBsky
    },
    // --- Bluesky: text-only thread ---
    {
      url: 'https://bsky.app/profile/replier.bsky.social/post/abc003',
      platform: 'bluesky', text: '(4/4) まとめると、ATプロトコルの将来が楽しみ',
      displayName: 'リプライヤー', screenName: 'replier.bsky.social', userId: 'did:plc:dummy003',
      likes: 2, reposts: 0, replies: 0, bookmarks: null, views: null,
      date: '2026-04-02T09:00:00Z', capturedAt: '2026-04-02T09:05:00Z',
      mediaType: 'none', lang: 'ja', isReply: null, isQuote: null, isThread: true,
      tags: [],
      image: imgBsky
    },
    // --- Misskey: video post ---
    {
      url: 'https://misskey.io/notes/dummy001',
      platform: 'misskey', text: 'Misskeyからこんにちは！リアクション機能の使い方動画 :blobcat:',
      displayName: 'みすきーテスト', screenName: 'mktest', userId: 'mk001',
      likes: 89, reposts: 5, replies: 3, bookmarks: null, views: null,
      date: '2026-04-01T14:20:00Z', capturedAt: '2026-04-01T14:25:00Z',
      mediaType: 'video', lang: null, isReply: null, isQuote: null, isThread: null,
      tags: ['Misskey'],
      image: imgVid
    },
    // --- Misskey: text-only quote ---
    {
      url: 'https://misskey.io/notes/dummy002',
      platform: 'misskey', text: 'MFMテスト $[sparkle ✨キラキラ✨] すごすぎて草',
      displayName: 'ノート職人', screenName: 'notemaster', userId: 'mk002',
      likes: 1502, reposts: 201, replies: 44, bookmarks: null, views: null,
      date: '2026-03-15T06:00:00Z', capturedAt: '2026-03-15T07:00:00Z',
      mediaType: 'none', lang: null, isReply: null, isQuote: true, isThread: null,
      quotedUrl: 'https://misskey.io/notes/xyz001',
      tags: [],
      image: imgMk
    },
    // --- Misskey: thread with video ---
    {
      url: 'https://nijimiss.moe/notes/dummy003',
      platform: 'misskey', text: '(3/3) 最後に動画で解説🌈',
      displayName: 'にじみす民', screenName: 'nijifan', userId: 'nj001',
      likes: 12, reposts: 0, replies: 1, bookmarks: null, views: null,
      date: '2026-03-30T20:00:00Z', capturedAt: '2026-03-30T20:02:00Z',
      mediaType: 'video', lang: 'ja', isReply: null, isQuote: null, isThread: true,
      tags: [],
      image: imgVid
    },
    // --- Misskey: reply with GIF ---
    {
      url: 'https://misskey.io/notes/mk007',
      platform: 'misskey', text: 'ワロタ :blobcatlaugh:',
      displayName: '初心者', screenName: 'newbie_mk', userId: 'mk007',
      likes: 0, reposts: 0, replies: 0, bookmarks: null, views: null,
      date: '2026-04-05T12:00:00Z', capturedAt: '2026-04-05T12:01:00Z',
      mediaType: 'gif', lang: 'ja', isReply: true, isQuote: null, isThread: null,
      tags: [],
      image: imgGif
    },

    // ====== Additional posts (14-50) ======

    // --- Misskey: image post ---
    {
      url: 'https://misskey.io/notes/mk014',
      platform: 'misskey', text: 'Misskeyのウィジェット機能で天気表示してみた。便利 #misskey',
      displayName: 'みすきー布教', screenName: 'mkfan', userId: 'mk014',
      likes: 182, reposts: 31, replies: 6, bookmarks: null, views: null,
      date: '2026-04-03T07:20:00Z', capturedAt: '2026-04-03T08:00:00Z',
      mediaType: 'image', lang: 'ja', isReply: null, isQuote: null, isThread: null,
      tags: ['Misskey', 'ウィジェット'],
      image: imgMk
    },
    // --- Bluesky: video post ---
    {
      url: 'https://bsky.app/profile/technews.bsky.social/post/bv001',
      platform: 'bluesky', text: 'Quick video demo of the new Bluesky video upload feature. Finally!',
      displayName: 'Tech News Daily', screenName: 'technews.bsky.social', userId: 'did:plc:tn001',
      likes: 345, reposts: 89, replies: 12, bookmarks: null, views: null,
      date: '2026-04-01T16:00:00Z', capturedAt: '2026-04-01T16:05:00Z',
      mediaType: 'video', lang: 'en', isReply: null, isQuote: null, isThread: null,
      tags: ['Bluesky', 'video'],
      image: imgBsky
    },
    // --- Bluesky: reply with video ---
    {
      url: 'https://bsky.app/profile/coder.bsky.social/post/bv002',
      platform: 'bluesky', text: '動画で解説しますね。Blueskyのフィード仕組みはこうです',
      displayName: 'ゆき@エンジニア', screenName: 'coder.bsky.social', userId: 'did:plc:cy001',
      likes: 8, reposts: 0, replies: 2, bookmarks: null, views: null,
      date: '2026-04-03T08:10:00Z', capturedAt: '2026-04-03T09:00:00Z',
      mediaType: 'video', lang: 'ja', isReply: true, isQuote: null, isThread: null,
      tags: ['Bluesky'],
      image: imgBsky
    },
    // --- X #17: self-thread, image ---
    {
      url: 'https://x.com/designtips/status/100000017',
      platform: 'x', text: 'デザインシステムの構築について連ツイします。まずはカラートークンの定義から。デザインとコードの橋渡しが重要です (1/5)',
      displayName: 'デザインのコツ', screenName: 'designtips', userId: '700004',
      likes: 2340, reposts: 567, replies: 34, bookmarks: 890, views: 120000,
      date: '2026-03-25T11:00:00Z', capturedAt: '2026-03-25T12:00:00Z',
      mediaType: 'image', lang: 'ja', isReply: null, isQuote: null, isThread: true,
      tags: ['デザイン', 'UI'],
      image: imgX
    },
    // --- Misskey: quote with image ---
    {
      url: 'https://misskey.io/notes/mk018',
      platform: 'misskey', text: 'この比較画像がわかりやすい。引用しておきます',
      displayName: 'みすきー比較', screenName: 'mk_compare', userId: 'mk018',
      likes: 156, reposts: 23, replies: 11, bookmarks: null, views: null,
      date: '2026-03-22T20:30:00Z', capturedAt: '2026-03-22T21:00:00Z',
      mediaType: 'image', lang: 'ja', isReply: null, isQuote: true, isThread: null,
      quotedUrl: 'https://misskey.io/notes/xyz002',
      tags: ['Misskey'],
      image: imgMk
    },
    // --- X #19: reply with GIF ---
    {
      url: 'https://x.com/neta_taro/status/100000019',
      platform: 'x', text: '@someone これ完全にわかる😂',
      displayName: 'ネタ太郎', screenName: 'neta_taro', userId: '700006',
      likes: 45230, reposts: 12300, replies: 890, bookmarks: 3400, views: 5600000,
      date: '2026-03-31T23:00:00Z', capturedAt: '2026-04-01T00:00:00Z',
      mediaType: 'gif', lang: 'ja', isReply: true, isQuote: null, isThread: null,
      tags: ['ネタ', '月曜日'],
      image: imgGif
    },
    // --- X #20: art post with image ---
    {
      url: 'https://x.com/illustrator_mio/status/100000020',
      platform: 'x', text: '今日の一枚。夕焼けと猫のシルエット。Procreateで2時間くらい #イラスト #猫 #art',
      displayName: 'みお🎨イラストレーター', screenName: 'illustrator_mio', userId: '700007',
      likes: 8901, reposts: 1234, replies: 156, bookmarks: 2345, views: 340000,
      date: '2026-04-02T17:30:00Z', capturedAt: '2026-04-02T18:00:00Z',
      mediaType: 'image', lang: 'ja', isReply: null, isQuote: null, isThread: null,
      tags: ['イラスト', '猫', 'Procreate'],
      image: imgX
    },
    // --- X #21: self-thread with GIF ---
    {
      url: 'https://x.com/viral_clips/status/100000021',
      platform: 'x', text: '(3/3) And finally, the deployment result... 💀',
      displayName: 'Viral Clips', screenName: 'viral_clips', userId: '700008',
      likes: 245000, reposts: 67000, replies: 8900, bookmarks: 15000, views: 32000000,
      date: '2026-03-28T12:00:00Z', capturedAt: '2026-03-28T13:00:00Z',
      mediaType: 'gif', lang: 'en', isReply: null, isQuote: null, isThread: true,
      tags: ['programming', 'funny'],
      image: imgGif
    },
    // --- Misskey: reply with image ---
    {
      url: 'https://misskey.io/notes/mk022',
      platform: 'misskey', text: 'スクショ貼りますね。こんな感じです',
      displayName: 'ROM専', screenName: 'silent_mk', userId: 'mk022',
      likes: 0, reposts: 0, replies: 0, bookmarks: null, views: null,
      date: '2026-04-04T22:00:00Z', capturedAt: '2026-04-04T22:01:00Z',
      mediaType: 'image', lang: 'ja', isReply: true, isQuote: null, isThread: null,
      tags: [],
      image: imgMk
    },
    // --- Misskey: thread with GIF ---
    {
      url: 'https://misskey.io/notes/mk023',
      platform: 'misskey', text: '(3/3) 最後にまとめGIF :blobcatcool:',
      displayName: 'みすきー解説', screenName: 'mk_explain', userId: 'mk023',
      likes: 156, reposts: 43, replies: 8, bookmarks: null, views: null,
      date: '2026-03-20T09:00:00Z', capturedAt: '2026-03-20T10:00:00Z',
      mediaType: 'gif', lang: 'ja', isReply: null, isQuote: null, isThread: true,
      tags: ['Misskey'],
      image: imgGif
    },
    // --- X #24: quote with image ---
    {
      url: 'https://x.com/jpnews/status/100000024',
      platform: 'x', text: 'この記事のグラフがわかりやすい。画像にまとめました',
      displayName: '日本ニュース速報', screenName: 'jpnews', userId: '700011',
      likes: 3400, reposts: 2100, replies: 456, bookmarks: 890, views: 1200000,
      date: '2026-04-01T06:00:00Z', capturedAt: '2026-04-01T06:05:00Z',
      mediaType: 'image', lang: 'ja', isReply: null, isQuote: true, isThread: null,
      quotedUrl: 'https://x.com/someone/status/99900002',
      tags: ['ニュース', 'IT人材'],
      image: imgX
    },
    // --- X #25: mixed language post ---
    {
      url: 'https://x.com/bilingual_dev/status/100000025',
      platform: 'x', text: '今日のlearning: CSS Container Queriesが全ブラウザでstableになった。これでresponsive designがcomponentレベルでできる！',
      displayName: 'バイリンガルDev', screenName: 'bilingual_dev', userId: '700012',
      likes: 567, reposts: 89, replies: 23, bookmarks: 134, views: 34000,
      date: '2026-03-18T13:45:00Z', capturedAt: '2026-03-18T14:00:00Z',
      mediaType: 'none', lang: 'ja', isReply: null, isQuote: null, isThread: null,
      tags: ['CSS', 'フロントエンド'],
      image: imgX
    },
    // --- Bluesky: quote with video ---
    {
      url: 'https://bsky.app/profile/commenter.bsky.social/post/bv003',
      platform: 'bluesky', text: 'この動画がわかりやすい。引用しておきます',
      displayName: 'コメンター', screenName: 'commenter.bsky.social', userId: 'did:plc:cm001',
      likes: 234, reposts: 56, replies: 12, bookmarks: null, views: null,
      date: '2026-04-01T07:00:00Z', capturedAt: '2026-04-01T07:05:00Z',
      mediaType: 'video', lang: 'ja', isReply: null, isQuote: true, isThread: null,
      quotedUrl: 'https://bsky.app/profile/someone/post/xyz003',
      tags: ['Bluesky'],
      image: imgBsky
    },
    // --- X #27: image post, low engagement, English ---
    {
      url: 'https://x.com/photographer_dan/status/100000027',
      platform: 'x', text: 'Caught the cherry blossoms at peak bloom this morning. Tokyo is beautiful in spring.',
      displayName: 'Dan Photography', screenName: 'photographer_dan', userId: '700013',
      likes: 42, reposts: 3, replies: 5, bookmarks: 12, views: 2300,
      date: '2026-03-27T06:30:00Z', capturedAt: '2026-03-27T07:00:00Z',
      mediaType: 'image', lang: 'en', isReply: null, isQuote: null, isThread: null,
      tags: ['photography', '桜'],
      image: imgX
    },
    // --- X #28: self-thread with video ---
    {
      url: 'https://x.com/designtips/status/100000028',
      platform: 'x', text: '(2/5) 動画でデモします。実際のCSS変数の定義方法と適用の流れ',
      displayName: 'デザインのコツ', screenName: 'designtips', userId: '700004',
      likes: 1890, reposts: 345, replies: 22, bookmarks: 670, views: 95000,
      date: '2026-03-25T11:05:00Z', capturedAt: '2026-03-25T12:01:00Z',
      mediaType: 'video', lang: 'ja', isReply: null, isQuote: null, isThread: true,
      tags: ['デザイン', 'タイポグラフィ'],
      image: imgVid
    },
    // --- X #29: reply with video ---
    {
      url: 'https://x.com/cooking_papa/status/100000029',
      platform: 'x', text: '@chef_master こちらが動画です。参考にどうぞ',
      displayName: '料理パパ', screenName: 'cooking_papa', userId: '700014',
      likes: 4500, reposts: 1200, replies: 89, bookmarks: 3400, views: 560000,
      date: '2026-03-29T18:00:00Z', capturedAt: '2026-03-29T18:05:00Z',
      mediaType: 'video', lang: 'ja', isReply: true, isQuote: null, isThread: null,
      tags: ['料理', 'レシピ'],
      image: imgVid
    },
    // --- X #30: English reply with image ---
    {
      url: 'https://x.com/webdev_sarah/status/100000030',
      platform: 'x', text: '@airesearcher Great thread. Here is a diagram I made showing the attention complexity comparison between standard and linear transformers.',
      displayName: 'Sarah Chen', screenName: 'webdev_sarah', userId: '700005',
      likes: 890, reposts: 123, replies: 34, bookmarks: 567, views: 67000,
      date: '2026-03-20T11:00:00Z', capturedAt: '2026-03-20T11:05:00Z',
      mediaType: 'image', lang: 'en', isReply: true, isQuote: null, isThread: null,
      tags: ['AI', 'diagram'],
      image: imgX
    },
    // --- X #32: quote with video ---
    {
      url: 'https://x.com/illustrator_mio/status/100000032',
      platform: 'x', text: 'この技法めちゃくちゃ参考になる。自分の作業動画と比較してみた',
      displayName: 'みお🎨イラストレーター', screenName: 'illustrator_mio', userId: '700007',
      likes: 12400, reposts: 2300, replies: 234, bookmarks: 4500, views: 890000,
      date: '2026-03-26T19:00:00Z', capturedAt: '2026-03-26T19:05:00Z',
      mediaType: 'video', lang: 'ja', isReply: null, isQuote: true, isThread: null,
      quotedUrl: 'https://x.com/someone/status/99900003',
      tags: ['イラスト', 'タイムラプス', 'メイキング'],
      image: imgVid
    },
    // --- X #35: quote with GIF ---
    {
      url: 'https://x.com/gifuser/status/100000035',
      platform: 'x', text: 'Still relevant in 2026 lmao',
      displayName: 'GIF Master', screenName: 'gifuser', userId: '555555',
      likes: 34000, reposts: 8900, replies: 1200, bookmarks: 2300, views: 4500000,
      date: '2026-03-19T10:00:00Z', capturedAt: '2026-03-19T10:05:00Z',
      mediaType: 'gif', lang: 'en', isReply: null, isQuote: true, isThread: null,
      quotedUrl: 'https://x.com/someone/status/99900004',
      tags: ['CSS', 'programming', 'GIF'],
      image: imgGif
    },
    // --- Misskey: quote with GIF ---
    {
      url: 'https://misskey.io/notes/mk036',
      platform: 'misskey', text: 'これは草 $[shake 🤣]',
      displayName: 'みすきーネタ', screenName: 'mk_neta', userId: 'mk036',
      likes: 123, reposts: 34, replies: 8, bookmarks: null, views: null,
      date: '2026-04-01T17:00:00Z', capturedAt: '2026-04-01T17:05:00Z',
      mediaType: 'gif', lang: 'ja', isReply: null, isQuote: true, isThread: null,
      quotedUrl: 'https://misskey.io/notes/xyz003',
      tags: ['Misskey', 'ネタ'],
      image: imgGif
    },

    // --- Bluesky #38: GIF post ---
    {
      url: 'https://bsky.app/profile/artist.bsky.social/post/abc004',
      platform: 'bluesky', text: 'Digital painting process in GIF form! Cyberpunk cityscape timelapse #digitalart',
      displayName: 'Digital Artist', screenName: 'artist.bsky.social', userId: 'did:plc:dummy004',
      likes: 892, reposts: 145, replies: 34, bookmarks: null, views: null,
      date: '2026-03-26T14:00:00Z', capturedAt: '2026-03-26T14:05:00Z',
      mediaType: 'gif', lang: 'en', isReply: null, isQuote: null, isThread: null,
      tags: ['digitalart', 'cyberpunk'],
      image: imgGif
    },
    // --- Bluesky #39: reply with image ---
    {
      url: 'https://bsky.app/profile/bskyuser2.bsky.social/post/abc005',
      platform: 'bluesky', text: 'これがスクショです。フィード設定画面はこんな感じ',
      displayName: 'Bluesky移住民', screenName: 'bskyuser2.bsky.social', userId: 'did:plc:dummy005',
      likes: 45, reposts: 8, replies: 3, bookmarks: null, views: null,
      date: '2026-04-03T10:00:00Z', capturedAt: '2026-04-03T10:05:00Z',
      mediaType: 'image', lang: 'ja', isReply: true, isQuote: null, isThread: null,
      tags: ['Bluesky', 'フィード'],
      image: imgBsky
    },
    // --- Bluesky #40: thread with image ---
    {
      url: 'https://bsky.app/profile/techwriter.bsky.social/post/abc006',
      platform: 'bluesky', text: 'ATProtocolの技術解説スレッド。まずDIDとハンドルの関係図をご覧ください (1/4)',
      displayName: 'テック解説員', screenName: 'techwriter.bsky.social', userId: 'did:plc:dummy006',
      likes: 1230, reposts: 345, replies: 67, bookmarks: null, views: null,
      date: '2026-03-22T08:00:00Z', capturedAt: '2026-03-22T09:00:00Z',
      mediaType: 'image', lang: 'ja', isReply: null, isQuote: null, isThread: true,
      tags: ['ATProtocol', 'Bluesky'],
      image: imgBsky
    },
    // --- Bluesky #41: thread with video ---
    {
      url: 'https://bsky.app/profile/photog.bsky.social/post/abc007',
      platform: 'bluesky', text: '(2/4) And heres the video version of that forest walk. The sounds are incredible.',
      displayName: 'Lens & Light', screenName: 'photog.bsky.social', userId: 'did:plc:dummy007',
      likes: 23, reposts: 2, replies: 4, bookmarks: null, views: null,
      date: '2026-03-30T05:30:00Z', capturedAt: '2026-03-30T06:00:00Z',
      mediaType: 'video', lang: 'en', isReply: null, isQuote: null, isThread: true,
      tags: ['photography', 'nature'],
      image: imgBsky
    },
    // --- Bluesky #42: quote with image ---
    {
      url: 'https://bsky.app/profile/bskyuser2.bsky.social/post/abc008',
      platform: 'bluesky', text: '図解してみた。ATProtocolのDID解決フロー',
      displayName: 'Bluesky移住民', screenName: 'bskyuser2.bsky.social', userId: 'did:plc:dummy005',
      likes: 67, reposts: 12, replies: 2, bookmarks: null, views: null,
      date: '2026-03-22T10:00:00Z', capturedAt: '2026-03-22T10:05:00Z',
      mediaType: 'image', lang: 'ja', isReply: null, isQuote: true, isThread: null,
      quotedUrl: 'https://bsky.app/profile/techwriter.bsky.social/post/abc006',
      tags: ['ATProtocol'],
      image: imgBsky
    },
    // --- Bluesky #43: text-only quote ---
    {
      url: 'https://bsky.app/profile/devrel.bsky.social/post/abc009',
      platform: 'bluesky', text: 'Great summary of the API changes. Highly recommend reading this.',
      displayName: 'Bluesky DevRel', screenName: 'devrel.bsky.social', userId: 'did:plc:dummy008',
      likes: 456, reposts: 89, replies: 23, bookmarks: null, views: null,
      date: '2026-04-04T16:00:00Z', capturedAt: '2026-04-04T16:05:00Z',
      mediaType: 'none', lang: 'en', isReply: null, isQuote: true, isThread: null,
      quotedUrl: 'https://bsky.app/profile/someone/post/xyz001',
      tags: ['Bluesky', 'API'],
      image: imgBsky
    },
    // --- Bluesky #44: thread with GIF ---
    {
      url: 'https://bsky.app/profile/newuser.bsky.social/post/abc010',
      platform: 'bluesky', text: '(3/4) 移行の感想をGIFで表現するとこんな感じ',
      displayName: 'はじめました', screenName: 'newuser.bsky.social', userId: 'did:plc:dummy009',
      likes: 0, reposts: 0, replies: 0, bookmarks: null, views: null,
      date: '2026-04-05T08:00:00Z', capturedAt: '2026-04-05T08:01:00Z',
      mediaType: 'gif', lang: 'ja', isReply: null, isQuote: null, isThread: true,
      tags: [],
      image: imgGif
    },
    // --- Bluesky #45: reply with GIF ---
    {
      url: 'https://bsky.app/profile/funpost.bsky.social/post/abc011',
      platform: 'bluesky', text: 'わかりみが深い😂',
      displayName: 'おもしろ投稿', screenName: 'funpost.bsky.social', userId: 'did:plc:dummy010',
      likes: 2340, reposts: 567, replies: 89, bookmarks: null, views: null,
      date: '2026-03-15T12:00:00Z', capturedAt: '2026-03-15T12:05:00Z',
      mediaType: 'gif', lang: 'ja', isReply: true, isQuote: null, isThread: null,
      tags: ['Bluesky', 'ネタ'],
      image: imgGif
    },
    // --- Bluesky #46: text-only reply ---
    {
      url: 'https://bsky.app/profile/skytest.bsky.social/post/abc012',
      platform: 'bluesky', text: '@devrel Thanks for the demo! Will the new feed generator SDK support TypeScript natively?',
      displayName: 'Sky Tester', screenName: 'skytest.bsky.social', userId: 'did:plc:dummy002',
      likes: 5, reposts: 0, replies: 1, bookmarks: null, views: null,
      date: '2026-04-04T17:00:00Z', capturedAt: '2026-04-04T17:05:00Z',
      mediaType: 'none', lang: 'en', isReply: true, isQuote: null, isThread: null,
      tags: ['TypeScript'],
      image: imgBsky
    },
    // --- Bluesky #47: quote with GIF ---
    {
      url: 'https://bsky.app/profile/dummy.bsky.social/post/abc013',
      platform: 'bluesky', text: '500万人突破の瞬間のリアクション',
      displayName: 'あおぞら', screenName: 'dummy.bsky.social', userId: 'did:plc:dummy001',
      likes: 8900, reposts: 2340, replies: 345, bookmarks: null, views: null,
      date: '2026-03-17T20:00:00Z', capturedAt: '2026-03-17T20:05:00Z',
      mediaType: 'gif', lang: 'ja', isReply: null, isQuote: true, isThread: null,
      quotedUrl: 'https://bsky.app/profile/someone/post/xyz002',
      tags: ['Bluesky', 'イラスト', '記念'],
      image: imgGif
    },

    // --- Misskey #48: text-only post ---
    {
      url: 'https://misskey.io/notes/dummy004',
      platform: 'misskey', text: 'Misskeyのドライブ機能、地味に便利すぎない？画像管理がSNS内で完結する #misskey',
      displayName: 'みすきー廃人', screenName: 'mkheavy', userId: 'mk003',
      likes: 234, reposts: 45, replies: 12, bookmarks: null, views: null,
      date: '2026-04-03T15:00:00Z', capturedAt: '2026-04-03T15:05:00Z',
      mediaType: 'none', lang: 'ja', isReply: null, isQuote: null, isThread: null,
      tags: ['Misskey', 'ドライブ'],
      image: imgMk
    },
    // --- Misskey #49: thread with image ---
    {
      url: 'https://misskey.io/notes/dummy005',
      platform: 'misskey', text: 'Misskeyのカスタム絵文字について語るスレ。各サーバーの一覧画像を添付 (1/3)',
      displayName: 'みすきーテスト', screenName: 'mktest', userId: 'mk001',
      likes: 156, reposts: 23, replies: 34, bookmarks: null, views: null,
      date: '2026-03-28T10:00:00Z', capturedAt: '2026-03-28T10:05:00Z',
      mediaType: 'image', lang: 'ja', isReply: null, isQuote: null, isThread: true,
      tags: ['Misskey', 'カスタム絵文字'],
      image: imgMk
    },
    // --- Misskey #50: text-only thread ---
    {
      url: 'https://misskey.io/notes/dummy006',
      platform: 'misskey', text: '(2/3) MFM formatting is really unique to Misskey. No other fediverse platform has it.',
      displayName: 'Fediverse Explorer', screenName: 'fediexplorer', userId: 'mk004',
      likes: 78, reposts: 12, replies: 5, bookmarks: null, views: null,
      date: '2026-03-21T18:00:00Z', capturedAt: '2026-03-21T18:05:00Z',
      mediaType: 'none', lang: 'en', isReply: null, isQuote: null, isThread: true,
      tags: ['Misskey', 'Fediverse'],
      image: imgMk
    },
    // --- Misskey #51: reply with video ---
    {
      url: 'https://misskey.io/notes/dummy007',
      platform: 'misskey', text: 'うちのサーバーのblobcat動く様子がこちら',
      displayName: 'えもじ職人', screenName: 'emojimaker', userId: 'mk005',
      likes: 0, reposts: 0, replies: 0, bookmarks: null, views: null,
      date: '2026-03-28T11:00:00Z', capturedAt: '2026-03-28T11:05:00Z',
      mediaType: 'video', lang: 'ja', isReply: true, isQuote: null, isThread: null,
      tags: [],
      image: imgVid
    },
    // --- Misskey #52: quote with video ---
    {
      url: 'https://nijimiss.moe/notes/dummy008',
      platform: 'misskey', text: 'にじみすのテーマ変更手順を動画にしました',
      displayName: 'にじみす民', screenName: 'nijifan', userId: 'nj001',
      likes: 45, reposts: 8, replies: 3, bookmarks: null, views: null,
      date: '2026-04-01T20:00:00Z', capturedAt: '2026-04-01T20:05:00Z',
      mediaType: 'video', lang: 'ja', isReply: null, isQuote: true, isThread: null,
      quotedUrl: 'https://misskey.io/notes/dummy004',
      tags: ['にじみす', 'テーマ'],
      image: imgVid
    },
    // --- Misskey #53: text-only reply ---
    {
      url: 'https://misskey.io/notes/dummy009',
      platform: 'misskey', text: 'MFMの基本構文は公式ドキュメントが参考になりますよ',
      displayName: 'ノート職人', screenName: 'notemaster', userId: 'mk002',
      likes: 3400, reposts: 890, replies: 123, bookmarks: null, views: null,
      date: '2026-03-23T22:00:00Z', capturedAt: '2026-03-23T22:05:00Z',
      mediaType: 'none', lang: 'ja', isReply: true, isQuote: null, isThread: null,
      tags: ['MFM', 'Misskey'],
      image: imgMk
    },
    // --- Misskey #54: GIF post ---
    {
      url: 'https://misskey.io/notes/dummy010',
      platform: 'misskey', text: 'サーバー管理者の日常。深夜にアップデートして祈る',
      displayName: 'サバ管', screenName: 'serveradmin', userId: 'mk006',
      likes: 567, reposts: 89, replies: 23, bookmarks: null, views: null,
      date: '2026-04-02T02:00:00Z', capturedAt: '2026-04-02T02:05:00Z',
      mediaType: 'gif', lang: 'ja', isReply: null, isQuote: null, isThread: null,
      tags: ['サーバー管理', 'Misskey'],
      image: imgGif
    },
  ];

  await chrome.storage.local.set({ posts });
  console.log(`Injected ${posts.length} dummy posts`);
  location.reload();
})();
