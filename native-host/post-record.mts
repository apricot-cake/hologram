import { CropRectSchema, PostRecordInputSchema, type PostRecordInput, type PostRecordShape, type CropRectShape } from './post-schemas.mts';
export type { PostRecordInput, PostRecordShape, MediaItemShape, CropRectShape, QuotedPostShape, PollChoiceShape, PollShape, LinkCardShape, ProfileLinkShape } from './post-schemas.mts';

export function normalizeCropRect(value: unknown): CropRectShape | null {
  return CropRectSchema.nullable().parse(value);
}
const VIDEO_FILE = /\.(mp4|webm|mov|m4v)$/i;
export function isVideoFileName(name: string | null | undefined): boolean {
  return typeof name === 'string' && VIDEO_FILE.test(name);
}

// URL だけの投稿を保存済みと扱わない。本文だけの投稿やリンクカードは内容を持つ。
export function recordHoldsContent(record: Partial<PostRecordShape> | null | undefined): boolean {
  if (!record) return false;
  if (record.image || record.video || record.text || record.title || record.displayName) return true;
  return !!(record.media?.length || record.linkCard?.url);
}

export function normalizePostRecord(input: PostRecordInput, now: () => string = () => new Date().toISOString()): PostRecordShape {
  const parsed = PostRecordInputSchema.parse(input);
  const capturedAt = parsed.capturedAt ?? now();
  const imageIsVideo = isVideoFileName(parsed.image);
  return {
    ...parsed,
    capturedAt,
    updatedAt: parsed.updatedAt ?? capturedAt,
    image: imageIsVideo ? null : parsed.image,
    video: parsed.video ?? (imageIsVideo ? parsed.image : null),
  };
}
