'use strict';

// 永続の取込キューの消費側 (#5 St6 / #299)。取込キューのエンベロープを、それぞれちょうど
// 1回だけ DB へ適用する。イベント1件につき SQLite のトランザクション1つの中で行い、
// post + media + post_tags + FTS と inbox_events の受領記録が一緒にコミットされる。だから
// 適用の途中で落ちても、投稿も受領記録もどちらも残らない（元のファイルは次の送り出しで
// やり直すだけ）。
//
// 同じ適用の処理へ、入口は2つある:
//   - .hologram-inbox/new/*.json＝loose なエンベロープ (native-host/inbox.mts の
//     writeInboxEvent が書いたもの)。定常状態での普通の経路。
//   - .hologram-inbox/segments/*.jsonl＝畳んだ束 (lib-db-inbox-compact.ts の出力)。
//     inbox_segments の受領記録がすでにあるセグメントは、開かずに飛ばす（DB が健全なら
//     こちらが普通）。受領記録の無いものは1行ずつ再生する＝DB を失ったときの回収の経路
//     (#299 の受け入れ条件「空の DB へ loose とセグメントの再生で1,500件を再構成できる」)。
//     圧縮が一度走ったあとは、根付いたライブラリの履歴の大半をセグメントが持つため。
//
// Electron 非依存（better-sqlite3 と node の組み込みだけ）なので素の node で単体テスト
// できる。lib-db-import.ts に倣う。ここで loose ファイルを消すことは決してない＝取込キュー
// は取り込みのあとも再生元として保持する (#299 の設計コメント「保持」)。loose ファイルを
// 消すことがあるのはセグメントへの圧縮 (lib-db-inbox-compact.ts) だけで、それも中身が
// 検証済みのセグメントへ永続的に畳まれてからに限る。
//
// 何度実行しても同じであることと衝突の扱いは、#299 で確定した設計 (2026-07-25 のコメント
// 「アプリ側の消費と冪等性」):
//   - この eventId とハッシュの組の受領記録がすでにある: 何もしない（適用済み）。
//   - この eventId の受領記録が、違うハッシュで存在する: 衝突。報告し、既存の投稿にも
//     ファイルにも触らない。
//   - 受領記録が無く、この captureId の posts の行も無い: 丸ごと挿入する。
//   - 受領記録が無く、この captureId の posts の行はすでにある（例えば、この再生が走る前に
//     DB の復元が別の道でそれを導出していた）: URL と、主張しているメディアのファイル名が
//     全部既存の行と一致する場合に限り、受領記録だけを足す。再生から既存の投稿を上書き
//     することは決してない。食い違えば衝突とし、報告して手を触れない。
//   - レコードが要求するメディア (image/video/media[].file) が saveFolder に無い、または
//     ファイル名のどれかがフォルダの外へ出る: 受領記録を付けずに飛ばし（次の送り出しで
//     やり直す＝同期クライアントがメディアをまだ追いかけている最中に効く）、理由を報告し、
//     他のファイルの処理を続ける。
//   - 適用がそれ以外の何かを throw した (#920): 同じように飛ばしたうえで、エンベロープを
//     .hologram-inbox/failed/ へ隔離する。上の規則は予見できた失敗を並べたもので、これは
//     残り全部を捕まえる。効くのは「エンベロープ1つが取り込み全体を止める」がいちばん痛い
//     失敗だから。その後ろに並んだ投稿は永久に現れず、以降どの送り出しも同じファイルで
//     死ぬので、ライブラリはただ空に見える。new/ に置いたままにせず隔離することが、この
//     飛ばしを効かせる。毒は次の送り出しで読み直されないので、ログにも毎回ではなく1回だけ
//     残る。例外の型は一切見ない。予見できなかった失敗を生き延びるためのものであり、型の
//     許可リストを置けば、次のもののために同じ穴を開けたままにすることになる。

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { SAFE_EVENT_ID, inboxFailedDir, inboxNewDir, inboxSegmentsDir, parseInboxEnvelope } from '../../../native-host/inbox.mts';
import type { InboxEnvelope } from '../../../native-host/inbox.mts';
import type { PostRecordShape } from '../../../native-host/post-record.mts';
import { fillCardDims } from './lib-card-dims.ts';
import { fillMediaDims } from './lib-media-dims.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';
import { resolveInSaveFolder } from './lib-save-folder-path.ts';
import { recordWithCurrentItemPaths } from './lib-item-storage-migration.ts';

