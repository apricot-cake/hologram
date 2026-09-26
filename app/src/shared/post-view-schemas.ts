import { z } from 'zod';
import { PostRecordSchema } from '../../../native-host/post-schemas.mts';
import { PostFlagsSchema, PosterProfileSchema } from './data-schemas.ts';

// 保存済み投稿から、一覧表示に必要な列とタグの導出結果を組み立てる。
export const PostViewSchema = PostRecordSchema.omit({ bio: true, profileLinks: true, banner: true, bannerFile: true, capturedVia: true, replaces: true }).extend({
  localViewCount: z.number().int().nonnegative(),
  lastViewedAt: PostFlagsSchema.shape.lastViewedAt,
  userKind: PostFlagsSchema.shape.userKind,
  tagReviewed: PostFlagsSchema.shape.tagReviewed,
  tagIds: z.array(z.number().int()),
});
export type PostView = z.output<typeof PostViewSchema>;

export const PosterViewSchema = PosterProfileSchema.pick({ platform: true, userId: true, displayName: true, screenName: true, bio: true, avatarFile: true, bannerFile: true, followers: true, following: true, authorCreatedAt: true, firstObservedAt: true, lastObservedAt: true }).extend({
  key: PosterProfileSchema.shape.posterKey,
  names: PosterProfileSchema.shape.names,
});
export type PosterView = z.output<typeof PosterViewSchema>;

// ゴミ箱やタグの再計算中には、DB 由来の集計値を持たない。
export const PostDisplaySchema = PostViewSchema.partial({ localViewCount: true, tagIds: true });
export type PostDisplay = z.output<typeof PostDisplaySchema>;
