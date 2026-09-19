'use strict';

// 行方不明の保存先を復旧するときだけ、選ばれたフォルダを読み取り専用で分類する。

import fs from 'node:fs';
import path from 'node:path';

import { TRASH_SUBDIR } from './lib-save-folder-path.ts';
import { INBOX_DIRNAME } from '../../../native-host/inbox.mts';
import { IMPORTABLE_MEDIA } from '../../../native-host/importable-media.mts';

export const DB_FILENAME = 'hologram.db';
export type LibraryClassification = 'has-db' | 'empty' | 'evidence-no-db' | 'reject';

export function classifyLibraryFolder(dir: string): LibraryClassification {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 'empty';
  }
  if (names.includes(DB_FILENAME)) return 'has-db';
  if (names.includes(TRASH_SUBDIR) || names.includes(INBOX_DIRNAME)) return 'evidence-no-db';
  const mediaRe = new RegExp('\\.(' + IMPORTABLE_MEDIA.join('|') + ')$', 'i');
  if (names.some((f) => mediaRe.test(f))) return 'evidence-no-db';
  return names.some((f) => !f.startsWith('.')) ? 'reject' : 'empty';
}

export function dbFileIn(dir: string): string {
  return path.join(dir, DB_FILENAME);
}
