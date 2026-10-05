import { z } from 'zod';
import { CountSchema } from '../../../native-host/post-schemas.mts';

// AppView の利用する項目だけを検証する。追加項目と open union の未知の型は保持し、
// 既知の型に読み替えない。根拠: atproto Lexicon、app.bsky.{feed,actor,embed} の公式定義。
const dateText = z
  .string()
  .min(1)
  .refine((value) => Number.isFinite(Date.parse(value)), { message: 'Invalid date' });
const dimensions = z.looseObject({ width: z.number().int().positive(), height: z.number().int().positive() });
const author = z.looseObject({ did: z.string().min(1), handle: z.string().min(1), displayName: z.string().optional(), avatar: z.string().optional() });
export const BlueskyProfileSchema = author.extend({
  banner: z.string().optional(),
  description: z.string().optional(),
  // 件数の非負条件は Hologram の保存契約。負値を丸めて正常にしない。
  followersCount: CountSchema.optional(),
  followsCount: CountSchema.optional(),
  createdAt: dateText.optional(),
});
export const BlueskyImagesSchema = z.array(z.looseObject({ fullsize: z.string().min(1), alt: z.string(), aspectRatio: dimensions.optional() }));
export const BlueskyExternalSchema = z.looseObject({ uri: z.string().min(1), title: z.string(), description: z.string(), thumb: z.string().optional() });
export const BlueskyVideoSchema = z.looseObject({ cid: z.string().min(1), playlist: z.string().min(1), alt: z.string().optional(), thumbnail: z.string().optional(), aspectRatio: dimensions.optional() });
export const BLUESKY_MEDIA_VIEW_TYPES = ['app.bsky.embed.images#view', 'app.bsky.embed.video#view', 'app.bsky.embed.external#view'] as const;
export const BLUESKY_EMBED_VIEW_TYPES = [...BLUESKY_MEDIA_VIEW_TYPES, 'app.bsky.embed.record#view', 'app.bsky.embed.recordWithMedia#view'] as const;
const unknownView = (known: readonly string[]) => z.looseObject({ $type: z.string().min(1) }).refine((value) => !known.includes(value.$type), { message: 'Invalid known embed' });
export const BlueskyMediaViewSchema = z.union([
  z.looseObject({ $type: z.literal('app.bsky.embed.images#view'), images: BlueskyImagesSchema }),
  BlueskyVideoSchema.extend({ $type: z.literal('app.bsky.embed.video#view') }),
  z.looseObject({ $type: z.literal('app.bsky.embed.external#view'), external: BlueskyExternalSchema }),
  unknownView(BLUESKY_EMBED_VIEW_TYPES),
]);
const feedRecord = z.looseObject({
  $type: z.literal('app.bsky.feed.post').optional(),
  text: z.string(),
  createdAt: dateText,
  embed: z.looseObject({ $type: z.string() }).optional(),
  reply: z.looseObject({ parent: z.looseObject({ uri: z.string().min(1) }), root: z.looseObject({ uri: z.string().min(1) }).optional() }).optional(),
  tags: z.array(z.string()).optional(),
  langs: z.array(z.string()).optional(),
  facets: z.array(z.looseObject({ features: z.array(z.union([z.looseObject({ $type: z.literal('app.bsky.richtext.facet#tag'), tag: z.string() }), z.looseObject({ $type: z.string() }).refine((value) => value.$type !== 'app.bsky.richtext.facet#tag', { message: 'Missing tag' })])) })).optional(),
  labels: z.looseObject({ values: z.array(z.looseObject({ val: z.string() })) }).optional(),
});
export const BlueskyFeedRecordSchema = feedRecord;
// value は Lexicon の unknown。投稿型かどうかの確認と検証は取り込み時に行う。
const quotedRecord = z.looseObject({
  $type: z.string().optional(),
  uri: z.string().optional(),
  value: z.unknown().optional(),
  author: author.partial().optional(),
  embeds: z.array(BlueskyMediaViewSchema).optional(),
});
export const BlueskyQuotedSchema = z.union([quotedRecord.refine((value) => value.$type === undefined || value.$type === 'app.bsky.embed.record#viewRecord', { message: 'Unknown quoted record' }), unknownView(['app.bsky.embed.record#viewRecord'])]);
const recordView = z.looseObject({
  $type: z.literal('app.bsky.embed.record#view'),
  record: z.union([quotedRecord.extend({ record: BlueskyQuotedSchema.optional() }).refine((value) => value.$type === undefined || value.$type === 'app.bsky.embed.record#viewRecord', { message: 'Unknown quoted record' }), unknownView(['app.bsky.embed.record#viewRecord'])]),
});
const embedView = z.union([...BlueskyMediaViewSchema.options.slice(0, 3), recordView, z.looseObject({ $type: z.literal('app.bsky.embed.recordWithMedia#view'), media: BlueskyMediaViewSchema, record: recordView }), unknownView(BLUESKY_EMBED_VIEW_TYPES)]);
export const BlueskyPostSchema = z.looseObject({
  uri: z.string().min(1),
  cid: z.string().min(1),
  indexedAt: dateText,
  author,
  record: feedRecord,
  embed: embedView.optional(),
  likeCount: CountSchema.optional(),
  repostCount: CountSchema.optional(),
  replyCount: CountSchema.optional(),
});
export const BlueskyThreadResponseSchema = z.object({
  thread: z
    .looseObject({ $type: z.string().optional(), uri: z.string().optional(), post: BlueskyPostSchema.optional() })
    .refine((thread) => thread.post !== undefined || (['app.bsky.feed.defs#notFoundPost', 'app.bsky.feed.defs#blockedPost'].includes(thread.$type ?? '') && !!thread.uri), { message: 'Missing thread post' }),
});
