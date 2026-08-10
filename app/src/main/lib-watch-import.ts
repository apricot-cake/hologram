'use strict';

// 監視フォルダからの取り込み（#84）。保存先フォルダの取込キューの監視とは意図して別にしてある。
// こちらは利用者が持つ元のフォルダを見張り、書き込みが落ち着くのを待ってから、書き終わった
// ファイルを共有のローカル取り込みの DB の書き手へ渡す。
import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';

import { configDir } from './native-host.ts';
import { importLocalFile } from './lib-local-intake.ts';
import { ensureLibraryId } from './lib-db-write.ts';
import type { DbHandle, HologramConfig } from './ipc-context.ts';

// #236: 取り込みが IMPORTABLE_MEDIA に限られなくなった今も、監視フォルダが決して拾ってはいけない
// 名前。OS やクラウド同期のごみであって利用者のファイルではない＝拾えば、利用者が一度も選んで
// いないファイルについてライブラリのレコードを作ることになる。
export const EXCLUDED_NAMES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);

// ウィンドウへのドロップの入口の再帰の走査（#234 の lib-drop-import.ts）と共有する＝明示的に
// 選ばれたものを取るのではなくフォルダの中身を絞り込まなければならない、ローカルファイルの
// すべての入口のための「隠しファイルか、OS・クラウド同期のごみ」の唯一の定義。
export function isHiddenOrJunk(name: string): boolean {
  return name.startsWith('.') || EXCLUDED_NAMES.has(name.toLowerCase());
}
// まだ書き込み中のダウンロード（Chrome・Firefox・Edge の慣習）。chokidar の awaitWriteFinish
// （下）は既に、'add' を発火する前にファイルが増えなくなるのを待つ＝ここでは進行中の名前を
// きっぱり除外するので、取り消されたダウンロードが残した古い断片が、ディレクトリの走査で拾われる
// こともない。
const PARTIAL_EXTS = new Set(['crdownload', 'part', 'tmp', 'download']);

export interface WatchImportFolder {
  path: string;
  enabled: boolean;
}
export interface WatchImportStatus {
  imported: number;
  at: string | null;
}
type Seen = Record<string, Record<string, { size: number; mtimeMs: number }>>;
// #176: 監視するフォルダは端末単位（下）だが、「取り込み済み」はライブラリごとの事実＝監視
// フォルダへ落とした同じファイルは、別のライブラリへ切り替えたらもう一度取り込めなければ
// ならないし、元へ戻ったときに取り込み直されてはいけない。保存先フォルダのパスではなく現在の
// DB 自身の同一性（lib-db-write.ts の ensureLibraryId）をキーにしてあるので、同じライブラリを
// 指し直したフォルダ（パスは変わったが同一性は変わっていない）は「もう見た」の履歴を保つ。
type SeenByLibrary = Record<string, Seen>;

const STATE_PATH = () => path.join(configDir(), 'watch-import-state.json');
const emptyStatus = (): WatchImportStatus => ({ imported: 0, at: null });

export function watchFoldersOf(value: unknown): WatchImportFolder[] {
  const entries = value && typeof value === 'object' && Array.isArray((value as any).folders) ? (value as any).folders : [];
  const out: WatchImportFolder[] = [];
  const paths = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string' || !entry.path.trim()) continue;
    const folder = path.resolve(entry.path);
    const key = process.platform === 'win32' ? folder.toLowerCase() : folder;
    if (paths.has(key)) continue;
    paths.add(key);
    out.push({ path: folder, enabled: entry.enabled !== false });
  }
  return out;
}

export function isInside(child: string, parent: string): boolean {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}

function readState(): SeenByLibrary {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
function writeState(state: SeenByLibrary) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(STATE_PATH(), JSON.stringify(state, null, 2));
}
// #236: 監視フォルダは今やどんなファイルも取り込む（IMPORTABLE_MEDIA だけではない＝あの一覧は
// 今も assetClass を決める。下の importLocalFile 経由で buildLocalRecord の中で）。ドットで
// 始まるファイルと、上の固定した OS・クラウド同期のごみの名前はきっぱり除外する。0バイトの
// ファイルは processFile で除外する（stat が要るが、ここは最初の走査で素のファイル名からも
// 呼ばれるので、それが常に手元にあるとは限らない）。
function supported(file: string) {
  if (isHiddenOrJunk(path.basename(file))) return false;
  const ext = path.extname(file).slice(1).toLowerCase();
  if (PARTIAL_EXTS.has(ext)) return false;
  return true;
}

export interface WatchImportDeps {
  readConfig(): HologramConfig;
  writeConfig(config: HologramConfig): void;
  getSaveFolder(): string;
  isLibraryMissing(): boolean;
  ensurePostsSynced(): DbHandle | null;
  send(channel: string, ...args: unknown[]): void;
}

