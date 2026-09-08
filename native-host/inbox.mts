// 消えない取込キュー（#5 St6 / #299）。native-host はサイドカーの JSON ではなくここに
// キャプチャを書き、hologram.db の読み書きはアプリのメインプロセスだけが行う
// （lib-db.ts の単一書き手の不変条件）。メインプロセスは起動時と変更時に、このキューを
// DB へ送り出す。設計は確定済み＝issue #299 の 2026-07-25 のコメント（「ディスク上の
// 形式」「native-host の公開手順」）。
//
// Electron から切り離してある（node の組み込みモジュールだけ）ので、
// native-host/bridge.mts とアプリ側 app/src/main の取込キューの読み手が、エンベロープの
// 形式1つとアトミックな書き込みの実装1つを共有できる＝post-record.mts と
// post-key.mts が既に果たしているのと同じ、境界をまたぐ役割だ。
//
// <saveFolder>/.hologram-inbox/ の下のディスク上の配置:
//   tmp/       書き込み中のもの。読み手もバックアップ処理も決して読まない。
//   new/       キャプチャ1件につき JSON のエンベロープ1つ。取り込んだ後も残す
//              （設計コメントが求める「retain」＝このファイルの読み手側の半分が持つ
//              ことになるモジュールコメントを参照）。
//   segments/  取り込み済みのエンベロープを JSON-Lines にまとめて圧縮したもの（この
//              ファイルはディレクトリを知っているだけ。segment を書くのはアプリ側の
//              読み手の仕事だ。受領記録の付いたイベントが1,000件たまったかを判断
//              できるのはそちらだけだから）。
//   failed/    適用が例外を投げたエンベロープ（#920）。書くのは読み手だけで、書き手は
//              決して書かない。最初の失敗が起きるまで作られもしないので、
//              ensureInboxDirs はこれを外してある。隔離することが、毒入りのエンベロープ
//              1つが送り出し全体を永久に止めるのを防いでいる。バイト列は診断のために
//              残し、直したエンベロープはファイルを new/ に戻すことでやり直す。

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';
import { PostRecordSchema, type PostRecordShape } from './post-schemas.mts';

const INBOX_DIRNAME = '.hologram-inbox';
const ENVELOPE_FORMAT = 'hologram-inbox';
const ENVELOPE_VERSION = 1;

// post.capture の eventId はレコードの captureId そのものだ（bridge.mts の uniqueBase の
// 出力＝`<epochMillis>-<hex>`。衝突したときは `-<n>` が付く）。キャプチャがこのモジュール
// に届く前に bridge.mts が既に強制しているのと同じ SAFE_ID の形を、ここでもう一度確かめる。
// このモジュールには自前の呼び出し側が在るからだ（読み手は bridge.mts が一切触らない
// エンベロープを解析する）。
const SAFE_EVENT_ID = /^[0-9]{1,20}-[0-9a-f]{1,8}(?:-\d+)?$/i;

export const InboxEnvelopeSchema = z
  .object({
    format: z.literal(ENVELOPE_FORMAT),
    version: z.literal(ENVELOPE_VERSION),
    eventId: z.string().regex(SAFE_EVENT_ID),
    kind: z.literal('post.capture'),
    createdAt: z.string().min(1),
    payloadSha256: z.string(),
    record: PostRecordSchema,
  })
  .refine((event) => event.eventId === event.record.captureId, { path: ['record', 'captureId'], message: 'id-mismatch' });
type InboxEnvelope = z.output<typeof InboxEnvelopeSchema>;

function inboxDir(saveFolder: string): string {
  return path.join(saveFolder, INBOX_DIRNAME);
}
function inboxTmpDir(saveFolder: string): string {
  return path.join(inboxDir(saveFolder), 'tmp');
}
function inboxNewDir(saveFolder: string): string {
  return path.join(inboxDir(saveFolder), 'new');
}
function inboxSegmentsDir(saveFolder: string): string {
  return path.join(inboxDir(saveFolder), 'segments');
}
function inboxFailedDir(saveFolder: string): string {
  return path.join(inboxDir(saveFolder), 'failed');
}

