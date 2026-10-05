import fs from 'node:fs';
import path from 'node:path';
import { itemFileRelative, parseItemFilePath } from '../../../native-host/item-storage.mts';

export function flatFileName(value: unknown): value is string {
  return typeof value === 'string' && !!value && !/[\\/:\0]/.test(value) && value !== '.' && value !== '..' && !/[. ]$/.test(value);
}

// リンクをたどって別の保存領域を、その投稿の所有物として採用しない。
export function regularLibraryFile(folder: string, relative: string): boolean {
  const parts = relative.replace(/\\/g, '/').split('/');
  if (parts.some((part) => !flatFileName(part))) return false;
  let current = path.resolve(folder);
  try {
    const root = fs.lstatSync(current);
    if (!root.isDirectory() || root.isSymbolicLink()) return false;
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function ownFileName(captureId: string, value: unknown): string | null {
  if (flatFileName(value)) return value;
  const item = parseItemFilePath(value);
  return item?.captureId === captureId ? item.file : null;
}

export function mapItemReferences<T extends Record<string, any>>(record: T, map: (file: string) => string): T {
  const convert = (value: any) => (typeof value === 'string' && value ? map(value) : value);
  return {
    ...record,
    image: convert(record.image),
    video: convert(record.video),
    avatarFile: convert(record.avatarFile),
    media: (record.media || []).map((media: any) => ({ ...media, file: convert(media.file), posterFile: convert(media.posterFile) })),
    linkCard: record.linkCard ? { ...record.linkCard, thumbnailFile: convert(record.linkCard.thumbnailFile) } : record.linkCard,
  };
}

export function normalizeOwnedItemReferences<T extends Record<string, any>>(record: T, names: ReadonlySet<string>): T {
  return mapItemReferences(record, (file) => {
    const name = ownFileName(record.captureId, file);
    return name && names.has(name) ? itemFileRelative(record.captureId, name) : file;
  });
}

// 作成前の各親を検査する。recursive mkdir は既存 junction をたどるので使わない。
export function assertLibraryDirectory(folder: string, relative = ''): void {
  let current = path.resolve(folder);
  const parts = relative ? relative.replace(/\\/g, '/').split('/') : [];
  if (parts.some((part) => !flatFileName(part))) throw new Error('Invalid library directory');
  for (const part of ['', ...parts]) {
    if (part) current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid library directory');
  }
}
