'use strict';

// Backup destination adapters (#233).
//
// The engine in lib-backup.ts decides WHAT the backup should contain; a
// destination decides HOW bytes get there. #233 splits the two so the second
// destination kind — a cloud account reached over OAuth — is a new
// implementation of this interface rather than a second copy of the engine
// ("先行すると宛先アダプタを二度組むことになる").
//
// The four operations are the intersection of what a plain folder and the
// consumer cloud drive APIs both offer, and they are the four the engine
// actually needs: enumerate what is already there, put a file, move a file
// (trash in and out — never a re-upload), delete a file. Paths are relative to
// the destination root and always use '/' as the separator, so the same
// relative name addresses a folder entry and a cloud object.
//
// v1 ships the local-folder adapter only. The OAuth adapters are #233's later
// stage; registering an OAuth client is not something this code can do for the
// user, so nothing here pretends the cloud kinds exist yet.

import fs from 'node:fs';
import path from 'node:path';

import { commitFileAtomic } from './lib-atomic.ts';

/** What `list()` reports per file — enough to spot a changed mutable file. */
export interface DestinationEntry {
  size: number;
  mtimeMs: number;
}

export interface BackupDestination {
  /** Discriminator for logs and status; 'local-folder' is the only v1 value. */
  readonly kind: string;
  /** Where the backup lives, for messages the user reads. */
  readonly location: string;
  /** Every file under the destination root, keyed by '/'-separated relative path. */
  list(): Promise<Map<string, DestinationEntry>>;
  /** Copies `srcFile` in, replacing whatever is at `rel`. */
  put(rel: string, srcFile: string, mtimeMs?: number | null): Promise<void>;
  /** Relocates an existing entry without moving its bytes twice. */
  move(fromRel: string, toRel: string): Promise<void>;
  remove(rel: string): Promise<void>;
}

// Backups go into a named subfolder of the folder the user picked, never into
// its top level: the picked folder is usually an existing drive root or a
// documents folder with the user's own files in it, and the engine deletes
// entries it does not recognise.
const BACKUP_SUBDIR = 'Hologram-backup';

/** The tmp artifacts the engine's own writes leave behind mid-copy. */
const TMP_RE = /\.tmp(-\d+)?$/i;

function backupRoot(dir: string): string {
  return path.join(dir, BACKUP_SUBDIR);
}

function createLocalFolderDestination(dir: string): BackupDestination {
  const root = backupRoot(dir);
  const abs = (rel: string) => path.join(root, ...rel.split('/'));

  async function walk(sub: string, into: Map<string, DestinationEntry>): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(sub ? path.join(root, ...sub.split('/')) : root, { withFileTypes: true });
    } catch {
      return; // not created yet, or unreadable — treated as empty
    }
    for (const e of entries) {
      if (TMP_RE.test(e.name)) continue;
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(rel, into);
        continue;
      }
      if (!e.isFile()) continue;
      try {
        const st = await fs.promises.stat(abs(rel));
        into.set(rel, { size: st.size, mtimeMs: st.mtimeMs });
      } catch {
        /* vanished between readdir and stat */
      }
    }
  }

  return {
    kind: 'local-folder',
    location: root,
    async list() {
      const out = new Map<string, DestinationEntry>();
      await walk('', out);
      return out;
    },
    async put(rel, srcFile, mtimeMs) {
      const dest = abs(rel);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await commitFileAtomic(
        dest,
        async (tmp) => {
          await fs.promises.copyFile(srcFile, tmp);
          // Carry the source mtime over (floored to the ms utimes can set) so a
          // destination restored back into place keeps the library's own
          // timestamps.
          if (typeof mtimeMs === 'number') {
            try {
              const t = new Date(Math.floor(mtimeMs));
              await fs.promises.utimes(tmp, t, t);
            } catch {
              /* best-effort */
            }
          }
        },
        { tmpSuffix: `.tmp-${Date.now()}` },
      );
    },
    async move(fromRel, toRel) {
      const to = abs(toRel);
      await fs.promises.mkdir(path.dirname(to), { recursive: true });
      await fs.promises.rename(abs(fromRel), to);
    },
    async remove(rel) {
      await fs.promises.unlink(abs(rel));
    },
  };
}

export { BACKUP_SUBDIR, TMP_RE, backupRoot, createLocalFolderDestination };
