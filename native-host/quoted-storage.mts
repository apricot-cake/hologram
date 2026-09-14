import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { quotedCaptureId } from './quoted-id.mts';
import { downloadOneMedia, type createByteBudget, MAX_MEDIA } from './media-download.mts';
import { QuotedPostSchema, type QuotedPostShape } from './post-schemas.mts';

export async function cachedQuotedMedia(input: unknown, folder: string): Promise<QuotedPostShape['media'] | null> {
  const parsed = QuotedPostSchema.safeParse(input);
  if (!parsed.success || !parsed.data.url || !parsed.data.media.length) return null;
  const id = quotedCaptureId(parsed.data.url);
  let names: string[];
  try {
    names = await fs.promises.readdir(path.join(folder, 'quoted-media', id));
  } catch {
    return null;
  }
  const media: QuotedPostShape['media'] = [];
  for (const item of parsed.data.media) {
    const stem = createHash('sha256').update(item.url).digest('hex');
    const file = names.find((name) => new RegExp(`^${stem}-media-0\\.(png|jpe?g|webp|gif|avif|mp4|webm)$`).test(name));
    if (!file) return null;
    const poster = names.find((name) => new RegExp(`^${stem}-poster\\.(png|jpe?g|webp|avif)$`).test(name));
    media.push({ ...item, file: `quoted-media/${id}/${file}`, posterFile: poster ? `quoted-media/${id}/${poster}` : null });
  }
  return media;
}

// 引用元は親とは別の保存単位に置く。同じ引用元の再保存でも確定済みファイルを再利用する。
export async function downloadQuotedPost(input: unknown, folder: string, budget: ReturnType<typeof createByteBudget>): Promise<QuotedPostShape | null> {
  if (!input) return null;
  const parsed = QuotedPostSchema.parse(input);
  if (!parsed.url) return parsed;
  const cached = await cachedQuotedMedia(input, folder);
  if (cached) return { ...parsed, media: cached };
  const id = quotedCaptureId(parsed.url);
  const dir = path.join(folder, 'quoted-media', id);
  const localFile = (name: string) => `quoted-media/${id}/${name}`;
  const media: QuotedPostShape['media'] = [];
  for (const [i, item] of parsed.media.slice(0, MAX_MEDIA).entries()) {
    if (!item.url) {
      media.push({ ...item, file: '' });
      continue;
    }
    const stem = createHash('sha256').update(item.url).digest('hex');
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const names = await fs.promises.readdir(dir);
      const existing = names.find((name) => new RegExp(`^${stem}-media-0\\.(png|jpe?g|webp|gif|avif|mp4|webm)$`).test(name));
      if (existing) {
        const poster = names.find((name) => new RegExp(`^${stem}-poster\\.(png|jpe?g|webp|avif)$`).test(name));
        media.push({ ...item, file: localFile(existing), posterFile: poster ? localFile(poster) : null });
        continue;
      }
      const announced = (input as { media?: unknown[] }).media?.[i];
      const saved = await downloadOneMedia(announced as Parameters<typeof downloadOneMedia>[0], dir, stem, 0, budget);
      media.push(saved ? { ...item, ...saved, file: localFile(saved.file), posterFile: saved.posterFile ? localFile(saved.posterFile) : null } : { ...item, file: '' });
    } catch {
      // 引用元の失敗で親投稿を失わない。URL と本文は残し、閲覧時に遠隔取得しない。
      media.push({ ...item, file: '' });
    }
  }
  return QuotedPostSchema.parse({ ...parsed, media });
}
