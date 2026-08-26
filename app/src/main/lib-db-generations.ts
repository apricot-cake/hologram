'use strict';

// ローカルの復元ポイントを保持する世代ストア (#233)。
//
// 復元ポイントはライブラリの保存フォルダにだけ書く。外部の保存先へ送る責務は持たない。
//
// ストアは保存フォルダの中に、ドット始まりのディレクトリとして `.trash/` や
// `.hologram-inbox/` と並べて置く。ライブラリを移すと一緒に付いて行き、ドット始まりの
// 名前のおかげで書き出しの書庫には入らない（書庫はディレクトリを1つも集めない）。
//
// 保持は daily / weekly / monthly の期間ごとに間引く。新しい方から
// 古い方へ辿り、まだ空きのある期間で最初に見たスナップショットを残す。#233 は v1 の数を
// daily 7 / weekly 4 / monthly 6に固定した（ファイル約17本で、およそ半年ぶん届く）。
//
// Electron 非依存（better-sqlite3 と node の組み込みだけ）で、これが包んでいる
// lib-db-snapshot.ts と同じ。

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

import { commitFileAtomic } from './lib-atomic.ts';
import { snapshotDatabase } from './lib-db-snapshot.ts';

/** 世代を収める、保存フォルダ直下のドット始まりのディレクトリ。 */
const GENERATIONS_DIRNAME = '.db-generations';

export interface GenerationRetention {
  daily: number;
  weekly: number;
  monthly: number;
}

/** #233 が定めた v1 の固定の保持数。 */
const GENERATION_RETENTION: GenerationRetention = { daily: 7, weekly: 4, monthly: 6 };

function generationsDir(saveFolder: string): string {
  return path.join(saveFolder, GENERATIONS_DIRNAME);
}

// ファイル名に入れるのは ISO/UTC の刻印ではなくローカルの壁時計の時刻。この名前は復元
// ポイントを選ぶ人間が読むものであり、下にある保持のバケツも、同じローカル時計の上の
// 暦の日・週・月だから。
const NAME_RE = /^hologram-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/;

const pad2 = (n: number) => String(n).padStart(2, '0');

function generationName(at: Date): string {
  return `hologram-${at.getFullYear()}${pad2(at.getMonth() + 1)}${pad2(at.getDate())}-${pad2(at.getHours())}${pad2(at.getMinutes())}${pad2(at.getSeconds())}.db`;
}

/** 世代のファイル名が表している時刻。こちらの名前でなければ null。 */
function parseGenerationName(name: string): Date | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return Number.isNaN(at.getTime()) ? null : at;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
// ISO-8601 の週（木曜の規則）を使う。週のバケツが年の境で割れて、同じ週の weekly
// スナップショットを2つ残してしまうことがないように。
function weekKey(d: Date): string {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const firstThursday = new Date(t.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  const week = 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${t.getFullYear()}-W${pad2(week)}`;
}

/**
 * 段階を付けた間引き。純粋関数なのでファイルシステム無しで単体テストできる。解析でき
 * なかった名前は keep にも drop にも入れない＝理解できないファイルの削除を提案すること
 * は一切ない。ストアはユーザーのライブラリの中にあり、他のものが正当に現れうるため。
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
  /** ファイル名から読み取った ISO のタイムスタンプ。 */
  at: string;
  size: number;
}

/** ストアにある世代を全部、新しい順に。ストアがまだ無ければ空の一覧。 */
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

/** 最も新しい世代の絶対パス。ストアが空なら null。 */
function latestGeneration(saveFolder: string): string | null {
  const list = listGenerations(saveFolder);
  return list.length ? list[0].file : null;
}

/**
 * 生きたデータベースから新しい世代を1つ書く。スナップショットは SQLite の
 * Online Backup API を通す（lib-db-snapshot.ts＝生きた .db の生コピーは #97 が禁じて
 * いる）。一時名で書いてから所定の名前へ rename するので、ストアを走査する側が
 * 書きかけの世代を見ることはない。
 */
async function createGeneration(sqlite: Database.Database, saveFolder: string, at: Date = new Date()): Promise<string> {
  const dir = generationsDir(saveFolder);
  await fs.promises.mkdir(dir, { recursive: true });
  const dest = path.join(dir, generationName(at));
  await commitFileAtomic(dest, (tmp) => snapshotDatabase(sqlite, tmp), { tmpSuffix: `.tmp-${Date.now()}` });
  return dest;
}

/** 保持の方針を当て、実際に消した名前を返す。 */
async function pruneGenerations(saveFolder: string, retention: GenerationRetention = GENERATION_RETENTION): Promise<string[]> {
  const dir = generationsDir(saveFolder);
  const { keep, drop } = selectGenerations(
    listGenerations(saveFolder).map((g) => g.name),
    retention,
  );
  // 間引きは DB 世代で唯一削除をする場所なので、ストアを空にしてしまう方針は
  // 指示ではなくバグとして拒む。
  if (drop.length && !keep.length) return [];
  const removed: string[] = [];
  for (const name of drop) {
    try {
      await fs.promises.unlink(path.join(dir, name));
      removed.push(name);
    } catch {
      /* できる範囲で。消せなかった世代はそのまま残し、消えたとは決して報告しない */
    }
  }
  return removed;
}

export { GENERATIONS_DIRNAME, GENERATION_RETENTION, generationsDir, generationName, parseGenerationName, selectGenerations, listGenerations, latestGeneration, createGeneration, pruneGenerations };
