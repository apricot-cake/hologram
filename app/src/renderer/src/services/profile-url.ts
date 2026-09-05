// 投稿者のプロフィールの URL＝出自のサイトにある外部のユーザーページ（#663）。「この投稿者の
// 投稿を見る」（posterViewPosts）とは別物で、あちらは Hologram の中に留まってライブラリを
// この投稿者で絞る。こちらは shell.openExternal に、プラットフォーム側の URL を渡す。対応する
// プラットフォームをまとめて1か所に置いてあるのは、それぞれ必要な形が違い、間違った部品を
// 間違ったプラットフォームへ渡すと、他人のページに着くか 404 になる URL が組み上がるから。
//
// 欄は、DB が投稿／投稿者ごとに既に保存しているものからそのまま取る（スキーマの変更は無い）＝
// extractor/{x,bluesky,pixiv}.ts はどれも、出自のサイト自身のプロフィールの
// 経路が期待する識別子を `screenName` に書く。
//   x / bluesky＝ハンドルだけ（screenName）。
//   pixiv＝pixiv には @ 付きのハンドルがそもそも無い（pixiv.ts 自身のコメント）。
//     `screenName` は数値の pixiv のユーザー id で、`userId` を使い回している。
export interface ProfileUrlSubject {
  platform: string | null | undefined;
  screenName: string | null | undefined;
}

export function posterProfileUrl(u: ProfileUrlSubject): string | null {
  if (!u.screenName) return null;
  switch (u.platform) {
    case 'x':
      return `https://x.com/${u.screenName}`;
    case 'bluesky':
      return `https://bsky.app/profile/${u.screenName}`;
    case 'pixiv':
      return `https://www.pixiv.net/users/${u.screenName}`;
    default:
      return null;
  }
}
