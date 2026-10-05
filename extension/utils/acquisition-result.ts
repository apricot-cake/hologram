import type { PostRecord } from './extractor/types.ts';

// 制限が明示された投稿は DOM で取得できる。通信失敗などは救済扱いにしない。
export function acquisitionComplete(meta: PostRecord, domFilled: readonly string[]): boolean {
  if (meta.acquisitionIssues.length) return false;
  if (!meta.metaError) return true;
  return (meta.metaError === 'protected' || meta.metaError === 'ageRestricted' || meta.metaError === 'embedUnavailable') && domFilled.includes('post');
}
