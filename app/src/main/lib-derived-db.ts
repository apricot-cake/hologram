'use strict';

// 派生データストア（#833、親 #98）向けの SQLite エンジン: 分析結果（OCR
// テキスト、AI タグ、色／埋め込みベクトル——#48/#49/#50/#51）はここに、
// それ専用のファイルとして住み、hologram.db の `posts` テーブル群には決して
// 混ざらない。再構築可能なデータと正本は異なる失敗／復旧規則を持つ
// （真実源を2つ持たないため、ここでは意図して正本では
// ないものに適用したもの）ので、この Issue はそれらを、1つのデータベースの
// 中に「このテーブルは正本に数えない」という慣習を発明するのではなく、
// 別々のファイルに保つ。
//
// マシンローカル。ML モデルキャッシュ（#831 の modelsRoot()）と同様に
// configDir() で、保存フォルダの中には決して置かない。この1つの選択が、
// #833 の受け入れ基準のうち3つを一度に満たす: バックアップミラー（#233）と
// エクスポート ZIP（#57）はどちらも保存フォルダしか歩かないので derived.db は
// どちらにも届かず、lib-backup.ts も別途、configDir() と重なる置き場を
// 明確に拒む。
//
// 構造上、捨ててよい: ここのすべての行は、アプリがまだ見られる何か（まだ
// 存在するキャプチャに対するモデルの出力）の写しなので、derived.db が無い
// ことや壊れていることは、壊れた hologram.db のようなデータ損失イベントには
// 決してならない。openDerivedDatabase はそれを反映している——quick_check の
// 失敗は、DatabaseCorruptError を投げるのではなく、ファイルを捨てて最初から
// 始める。
//
// Electron に依存しない（better-sqlite3 と node の組み込みのみ）。lib-db.ts
// を写しており、素の node で単体テストできる。

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { Kysely, SqliteDialect } from 'kysely';

/** 設定ディレクトリ（native-host.ts の configDir()）の中にある derived.db のパス。 */
export function derivedDbFile(dir: string): string {
  return path.join(dir, 'derived.db');
}

// スキーマ変更ごとに1エントリ。lib-db.ts の MIGRATIONS 配列と同じ、追記のみの
// 慣習。機能テーブル（#48/#49/#50/#51）は、それぞれ着地する時にここへ自分の
// マイグレーションを追記する。#833 の設計が定めた共有のキーの慣習に従う:
// captureId + assetRef（'image' | 'video' | 'file' | 'media[seq]'）+
// segment（PDF のページ番号。単一パートのものは 0）、そしてモデルが生成した
// すべての行には modelId/modelRev の列が刻まれる（PDF のテキスト層抽出の
// ようにモデルを使わないジョブでは両方 null——#98 の 2026-08-02 コメント
// §1-2）。
//
// この Issue が出荷するのは、何を生成するかに関わらずすべてのジョブ種別が
// 共有する、たった1つのテーブルだけ: アセットのセグメントをどこまで進めたか。
const MIGRATIONS: Migration[] = [
  {
    name: 'schema-v1',
    up: (db) =>
      db.exec(`
        -- (captureId, assetRef, jobKind) ごとに1行: ジョブがアセットの
        -- セグメントをどこまで進めたか。何を生成するジョブかに関わらず
        -- 「これがどれだけインデックス済みか」は同じ問いなので、機能
        -- テーブルごとに重複させるのではなく、すべてのジョブ種別
        -- （画像系のジョブもテキスト抽出も）が共有する。
        -- indexedSegments < totalSegments は、再開可能な遡及処理が拾い上げる
        -- ために残された部分的な索引であり（#98 2026-08-02 コメント §3）、
        -- エラー状態ではない。
        CREATE TABLE derived_progress (
          captureId TEXT NOT NULL,
          assetRef TEXT NOT NULL,
          jobKind TEXT NOT NULL,
          modelId TEXT,
          modelRev TEXT,
          indexedSegments INTEGER NOT NULL DEFAULT 0,
          totalSegments INTEGER NOT NULL DEFAULT 0,
          updatedAt TEXT NOT NULL,
          PRIMARY KEY (captureId, assetRef, jobKind)
        );
        CREATE INDEX idx_derived_progress_captureId ON derived_progress(captureId);
      `),
  },
  {
    // #50 の3つのテーブル。すべて captureId をキーにするので、
    // purgeDerivedForCapture は存在を教えられなくてもこれらを拾い上げる。
    name: 'ai-tags',
    up: (db) =>
      db.exec(`
        -- モデルのしきい値を超えた候補。提案 UI から「読まれる」だけ: 1つを
        -- 採用することは hologram.db の通常のタグ書き込み経路を通るので、
        -- ここにあるものがタグの出所になることは決して無い。name はモデル
        -- 自身のラベル（アンダースコアは既にスペースに変換済み）。表示名は
        -- #50 §5 に従って別途解決される。
        CREATE TABLE ai_tags (
          captureId TEXT NOT NULL,
          assetRef TEXT NOT NULL,
          segment INTEGER NOT NULL DEFAULT 0,
          name TEXT NOT NULL,
          category INTEGER NOT NULL,
          score REAL NOT NULL,
          modelId TEXT NOT NULL,
          modelRev TEXT NOT NULL,
          PRIMARY KEY (captureId, assetRef, segment, name)
        );
        CREATE INDEX idx_ai_tags_captureId ON ai_tags(captureId);

        -- 記録はするが、画面には一切出さない（2026-07-11）。レーティングの
        -- UI もフィルタも無い: 露骨な内容をアプリがどう扱うかはアプリ自身の
        -- 決定であり、この列を読めるままにしておくことは、ここでその決定を
        -- 下すこととは違う。
        CREATE TABLE ai_tag_ratings (
          captureId TEXT NOT NULL,
          assetRef TEXT NOT NULL,
          segment INTEGER NOT NULL DEFAULT 0,
          rating TEXT NOT NULL,
          score REAL NOT NULL,
          modelId TEXT NOT NULL,
          modelRev TEXT NOT NULL,
          PRIMARY KEY (captureId, assetRef, segment, rating)
        );
        CREATE INDEX idx_ai_tag_ratings_captureId ON ai_tag_ratings(captureId);

        -- 「これはもう提案しないで」。アセット単位ではなく「レコード」単位:
        -- 利用者が拒んだのは「この投稿のこのタグ」であって「このファイルの
        -- このタグ」ではない。これが派生ストアに住むのは、候補が無ければ
        -- 意味を成さないから——AI 機能を丸ごと取り除けばこれも一緒に消える
        -- べきであり、そうしてもライブラリ自体には手を触れないままで
        -- なければならない（#833）。
        CREATE TABLE ai_tag_dismissals (
          captureId TEXT NOT NULL,
          name TEXT NOT NULL,
          dismissedAt TEXT NOT NULL,
          PRIMARY KEY (captureId, name)
        );
        CREATE INDEX idx_ai_tag_dismissals_captureId ON ai_tag_dismissals(captureId);
      `),
  },
];

