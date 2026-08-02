// The five adopted-platforms table, in the popover's display order (same order the save
// path lists them - #204/scope.md's "X / Bluesky / Misskey / Mastodon / pixiv").
import type { PlatformDef } from '../types.ts';
import { xPlatform } from './x.ts';
import { blueskyPlatform } from './bluesky.ts';
import { misskeyPlatform } from './misskey.ts';
import { mastodonPlatform } from './mastodon.ts';
import { pixivPlatform } from './pixiv.ts';

export const ALL_PLATFORMS: readonly PlatformDef[] = [xPlatform, blueskyPlatform, misskeyPlatform, mastodonPlatform, pixivPlatform];

export { xPlatform, blueskyPlatform, misskeyPlatform, mastodonPlatform, pixivPlatform };
export { buildGoogleQuery, type GoogleBuildResult } from './google.ts';
