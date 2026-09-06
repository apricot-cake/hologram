import { hologramIpc } from './ipc.ts';
import { t } from '../_shared/i18n.ts';
import { notify } from './ui.ts';

export const copyableImages = (files: string[]): string[] => [...new Set(files.filter((file) => /\.(jpe?g|jfif|png|webp|gif|avif)$/i.test(file)))];
let current: string[] | null = null;
const subscribers = new Set<() => void>();
export const get = () => current;
export function subscribe(callback: () => void) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}
function publish(files: string[] | null) {
  current = files;
  for (const callback of subscribers) callback();
}
export const close = () => publish(null);
export async function copyImage(file: string) {
  const ok = await hologramIpc.copyImage(file).catch(() => false);
  notify(t(ok ? 'imageCopied' : 'imageCopyFailed'));
  return ok;
}
export function requestImageCopy(files: string[]) {
  const images = copyableImages(files);
  if (images.length === 1) void copyImage(images[0]);
  else if (images.length > 1) publish(images);
}
