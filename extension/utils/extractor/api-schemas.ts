import { z } from 'zod';
import { CountSchema, FramesSchema } from '../../../native-host/post-schemas.mts';

const optionalText = z.string().nullable().optional();
const dateText = z
  .string()
  .min(1)
  .refine((value) => Number.isFinite(Date.parse(value)), { message: 'Invalid date' });
const entities = z
  .looseObject({
    urls: z.array(z.looseObject({ url: z.string(), expanded_url: z.string() })).optional(),
    hashtags: z.array(z.looseObject({ text: z.string() })).optional(),
  })
  .optional();

const dimensions = z.looseObject({ width: z.number().int().positive(), height: z.number().int().positive() });
const pixivUrls = z.looseObject({ original: z.string().min(1) });
export const PixivPagesSchema = z.array(z.looseObject({ urls: pixivUrls, width: CountSchema.optional(), height: CountSchema.optional() })).min(1);
export const PixivProfileSchema = z.looseObject({
  image: optionalText,
  imageBig: optionalText,
  comment: optionalText,
  commentHtml: optionalText,
  webpage: optionalText,
  social: z
    .record(z.string(), z.looseObject({ url: z.string() }))
    .nullable()
    .optional(),
});
export const BlueskyProfileSchema = z.looseObject({
  did: z.string().min(1),
  handle: z.string().min(1),
  avatar: z.string().optional(),
  banner: z.string().optional(),
  description: z.string().optional(),
  followersCount: CountSchema.optional(),
  followsCount: CountSchema.optional(),
  createdAt: dateText.optional(),
});
export const BlueskyImagesSchema = z.array(z.looseObject({ fullsize: z.string().min(1), alt: z.string(), aspectRatio: dimensions.optional() }));
export const BlueskyExternalSchema = z.looseObject({ uri: z.string().min(1), title: z.string(), description: z.string(), thumb: z.string().optional() });
export const BlueskyVideoSchema = z.looseObject({ cid: z.string().min(1), playlist: z.string().min(1), alt: z.string().optional(), thumbnail: z.string().optional(), aspectRatio: dimensions.optional() });
const bskyMediaView = z.looseObject({
  $type: z.string(),
  images: BlueskyImagesSchema.optional(),
  external: BlueskyExternalSchema.optional(),
  cid: z.string().optional(),
  playlist: z.string().optional(),
  thumbnail: z.string().optional(),
  alt: z.string().optional(),
  aspectRatio: dimensions.optional(),
});
export const BlueskyQuotedSchema = z.looseObject({
  uri: z.string().optional(),
  value: z.looseObject({ text: z.string().optional(), createdAt: dateText.optional() }).optional(),
  author: z.looseObject({ did: z.string().optional(), handle: z.string().optional(), displayName: z.string().optional(), avatar: z.string().optional() }).optional(),
  embeds: z.array(bskyMediaView).optional(),
});
const bskyEmbedView = bskyMediaView.extend({
  media: bskyMediaView.optional(),
  record: BlueskyQuotedSchema.extend({ record: BlueskyQuotedSchema.optional() }).optional(),
});
export const ResolveHandleSchema = z.object({ did: z.string().regex(/^did:[a-z]+:.+/) });
export const PixivEnvelopeSchema = z.looseObject({ error: z.boolean(), body: z.unknown().optional() });
export const XProfileUrlsSchema = z.array(z.looseObject({ url: z.string(), expanded_url: z.string().optional() }));
const xUser = z.looseObject({
  id_str: z.string().min(1),
  name: z.string(),
  screen_name: z.string().min(1),
  description: optionalText,
  followers_count: CountSchema.optional(),
  friends_count: CountSchema.optional(),
  created_at: dateText.optional(),
  profile_image_url_https: z.string().min(1),
  profile_banner_url_https: optionalText,
  profile_banner_url: optionalText,
  entities: z.looseObject({ url: z.looseObject({ urls: XProfileUrlsSchema }).optional(), description: entities }).optional(),
});
export const XMediaSchema = z.array(
  z.looseObject({
    type: z.string().min(1),
    media_url_https: z.string().min(1),
    ext_alt_text: optionalText,
    original_info: dimensions.optional(),
    video_info: z.looseObject({ variants: z.array(z.looseObject({ content_type: z.string(), url: z.string().min(1), bitrate: CountSchema.optional() })) }).optional(),
  }),
);
export const XQuotedSchema = z.looseObject({
  id_str: z.string().optional(),
  text: optionalText,
  created_at: dateText.optional(),
  user: xUser.partial().optional(),
  entities,
  mediaDetails: XMediaSchema.optional(),
});