interface Migration {
  name: string;
  up: (db: MigrationDb) => void;
}

// lib-db.ts の MigrationDb が使うのと同じ狭い一部——生の DDL のみでクエリ
// ビルダーは無い。だからマイグレーションは「現在の」型付きスキーマには
// 依存できず、自分が書いている歴史的な形にしか依存できない。
interface MigrationDb {
  exec: (sql: string) => unknown;
  pragma: (source: string, options?: { simple?: boolean }) => unknown;
}

function runMigrations(db: MigrationDb, migrations = MIGRATIONS) {
  const applied = Number(db.pragma('user_version', { simple: true })) || 0;
  if (applied > migrations.length) {
    throw new Error(`derived.db schema is newer than this build (user_version=${applied}, known=${migrations.length})`);
  }
  for (let i = applied; i < migrations.length; i++) {
    db.exec('BEGIN');
    try {
      migrations[i].up(db);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`derived-db migration ${i + 1} (${migrations[i].name}) failed: ${(err as Error).message}`);
    }
  }
  return { from: applied, to: migrations.length };
}

// `file` を開く。quick_check が異を唱えた瞬間、失敗を呼び出し元へ表に出す
// のではなく、それ（と -wal/-shm の sidecar）を捨てて最初からやり直す——
// モジュールコメント参照: ここには正本になるものが何も無いので、壊れた
// derived.db は無いものとまったく同じ価値しか持たない。
function openWithRecovery(file: string): Database.Database {
  const sqlite = new Database(file);
  let check: unknown;
  try {
    check = sqlite.pragma('quick_check', { simple: true });
  } catch {
    check = null;
  }
  if (check === 'ok') return sqlite;
  sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(file + suffix, { force: true });
    } catch {
      /* ベストエフォート */
    }
  }
  return new Database(file);
}

export interface DerivedDbHandle {
  db: Kysely<DerivedSchema>;
  sqlite: Database.Database;
}

