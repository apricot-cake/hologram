'use strict';

// config.json と、それが指す保存フォルダ（#227）——index.ts の `// --- Config ---`
// ブロックを丸ごと移した。これを失うとライブラリを失う唯一のファイルを読み書きする
// すべてはここに住む。アトミック書き込みの規律と冗長な保存フォルダポインタが、
// 呼び出し元にまたがる慣習ではなく1つの単位になるように。
//
// 整理状態の置き場ではない、というのは意図的な選択: それは DB（#5）の役目。
// ここはマシンローカルな設定（保存フォルダ、拡張機能 id、バックアップ／整合性の
// 状態、ウィンドウの位置とサイズ、環境設定）と、ファイルが途中で切れた時の
// 復旧経路。

import fs from 'node:fs';
import path from 'node:path';

import { parseJsonLoose } from './lib-json.ts';
import { writeFileAtomicSync } from './lib-atomic.ts';
import { configDir, defaultLibraryDir, resolveSaveFolder } from './native-host.ts';

const CONFIG_PATH = path.join(configDir(), 'config.json');

// --- インメモリキャッシュ（#61） ---
//
// getSaveFolder() は asset:// の経路に乗っているので、これが無ければグリッドが
// 要求する画像1枚ごとに config.json を開き直しパースし直すことになる。コストを
// 生むのはファイルを開くこと: この機器で計測すると、約900バイトの config.json の
// readFileSync+parse は約230µs、同じファイルの statSync は約6µs。
//
// このキャッシュは、自分自身の書き込みでだけ捨てるのではなく、読むたびにファイルと
// 突き合わせて確認する。これは意図的な選択で、この規律はちょっとした親切ではなく
// このモジュールの安全性そのもの:
//   - config.json は手で編集してよいものとして文書化されており
//     （native-host/README.md）、インストーラ CLI（native-host/install.mts の
//     persistExtensionId）は別プロセスからそこへ書き込む。だから「書き手はすべて
//     このプロセスの中」というのは成り立たない。
//   - ここの書き手はすべて読み取り→変更→書き込みなので、古い読み取りは単に
//     古い値を返すだけでは済まない——次の writeConfig がそれをそのまま永続化し、
//     外部からの編集を黙って消してしまう。そうやって saveFolder を失ったのが
//     2026-06-23 のインシデントの失敗モードであり、だからこそフックだけに頼る
//     無効化方式（1回のフック取りこぼし＝設定が消える）ではここでは足りない。
//
// このチェックは (size, mtime, ino) を指紋にした statSync 1回。既知の限界: NTFS は
// システムクロックの約15msの刻みで mtime を刻むので、プロセス外から、ちょうど
// 同じバイト長でインプレースに書き換えたものが、自分の書き込みと同じ刻みに
// 収まると区別が付かない。所定の場所へリネームして置くもの——こちらの
// writeFileAtomicSync や、アトミックに保存するあらゆるエディタ——は新しい ino が
// 付くので、必ず検出できる。
interface ConfigCacheEntry {
  /** `data` がパースされた元のバイト列の識別子。null = ファイルが存在しない。 */
  fp: string | null;
  data: Record<string, any>;
  corrupt: boolean;
}
let cached: ConfigCacheEntry | null = null;

// null = そのファイルが無い（新規インストール——不在もキャッシュしてよい正当な
// 状態）。undefined = stat 自体が失敗し、ファイルについて何も分からない。この場合
// キャッシュを信用しても、この回でリフレッシュしてもいけない。
function statFingerprint(): string | null | undefined {
  try {
    const st = fs.statSync(CONFIG_PATH, { bigint: true, throwIfNoEntry: false });
    return st ? `${st.size}:${st.mtimeNs}:${st.ino}` : null;
  } catch {
    return undefined;
  }
}

