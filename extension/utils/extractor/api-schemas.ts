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
    // 連携先がない実応答は {} ではなく []。空配列だけを空オブジェクトへ揃える。
    .union([
      z.record(z.string(), z.looseObject({ url: z.string() })),
      z
        .array(z.never())
        .length(0)
        .transform(() => ({})),
    ])
    .nullable()
    .optional(),
});
export { BlueskyProfileSchema, BlueskyImagesSchema, BlueskyExternalSchema, BlueskyVideoSchema, BlueskyQuotedSchema, BlueskyPostSchema, BlueskyThreadResponseSchema } from './bluesky-api-schemas.ts';
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
// 一つの付随情報の不整合で、独立して取得できた本文や媒体を捨てない。
export const XPostCoreSchema = XPostSchema.omit({ mediaDetails: true, quoted_tweet: true, parent: true, card: true, user: true, entities: true, edit_control: true, favorite_count: true, conversation_count: true });
export const XUserCoreSchema = xUser.pick({ id_str: true, name: true, screen_name: true });
export const XAvatarSchema = xUser.pick({ profile_image_url_https: true });
export const XProfileSchema = xUser.omit({ id_str: true, name: true, screen_name: true, profile_image_url_https: true });
export const XCountsSchema = XPostSchema.pick({ favorite_count: true, conversation_count: true });
export const XEntitiesSchema = entities;
export const XCardSchema = XPostSchema.shape.card;
export const XEditSchema = XPostSchema.shape.edit_control;
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
export const PixivIllustCoreSchema = PixivIllustSchema.omit({ illustComment: true, description: true, likeCount: true, bookmarkCount: true, viewCount: true, commentCount: true, seriesNavData: true, tags: true });
export const PixivTextSchema = PixivIllustSchema.pick({ illustComment: true, description: true });
export const PixivCountsSchema = PixivIllustSchema.pick({ likeCount: true, bookmarkCount: true, viewCount: true, commentCount: true });
export const PixivTagsSchema = PixivIllustSchema.shape.tags;
export const PixivSeriesSchema = PixivIllustSchema.shape.seriesNavData;
export const PixivAvatarSchema = PixivProfileSchema.pick({ image: true, imageBig: true });
export const PixivBioSchema = PixivProfileSchema.pick({ comment: true, commentHtml: true });
export const PixivLinksSchema = PixivProfileSchema.pick({ webpage: true, social: true });
export function rethrowContractError(error: unknown): void {
  if (error instanceof z.ZodError || error instanceof SyntaxError) throw error;
}
