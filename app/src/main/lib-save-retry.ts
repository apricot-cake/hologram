import { normalizePostRecord, type PostRecordShape } from '../../../native-host/post-record.mts';

// 再取得で欠けた値は、すでに保存した情報を消さない。
export function mergeSaveRetry(previous: PostRecordShape, incoming: PostRecordShape): PostRecordShape {
  const values = Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)));
  const media: PostRecordShape['media'] = [];
  for (const item of incoming.media) {
    const existing = previous.media.find((old) => (item.url ? old.url === item.url : old.file === item.file));
    if (!media.some((old) => (item.url ? old.url === item.url : old.file === item.file))) media.push(existing || item);
  }
  for (const item of previous.media) if (!media.some((old) => (item.url ? old.url === item.url : old.file === item.file))) media.push(item);
  return normalizePostRecord({ ...previous, ...values, captureId: previous.captureId, capturedAt: previous.capturedAt, tags: [...new Set([...previous.tags, ...incoming.tags])], media, retryOf: undefined, saveIncomplete: previous.saveIncomplete && incoming.saveIncomplete });
}
