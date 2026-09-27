import { DeadlineError, METADATA_TIMEOUT_MS, withDeadline } from '../deadline.ts';
import { readJsonResponse } from './record.ts';

// 一度の投稿取得で予算を共有し、失敗は呼び出した工程の catch へ返す。
// 本文まで期限に含める。期限後に補完リクエストを開始しない。
export function createMetadataRequest() {
  const expiresAt = Date.now() + METADATA_TIMEOUT_MS;
  return async (url: string, init?: RequestInit) => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) throw new DeadlineError('metadata fetch', METADATA_TIMEOUT_MS);
    const controller = new AbortController();
    try {
      return await withDeadline(
        (async () => {
          const response = await fetch(url, { ...init, signal: controller.signal });
          const data = response.ok ? await readJsonResponse(response) : null;
          return { ok: response.ok, status: response.status, data };
        })(),
        remaining,
        'metadata fetch',
      );
    } finally {
      controller.abort();
    }
  };
}
export type MetadataRequest = ReturnType<typeof createMetadataRequest>;