/** `file` の derived.db を開く（無ければ作成する）。保留中のマイグレーションを適用する。 */
export function openDerivedDatabase(file: string): DerivedDbHandle {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = openWithRecovery(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  runMigrations(sqlite);
  const db = new Kysely<DerivedSchema>({ dialect: new SqliteDialect({ database: sqlite }) });
  return { db, sqlite };
}

// captureId を参照するすべての派生テーブルの、すべての行を削除する——
// hologram.db の ON DELETE CASCADE の、派生側の半分（#833 の設計:
// 「ゴミ箱にある間は残し、完全削除で消える」）。SQLite にデータベースを
// またぐ外部キーは存在しないので、これがその代わりを務める。キャプチャが
// 「本当に無くなった」時（ゴミ箱からの完全削除、ゴミ箱を空にする）に呼ぶ
// ——ゴミ箱への論理削除の移動では決して呼ばない。それは派生行に一切触れずに
// おかなければならない。
//
// テーブルの発見は、ハードコードした一覧ではなく動的（sqlite_master +
// PRAGMA table_info）に行うので、後から追加された機能テーブルはここを変更
// する必要が無い——キーの列を `captureId` と名付けるだけでよい。これが
// すべての派生テーブルが共有する唯一の慣習。
export function purgeDerivedForCapture(sqlite: Database.Database, captureId: string): void {
  const tables = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>;
  for (const { name } of tables) {
    const hasCaptureId = (sqlite.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>).some((c) => c.name === 'captureId');
    if (hasCaptureId) sqlite.prepare(`DELETE FROM "${name}" WHERE captureId = ?`).run(captureId);
  }
}

/**
 * あるジョブ種別が、あるアセットをどこまで進めたか。一度も実行していなければ
 * undefined。#834 のキューは計画中に (record, asset, kind) ごとにこれを
 * 尋ねる——これこそが、遡及処理を再開可能にする「唯一の」もの。だから
 * これと食い違いうる別のカーソルは存在しない。
 */
export function readDerivedProgress(sqlite: Database.Database, captureId: string, assetRef: string, jobKind: string): { indexedSegments: number; totalSegments: number } | undefined {
  const row = sqlite.prepare('SELECT indexedSegments, totalSegments FROM derived_progress WHERE captureId = ? AND assetRef = ? AND jobKind = ?').get(captureId, assetRef, jobKind) as { indexedSegments: number; totalSegments: number } | undefined;
  return row;
}

/** 完了したジョブが報告する共有の進捗行を upsert する（これを書くのは #834 で、ジョブ種別自身ではない）。 */
export function writeDerivedProgress(sqlite: Database.Database, row: { captureId: string; assetRef: string; jobKind: string; modelId: string | null; modelRev: string | null; indexedSegments: number; totalSegments: number; updatedAt?: string }): void {
  sqlite
    .prepare(
      `INSERT INTO derived_progress (captureId, assetRef, jobKind, modelId, modelRev, indexedSegments, totalSegments, updatedAt)
       VALUES (@captureId, @assetRef, @jobKind, @modelId, @modelRev, @indexedSegments, @totalSegments, @updatedAt)
       ON CONFLICT(captureId, assetRef, jobKind) DO UPDATE SET
         modelId = excluded.modelId,
         modelRev = excluded.modelRev,
         indexedSegments = excluded.indexedSegments,
         totalSegments = excluded.totalSegments,
         updatedAt = excluded.updatedAt`,
    )
    .run({ ...row, updatedAt: row.updatedAt ?? new Date().toISOString() });
}

// --- #50 の AI タグ候補 ---

export interface AiTagRow {
  name: string;
  category: number;
  score: number;
}

export interface AiTagWrite {
  captureId: string;
  assetRef: string;
  segment: number;
  modelId: string;
  modelRev: string;
  tags: AiTagRow[];
  ratings: Array<{ rating: string; score: number }>;
}

/**
 * 1つのアセットの候補を丸ごと置き換える。
 *
 * upsert ではなく削除してから挿入する: 新しいモデルのリビジョンでの再実行は、
 * 前のリビジョンが生成したタグを「取り除け」なければならず、upsert では
 * それを永遠に残してしまう。1つのトランザクションにすることで、途中の
 * クラッシュが、アセットに2つのリビジョンの意見が混ざった状態を残すことは
 * ない。
 */
export function writeAiTags(sqlite: Database.Database, row: AiTagWrite): void {
  const delTags = sqlite.prepare('DELETE FROM ai_tags WHERE captureId = ? AND assetRef = ? AND segment = ?');
  const delRatings = sqlite.prepare('DELETE FROM ai_tag_ratings WHERE captureId = ? AND assetRef = ? AND segment = ?');
  const insTag = sqlite.prepare('INSERT INTO ai_tags (captureId, assetRef, segment, name, category, score, modelId, modelRev) VALUES (@captureId, @assetRef, @segment, @name, @category, @score, @modelId, @modelRev)');
  const insRating = sqlite.prepare('INSERT INTO ai_tag_ratings (captureId, assetRef, segment, rating, score, modelId, modelRev) VALUES (@captureId, @assetRef, @segment, @rating, @score, @modelId, @modelRev)');
  const { captureId, assetRef, segment, modelId, modelRev } = row;
  sqlite.transaction(() => {
    delTags.run(captureId, assetRef, segment);
    delRatings.run(captureId, assetRef, segment);
    for (const t of row.tags) insTag.run({ captureId, assetRef, segment, modelId, modelRev, ...t });
    for (const r of row.ratings) insRating.run({ captureId, assetRef, segment, modelId, modelRev, ...r });
  })();
}

export interface AiTagCandidateRow extends AiTagRow {
  assetRef: string;
  segment: number;
  modelId: string;
  modelRev: string;
}

/**
 * あるレコードの、まだ決まっていない候補、強い順。却下された名前は、削除
 * するのではなくここでフィルタして除く。だから同じタグは再インデックスを
 * またいで抑制されたままになる（#50 の受け入れ条件の1つ）。
 */
export function readAiTagCandidates(sqlite: Database.Database, captureId: string): AiTagCandidateRow[] {
  return sqlite
    .prepare(
      `SELECT assetRef, segment, name, category, score, modelId, modelRev FROM ai_tags
       WHERE captureId = @captureId
         AND name NOT IN (SELECT name FROM ai_tag_dismissals WHERE captureId = @captureId)
       ORDER BY score DESC`,
    )
    .all({ captureId }) as AiTagCandidateRow[];
}

export function dismissAiTag(sqlite: Database.Database, captureId: string, name: string, at = new Date().toISOString()): void {
  sqlite.prepare('INSERT INTO ai_tag_dismissals (captureId, name, dismissedAt) VALUES (?, ?, ?) ON CONFLICT(captureId, name) DO NOTHING').run(captureId, name, at);
}

/**
 * このモデルが生成したすべての候補と、仕事が済んだと言っている進捗行を
 * 忘れる。
 *
 * モデルが削除された時に呼ばれる: 候補はそもそも、もうここには無いモデルの
 * 見え方でしかなく、進捗行を残しておくと、後で再ダウンロードした時に
 * すべきことが何も見つからなくなってしまう。却下の記録は消さない——
 * それらは利用者の決定であって、モデルの出力ではないため。
 */
export function clearAiTagOutput(sqlite: Database.Database, jobKind: string): void {
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM ai_tags').run();
    sqlite.prepare('DELETE FROM ai_tag_ratings').run();
    sqlite.prepare('DELETE FROM derived_progress WHERE jobKind = ?').run(jobKind);
  })();
}

