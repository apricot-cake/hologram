import { clipboard, ClipboardItem } from 'electron';
import fs from 'node:fs';
import { isViewerImageName, libraryFilePath } from './library-files.ts';
import { getPreparedImage } from './image-processing.ts';

// 原本をPNGへデコードし、縮小せずにコピーする。アニメーションは先頭フレーム。
export async function copyLibraryImage(file: unknown, saveFolder: string): Promise<boolean> {
  if (!isViewerImageName(file)) return false;
  const source = libraryFilePath(file, saveFolder);
  if (!source) return false;
  try {
    const prepared = await getPreparedImage(source, { kind: 'copy' });
    if (!prepared || prepared.mime !== 'image/png') return false;
    const png = await fs.promises.readFile(prepared.path);
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    return true;
  } catch {
    return false;
  }
}
