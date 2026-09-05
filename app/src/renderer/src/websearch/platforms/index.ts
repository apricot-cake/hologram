// 採用した3つのプラットフォームの表。並びはポップオーバーの表示順と同じ。
import type { PlatformDef } from '../types.ts';
import { xPlatform } from './x.ts';
import { blueskyPlatform } from './bluesky.ts';
import { pixivPlatform } from './pixiv.ts';

export const ALL_PLATFORMS: readonly PlatformDef[] = [xPlatform, blueskyPlatform, pixivPlatform];

export { xPlatform, blueskyPlatform, pixivPlatform };
export { buildGoogleQuery, type GoogleBuildResult } from './google.ts';