export function createWatchImportManager(deps: WatchImportDeps) {
  let watcher: FSWatcher | null = null;
  const state = readState();
  let queued = Promise.resolve();
  let status = emptyStatus();

  const folders = () => watchFoldersOf(deps.readConfig().watchImport);
  const seenFor = (libraryId: string, folder: string) => ((state[libraryId] ||= {})[folder] ||= {});
  const fingerprint = (st: fs.Stats) => ({ size: st.size, mtimeMs: st.mtimeMs });
  const same = (a: { size: number; mtimeMs: number } | undefined, b: { size: number; mtimeMs: number }) => !!a && a.size === b.size && a.mtimeMs === b.mtimeMs;

  async function processFile(folder: string, file: string): Promise<boolean> {
    if (!supported(file)) return false;
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      return false;
    }
    if (!stat.isFile()) return false;
    if (stat.size === 0) return false; // #236: 空のファイル（まだ作られている途中）は取り込む対象ではない
    if (deps.isLibraryMissing()) return false;
    const handle = deps.ensurePostsSynced();
    if (!handle) return false;
    // #176:「取り込み済み」は現在のライブラリに閉じた話＝それがどれかを知るには DB が開いて
    // いなければならないので、この確認は ensurePostsSynced より後へ移した（以前は、そもそも
    // DB を開く前の安い飛ばしとして先に走っていた。libraryId は、ライブラリごとの台帳の代価）。
    const libraryId = ensureLibraryId(handle.sqlite);
    const key = path.basename(file);
    const current = fingerprint(stat);
    if (same(seenFor(libraryId, folder)[key], current)) return false;
    const ext = path.extname(file).slice(1).toLowerCase();
    await importLocalFile({
      folder: deps.getSaveFolder(),
      sqlite: handle.sqlite,
      srcPath: file,
      ext,
      source: 'watch',
      idPrefix: 'watch',
      title: path.basename(file, path.extname(file)) || null,
      date: stat.mtime.toISOString(),
    });
    seenFor(libraryId, folder)[key] = current;
    writeState(state);
    return true;
  }

  function enqueue(folder: string, file: string) {
    queued = queued
      .then(async () => {
        if (await processFile(folder, file)) {
          status = { imported: status.imported + 1, at: new Date().toISOString() };
          deps.send('posts-changed', null);
          deps.send('intake-imported', { source: 'watch', count: 1 });
        }
      })
      .catch(() => undefined);
    return queued;
  }

  async function scan(folder: string, markKnown = false) {
    let names: string[];
    try {
      names = await fs.promises.readdir(folder);
    } catch {
      return;
    }
    // markKnown（「これらを取り込み済みとして印を付け、取り込まない」）は現在のライブラリの id を
    // 先に必要とする＝markKnown でない分岐は必要としない。enqueue → processFile が、ファイルごとに
    // 自分で解決するため。
    let libraryId: string | null = null;
    if (markKnown) {
      const handle = deps.ensurePostsSynced();
      if (!handle) return;
      libraryId = ensureLibraryId(handle.sqlite);
    }
    for (const name of names) {
      const file = path.join(folder, name);
      if (!supported(file)) continue;
      if (markKnown) {
        try {
          const st = await fs.promises.stat(file);
          if (st.isFile()) seenFor(libraryId as string, folder)[name] = fingerprint(st);
        } catch {
          /* 走査中にファイルが変わった。監視が再試行する */
        }
      } else {
        enqueue(folder, file);
      }
    }
    if (markKnown) writeState(state);
  }

  async function refresh() {
    await watcher?.close();
    watcher = null;
    const active = folders().filter((f) => f.enabled);
    for (const folder of active) await scan(folder.path);
    if (!active.length) return;
    watcher = chokidar.watch(
      active.map((f) => f.path),
      {
        awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 },
        depth: 0,
        ignoreInitial: true,
      },
    );
    watcher.on('add', (file) => {
      const folder = active.find((f) => path.dirname(file) === f.path);
      if (folder) enqueue(folder.path, file);
    });
    watcher.on('change', (file) => {
      const folder = active.find((f) => path.dirname(file) === f.path);
      if (folder) enqueue(folder.path, file);
    });
  }

  async function setFolders(value: unknown, markExisting: string[] = []) {
    const next = watchFoldersOf({ folders: value });
    const cfg = deps.readConfig();
    cfg.watchImport = { folders: next };
    deps.writeConfig(cfg);
    for (const folder of markExisting) await scan(path.resolve(folder), true);
    await refresh();
    return { folders: next, status };
  }

  return { folders, status: () => status, refresh, setFolders, scan };
}
