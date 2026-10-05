import { z } from 'zod';
import type { SaveLogEntry } from '../capture-log.ts';
import type { PostRecord } from './types.ts';

// 取得元の値や record の動的キーは診断へ転送しない。
const FIELDS = new Set(
  'error body image imageBig comment commentHtml webpage social url id_str text created_at user name screen_name description followers_count friends_count profile_image_url_https profile_banner_url_https profile_banner_url entities urls expanded_url hashtags mediaDetails type media_url_https ext_alt_text original_info width height video_info variants content_type bitrate quoted_tweet parent card binding_values favorite_count conversation_count lang possibly_sensitive edit_control edit_tweet_ids illustId illustComment illustType pageCount illustTitle userId userName likeCount bookmarkCount viewCount commentCount seriesNavData seriesId title order tags tag createDate uploadDate originalSrc src frames file delay uri cid indexedAt author did handle displayName avatar banner followersCount followsCount createdAt record embed media external fullsize alt aspectRatio playlist thumbnail value embeds reply root facets features labels values val repostCount replyCount'.split(
    ' ',
  ),
);

export function acquisitionFailureReason(error: unknown): 'invalidResponse' | 'fetchFailed' {
  return error instanceof z.ZodError || error instanceof SyntaxError ? 'invalidResponse' : 'fetchFailed';
}

export function diagnosticFailureReason(error: unknown): 'contract' | 'json' | 'transport' {
  return error instanceof z.ZodError ? 'contract' : error instanceof SyntaxError ? 'json' : 'transport';
}

export function createAcquisitionDiagnostic(rec: Pick<PostRecord, 'platform'>, logDiagnostic?: (entry: SaveLogEntry) => void) {
  return (operation: string, status: number | null, reason?: string, error?: unknown): void => {
    const paths = error instanceof z.ZodError ? [...new Set(error.issues.slice(0, 12).map((issue) => issue.path.map((part) => (typeof part === 'string' && FIELDS.has(part) ? part : '*')).join('.') || '(root)'))].join(',') : undefined;
    try {
      logDiagnostic?.({ stage: 'metadata', phase: reason ? 'fail' : 'ok', platform: rec.platform, category: operation === 'ajax-user-full' ? 'pixiv-profile' : 'api-acquisition', operation, code: status, reason, error: paths });
    } catch {
      // 診断の失敗で取得や保存を止めない。
    }
  };
}