export interface InboxDrainReport {
  scanned: number; // この呼び出しで見たエンベロープ（loose と、再生したセグメントの行）
  applied: string[]; // posts へ新しく書いた eventId（新規の挿入）
  receiptOnly: string[]; // 受領記録だけを足した eventId（投稿はすでに在り、一致した）
  noop: number; // 適用済み（受領記録が一致）＝DB への書き込みは無し
  skipped: Array<{ file: string; reason: string; detail?: string }>;
  segmentsReplayed: string[]; // この呼び出しで開いた segmentId（受領記録がまだ無い＝DB 喪失の経路）
}

// そのレコード自身の表示用の成果物＝表示側がこの投稿をそもそも出すのに要るもの。
// avatarFile は意図して外してある。コードベースの他のどこでも、できる範囲で扱うもので
// (bridge.mts の取得、旧形式の ZIP の取り込み)、無くても投稿を止めずに穏やかに崩れる
// （表示側は無いアバターを隠す）。
function requiredMediaFiles(record: PostRecordShape): string[] {
  const files: string[] = [];
  if (record.image) files.push(record.image);
  if (record.video) files.push(record.video);
  for (const m of record.media) if (m.file) files.push(m.file);
  return files;
}

// null＝要求されるファイルが全部あり、フォルダの中に収まっている。そうでなければ理由。
function missingMediaReason(saveFolder: string, record: PostRecordShape): string | null {
  for (const name of requiredMediaFiles(record)) {
    const resolved = resolveInSaveFolder(saveFolder, name);
    if (!resolved) return `media path escapes save folder: ${name}`;
    if (!fs.existsSync(resolved)) return `missing media: ${name}`;
  }
  return null;
}

function ownedMediaSet(record: PostRecordShape): Set<string> {
  const files = new Set<string>();
  if (record.image) files.add(record.image);
  if (record.video) files.add(record.video);
  for (const m of record.media) if (m.file) files.add(m.file);
  return files;
}

interface ExistingPostRow {
  url: string | null;
  image: string | null;
  video: string | null;
}

// 受領記録だけを足す経路での「同じ投稿」＝URL が同じで、主張しているメディアのファイルの
// 集合がぴったり同じ。これより緩くすると、たまたま captureId を共有する無関係な投稿へ、
// 再生したイベントの受領記録を黙って付けてしまう恐れがある。
function existingMatches(existing: ExistingPostRow, existingMediaFiles: string[], envelope: InboxEnvelope): boolean {
  if ((existing.url || null) !== (envelope.record.url || null)) return false;
  const existingOwned = new Set<string>(existingMediaFiles);
  if (existing.image) existingOwned.add(existing.image);
  if (existing.video) existingOwned.add(existing.video);
  const claimed = ownedMediaSet(envelope.record);
  if (existingOwned.size !== claimed.size) return false;
  for (const f of claimed) if (!existingOwned.has(f)) return false;
  return true;
}

// loose の周回とセグメント再生の周回が両方使う、共有の prepared statement 一式。
// エンベロープ1件をどう適用するかを知っている場所を、ちょうど1つにするため。
interface InboxApplyCtx {
  saveFolder: string;
  sqlite: Database.Database;
  stmts: ReturnType<typeof preparePostStmts>;
  resolveTagId: (name: string) => number;
  selectReceipt: Database.Statement;
  insertReceipt: Database.Statement;
  selectExistingPost: Database.Statement;
  selectExistingMedia: Database.Statement;
}

function makeApplyCtx(saveFolder: string, sqlite: Database.Database): InboxApplyCtx {
  return {
    saveFolder,
    sqlite,
    stmts: preparePostStmts(sqlite),
    resolveTagId: makeTagResolver(sqlite),
    selectReceipt: sqlite.prepare('SELECT payloadSha256, importedAt FROM inbox_events WHERE eventId = ?'),
    insertReceipt: sqlite.prepare('INSERT INTO inbox_events (eventId, captureId, payloadSha256, importedAt, sourceSegment) VALUES (?,?,?,?,?)'),
    selectExistingPost: sqlite.prepare('SELECT url, image, video FROM posts WHERE captureId = ?'),
    selectExistingMedia: sqlite.prepare('SELECT file FROM media WHERE postId = ?'),
  };
}

type ApplyOutcome = 'applied' | 'receiptOnly' | 'noop' | { skipped: { reason: string; detail?: string } };

