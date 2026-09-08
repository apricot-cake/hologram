import { clipboard, ClipboardItem, nativeImage } from 'electron';
import { isViewerImageName, libraryFilePath } from './library-files.ts';
import { getDelegatedThumbnail } from './lib-thumbnails.ts';

// 原本をPNGへデコードし、縮小せずにコピーする。アニメーションは先頭フレーム。
export async function copyLibraryImage(file: unknown, saveFolder: string): Promise<boolean> {
  if (!isViewerImageName(file)) return false;
  const source = libraryFilePath(file, saveFolder);
  if (!source) return false;
  try {
    const png = await getDelegatedThumbnail(source, Number.MAX_SAFE_INTEGER, 'image/png');
    if (!png) return false;
    const image = nativeImage.createFromBuffer(png);
    if (image.isEmpty()) return false;
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    return true;
  } catch {
    return false;
  }
}
