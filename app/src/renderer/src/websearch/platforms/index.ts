// 採用した5つのプラットフォームの表。並びはポップオーバーの表示順（保存の経路が並べるのと
// 同じ順＝#204 と 射程.md の「X / Bluesky / Misskey / Mastodon / pixiv」）。
import type { PlatformDef } from '../types.ts';
import { xPlatform } from './x.ts';
import { blueskyPlatform } from './bluesky.ts';
import { misskeyPlatform } from './misskey.ts';
import { mastodonPlatform } from './mastodon.ts';
import { pixivPlatform } from './pixiv.ts';

export const ALL_PLATFORMS: readonly PlatformDef[] = [xPlatform, blueskyPlatform, misskeyPlatform, mastodonPlatform, pixivPlatform];

export { xPlatform, blueskyPlatform, misskeyPlatform, mastodonPlatform, pixivPlatform };
export { buildGoogleQuery, type GoogleBuildResult } from './google.ts';