// 解析済みのエンベロープを1件適用する。sourceSegment は、replaySegments から呼ばれたときは
// そのセグメントの id、まだ畳まれていない loose なイベントなら NULL。これを受領記録に残す
// ので、後の圧縮はどの loose ファイルがすでにセグメントへ畳まれたかを知る
// (lib-db-inbox-compact.ts の WHERE sourceSegment IS NULL ORDER BY eventId の走査)。
function applyEnvelope(ctx: InboxApplyCtx, envelope: InboxEnvelope, sourceSegment: string | null): ApplyOutcome {
  const receipt = ctx.selectReceipt.get(envelope.eventId) as { payloadSha256: string } | undefined;
  if (receipt) {
    if (receipt.payloadSha256 === envelope.payloadSha256) return 'noop';
    return { skipped: { reason: 'hash-conflict', detail: `eventId ${envelope.eventId} already applied with a different payload` } };
  }

  const currentRecord = recordWithCurrentItemPaths(ctx.saveFolder, envelope.record);
  const currentEnvelope = currentRecord === envelope.record ? envelope : { ...envelope, record: currentRecord };
  const missing = missingMediaReason(ctx.saveFolder, currentRecord);
  if (missing) return { skipped: { reason: 'missing-media', detail: missing } };

  const now = new Date().toISOString();
  const existing = ctx.selectExistingPost.get(currentEnvelope.eventId) as ExistingPostRow | undefined;
  if (existing) {
    const existingMediaFiles = (ctx.selectExistingMedia.all(currentEnvelope.eventId) as Array<{ file: string }>).map((r) => r.file);
    if (!existingMatches(existing, existingMediaFiles, currentEnvelope)) {
      return { skipped: { reason: 'post-conflict', detail: `captureId ${currentEnvelope.eventId} already exists with a different URL/media` } };
    }
    ctx.sqlite.exec('BEGIN');
    try {
      ctx.insertReceipt.run(currentEnvelope.eventId, currentRecord.captureId, currentEnvelope.payloadSha256, now, sourceSegment);
      ctx.sqlite.exec('COMMIT');
    } catch (err) {
      ctx.sqlite.exec('ROLLBACK');
      throw err;
    }
    return 'receiptOnly';
  }

  ctx.sqlite.exec('BEGIN');
  try {
    writePost(ctx.stmts, ctx.resolveTagId, fillMediaDims(ctx.saveFolder, fillCardDims(ctx.saveFolder, currentRecord)));
    ctx.insertReceipt.run(currentEnvelope.eventId, currentRecord.captureId, currentEnvelope.payloadSha256, now, sourceSegment);
    ctx.sqlite.exec('COMMIT');
  } catch (err) {
    ctx.sqlite.exec('ROLLBACK');
    throw err;
  }
  return 'applied';
}

// applyEnvelope と同じだが、想定外の throw が送り出し全体を道連れにせず、飛ばしになる
// (#920)。`quarantine` が走るのはまさにその経路で、飛ばしを効かせるもの（エンベロープが
// new/ から出るので、次の送り出しは読み直さない）。報告の detail に添える一文を返す。
function applyEnvelopeIsolated(ctx: InboxApplyCtx, envelope: InboxEnvelope, sourceSegment: string | null, quarantine: () => string): ApplyOutcome {
  try {
    return applyEnvelope(ctx, envelope, sourceSegment);
  } catch (err: any) {
    // applyEnvelope は自分のトランザクションを自分でロールバックするが、ROLLBACK 自体が
    // throw すると接続がトランザクションの中に取り残される。そうなると以降のエンベロープも
    // 全部失敗する＝この隔離が防ぐためにある「悪いファイル1つが残り全部を止める」そのもの。
    if (ctx.sqlite.inTransaction) {
      try {
        ctx.sqlite.exec('ROLLBACK');
      } catch {
        /* 取り消すものはもう残っていない */
      }
    }
    return { skipped: { reason: 'apply-failed', detail: `${err?.message || String(err)} (${quarantine()})` } };
  }
}

