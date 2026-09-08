import { PostDisplaySchema } from '../app/src/shared/post-view-schemas.ts';
// 個別の表示テストが使わない列は、保存スキーマと同じ既定値で補う。
export function postView(overrides: object) {
  return PostDisplaySchema.parse({ captureId: 'fixture', capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...overrides });
}
