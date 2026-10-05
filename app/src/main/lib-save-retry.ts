import { normalizePostRecord, type PostRecordShape } from '../../../native-host/post-record.mts';

function availableValues<T extends object>(record: T): Partial<T> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0))) as Partial<T>;
}

function mergeMedia(previous: PostRecordShape['media'], incoming: PostRecordShape['media']): PostRecordShape['media'] {
  const media: PostRecordShape['media'] = [];
  for (const item of incoming) {
    const existing = previous.find((old) => (item.url ? old.url === item.url : old.file === item.file));
    if (!media.some((old) => (item.url ? old.url === item.url : old.file === item.file))) media.push(existing?.file ? existing : item);
  }
  for (const item of previous) if (!media.some((old) => (item.url ? old.url === item.url : old.file === item.file))) media.push(item);
  return media;
}

function mergeQuoted(previous: PostRecordShape['quotedPost'], incoming: PostRecordShape['quotedPost']): PostRecordShape['quotedPost'] {
  if (!incoming) return previous;
  if (!previous?.url || previous.url !== incoming.url) return incoming;
  return { ...previous, ...availableValues(incoming), media: mergeMedia(previous.media, incoming.media) };
}

// 再取得で欠けた値は、すでに保存した情報を消さない。
export function mergeSaveRetry(previous: PostRecordShape, incoming: PostRecordShape): PostRecordShape {
  const linkCard = incoming.linkCard && previous.linkCard?.url === incoming.linkCard.url ? { ...previous.linkCard, ...availableValues(incoming.linkCard) } : incoming.linkCard || previous.linkCard;
  return normalizePostRecord({
    ...previous,
    ...availableValues(incoming),
    captureId: previous.captureId,
    capturedAt: previous.capturedAt,
    tags: [...new Set([...previous.tags, ...incoming.tags])],
    media: mergeMedia(previous.media, incoming.media),
    linkCard,
    quotedPost: mergeQuoted(previous.quotedPost, incoming.quotedPost),
    replyToPost: mergeQuoted(previous.replyToPost, incoming.replyToPost),
    retryOf: undefined,
    saveIncomplete: previous.saveIncomplete && incoming.saveIncomplete,
  });
}