function readConfigFromDisk(): Omit<ConfigCacheEntry, 'fp'> {
  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    return { data: {}, corrupt: false }; // まだ config が無い（新規インストール）——不在は壊れているのとは違う
  }
  try {
    return { data: parseJsonLoose(raw), corrupt: false };
  } catch {
    // 設定が壊れている（例: アトミック書き込み導入前の強制終了による切り詰め）。
    // 呼び出し元に黙って {} で上書きさせるのではなく保存する——{} として読めて
    // しまい、それがそのまま書き戻される切り詰め済み config は、saveFolder/
    // extensionId/backup を一度に失う。復旧・調査用にコピーを残す。この結果を
    // キャッシュすることは、読むたびに1つではなく壊れるたびに1つのコピーで
    // 済むことも意味する——以前はアプリを開いたままにしていると config
    // ディレクトリがそれで散らかっていた。
    try {
      if (raw && raw.length) fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.corrupt-${Date.now()}`);
    } catch {
      /* ベストエフォート */
    }
    return { data: {}, corrupt: true };
  }
}

// 共有エントリ——呼び出し元へ渡すことは無い（readConfig は複製する）。不変の
// スカラー値だけを取り出す内部の読み手は、これを直接使う。
function loadConfig(): ConfigCacheEntry {
  const before = statFingerprint();
  if (cached && before !== undefined && cached.fp === before) return cached;
  const fresh = readConfigFromDisk();
  const after = statFingerprint();
  // 読み取りの間ファイルがじっとしていた時だけ指紋を保存する: もし足元で
  // 変わっていたら、`after` はこちらがパースしていないバイト列を表しており、
  // それをこのパース結果に固定してしまうと、ファイルが「もう一度」変わるまで
  // 古いコピーを提供し続けることになる。
  cached = before !== undefined && after === before ? { ...fresh, fp: after } : null;
  return cached ?? { ...fresh, fp: null };
}

/** 今この瞬間、config.json が存在するのにパースできないなら true。 */
function isConfigCorrupt() {
  return loadConfig().corrupt;
}

/**
 * config.json を、専用のコピーとして返す: 呼び出し元はこれを読み取り→変更→
 * 書き込みするので、writeConfig へ一度も渡されなかった変更（あるいは書き込みが
 * 例外を投げたもの）は、次の読み手から見えてはいけない。
 */
function readConfig() {
  return structuredClone(loadConfig().data);
}

/**
 * 次の読み取りを、強制的にファイルへ戻す。writeConfig を経由しない、プロセス内で
 * 唯一の書き手のため: native-host のインストーラは extensionId を config.json へ
 * 直接永続化する（install.mts の persistExtensionId）。
 */
function invalidateConfigCache() {
  cached = null;
}

// 冗長な保存フォルダポインタ: config.json の隣に書かれる、保存フォルダのパスだけを
// 持つ小さなファイル。saveFolder の唯一のコピーを config.json だけが持っていたのが、
// 一度の切り詰めでライブラリを空の既定値へ落としてしまった原因。この独立した
// ファイルはそれを生き延び、getSaveFolder() が黙って切り替わるのではなく復旧できる
// ようにする。
const SAVE_POINTER_PATH = () => path.join(configDir(), 'saveFolder.path');
function writeSavePointer(folder) {
  if (typeof folder !== 'string' || !folder.trim()) return;
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    writeFileAtomicSync(SAVE_POINTER_PATH(), folder); // アトミックで、config.json とは独立
  } catch {
    /* 冗長化はベストエフォート */
  }
}
function readSavePointer() {
  try {
    const p = fs.readFileSync(SAVE_POINTER_PATH(), 'utf8').trim();
    return p || null;
  } catch {
    return null;
  }
}
function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// --- 現在のライブラリの設定 ---
//
// Hologram は1つのライブラリを移動して使う。エクスポート通知と整合性状態は
// config.json の現在の設定として持ち、過去のライブラリ一覧は保持しない。
const EXPORT_REMINDER_DEFAULTS = {
  enabled: true,
  threshold: 100,
  changesSinceExport: 0,
  lastExportAt: null,
};
const EXPORT_REMINDER_THRESHOLDS = new Set([25, 50, 100, 250]);

function exportReminderConfigOf(value: unknown) {
  const raw = value && typeof value === 'object' ? (value as Record<string, any>) : {};
  return {
    ...EXPORT_REMINDER_DEFAULTS,
    enabled: raw.enabled !== false,
    threshold: EXPORT_REMINDER_THRESHOLDS.has(raw.threshold) ? raw.threshold : EXPORT_REMINDER_DEFAULTS.threshold,
    changesSinceExport: Number.isFinite(raw.changesSinceExport) ? Math.max(0, Math.floor(raw.changesSinceExport)) : 0,
    lastExportAt: typeof raw.lastExportAt === 'string' ? raw.lastExportAt : null,
  };
}
const INTEGRITY_DEFAULTS = {
  lastCheckAt: null,
  dbOk: null, // null = まだ一度もチェックしていない
  orphanCount: 0,
  missingCount: 0,
};

// 切り替え機能を使っていた設定を、現在の保存先に対応する1組の状態へ畳み込む。
// 過去のライブラリ履歴は消し、現在の通知と整合性の状態だけを残す。
function migrateLibrarySettings() {
  const cfg = readConfig();
  const libraries = Array.isArray(cfg.libraries) ? cfg.libraries : [];
  const folder = getSaveFolder();
  const current = libraries.find((entry) => entry?.path && path.resolve(entry.path) === path.resolve(folder));
  let changed = false;
  if (current && cfg.exportReminder === undefined && current.exportReminder !== undefined) {
    cfg.exportReminder = current.exportReminder;
    changed = true;
  }
  if (current && cfg.integrity === undefined && current.integrity !== undefined) {
    cfg.integrity = current.integrity;
    changed = true;
  }
  if (Array.isArray(cfg.libraries)) {
    delete cfg.libraries;
    changed = true;
  }
  if ('backup' in cfg) {
    delete cfg.backup;
    changed = true;
  }
  if (changed) writeConfig(cfg);
}

function readLibraryExportReminderConfig() {
  return exportReminderConfigOf(readConfig().exportReminder);
}
function writeLibraryExportReminderConfig(patch: Record<string, any> | null | undefined) {
  const cfg = readConfig();
  const merged = exportReminderConfigOf(Object.assign({}, cfg.exportReminder || {}, patch || {}));
  cfg.exportReminder = merged;
  writeConfig(cfg);
  return merged;
}
function readLibraryIntegrityStatus() {
  return Object.assign({}, INTEGRITY_DEFAULTS, readConfig().integrity || {});
}
function writeLibraryIntegrityStatus(patch: Record<string, any> | null | undefined) {
  const cfg = readConfig();
  const merged = Object.assign({}, INTEGRITY_DEFAULTS, cfg.integrity || {}, patch || {});
  cfg.integrity = merged;
  writeConfig(cfg);
  return merged;
}

// アトミックな書き込み: 書き込みの途中の強制終了やクラッシュが、切り詰められた
// config.json を絶対に残してはいけない。tmp ファイルへ書いて fsync し、それから
// 対象へリネームする——読み手が見るのは常に完全な旧ファイルか完全な新ファイルの
// どちらか。（アトミックでない writeFileSync は強制終了で config.json を切り詰め、
// readConfig() は {} を返し、次の書き込みがその {} を永続化し、saveFolder/
// extensionId/backup が一度に失われていた。その連鎖こそがライブラリを
// 「消える」ようにしていたもの。）lib-atomic.ts に fsync を求める唯一の
// 呼び出し元。これを失うと保存フォルダ自体を失うファイルだから。
function writeConfig(cfg) {
  fs.mkdirSync(configDir(), { recursive: true });
  const json = JSON.stringify(cfg, null, 2);
  writeFileAtomicSync(CONFIG_PATH, json, { fsync: true });
  // 今しがた着地したバイト列からキャッシュを準備する——`cfg` 自身ではなく
  // JSON.parse(json) を使うことで、キャッシュが「ファイルが持っているもの」を
  // 持つようにする（往復で undefined のメンバーは落ちる）し、呼び出し元は自分の
  // オブジェクトを変更し続けてよい。上で例外が投げられればここはスキップされる:
  // 失敗した書き込みは、実際には届いていない値を報告するのではなく、
  // readConfig() をディスクと一致させたままにしなければならない。
  const fp = statFingerprint();
  cached = typeof fp === 'string' ? { fp, data: JSON.parse(json), corrupt: false } : null;
  // 冗長ポインタを、たった今書いた保存フォルダと歩調を合わせておく。
  if (cfg && typeof cfg.saveFolder === 'string' && cfg.saveFolder.trim()) writeSavePointer(cfg.saveFolder);
}

// 明示的な設定が優先。無ければ、共有の既定ライブラリディレクトリへ落ちる前に
// 冗長ポインタから復旧する（ブリッジの readSaveFolder と同じ解決順）。null を
// 返すことは無い——新規インストールは defaultLibraryDir() を使う。ポインタを
// 参照するのは config に saveFolder が無い時（劣化／新規）だけなので、通常の
// 経路は余分なファイル I/O 無しの単一の config 読み取りのまま。
function getSaveFolder() {
  // readConfig() ではなく共有エントリを使う: これはアプリの中で最も頻繁な
  // config の読み取り（asset:// のリクエストごとに1回）で、取り出すのは
  // 文字列1つだけ。
  const folder = loadConfig().data.saveFolder;
  if (typeof folder === 'string' && folder.trim()) return folder;
  const ptr = readSavePointer();
  return resolveSaveFolder({
    configSaveFolder: folder,
    pointer: ptr,
    pointerExists: ptr ? dirExists(ptr) : false,
    defaultDir: defaultLibraryDir(),
  }).folder;
}

// #37: 現在の保存フォルダが、今この瞬間ディスク上に無いかどうか——つまり、
// 明示的な config.saveFolder が、実在するディレクトリにもう解決しない状態
// （アプリの外で移動／改名／アンマウントされた）。新規インストール（明示的な
// フォルダが無い）では絶対に true にならない: そのケースはポインタ／既定値経由で
// 解決し、既定のディレクトリは必要に応じて作成されるので「missing」ではない。
//
// キャッシュしたフラグではなく、呼ぶたびに新しく stat するのは意図的な選択:
// このチェックは statSync（dirExists）1回で、書き込みハンドラやレンダラーの
// ステータス IPC が「今の」答えを必要とするどこからでも呼べるほど安い。
// キャッシュしたフラグは、実質的な節約が無いのに独自の無効化の仕組み
// （repoint、リトライ、ドライブの再マウント）を必要とする。
function saveFolderStatus() {
  const explicit = loadConfig().data.saveFolder;
  const hasExplicit = typeof explicit === 'string' && !!explicit.trim();
  const folder = getSaveFolder();
  return { folder, missing: hasExplicit && !dirExists(folder) };
}

// 起動時に一度だけ: 既存のインストールについて冗長ポインタを最新に保つ。そして
// ——もし config が saveFolder を失っていて（壊れた）、ポインタはまだ実在する
// ライブラリに解決するなら——それを config へ書き戻し、値を永続的にしつつ、
// （config を独立して読む）ネイティブホストが食い違うのではなく同期したままに
// する。
function initSaveFolderRedundancy() {
  const cfg = readConfig();
  if (typeof cfg.saveFolder === 'string' && cfg.saveFolder.trim()) {
    writeSavePointer(cfg.saveFolder);
    return;
  }
  const ptr = readSavePointer();
  if (ptr && dirExists(ptr)) {
    try {
      writeConfig(Object.assign({}, cfg, { saveFolder: ptr }));
    } catch {
      /* 復旧はベストエフォート */
    }
  }
}

export { readConfig, writeConfig, getSaveFolder, readSavePointer, initSaveFolderRedundancy, isConfigCorrupt, invalidateConfigCache, saveFolderStatus, migrateLibrarySettings, readLibraryExportReminderConfig, writeLibraryExportReminderConfig, readLibraryIntegrityStatus, writeLibraryIntegrityStatus };
