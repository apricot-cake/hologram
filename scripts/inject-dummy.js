// Paste this into the viewer page's DevTools console (F12) to inject dummy data.
// To remove: Settings tab > "Delete all data"

(async () => {
  // 1x1 colored JPEG placeholders (platform-colored)
  function makeImg(hex) {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 300;
    const ctx = c.getContext('2d');
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, 400, 300);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Dummy Image', 200, 160);
    return c.toDataURL('image/jpeg', 0.8);
  }

  const imgX = makeImg('#14171a');
  const imgBsky = makeImg('#0085ff');
  const imgMk = makeImg('#96d04a');

  const posts = [
    {
      url: 'https://x.com/testuser1/status/100000001',
      platform: 'x', text: 'TypeScriptの型パズル、解けた時の快感がすごい。再帰型テンプレートリテラル最高',
      displayName: 'てすと太郎', screenName: 'testuser1', userId: '111111',
      likes: 24853, reposts: 3210, replies: 142, bookmarks: 891,
      date: '2026-04-04T10:30:00Z', capturedAt: '2026-04-04T12:00:00Z', image: imgX
    },
    {
      url: 'https://x.com/testuser2/status/100000002',
      platform: 'x', text: 'Good morning! Starting the day with coffee and code.',
      displayName: 'Dev Jane', screenName: 'testuser2', userId: '222222',
      likes: 5, reposts: 0, replies: 1, bookmarks: 0,
      date: '2026-04-03T01:15:00Z', capturedAt: '2026-04-03T08:00:00Z', image: imgX
    },
    {
      url: 'https://x.com/testuser3/status/100000003',
      platform: 'x', text: '新しいChrome拡張を作っています。SNS投稿をキャプチャして検索できるやつ。もうすぐリリース予定！',
      displayName: 'サンプル花子', screenName: 'testuser3', userId: '333333',
      likes: 0, reposts: 0, replies: 0, bookmarks: null,
      date: '2026-03-28T15:00:00Z', capturedAt: '2026-03-29T03:00:00Z', image: imgX
    },
    {
      url: 'https://bsky.app/profile/dummy.bsky.social/post/abc001',
      platform: 'bluesky', text: 'Blueskyの空は今日も青い。分散SNSの未来を感じる投稿テストです。絵文字もOK 🦋✨',
      displayName: 'あおぞら', screenName: 'dummy.bsky.social', userId: 'did:plc:dummy001',
      likes: 347, reposts: 28, replies: 12, bookmarks: null,
      date: '2026-04-02T08:45:00Z', capturedAt: '2026-04-02T09:00:00Z', image: imgBsky
    },
    {
      url: 'https://bsky.app/profile/skytest.bsky.social/post/abc002',
      platform: 'bluesky', text: 'This is a longer post to test how the viewer handles text truncation. The quick brown fox jumps over the lazy dog. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      displayName: 'Sky Tester', screenName: 'skytest.bsky.social', userId: 'did:plc:dummy002',
      likes: 1, reposts: null, replies: 0, bookmarks: null,
      date: '2026-03-20T22:00:00Z', capturedAt: '2026-03-21T06:30:00Z', image: imgBsky
    },
    {
      url: 'https://misskey.io/notes/dummy001',
      platform: 'misskey', text: 'Misskeyからこんにちは！リアクション機能が楽しい :blobcat:',
      displayName: 'みすきーテスト', screenName: 'mktest', userId: 'mk001',
      likes: 89, reposts: 5, replies: 3, bookmarks: null,
      date: '2026-04-01T14:20:00Z', capturedAt: '2026-04-01T14:25:00Z', image: imgMk
    },
    {
      url: 'https://misskey.io/notes/dummy002',
      platform: 'misskey', text: 'MFMテスト $[sparkle ✨キラキラ✨]',
      displayName: 'ノート職人', screenName: 'notemaster', userId: 'mk002',
      likes: 1502, reposts: 201, replies: 44, bookmarks: null,
      date: '2026-03-15T06:00:00Z', capturedAt: '2026-03-15T07:00:00Z', image: imgMk
    },
    {
      url: 'https://x.com/bigaccount/status/100000004',
      platform: 'x', text: '100万いいね目指してます',
      displayName: 'バズりたい', screenName: 'bigaccount', userId: '444444',
      likes: 987654, reposts: 123456, replies: 45678, bookmarks: 12345,
      date: '2026-04-05T00:00:00Z', capturedAt: '2026-04-05T01:00:00Z', image: imgX
    },
  ];

  await chrome.storage.local.set({ posts });
  console.log(`Injected ${posts.length} dummy posts`);
  location.reload();
})();