// セッションで最初に書く前に呼ぶ（毎回呼んでも安全＝木ができていれば recursive な
// mkdir は何もしない）。tmp と new と segments を1つの親の下の兄弟にしてあるので、
// tmp → new の rename は同じファイルシステムの中に収まる（ファイルシステムをまたぐ
// rename はアトミックではない＝tmp と rename を組み合わせる形の要点そのもの）。
function ensureInboxDirs(saveFolder: string): void {
  fs.mkdirSync(inboxTmpDir(saveFolder), { recursive: true });
  fs.mkdirSync(inboxNewDir(saveFolder), { recursive: true });
  fs.mkdirSync(inboxSegmentsDir(saveFolder), { recursive: true });
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

// 正規化済みのレコードからエンベロープを組み立てる。呼び出し側（bridge.mts）は既に
// レコードを normalizePostRecord に通している。このモジュールは正規化をやり直さないので、
// 正規化を飛ばした書き手は、渡したものが黙って直されるのではなく、渡したまま検証されて
// 返る。
function buildEnvelope(record: PostRecordShape, opts: { kind?: InboxEnvelope['kind']; now?: () => string } = {}): InboxEnvelope {
  const kind = opts.kind || 'post.capture';
  const createdAt = (opts.now || (() => new Date().toISOString()))();
  const recordJson = JSON.stringify(record);
  return {
    format: ENVELOPE_FORMAT,
    version: ENVELOPE_VERSION,
    eventId: record.captureId,
    kind,
    createdAt,
    payloadSha256: sha256Hex(recordJson),
    record,
  };
}

// エンベロープ1つを消えない形で書く。tmp のファイルは必ず排他で作り（名前の衝突は
// eventId の重複を意味する＝黙って上書きせず、例外として表に出す）、書いて fsync し、
// それから new/ へ rename する。rename が確定の地点だ。その前のものは new/ の読み手には
// 何も見えず、その後には、イベントが安全になるために起きなければならないことは何も無い。
// `flush: true`（Node >=20.10）は close の前に fd を fsync するので、戻ってきた書き込みは
// ページキャッシュ止まりではなく実際にディスクへ届いている＝この保証について設計コメント
// が Node の fs のドキュメントを引いている。
async function writeInboxEvent(saveFolder: string, envelope: InboxEnvelope): Promise<void> {
  InboxEnvelopeSchema.parse(envelope);
  ensureInboxDirs(saveFolder);
  const finalPath = path.join(inboxNewDir(saveFolder), `${envelope.eventId}.json`);
  const tmpPath = path.join(inboxTmpDir(saveFolder), `${envelope.eventId}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  const json = JSON.stringify(envelope, null, 2);
  await fs.promises.writeFile(tmpPath, json, { flag: 'wx', flush: true });
  try {
    await fs.promises.rename(tmpPath, finalPath);
  } catch (err) {
    try {
      await fs.promises.unlink(tmpPath);
    } catch {
      /* 取り残された tmp ファイルの後始末。できる範囲で */
    }
    throw err;
  }
}

type ParsedEnvelope = { ok: true; envelope: InboxEnvelope } | { ok: false; reason: 'invalid-json' | 'malformed' | 'unknown-format' | 'unknown-version' | 'unknown-kind' | 'id-mismatch' | 'hash-mismatch'; detail?: string };

// 読み手の側のために、生の new/<eventId>.json の中身を検証する。決して例外を投げない
// ＝どの失敗も、落ちるのではなく、呼び出し側が報告して飛ばせる理由になる（設計コメント
// の「他のイベントは続く」）。
function parseInboxEnvelope(raw: string): ParsedEnvelope {
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch (err: any) {
    return { ok: false, reason: 'invalid-json', detail: err?.message };
  }
  const parsed = InboxEnvelopeSchema.safeParse(obj);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const reasons = { format: 'unknown-format', version: 'unknown-version', kind: 'unknown-kind' } as const;
    const key = issue.path[0];
    const reason = issue.message === 'id-mismatch' ? 'id-mismatch' : key === 'format' || key === 'version' || key === 'kind' ? reasons[key] : 'malformed';
    return { ok: false, reason, detail: parsed.error.issues.map(({ path, code }) => path.join('.') + ': ' + code).join(', ') };
  }
  // 正規化前のバイト表現で照合する。検証で補った既定値をハッシュへ混ぜない。
  if (sha256Hex(JSON.stringify(obj.record)) !== parsed.data.payloadSha256) return { ok: false, reason: 'hash-mismatch' };
  return { ok: true, envelope: parsed.data };
}

export { INBOX_DIRNAME, ENVELOPE_FORMAT, ENVELOPE_VERSION, SAFE_EVENT_ID, inboxDir, inboxTmpDir, inboxNewDir, inboxSegmentsDir, inboxFailedDir, ensureInboxDirs, sha256Hex, buildEnvelope, writeInboxEvent, parseInboxEnvelope };
export type { InboxEnvelope, ParsedEnvelope };