interface DerivedProgressTable {
  captureId: string;
  assetRef: string;
  jobKind: string;
  modelId: string | null;
  modelRev: string | null;
  indexedSegments: number;
  totalSegments: number;
  updatedAt: string;
}

interface AiTagsTable {
  captureId: string;
  assetRef: string;
  segment: number;
  name: string;
  category: number;
  score: number;
  modelId: string;
  modelRev: string;
}

interface AiTagRatingsTable {
  captureId: string;
  assetRef: string;
  segment: number;
  rating: string;
  score: number;
  modelId: string;
  modelRev: string;
}

interface AiTagDismissalsTable {
  captureId: string;
  name: string;
  dismissedAt: string;
}

interface DerivedSchema {
  derived_progress: DerivedProgressTable;
  ai_tags: AiTagsTable;
  ai_tag_ratings: AiTagRatingsTable;
  ai_tag_dismissals: AiTagDismissalsTable;
}

let handle: DerivedDbHandle | null = null;

/**
 * プロセス全体で使う derived.db のハンドル。初回使用時に遅延して開く
 * （lib-ml-runtime.ts 自身のモジュールレベルのシングルトンを写している——
 * このストアはマシンローカルで #176 のライブラリ切り替えでも変わらないので、
 * index.ts のライブラリごとの dbHandle のライフサイクルには属さない）。
 */
export function ensureDerivedDb(dir: string): DerivedDbHandle {
  if (!handle) handle = openDerivedDatabase(derivedDbFile(dir));
  return handle;
}

/** テスト専用: 次の ensureDerivedDb() 呼び出しを強制的に開き直させる。 */
export function resetDerivedDbForTest(): void {
  try {
    handle?.sqlite.close();
  } catch {
    /* 既に閉じている */
  }
  handle = null;
}

export { runMigrations, MIGRATIONS };
export type { Migration, MigrationDb, DerivedSchema };