// failed/ の下で空いている名前。同じ eventId が2度目に失敗したということは、送り出しの
// 合間にファイルが書き直されたということ。つまりどちらのバイト列も証拠であり、1つ目に
// 上書きして rename すると、先の証拠を捨てることになる。
function freeFailedPath(saveFolder: string, name: string): string {
  const base = path.join(inboxFailedDir(saveFolder), name);
  if (!fs.existsSync(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}.${n}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  return `${base}.${Date.now()}`;
}

// 毒になった loose なエンベロープを new/ の外へ移す。バイト列はそのまま保つ（失敗した
// エンベロープは、DB に届かなかっただけの保存済みの中身＝移すのであって、決して消さない）。
// 報告の detail に添える一文を返す。隔離そのものが失敗した場合も報告する。そのときは次の
// 送り出しが、そのファイルを本当に読み直すことになるから。
function quarantineLoose(saveFolder: string, name: string): string {
  try {
    fs.mkdirSync(inboxFailedDir(saveFolder), { recursive: true });
    const dest = freeFailedPath(saveFolder, name);
    fs.renameSync(path.join(inboxNewDir(saveFolder), name), dest);
    return `moved to failed/${path.basename(dest)}`;
  } catch (err: any) {
    return `quarantine failed: ${err?.message || String(err)}`;
  }
}

// セグメント側の対応物。行を束から外へ移すことはできず、セグメントの受領記録はその回が
// 終われば書かれる。そこで、失敗したエンベロープを failed/ へ写し、それ単独でやり直しも
// 診断もできる状態にしておく。セグメントのファイル自体には手を触れない＝DB を失ったときの
// 再生元だから。
function quarantineSegmentLine(saveFolder: string, eventId: string, line: string): string {
  try {
    fs.mkdirSync(inboxFailedDir(saveFolder), { recursive: true });
    const dest = freeFailedPath(saveFolder, `${eventId}.json`);
    fs.writeFileSync(dest, line);
    return `copied to failed/${path.basename(dest)}`;
  } catch (err: any) {
    return `quarantine failed: ${err?.message || String(err)}`;
  }
}

function recordOutcome(report: InboxDrainReport, file: string, outcome: ApplyOutcome, eventId: string) {
  if (outcome === 'noop') report.noop++;
  else if (outcome === 'applied') report.applied.push(eventId);
  else if (outcome === 'receiptOnly') report.receiptOnly.push(eventId);
  else report.skipped.push({ file, reason: outcome.skipped.reason, detail: outcome.skipped.detail });
}

// inbox_segments の受領記録が無いセグメントを再生する。普通は1つも無い（健全な DB は
// どのセグメントの受領記録も持っているので、セグメントのファイル1つにつき索引を使った検索
// が1回あるだけ）。DB を失ったあとは全部のセグメントを、ファイル名の順に古い方から
// （セグメントの id は内容のハッシュであって時刻順ではないが、適用の順序は問題にならない＝
// どの行も単独で何度実行しても同じ）。そのセグメント自身の受領記録は、中の行を全部適用し
// 終えてからコミットする。だから再生の途中で落ちても、次に同じセグメントを再生し直すだけ
// で済む（各行の受領記録があるので、それは作業のやり直しではなく何もしない走査になる）。
function replaySegments(ctx: InboxApplyCtx, report: InboxDrainReport) {
  const dir = inboxSegmentsDir(ctx.saveFolder);
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return; // セグメントはまだ無い
  }
  const selectSegmentReceipt = ctx.sqlite.prepare('SELECT 1 FROM inbox_segments WHERE segmentId = ?');
  const insertSegmentReceipt = ctx.sqlite.prepare('INSERT OR IGNORE INTO inbox_segments (segmentId, payloadSha256, importedAt) VALUES (?,?,?)');

  for (const f of files.filter((f) => f.toLowerCase().endsWith('.jsonl')).sort()) {
    const segmentId = f.slice(0, -'.jsonl'.length);
    if (selectSegmentReceipt.get(segmentId)) continue; // 再生済み＝一度も開かない

    report.segmentsReplayed.push(segmentId);
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, f), 'utf8');
    } catch (err: any) {
      report.skipped.push({ file: f, reason: 'unreadable', detail: err?.message });
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line) continue;
      report.scanned++;
      const parsed = parseInboxEnvelope(line);
      if (!parsed.ok) {
        report.skipped.push({ file: f, reason: parsed.reason, detail: parsed.detail });
        continue;
      }
      const outcome = applyEnvelopeIsolated(ctx, parsed.envelope, segmentId, () => quarantineSegmentLine(ctx.saveFolder, parsed.envelope.eventId, line));
      recordOutcome(report, f, outcome, parsed.envelope.eventId);
    }
    insertSegmentReceipt.run(segmentId, segmentId, new Date().toISOString());
  }
}

