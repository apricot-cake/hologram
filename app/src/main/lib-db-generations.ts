'use strict';

// The DB lane's generation store (#233).
//
// #233 makes the LOCAL store the source of truth for database backups: every
// snapshot is written here first, and a backup destination is then brought in
// line with it by the same "make the destination look like the source" rule the
// media lane already follows. That is why generations do not live at the
// destination: a user with no destination configured still gets rollback points,
// and every destination ends up holding the identical generation set instead of
// each one keeping its own private history.
//
// The store sits INSIDE the save folder as a dot-directory, next to `.trash/`
// and `.hologram-inbox/` — it travels with the library when the library is
// relocated, and its dot-name keeps it out of the export archives (which
// collect no directories at all).
//
// Retention is restic's `--keep-daily/--keep-weekly/--keep-monthly` model:
// walking newest to oldest, a snapshot is kept when it is the first one seen in
// a period that still has room. #233 fixes the v1 numbers at 7 daily / 4 weekly
// / 6 monthly (roughly half a year of reach in ~17 files).
//
// Electron-free (better-sqlite3 + node builtins only), like lib-db-snapshot.ts
// which it wraps.

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

import { commitFileAtomic } from './lib-atomic.ts';
import { snapshotDatabase } from './lib-db-snapshot.ts';

/** Dot-directory under the save folder that holds the generations. */
const GENERATIONS_DIRNAME = '.db-generations';

export interface GenerationRetention {
  daily: number;
  weekly: number;
  monthly: number;
}

/** #233's v1 fixed retention. */
const GENERATION_RETENTION: GenerationRetention = { daily: 7, weekly: 4, monthly: 6 };

function generationsDir(saveFolder: string): string {
  return path.join(saveFolder, GENERATIONS_DIRNAME);
}

// Local wall-clock in the file name, not an ISO/UTC stamp: these names are read
// by a human picking a rollback point, and the retention buckets below are
// calendar days/weeks/months on the same local clock.
const NAME_RE = /^hologram-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/;

const pad2 = (n: number) => String(n).padStart(2, '0');

function generationName(at: Date): string {
  return `hologram-${at.getFullYear()}${pad2(at.getMonth() + 1)}${pad2(at.getDate())}-${pad2(at.getHours())}${pad2(at.getMinutes())}${pad2(at.getSeconds())}.db`;
}

/** The instant a generation file name encodes, or null when it is not one of ours. */
function parseGenerationName(name: string): Date | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return Number.isNaN(at.getTime()) ? null : at;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
// ISO-8601 week (Thursday rule) so a week bucket never splits across a year
// boundary in a way that would keep two "weekly" snapshots for the same week.
function weekKey(d: Date): string {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const firstThursday = new Date(t.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  const week = 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${t.getFullYear()}-W${pad2(week)}`;
}

/**
 * Tiered thinning, pure so it unit-tests without a filesystem. Names that do not
 * parse are reported as neither kept nor dropped — this never proposes deleting
 * a file it does not understand, because the store lives inside the user's
 * library where something else may legitimately appear.
 */
function selectGenerations(names: readonly string[], retention: GenerationRetention = GENERATION_RETENTION): { keep: string[]; drop: string[] } {
  const dated = names
    .map((name) => ({ name, at: parseGenerationName(name) }))
    .filter((g): g is { name: string; at: Date } => g.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  const keep: string[] = [];
  const drop: string[] = [];
  const seen = { daily: new Set<string>(), weekly: new Set<string>(), monthly: new Set<string>() };
  for (const g of dated) {
    const day = dayKey(g.at);
    const week = weekKey(g.at);
    const month = monthKey(g.at);
    if (seen.daily.size < retention.daily && !seen.daily.has(day)) {
      seen.daily.add(day);
      keep.push(g.name);
      continue;
    }
    if (seen.weekly.size < retention.weekly && !seen.weekly.has(week)) {
      seen.weekly.add(week);
      keep.push(g.name);
      continue;
    }
    if (seen.monthly.size < retention.monthly && !seen.monthly.has(month)) {
      seen.monthly.add(month);
      keep.push(g.name);
      continue;
    }
    drop.push(g.name);
  }
  return { keep, drop };
}

export interface GenerationFile {
  name: string;
  file: string;
  /** ISO timestamp decoded from the file name. */
  at: string;
  size: number;
}

/** Every generation in the store, newest first. No store yet = empty list. */
function listGenerations(saveFolder: string): GenerationFile[] {
  const dir = generationsDir(saveFolder);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: GenerationFile[] = [];
  for (const name of names) {
    const at = parseGenerationName(name);
    if (!at) continue;
    let size = 0;
    try {
      const st = fs.statSync(path.join(dir, name));
      if (!st.isFile()) continue;
      size = st.size;
    } catch {
      continue;
    }
    out.push({ name, file: path.join(dir, name), at: at.toISOString(), size });
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

/** The newest generation's absolute path, or null when the store is empty. */
function latestGeneration(saveFolder: string): string | null {
  const list = listGenerations(saveFolder);
  return list.length ? list[0].file : null;
}

/**
 * Writes one new generation from the live database. The snapshot goes through
 * SQLite's Online Backup API (lib-db-snapshot.ts — a raw copy of a live .db is
 * forbidden by #97) into a temp name that is renamed into place, so anything
 * scanning the store never sees a half-written generation.
 */
async function createGeneration(sqlite: Database.Database, saveFolder: string, at: Date = new Date()): Promise<string> {
  const dir = generationsDir(saveFolder);
  await fs.promises.mkdir(dir, { recursive: true });
  const dest = path.join(dir, generationName(at));
  await commitFileAtomic(dest, (tmp) => snapshotDatabase(sqlite, tmp), { tmpSuffix: `.tmp-${Date.now()}` });
  return dest;
}

/** Applies the retention policy, returning the names actually removed. */
async function pruneGenerations(saveFolder: string, retention: GenerationRetention = GENERATION_RETENTION): Promise<string[]> {
  const dir = generationsDir(saveFolder);
  const { keep, drop } = selectGenerations(
    listGenerations(saveFolder).map((g) => g.name),
    retention,
  );
  // Thinning is the one place in the DB lane that deletes, so it gets the same
  // kind of safety valve backup-guard gives the media lane (#233 asks for the
  // thinning to be covered by the bulk-deletion watch): a policy that would
  // leave the store with nothing is a bug, not an instruction.
  if (drop.length && !keep.length) return [];
  const removed: string[] = [];
  for (const name of drop) {
    try {
      await fs.promises.unlink(path.join(dir, name));
      removed.push(name);
    } catch {
      /* best-effort: a generation we could not remove is kept, never reported gone */
    }
  }
  return removed;
}

export { GENERATIONS_DIRNAME, GENERATION_RETENTION, generationsDir, generationName, parseGenerationName, selectGenerations, listGenerations, latestGeneration, createGeneration, pruneGenerations };