export const DecimalCountSchema = z.string().regex(/^\d+$/).transform(Number).pipe(CountSchema);
export const CardStringBindingSchema = z.object({ string_value: z.string() });
export const CardImageBindingSchema = z.object({ image_value: z.object({ url: z.string().min(1) }) });
export const PixivUgoiraSchema = z.object({ originalSrc: z.string().min(1).optional(), src: z.string().min(1).optional(), frames: FramesSchema }).transform((body, ctx) => {
  const url = body.originalSrc || body.src;
  if (!url) {
    ctx.issues.push({ code: 'custom', input: body, message: 'Missing ugoira URL' });
    return z.NEVER;
  }
  return { ...body, url };
});

// X の埋め込み用 API と pixiv AJAX は保存済みの取得サンプルに基づく。
// X API v2 の契約を、別エンドポイントの必須項目の根拠にしない。
export const XPostSchema = z.looseObject({
  id_str: z.string().min(1),
  text: z.string(),
  created_at: dateText,
  user: xUser,
  lang: z.string(),
  mediaDetails: XMediaSchema.optional(),
  quoted_tweet: XQuotedSchema.optional(),
  parent: XQuotedSchema.optional(),
  card: z.looseObject({ name: z.string(), binding_values: z.record(z.string(), z.unknown()) }).optional(),
  favorite_count: CountSchema,
  conversation_count: CountSchema,
  // テキスト・引用・返信では実際の応答に存在しない。
  possibly_sensitive: z.boolean().optional(),
  entities,
  edit_control: z.looseObject({ edit_tweet_ids: z.array(z.string()) }).optional(),
});
export const PixivIllustSchema = z.looseObject({
  illustId: z.string().min(1),
  illustComment: optionalText,
  description: optionalText,
  illustType: CountSchema,
  pageCount: CountSchema.positive(),
  width: CountSchema,
  height: CountSchema,
  urls: pixivUrls,
  illustTitle: z.string(),
  userId: z.string().min(1),
  userName: z.string(),
  likeCount: CountSchema,
  bookmarkCount: CountSchema,
  viewCount: CountSchema,
  commentCount: CountSchema,
  seriesNavData: z.looseObject({ seriesId: z.string(), title: z.string(), order: CountSchema }).nullable().optional(),
  tags: z.looseObject({ tags: z.array(z.looseObject({ tag: z.string() })) }),
  createDate: dateText,
  uploadDate: dateText,
});
// app.bsky.feed.defs#postView と app.bsky.feed.post。件数は公式に省略可能。
export const BlueskyPostSchema = z.looseObject({
  uri: z.string().min(1),
  cid: z.string().min(1),
  indexedAt: dateText,
  author: z.looseObject({ did: z.string().min(1), handle: z.string().min(1), displayName: z.string().optional(), avatar: z.string().optional() }),
  embed: bskyEmbedView.optional(),
  record: z.looseObject({
    embed: z.looseObject({ $type: z.string() }).optional(),
    reply: z.looseObject({ parent: z.looseObject({ uri: z.string().min(1) }), root: z.looseObject({ uri: z.string().min(1) }).optional() }).optional(),
    text: z.string(),
    createdAt: dateText,
    tags: z.array(z.string()).optional(),
    langs: z.array(z.string()).optional(),
    facets: z.array(z.looseObject({ features: z.array(z.looseObject({ $type: z.string(), tag: z.string().optional() }).refine((feature) => feature.$type !== 'app.bsky.richtext.facet#tag' || feature.tag !== undefined, { path: ['tag'], message: 'Missing tag' })) })).optional(),
    labels: z.looseObject({ values: z.array(z.looseObject({ val: z.string() })) }).optional(),
  }),
  likeCount: CountSchema.optional(),
  repostCount: CountSchema.optional(),
  replyCount: CountSchema.optional(),
});

export const BlueskyThreadResponseSchema = z.object({
  thread: z
    .looseObject({ $type: z.string().optional(), uri: z.string().optional(), post: BlueskyPostSchema.optional() })
    .refine((thread) => thread.post !== undefined || (['app.bsky.feed.defs#notFoundPost', 'app.bsky.feed.defs#blockedPost'].includes(thread.$type ?? '') && !!thread.uri), { message: 'Missing thread post' }),
});

export function rethrowContractError(error: unknown): void {
  if (error instanceof z.ZodError || error instanceof SyntaxError) throw error;
}
