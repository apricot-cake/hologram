// Author profile URL — the external, ORIGIN-SITE user page (#663). Distinct from
// "View this poster's posts" (posterViewPosts), which stays inside Hologram and
// filters the library to this poster; this one hands shell.openExternal a URL on
// the platform itself. One place for all five platforms because each needs a
// different shape and handing the wrong piece to the wrong platform would build a
// URL that resolves to someone else's page or 404s.
//
// Fields come straight off what the DB already stores per post/poster (no schema
// change): extractor/{x,bluesky,misskey,mastodon,pixiv}.ts all write `screenName`
// with the identity the origin site's own profile route expects —
//   x / bluesky      — the handle alone (screenName).
//   misskey / mastodon — `username` for a LOCAL author, `username@remoteHost` for
//     a federated one (both extractors only add the `@host` suffix in the remote
//     case). Both platforms resolve /@user[@remoteHost] on ANY instance via their
//     own webfinger lookup, so the instance the post/poster was captured ON is
//     enough — no home-instance resolution needed.
//   pixiv             — pixiv has no @handle at all (pixiv.ts's own comment);
//     `screenName` is the numeric pixiv user id, reused from `userId`.
export interface ProfileUrlSubject {
  platform: string | null | undefined;
  screenName: string | null | undefined;
  // misskey/mastodon only — the instance host the post/poster was captured on
  // (poster-grid-builder's HologramUserAgg.instance, or hostOf(post.url)).
  instance?: string | null | undefined;
}

export function posterProfileUrl(u: ProfileUrlSubject): string | null {
  if (!u.screenName) return null;
  switch (u.platform) {
    case 'x':
      return `https://x.com/${u.screenName}`;
    case 'bluesky':
      return `https://bsky.app/profile/${u.screenName}`;
    case 'misskey':
    case 'mastodon':
      return u.instance ? `https://${u.instance}/@${u.screenName}` : null;
    case 'pixiv':
      return `https://www.pixiv.net/users/${u.screenName}`;
    default:
      return null;
  }
}