// そのファイルが、ファイル自身より新しい受領記録に覆われていると証明できるなら true＝
// 送り出しはファイルを開かずに適用済みと数えられる。ファイル名が eventId なので
// (native-host/inbox.mts は new/<eventId>.json を書く)、1バイトも読む前に受領記録を引ける。
//
// mtime の比較が、ハッシュ衝突の取り決めを保つ。受領記録が言っているのは「この eventId を
// T の時点で取り込んだ」であって、「ディスク上のバイト列が今も取り込んだときのものだ」では
// ない。T より後に書き直されたファイルは丸ごと読み、通常の経路を通る。payload の食い違いが
// 報告されるのはそこ。受領記録の言い分をそのまま採るのは、自分の取り込み以降触られて
// いないファイルだけ。stat() はメタデータだけを見るので、ファイルキャッシュが冷えた状態
// では read と SHA-256 のおよそ 1/12 で済み（エンベロープ約1,000件で実測）、送り出しは
// 読まずに済むものを一切読まない。
function receiptCoversUntouchedFile(ctx: InboxApplyCtx, dir: string, name: string): boolean {
  const eventId = name.slice(0, -'.json'.length);
  // こちらのイベント id の形をしていないものは、読み取りの側に任せる。迷い込んだファイルも
  // 報告から消えず、理由が報告されるようにするため。
  if (!SAFE_EVENT_ID.test(eventId)) return false;
  const receipt = ctx.selectReceipt.get(eventId) as { payloadSha256: string; importedAt: string } | undefined;
  if (!receipt) return false;
  const importedAt = Date.parse(receipt.importedAt || '');
  if (!Number.isFinite(importedAt)) return false;
  try {
    return fs.statSync(path.join(dir, name)).mtimeMs <= importedAt;
  } catch {
    return false; // メタデータが読めない＝素通りさせ、読み取りの側に報告させる
  }
}

// .hologram-inbox/new にある、まだ受領記録の付いていない loose なエンベロープを全部
// 適用する。
//
// 取り込み済みのエンベロープは、受領記録だけを見て飛ばす（上を参照）。それが圧倒的多数を
// 占める。loose ファイルは取り込みのあとも再生元として保持するので（このモジュールの
// 冒頭）、この飛ばしが無いと、送り出しのたびに保持してある山を全部読み直してハッシュを
// 取り直すことになる。しかも drainInbox は最初の投稿一覧の要になる経路で走り、さらに
// 取込キューの監視イベントのたびにも走る。replaySegments がセグメントにすでに当てている
// のと同じ規則（「再生済み＝一度も開かない」）で、loose の経路にだけ無かっただけ。
function drainLoose(ctx: InboxApplyCtx, report: InboxDrainReport) {
  const dir = inboxNewDir(ctx.saveFolder);
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return; // 取込キューがまだ無い＝そこを通って保存されたものが1つも無い
  }
  for (const name of files.filter((f) => f.toLowerCase().endsWith('.json')).sort()) {
    report.scanned++;
    if (receiptCoversUntouchedFile(ctx, dir, name)) {
      report.noop++;
      continue;
    }
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, name), 'utf8');
    } catch (err: any) {
      report.skipped.push({ file: name, reason: 'unreadable', detail: err?.message });
      continue;
    }
    const parsed = parseInboxEnvelope(raw);
    if (!parsed.ok) {
      report.skipped.push({ file: name, reason: parsed.reason, detail: parsed.detail });
      continue;
    }
    const outcome = applyEnvelopeIsolated(ctx, parsed.envelope, null, () => quarantineLoose(ctx.saveFolder, name));
    recordOutcome(report, name, outcome, parsed.envelope.eventId);
  }
}

// 受領記録の無いセグメントを再生し、そのあとで loose なエンベロープを送り出す。繰り返し
// 呼んで安全（起動時、監視イベント時、あふれたときの突き合わせ時）＝適用済みのイベントの
// 費用は、索引を使った SELECT が1回ずつあるだけ。
function drainInbox(saveFolder: string, sqlite: Database.Database): InboxDrainReport {
  const report: InboxDrainReport = { scanned: 0, applied: [], receiptOnly: [], noop: 0, skipped: [], segmentsReplayed: [] };
  const ctx = makeApplyCtx(saveFolder, sqlite);
  replaySegments(ctx, report);
  drainLoose(ctx, report);
  return report;
}

export { drainInbox, missingMediaReason };
