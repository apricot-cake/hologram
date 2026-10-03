import { z } from 'zod';
import { normalizeTagNames, tagNameInputIsSafe } from './tag-normalize.mts';

// 省略と null はデータがない状態。不正な型は欠損へ読み替えない。
const text = z
  .string()
  .nullable()
  .default(null)
  .transform((value) => (value === '' ? null : value));
export const CountSchema = z.number().int().nonnegative();
const count = CountSchema.nullable().default(null);
const flag = z.boolean().nullable().default(null);
export const CropRectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine((r) => r.x + r.width <= 1 && r.y + r.height <= 1, { message: 'Crop exceeds image bounds' });
export const FramesSchema = z.array(z.object({ file: z.string().min(1), delay: CountSchema })).min(1);
export const MediaItemSchema = z.object({
  url: z.string().default(''),
  alt: text,
  width: count,
  height: count,
  file: z.string().default(''),
  type: text,
  posterFile: text,
  frames: FramesSchema.nullable().default(null),
  crop: CropRectSchema.nullable().default(null),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  flipped: z.boolean().optional(),
});
export const QuotedPostSchema = z.object({
  captureId: z.string().optional(),
  url: text,
  displayName: text,
  screenName: text,
  userId: text,
  avatar: text,
  text,
  date: text,
  cw: text,
  media: z.array(MediaItemSchema).default([]),
});
export const PollChoiceSchema = z.object({ text: z.string().min(1), votes: count });
export const PollSchema = z.object({ choices: z.array(PollChoiceSchema).min(1), multiple: flag, expiresAt: text });
export const LinkCardSchema = z.object({ url: z.string().min(1), title: text, description: text, thumbnailFile: text });
export const ProfileLinkSchema = z.object({ name: z.string().min(1), value: z.string().min(1) });
export const SaveScopeSchema = z.enum(['post', 'media']);
// NFKC の前に処理量を検査する。文字数上限や transform 後の切り詰めではない。
export const TagNameInputSchema = z.string().refine(tagNameInputIsSafe, { message: 'Too many consecutive combining marks' });
export const PostRecordSchema = z.object({
  captureId: z.string().min(1),
  saveScope: SaveScopeSchema.default('post'),
  saveIncomplete: z.boolean().default(false),
  retryOf: z.string().min(1).optional(),
  mediaType: text,
  image: text,
  video: text,
  url: text,
  platform: text,
  text: text,
  title: text,
  displayName: text,
  screenName: text,
  userId: text,
  avatar: text,
  avatarFile: text,
  bio: text,
  profileLinks: z.array(ProfileLinkSchema).nullable().default(null),
  banner: text,
  bannerFile: text,
  followers: count,
  following: count,
  authorCreatedAt: text,
  likes: count,
  reposts: count,
  replies: count,
  bookmarks: count,
  views: count,
  date: text,
  capturedAt: z.string().min(1),
  updatedAt: z.string().min(1),
  capturedVia: text,
  lang: text,
  isReply: flag,
  isQuote: flag,
  isThread: flag,
  isEdited: flag,
  cw: text,
  sensitive: flag,
  quotedUrl: text,
  replyToId: text,
  quotedPost: QuotedPostSchema.nullable().default(null),
  replyToPost: QuotedPostSchema.nullable().default(null),
  poll: PollSchema.nullable().default(null),
  linkCard: LinkCardSchema.nullable().default(null),
  seriesId: text,
  seriesTitle: text,
  seriesOrder: count,
  hashtags: z.array(TagNameInputSchema).default([]).transform(normalizeTagNames),
  tags: z.array(TagNameInputSchema).default([]).transform(normalizeTagNames),
  domFilled: z.array(z.string()).default([]),
  media: z.array(MediaItemSchema).default([]),
  imageIndex: count,
  imageCount: count,
  eagleName: text,
  source: text,
  shotW: count,
  shotH: count,
  shotAnimated: flag,
  mediaMaxW: count,
  mediaMaxH: count,
  mediaMaxBytes: count,
  trashedAt: text,
  replaces: text,
  metaSource: z.record(z.string(), z.string().min(1)).nullable().default(null),
});
// 作成時刻は取り込み処理が決める。他の既定値と型は保存スキーマを共有する。
export const PostRecordInputSchema = PostRecordSchema.extend({ capturedAt: z.string().min(1).optional(), updatedAt: z.string().min(1).optional() });
export type PostRecordShape = z.output<typeof PostRecordSchema>;
export type PostRecordInput = z.input<typeof PostRecordInputSchema>;
export type MediaItemShape = z.output<typeof MediaItemSchema>;
export type CropRectShape = z.output<typeof CropRectSchema>;
export type QuotedPostShape = z.output<typeof QuotedPostSchema>;
export type PollChoiceShape = z.output<typeof PollChoiceSchema>;
export type PollShape = z.output<typeof PollSchema>;
export type LinkCardShape = z.output<typeof LinkCardSchema>;
export type ProfileLinkShape = z.output<typeof ProfileLinkSchema>;
