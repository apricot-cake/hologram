'use strict';

// 投稿・ローカル取り込みを問わず、ライブラリが所有する項目のファイルを置く場所。
// captureId は既に DB、取込キュー、保存済み索引、ゴミ箱の共通の識別子なので、保存構造の
// ためだけの別の id は作らない。ファイルはすべて次の形になる。
//
//   items/<captureId>/<file>
//
// このモジュールは native host と Electron main の両方から使う。片方が新しい保存だけを
// フォルダー化し、もう片方がローカル取り込みを平坦なまま残す状態を作らないためだ。

import path from 'node:path';

export const ITEMS_SUBDIR = 'items';

const SAFE_SEGMENT = /^[A-Za-z0-9%][A-Za-z0-9._%+-]{0,239}$/;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function encodedItemKey(captureId: unknown): string {
  const raw = typeof captureId === 'string' ? captureId : '';
  if (!raw) throw new Error('Invalid captureId for item storage');
  let key = encodeURIComponent(raw);
  // encodeURIComponent は RFC 3986 の歴史的な5文字を残す。Windows のファイル名として
  // 使えないものだけを percent-encode して、OS 間で同じキーにする。
  key = key.replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  if (!SAFE_SEGMENT.test(key) || key === '.' || key === '..' || WINDOWS_RESERVED.test(key)) {
    throw new Error('Invalid captureId for item storage');
  }
  return key;
}

function safeFileName(file: unknown): string {
  const name = typeof file === 'string' ? file : '';
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || path.basename(name) !== name) {
    throw new Error('Invalid item file name');
  }
  return name;
}

export function itemDirectoryRelative(captureId: string): string {
  return `${ITEMS_SUBDIR}/${encodedItemKey(captureId)}`;
}

export function itemDirectoryAbsolute(libraryFolder: string, captureId: string): string {
  return path.join(libraryFolder, ITEMS_SUBDIR, encodedItemKey(captureId));
}

export function itemFileRelative(captureId: string, file: string): string {
  return `${itemDirectoryRelative(captureId)}/${safeFileName(file)}`;
}

export function itemFileAbsolute(libraryFolder: string, captureId: string, file: string): string {
  return path.join(itemDirectoryAbsolute(libraryFolder, captureId), safeFileName(file));
}

export interface ItemFilePath {
  directory: string;
  itemKey: string;
  captureId: string;
  file: string;
}

// DB と ZIP の相対パスは '/' を正本にする。Windows 由来の古い値を読み取る境界では
// '\\' も区切りとして受け入れ、返す値は正規化する。
export function parseItemFilePath(value: unknown): ItemFilePath | null {
  if (typeof value !== 'string' || !value) return null;
  const normalized = value.replace(/\\/g, '/');
  const match = /^items\/([^/]+)\/([^/]+)$/.exec(normalized);
  if (!match || !SAFE_SEGMENT.test(match[1])) return null;
  try {
    safeFileName(match[2]);
    const captureId = decodeURIComponent(match[1]);
    if (encodedItemKey(captureId) !== match[1]) return null;
    return { directory: `${ITEMS_SUBDIR}/${match[1]}`, itemKey: match[1], captureId, file: match[2] };
  } catch {
    return null;
  }
}
