import { createHash } from 'node:crypto';
import { postKeyOf } from './post-key.mts';

export function quotedCaptureId(url: string): string {
  return `quote-${createHash('sha256')
    .update(postKeyOf(url) || url)
    .digest('hex')}`;
}
