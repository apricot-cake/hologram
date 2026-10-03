// Hologram の Native Messaging ホスト。
//
// Chrome が接続ごとにこのプロセスを起動する（chrome.runtime.connectNative）。取得した
// 投稿を stdin で受け取り、ユーザーの保存フォルダへ書く:
//   items/<captureId>/<file> 投稿が所有するメディア
//   .hologram-inbox/new/<captureId>.json   消えない取込のエンベロープ（#5 St6 / #299）
//
// ブリッジはもう、投稿ごとのサイドカーの JSON を保存フォルダへ直接書かない。その書き込みの
// 経路は #5 の移行の「広げる」局面のものだった（当時はサイドカーが正本だった）。デスクトップ
// アプリが hologram.db を唯一の書き手として持つ今（lib-db.ts の単一書き手の不変条件）、
// 2つ目のプロセスが DB の派生した状態へ直接書けば、その境界を破ることになる。代わりに
// ブリッジは取込キュー（native-host/inbox.mts）へエンベロープを追記する。アプリは起動時と
// 変更時にそれを DB へ送り出す。ファイル（メディア、アバター）は今も1度きりしか書かず、
// 同時に走る保存に対しても安全で、アプリが動いていなくても
// ブリッジは働く。ディスク上の取込のエンベロープは、まだ DB の行になっていないだけで、
// 昔のサイドカーとまったく同じだけ消えない。
//
// 読み取りにも1つだけ答える。{type:'query'} は、どのパーマリンクが既にライブラリに在るか
// を拡張機能に伝えるので、タイムラインが保存済みの投稿に印を付けられる（#54）。この経路も
// 保存フォルダへは何も書かない＝保存済み投稿の索引を参照。

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { configDir, defaultLibraryDir, extensionBuildStampPath, extensionContactPath } from './paths.mts';
// できる範囲で働く遠隔画像のダウンロード（元のメディアとアバター）は共有のモジュールに
// 置く。そうすればキャプチャでも取り込みでも埋め戻しでも、SSRF の防ぎとサイズの上限が
// 同一になる。media-download.mts を参照。
import { downloadMedia, downloadOneMedia, downloadAvatar, downloadLinkCardThumbnail, saveStillImage, createByteBudget, subscribeMediaFailures } from './media-download.mts';
import type { MediaDescriptor } from './media-download.mts';
// デスクトップアプリが使うのと同じ純粋な解決処理。だからブリッジとアプリは必ず同じ保存
// フォルダを選ぶ。冗長なポインタからの復旧も含めてだ。readSaveFolder を参照。
import { resolveSaveFolder } from './config-recovery.mts';
// URL から同一性のキーへの唯一の規則。レンダラーのまとめ方と共有する。post-key.mts と、
// 下の保存済み投稿の索引を参照。
import { postKeyOf } from './post-key.mts';
import { alreadySaved } from './save-guard.mts';
// 共有のレコードの形と正規化の組み立て役（#5 St2 / #295）。だからブリッジが作ったレコード
// は、DB の書き手が期待する欄をそっくりそのまま持つ。
import { normalizePostRecord, recordHoldsContent } from './post-record.mts';
import { downloadQuotedPost, cachedQuotedMedia } from './quoted-storage.mts';
// 消えない取込キューのエンベロープの形式と、アトミックな書き手（#5 St6 / #299）。
import { buildEnvelope, writeInboxEvent, inboxNewDir, parseInboxEnvelope, type InboxEnvelope } from './inbox.mts';
// 取得した原本（#292）。拡張機能は応答の本体を受け取ったまま渡してくる。圧縮とハッシュと
// 上限はここ、Native Messaging の境界の信頼できる側で行う。だからブラウザが、原本のどこ
// までを残す値打ちがあるかを決めることは決してない。
import { itemDirectoryAbsolute, itemFileRelative } from './item-storage.mts';
import { STORED_CAPTURE_ID_PATTERN } from './capture-id.mts';
// メッセージの取り決めそのもの（#400）。拡張機能と共有する。要求がどんな形か、応答が
// どんな形か、そして受け取ったフレームをそのどちらかに変える唯一の解析。下のハンドラは
// どれも、通信路から生の欄を読まない。
import { parseHostFrame, isCaptureId, stampProtocol, AckCommonSchema, SavePostAckSchema } from './protocol.mts';
type SavePostAck = import('./protocol.mts').SavePostAck;
type SaveMediaAck = import('./protocol.mts').SaveMediaAck;
type HostResponse = import('./protocol.mts').HostResponse;
type QueryAck = import('./protocol.mts').QueryAck;
type QueryRequest = import('./protocol.mts').QueryRequest;
type SaveAck = import('./protocol.mts').SaveAck;
type SaveMediaRequest = import('./protocol.mts').SaveMediaRequest;
type SavePostRequest = import('./protocol.mts').SavePostRequest;
type SavedEntry = import('./protocol.mts').SavedEntry;
type TrashedEntry = import('./protocol.mts').TrashedEntry;
type RequestReceipt = import('./protocol.mts').RequestReceipt;

// --- 診断のログ -----------------------------------------------------------------
// Chrome は Native Messaging の接続1つにつき1回このプロセスを起動するので、ここに
// 行が出れば、ホストがレジストリで見つかって起動したことの証拠になる。Chrome が
// 「native messaging host not found」と言い、このログに新しい行が1本も出ないなら、
// 失敗はブリッジではなく Chrome のマニフェストの探索（起動より前）にある。できる範囲で
// 働き、決して例外を投げてはいけない（ログのエラーがキャプチャを壊してはいけない）。
function logLine(msg: string): void {
  try {
    fs.appendFileSync(path.join(configDir(), 'bridge.log'), `${new Date().toISOString()} [pid ${process.pid}] ${msg}\n`);
  } catch {
    /* 無視する＝ログは無くても困らない */
  }
}

// --- ローカルの拡張機能ビルドのトークン（#650）---------------------------------
// プロセスごとに1回ではなく、応答のたびに読み直す。接続のうち1つが長生きするからだ。
// 保存済み投稿の印は、閲覧のひとまとまりの間ずっと1本のポートを開いたままにする。そして
// そのポートは、30秒前に終わったビルドが拡張機能へ届く最も速い道だ。値を覚えてしまえば、
// 最も役に立つ運び手であるその印のポートだけが、知らせを運べない唯一のものになる。
//
// 応答ごとに約120バイトの読み取りがかかる。決して例外を投げず、理由も一切言わない。
// ファイルが無い（拡張機能をビルドしていないどのマシンでも、これがふつうの場合）、
// ファイルが読めない、JSON が壊れている、欄が無い。どれも同じことを意味する＝言うことが
// 何も無いのだから、応答も何も言わない。
function readExtBuild(): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(extensionBuildStampPath(), 'utf8'));
    return raw && typeof raw.build === 'string' && raw.build ? raw.build : null;
  } catch {
    return null;
  }
}

// --- 拡張機能の接触の印（#71）---------------------------------------------
// このプロセスが確認（{type:'query'}）や保存を扱うたびに、できる範囲でこれに触る。
// そうすればアプリは、「拡張機能は一度も話しかけてきていない」と「話しかけてきたが、
// ライブラリはまだ空だ」を見分けられる（empty/EmptyState.tsx の firstRun の側）。読み返す
// のはファイルが在るかどうかだけなので（paths.mts の extensionContactPath を参照）、
// ここでの失敗は、保存を危険にさらす代わりに、このファイルの他の診断の書き込みと同じく
// 飲み込む。
export function touchExtensionContact(): void {
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(extensionContactPath(), new Date().toISOString(), 'utf8');
  } catch {
    /* できる範囲で＝触り損ねても、案内が消えるのが保存1回分遅れるだけだ */
  }
}

// --- 構造化したキャプチャの診断ログ ---------------------------------------------
// capture.log に、キャプチャのイベント1件につき JSON を1行。壊れた保存を後から診断
// できるようにするためだ。どの段階が、なぜ失敗したか。拡張機能はブリッジより前の段階
// （select / permalink / capture / crop / metadata）を {type:'log'} で中継し、ブリッジは
// 自分の最終的な結果をここに追記する。できる範囲で働き、決して例外を投げてはいけない
// （ログのエラーがキャプチャを壊してはいけない）。約 2MB で1世代前（capture.log.1）へ
// 回すので、際限なく育つことはない。
const CAPTURE_LOG_MAX = 2 * 1024 * 1024;

export function appendLog(entry: Record<string, unknown>): void {
  try {
    const file = path.join(configDir(), 'capture.log');
    try {
      if (fs.statSync(file).size > CAPTURE_LOG_MAX) fs.renameSync(file, `${file}.1`);
    } catch {
      /* まだファイルが無い＝回すものが無い */
    }
    fs.appendFileSync(file, JSON.stringify(Object.assign({ ts: new Date().toISOString() }, entry)) + '\n');
  } catch {
    /* 無視する＝ログは無くても困らない */
  }
}

// #894: 着かなかったメディアのダウンロード1件につき capture.log に1行。理由を載せる
// （HTTP のステータス、SSRF の防ぎが拒んだ、非対応の content-type、時間切れ、防ぎが見た
// DNS の答え）。メディアのダウンロードは約束としてできる範囲で働く＝失敗すると null を
// 返し、呼び出し側がそのファイルを落とす。だから今までは、「メディアが告げられたのに、何も
// ダウンロードできなかった」で死んだ保存が、その理由の手がかりを何も残さず、#894 の Qiita
// での失敗とネットワークの一時的な乱れを見分けられなかった。理由を保存の結果の行に畳み
// 込まず、自前の `stage:'media'` の行に乗せているのは、保存1回で複数のダウンロードが
// 失敗しうるからであり、アバターや絵文字はここで失敗しても保存自体はまったく失敗しない
// からだ。既存のどの行も記録しない損失が、まさにそれだ。
//
// モジュールの読み込み時に購読する。このファイルはホストのプロセスの入口であり、失敗は
// どのハンドラに入る前にも起こりうる（防ぎ付きの DNS の名前解決は fetch の中で走る）。
subscribeMediaFailures((info) => {
  appendLog({ stage: 'media', phase: 'fail', ...info });
});

// このホストが保存を受け取り、取りかかったことを言う capture.log の1行（#519）。拡張
// 機能自身の行と違って、これはただだ。このプロセスは既に走っていて、ログも既に開いて
// いるので、作業を挟む2本の行に費用はかからない。得られるのは、「要求がホストに届いて
// いない」と「ホストは受け取ったが終えなかった」の違いだ。#507 の調査はこのログから
// その問いに答えられなかった。ホストの行が、作業が済んだ後に書かれる1本しか無かった
// からだ。
function logSaveReceived(req: SavePostRequest | SaveMediaRequest): void {
  const meta = req.metadata;
  appendLog({
    stage: 'bridge',
    phase: 'begin',
    type: req.type,
    saveId: req.saveId || null,
    captureId: req.captureId || null,
    platform: meta.platform || null,
    url: meta.url || null,
  });
}

// ブリッジ側の保存の結果（最後の段階）についての capture.log の1行。前の段階は拡張機能
// がログに残す。この行は、その結果を同じ url に結びつける。
function logSaveOutcome(req: SavePostRequest | SaveMediaRequest, res: SaveAck | null, err: Error | null): void {
  const meta = req.metadata;
  appendLog({
    stage: 'bridge',
    phase: err ? 'fail' : 'ok',
    type: req.type,
    // ページが発行し、他の2つのプロセスを通して運ばれるので、この行は拡張機能自身の
    // 行と並べて読める（#519）。
    saveId: req.saveId || null,
    captureId: (res && res.file) || req.captureId || null,
    platform: meta.platform || null,
    url: meta.url || null,
    // metaOk は拡張機能が計算する（投稿の API が情報を返したか）。素通しするので、部分的
    // な保存（画像は保存できたが投稿の情報が無い）が見える。metaReason は、拡張機能が
    // 分類できたときのその理由（protected / ageRestricted / unavailable / fetchFailed）
    // ＝「投稿がもう無い」と「こちらの取得が壊れた」の違いで、結果だけからは言えない。
    metaOk: req.metaOk,
    metaReason: req.metaReason,
    // ドラッグ保存の経路には無い。あちらは画像をちょうど1枚ダウンロードし、代わりに
    // `media` でそれを報告する（ack の型を参照）。
    mediaCount: res && 'mediaCount' in res ? res.mediaCount : undefined,
    error: err ? err.message : undefined,
  });
}

// --- 保存フォルダの解決（デスクトップアプリと共有する設定）---
// アプリの getSaveFolder() とまったく同じ純関数を通して解決する。明示された設定が勝ち、
// 無ければ冗長な saveFolder.path のポインタから復旧し（それが今も実在のディレクトリに
// 解決する場合だけ）、それも無ければ共有の同じ既定を使う。
//
// ポインタの段が効いてくるのは、アプリとブリッジが独立に設定を読むからだ。config.json が
// 切り詰められて saveFolder が落ちた後（2026-06-23 の喪失の一件）、アプリは次の起動で
// ポインタから設定を治す。だがブリッジは、アプリが閉じているかもしれない状態で Chrome に
// キャプチャごとに起動される。だから自分でポインタを読まなければ、アプリがまだ選ばれた
// ライブラリを指しているのに、黙って defaultLibraryDir() へ保存してしまう＝2つがずれる。
function readSaveFolder(): string {
  let configSaveFolder = null;
  try {
    // README は config.json を手で編集する手順を書いている。Windows のエディタが好んで
    // 先頭に付ける UTF-8 の BOM を落とす。落とさないと解析が例外を投げ、ここが黙って
    // 退避してしまう。
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
    if (cfg && typeof cfg.saveFolder === 'string') configSaveFolder = cfg.saveFolder;
  } catch {
    // まだ設定が無い（または読めない）＝ポインタと既定へ落ちる。
  }
  let pointer: string | null = null;
  try {
    pointer = fs.readFileSync(path.join(configDir(), 'saveFolder.path'), 'utf8').trim() || null;
  } catch {
    // 冗長なポインタが無い＝それでよい。
  }
  let pointerExists = false;
  if (pointer) {
    try {
      pointerExists = fs.statSync(pointer).isDirectory();
    } catch {
      pointerExists = false;
    }
  }
  return resolveSaveFolder({
    configSaveFolder,
    pointer,
    pointerExists,
    defaultDir: defaultLibraryDir(),
  }).folder;
}

// --- Native Messaging のフレーム（4バイトのリトルエンディアンの長さ＋UTF-8 の JSON）---
function sendMessage(obj: unknown): void {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  try {
    process.stdout.write(Buffer.concat([header, json]));
  } catch {
    // stdout が閉じた＝こちらにできることは無い。
  }
}

// captureId は `<epochMillis>-<hex>` で、それ以外は、要求がここのハンドラに届く前に共有の
// 解析（protocol.mts の CAPTURE_ID_PATTERN）が既に弾いている。この規則が取り決めの持ち物
// なのは、ページが選んだ id がパス区切りや `..` で保存フォルダの外へ出るのを防ぐものだから
// だ。したがってハンドラは、要求が使える id をまったく運ばなかった場合（captureId ===
// null）にだけ答えればよい。
//
// どの保存の応答も、`file` と並べて `captureId`（uniqueBase で解決した id。求められたもの
// と違うことがある）を運ぶ。この2つは取り替えがきかない。`file` はファイル名で、一括
// 取り込みの経路ではそもそも id から導かれてすらいない（最初にダウンロードしたメディアの
// 名前だ）。拡張機能はレコードの名を言うのに id そのものを必要とする＝#34 の「置き換える」
// という答えは、どのキャプチャを退けるかを言う。以前はそれを `file` で間に合わせていた。

// captureId から作る項目名の衝突を避ける。現在の項目フォルダー、取込のエンベロープ、
// 移行前の直下ファイルをすべて確かめる。古いライブラリを初めて開く前に拡張機能が保存しても、
// 既存の項目を上書きしない。
function uniqueBase(dir: string, captureId: string): string {
  const taken = (base: string) => fs.existsSync(itemDirectoryAbsolute(dir, base)) || fs.existsSync(path.join(dir, `${base}.jpg`)) || fs.existsSync(path.join(dir, `${base}.json`)) || fs.existsSync(path.join(inboxNewDir(dir), `${base}.json`));
  if (!taken(captureId)) return captureId;
  let n = 1;
  // まず起きない（captureId は既にタイムスタンプと乱数を持つ）が、上書きするのではなく
  // 一意であることを保証する。
  while (taken(`${captureId}-${n}`)) {
    n += 1;
  }
  return `${captureId}-${n}`;
}

interface ReceiptContext {
  folder: string;
  requestId: string;
  generation: string;
  requestNonce: string | null;
  payloadHash: string;
  phase: 'downloading' | 'publishing';
}

interface OutputOwner {
  requestId: string;
  generation: string;
  requestNonce: string | null;
  payloadHash: string;
  itemId: string;
}

type OutputJournal = OutputOwner & ({ phase: 'downloading' } | { phase: 'publishing'; envelope: InboxEnvelope; ack: SaveAck });
const ITEM_OWNER_FILE = '.hologram-request-owner.json';

function outputOwner(context: ReceiptContext, itemId: string): OutputOwner {
  return { requestId: context.requestId, generation: context.generation, requestNonce: context.requestNonce, payloadHash: context.payloadHash, itemId };
}

function writeOutputJournal(context: ReceiptContext, journal: OutputJournal): void {
  const dir = receiptDir(context.folder, context.requestId);
  const tmp = path.join(dir, `output.json.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(journal), { encoding: 'utf8', flush: true });
  fs.renameSync(tmp, path.join(dir, 'output.json'));
}

async function withItemDirectory<T>(saveFolder: string, captureId: string, context: ReceiptContext, work: (itemDir: string) => Promise<T>): Promise<T> {
  const itemDir = path.join(receiptDir(saveFolder, context.requestId), 'item');
  fs.mkdirSync(itemDir);
  try {
    const owner = outputOwner(context, captureId);
    // 大きな媒体を書き始める前に、項目と受領記録の両方に所有世代を残す。
    fs.writeFileSync(path.join(itemDir, ITEM_OWNER_FILE), JSON.stringify(owner), { encoding: 'utf8', flag: 'wx', flush: true });
    writeOutputJournal(context, { ...owner, phase: 'downloading' });
    return await work(itemDir);
  } catch (error) {
    // 公開を始めた項目は、アプリが既に取り込んだ可能性がある。削除せず、
    // 耐久記録した同じエンベロープの再公開に委ねる。
    if (context.phase === 'downloading') {
      try {
        fs.rmSync(itemDir, { recursive: true, force: true });
      } catch (cleanupError: any) {
        throw Object.assign(new Error(cleanupError?.message || String(cleanupError)), { code: 'request-in-progress' });
      }
    }
    throw error;
  }
}

async function publishPreparedOutput(folder: string, journal: Extract<OutputJournal, { phase: 'publishing' }>): Promise<SaveAck> {
  const staging = path.join(receiptDir(folder, journal.requestId), 'item');
  const finalItem = itemDirectoryAbsolute(folder, journal.itemId);
  if (fs.existsSync(staging)) {
    assertOutputOwner(staging, journal);
    if (fs.existsSync(finalItem)) throw new Error('Save output destination already exists');
    fs.mkdirSync(path.dirname(finalItem), { recursive: true });
    fs.renameSync(staging, finalItem);
  }
  assertOutputOwner(finalItem, journal);
  if (fs.realpathSync(finalItem) !== path.join(fs.realpathSync(folder), 'items', path.basename(finalItem))) throw new Error('Save output directory escapes its library');
  const file = path.join(inboxNewDir(folder), `${journal.itemId}.json`);
  let existing: string | null = null;
  try {
    existing = fs.readFileSync(file, 'utf8');
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (existing !== null) {
    const parsed = parseInboxEnvelope(existing);
    if (!parsed.ok || parsed.envelope.payloadSha256 !== journal.envelope.payloadSha256) throw new Error('Committed output belongs to a different payload');
  } else {
    // loose が圧縮済みでも同じ eventId/hash の再公開は DB の受領記録で noop になる。
    await writeInboxEvent(folder, journal.envelope);
  }
  const record = journal.envelope.record;
  noteSaved(record.url, record.retryOf || record.captureId, record.media, record.imageCount, !record.saveIncomplete && record.saveScope === 'post' && record.media.length >= (record.imageCount || 0), record.saveScope === 'media' ? mediaUrlsOf(record).filter((url): url is string => !!url) : []);
  return journal.ack;
}

async function commitSavedOutput(context: ReceiptContext, record: Parameters<typeof buildEnvelope>[0], ack: SaveAck): Promise<void> {
  const journal: Extract<OutputJournal, { phase: 'publishing' }> = { ...outputOwner(context, record.captureId), phase: 'publishing', envelope: buildEnvelope(record), ack };
  writeOutputJournal(context, journal);
  context.phase = 'publishing';
  await publishPreparedOutput(context.folder, journal);
}

function assertOutputOwner(itemDir: string, journal: OutputOwner): void {
  const stat = fs.lstatSync(itemDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Save output is not an owned directory');
  const marker = path.join(itemDir, ITEM_OWNER_FILE);
  const markerStat = fs.lstatSync(marker);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error('Save output owner is not a regular file');
  const owner = JSON.parse(fs.readFileSync(marker, 'utf8'));
  for (const key of ['requestId', 'generation', 'requestNonce', 'payloadHash', 'itemId'] as const) {
    if (owner[key] !== journal[key]) throw new Error('Save output ownership changed');
  }
}

async function recoverRequestOutput(folder: string, req: SavePostRequest | SaveMediaRequest): Promise<SaveAck | null> {
  const dir = receiptDir(folder, req.captureId);
  // 更新前のホストが回収中なら終了を待つ。旧ロック自体を移動しない。
  const legacyLock = path.join(dir, 'recovery.lock');
  let legacyOwnerAlive = false;
  try {
    const owner = JSON.parse(fs.readFileSync(legacyLock, 'utf8'));
    try {
      process.kill(Number(owner.ownerPid), 0);
      legacyOwnerAlive = true;
    } catch {
      /* 終了した旧ホスト */
    }
  } catch {
    try {
      legacyOwnerAlive = fs.statSync(legacyLock).mtimeMs >= Date.now() - 90_000;
    } catch {
      /* 旧ロック無し */
    }
  }
  if (legacyOwnerAlive) throw Object.assign(new Error('Save request recovery is contended'), { code: 'request-in-progress' });
  let journal: OutputJournal;
  try {
    journal = JSON.parse(fs.readFileSync(path.join(dir, 'output.json'), 'utf8'));
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null; // 旧版は項目の所有証拠を持たない。
    throw error;
  }
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  const identity = requestIdentity(req);
  if (
    journal.requestId !== req.captureId ||
    typeof journal.generation !== 'string' ||
    !/^[a-f0-9]{32}$/.test(journal.generation) ||
    journal.generation !== receipt.generation ||
    journal.requestNonce !== identity.requestNonce ||
    journal.payloadHash !== identity.payloadHash ||
    !STORED_CAPTURE_ID_PATTERN.test(journal.itemId) ||
    (journal.phase !== 'downloading' && journal.phase !== 'publishing')
  )
    throw new Error('Save output ownership changed');
  if (journal.phase === 'downloading') {
    const itemDir = path.join(dir, 'item');
    if (!fs.existsSync(itemDir)) return null;
    assertOutputOwner(itemDir, journal);
    if (fs.realpathSync(itemDir) !== path.join(fs.realpathSync(folder), '.hologram-inbox', 'requests', req.captureId, 'item')) throw new Error('Save staging directory escapes its library');
    fs.rmSync(itemDir, { recursive: true, force: true });
    return null;
  }
  const parsed = parseInboxEnvelope(JSON.stringify(journal.envelope));
  const ack = (req.type === 'savePost' ? SavePostAckSchema : AckCommonSchema).parse(journal.ack);
  if (!parsed.ok || parsed.envelope.eventId !== journal.itemId || ack.saveFolder !== folder) throw new Error('Invalid prepared save output');
  // 検証で補った既定値やプロパティ順を、保存済みハッシュの表現へ混ぜない。
  return publishPreparedOutput(folder, { ...journal, ack });
}

function removeCompletedOutputOwner(folder: string, requestId: string): void {
  try {
    const dir = receiptDir(folder, requestId);
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'output.json'), 'utf8'));
    if (receipt.state !== 'completed' || journal.requestId !== requestId || journal.requestNonce !== receipt.requestNonce || journal.payloadHash !== receipt.payloadHash || !STORED_CAPTURE_ID_PATTERN.test(journal.itemId)) return;
    const itemDir = itemDirectoryAbsolute(folder, journal.itemId);
    if (fs.realpathSync(itemDir) !== path.join(fs.realpathSync(folder), 'items', path.basename(itemDir))) return;
    const file = path.join(itemDir, ITEM_OWNER_FILE);
    const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of ['requestId', 'generation', 'requestNonce', 'payloadHash', 'itemId'] as const) {
      if (owner[key] !== journal[key]) return;
    }
    fs.unlinkSync(file);
  } catch {
    // 完了記録が正本。補助マーカーの削除失敗を保存失敗へ変えない。
  }
}

function itemizeMedia(captureId: string, media: MediaDescriptor[]): MediaDescriptor[] {
  return media.map((entry) => ({
    ...entry,
    file: itemFileRelative(captureId, entry.file),
    ...(entry.posterFile ? { posterFile: itemFileRelative(captureId, entry.posterFile) } : {}),
  }));
}

// --- 保存済み投稿の索引（タイムラインの「保存済み」の印の読み取りの経路）------------
// 拡張機能は「このパーマリンクのうち、既にライブラリに在るのはどれか」を尋ねる
// （{type:'query'}）。その答えは、デスクトップアプリが閉じていても正しくなければならない
// ＝アプリではなくブリッジに尋ねる理由はまさにそこだ。
//
// #299 は、走査から作っていた古いスナップショットを bridge-saved-index.json に置き換えた。
// これは postKey から captureId への小さな map で、アプリが hologram.db から直接組み直し
// （lib-saved-index.ts）、投稿が変わるたびに間引いてアトミックに書き直す。安く大量に読める
// 出所であり（ライブラリを走査せずに1回読むだけ）、同時に古くなる出所でもある。アプリの
// 最後の書き込み以降に保存（取り込み、削除）されたものは、そこに無い。その隙間は独立した
// 2つの継ぎ当てで埋める:
//
//   1. bridge-journal.jsonl（configDir）: ブリッジ側の保存はどれも、自分の postKey を
//      ここに追記する。これがまさにアプリが閉じていた場合であり、そのとき起きていた
//      唯一のプロセスが記録する。
//   2. 保存済み索引のスナップショットより新しい、取込キューにばらけて残るエンベロープ
//      （.hologram-inbox/new）の、上限付きの読み直し。eventId は `<epochMillis>-<hex>` で
//      エンベロープはその名前を持つので、「スナップショットより新しい」はファイル名から
//      読める。ファイルごとの stat() は要らない。これは1の帯に対する吊りひもだ。2つ目の
//      ブラウザのプロファイル（別のブリッジのプロセス、別のジャーナル）が行った保存も
//      これが拾う。
//
// 両方を1つの postKey からエントリへの map にまとめ、プロセスの一生のあいだ覚えておく
// （拡張機能はタイムライン1本分の問い合わせのあいだ1本のポートを開いたままにする＝
// background.ts を参照）。どちらかの出所の mtime が動いたら無効にする。
//
// エントリは captureId と、その投稿の保存済みの画像（#334）＝そのレコードが持つメディアの
// 項目を、レコード自身の順番で並べたものだ。印の問いは投稿ごとではなく画像ごとになる。
// 複数画像の投稿のうち1枚だけがライブラリに在って残りは無い、ということがありうるし、
// どれかを知っているのはレコードだけだ。同じ postKey を持つすべてのレコードのメディアを
// まとめる。投稿の2枚目を保存すると、最初のレコードが伸びるのではなく2つ目のレコードが
// 書かれるからだ。
//
// メディアが分からないレコード（項目が1つも無いエントリ＝テキストだけの投稿、ダウン
// ロードが失敗したキャプチャ、より古いアプリが書いたスナップショット）は空の一覧で答え、
// 拡張機能はそれを「保存済みだが、粒度は分からない」と読み、#334 の前とまったく同じに
// 扱う＝投稿全体に印が付く。細かさが無いことを「その画像は保存されていない」と読んでは
// いけない。
const SAVED_INDEX_FILE = 'bridge-saved-index.json';
const JOURNAL_FILE = 'bridge-journal.jsonl';
const QUERY_URL_CAP = 300; // 表示領域1画面分の投稿に、余裕を足した数
const RECENT_SCAN_CAP = 500; // 組み直しごとに読み直す、ばらけた取込エンベロープの数。新しい順
const JOURNAL_COMPACT_BYTES = 64 * 1024; // 書き直す値打ちが出てから初めて詰める
// 取込エンベロープのファイル名（native-host/inbox.mts の writeInboxEvent）。eventId は
// captureId そのもの＝`<epochMillis>-<hex>` に、uniqueBase() の `-<n>` の接尾辞が付く。
// グループ1が保存の時刻だ。
const INBOX_ENVELOPE_NAME = /^(.+)\.json$/i;

// 投稿1つの保存済みの画像。位置で対応するので、配列の添字がメディアの行の seq そのもの
// になり、ライブラリが URL を記録しなかった画像は null としてその位置を占める。主となるのは
// url で、seq はその null のときだけの代わりだ（投稿のメディアは変わりうるので、位置は
// 消えない id にはならない）。
//
// owners は media と並びが対応する。その画像を持つレコードの captureId だ。`id` はキーを
// 最初に主張したレコードしか指さないので、画像が複数のレコードに散らばった投稿について
// 「この画像はどのキャプチャに在るか」には答えられない。そしてそれこそ、二重保存の警告の
// 「置き換える」という答えが間違えてはいけない問いだ（#34）。
// 通信路上の形（protocol.mts の SavedEntry）に `owners` を必須にしたもの。答える側では
// どのエントリもここで組み立てられるので、この欄が、契約が読み手のために許さなければ
// ならない「より古いスナップショットは持っていなかった」という不在になることは決してない。
type IndexEntry = SavedEntry & { owners: Array<string | null>; total: number | null };
interface SavedIndex {
  folder: string;
  savedIndexMtimeMs: number;
  journalMtimeMs: number;
  keys: Map<string, IndexEntry>; // postKey → エントリ
  // `.trash/` に座っている投稿についての、postKey からゴミ箱のレコードへの map（#158）。
  // ジャーナルや取込キューの継ぎ当てを後ろに置かず、スナップショットからそのまま読む。
  // 保存とは違い、ゴミ箱が動くのはアプリが走っている間だけだからだ。この半分が埋める
  // べきアプリが閉じていた場合は無く、アプリはゴミ箱の操作のたびにスナップショットを
  // 書き直す。
  trashed: Map<string, TrashedEntry>;
}
let savedIndexCache: SavedIndex | null = null;

// 保存済み索引が持つ形での media[]。位置で対応するので、添字が seq そのものであり、
// レコードが URL を持たない項目もその位置を占め続ける。出所が渡すどちらの形も受け取る
// ＝レコードのメディアのオブジェクト（{url,file,…}）でも、スナップショットとジャーナルが
// 保存する、既に平らにした一覧でもよい。
function mediaUrlsOf(source: any): Array<string | null> {
  const media = source && Array.isArray(source.media) ? source.media : [];
  return media.map((m: any) => {
    if (typeof m === 'string') return m || null;
    return m && typeof m.url === 'string' && m.url ? m.url : null;
  });
}

// レコード1つの画像を、その postKey のエントリへ畳み込む。同じ投稿の2つのレコード
// （複数画像の投稿の2枚目は、それ自体が1回の保存だ）はどちらも寄与する。既に一覧に
// 在る画像を二度並べることはない。
//
// url の無い画像は、キーを最初に主張したレコードのものだけを保つ。その位置が意味を持つ
// のは自分のレコードの中だけで、他のどこでもない。だから後のレコードから足せば、「何枚目」
// を自分のものではない番号に置くことになる。落としても、印が使えるものは何も失わない。
function mergeSavedEntry(keys: Map<string, IndexEntry>, key: string, id: string, urls: Array<string | null>, owners?: Array<string | null>, total: number | null = null, post = true, individualMedia: string[] = []): void {
  const ownerOf = (i: number) => (owners && owners[i] ? owners[i] : id || null);
  const entry = keys.get(key);
  if (!entry) {
    keys.set(key, { post, individualMedia: individualMedia.slice(), id, media: urls.slice(), owners: urls.map((_u, i) => ownerOf(i)), total: Math.max(total || 0, urls.length) || null });
    return;
  }
  entry.post ||= post;
  entry.individualMedia = [...new Set([...(entry.individualMedia ?? []), ...individualMedia])];
  entry.total = Math.max(entry.total || 0, total || 0, urls.length) || null;
  urls.forEach((url, i) => {
    if (!url || entry.media.includes(url)) return;
    entry.media.push(url);
    entry.owners.push(ownerOf(i));
  });
  entry.total = Math.max(entry.total || 0, entry.media.length) || null;
}

function savedIndexPath(): string {
  return path.join(configDir(), SAVED_INDEX_FILE);
}
function journalPath(): string {
  return path.join(configDir(), JOURNAL_FILE);
}

function statMtimeMs(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return -1; // 無い＝本物の mtime が負になることはないので、これで素直に比べられる
  }
}

// 今終わった保存を記録し、問い合わせが即座に「保存済み」と答えられるようにする。
// bridge-saved-index.json は、アプリが次に取込キューを送り出すまでこれを知らないからだ。
// 生きている map も更新する。ポート1本の一生の中で、ユーザーが今保存した投稿の印は、
// どのファイルが落ち着くのも待たずに点かなければならない。
export function noteSaved(url: unknown, captureId: string, media?: unknown, total: number | null = null, post = true, individualMedia: string[] = []): void {
  const key = postKeyOf(typeof url === 'string' ? url : null);
  if (!key) return;
  const urls = mediaUrlsOf({ media });
  if (savedIndexCache) mergeSavedEntry(savedIndexCache.keys, key, captureId, urls, undefined, total, post, individualMedia);
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.appendFileSync(journalPath(), JSON.stringify({ k: key, id: captureId, m: urls, n: total, post, individualMedia, t: Date.now() }) + '\n', 'utf8');
    // 追記でジャーナルの mtime が動いた。それを取り込んでおくので、次の問い合わせが
    // 自分の書き込みを「誰かが変えた」と読んで組み直すことがない。
    if (savedIndexCache) savedIndexCache.journalMtimeMs = statMtimeMs(journalPath());
  } catch {
    /* できる範囲で＝印の帳簿付けのせいで保存が失敗することは決してあってはならない */
  }
}

// まだ残す値打ちのあるジャーナルの行＝保存済み索引のスナップショットが書かれた後に記録
// されたもの（それより古いものは既にスナップショットに入っている）。ファイルがしきい値を
// 超えて育ったら詰める。その際サイズを確かめてから入れ替えるので、同時に走る別のブリッジの
// 追記が、この書き直しに黙って落とされることはない。
function readJournal(savedIndexMtimeMs: number): Array<{ k: string; id: string; m: Array<string | null>; n: number | null; post: boolean; individualMedia: string[] }> {
  const p = journalPath();
  let sizeBefore: number;
  let raw: string;
  try {
    sizeBefore = fs.statSync(p).size;
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return []; // まだジャーナルが無い＝アプリが閉じている間に保存されたものは無い
  }
  const kept: string[] = [];
  const entries: Array<{ k: string; id: string; m: Array<string | null>; n: number | null; post: boolean; individualMedia: string[] }> = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // 途中で切れた行（追記中に落ちた）＝落とす
    }
    if (!e || typeof e.k !== 'string') continue;
    if (typeof e.t === 'number' && e.t <= savedIndexMtimeMs) continue; // スナップショットが持っている
    // m は位置で対応する（mediaUrlsOf を参照）。#334 より前に書かれた行はこれを持たず、
    // それは「画像は1枚も保存されていない」ではなく「保存済みだが画像は分からない」と
    // 読まれる。
    entries.push({
      individualMedia: Array.isArray(e.individualMedia) ? e.individualMedia.filter((url: unknown) => typeof url === 'string') : [],
      post: e.post !== false,
      k: e.k,
      id: typeof e.id === 'string' ? e.id : '',
      m: Array.isArray(e.m) ? e.m.map((u: unknown) => (typeof u === 'string' && u ? u : null)) : [],
      n: typeof e.n === 'number' && Number.isFinite(e.n) && e.n > 0 ? e.n : null,
    });
    kept.push(line);
  }
  if (sizeBefore >= JOURNAL_COMPACT_BYTES && kept.length * 120 < sizeBefore) {
    try {
      if (fs.statSync(p).size === sizeBefore) {
        const tmp = p + '.tmp';
        fs.writeFileSync(tmp, kept.length ? kept.join('\n') + '\n' : '', 'utf8');
        fs.renameSync(tmp, p);
      }
    } catch {
      /* 詰めるのは最適化＝失敗してもファイルが長いままになるだけだ */
    }
  }
  return entries;
}

// 保存済み索引のスナップショットより新しい、ばらけた取込エンベロープを、新しい順に上限
// 付きで読む。ファイルごとに stat せず、ファイル名から保存の時刻を読む
// （INBOX_ENVELOPE_NAME を参照）＝#299 より前に scanRecentSidecars が使っていたのと同じ
// 手だ。
function scanRecentInbox(folder: string, sinceMs: number, keys: Map<string, IndexEntry>): void {
  let files: string[];
  try {
    files = fs.readdirSync(inboxNewDir(folder));
  } catch {
    return; // まだ取込キューが無い（新しいライブラリか、このブリッジ経由の保存が無い）
  }
  const fresh: string[] = [];
  for (const f of files) {
    const m = f.match(INBOX_ENVELOPE_NAME);
    const captureId = m?.[1].match(STORED_CAPTURE_ID_PATTERN);
    if (captureId && Number(captureId[1]) >= sinceMs) fresh.push(f);
  }
  fresh.sort().reverse();
  for (const f of fresh.slice(0, RECENT_SCAN_CAP)) {
    try {
      const raw = fs.readFileSync(path.join(inboxNewDir(folder), f), 'utf8');
      const parsed = parseInboxEnvelope(raw);
      if (!parsed.ok) continue; // 壊れている・書きかけ・未知のバージョン＝飛ばす。問い合わせを落とさない
      // 書き手が今当てているのと同じ規則（#492）。その投稿について何も持っていない
      // エンベロープが「保存済み」と答えてはいけない。handleSavePost はこれを書くのを
      // やめたが、より古いブリッジが残したエンベロープはまだディスクに在る。
      if (!recordHoldsContent(parsed.envelope.record)) continue;
      const key = postKeyOf(parsed.envelope.record.url);
      if (key)
        mergeSavedEntry(
          keys,
          key,
          parsed.envelope.record.retryOf || parsed.envelope.eventId,
          mediaUrlsOf(parsed.envelope.record),
          undefined,
          parsed.envelope.record.imageCount || null,
          !parsed.envelope.record.saveIncomplete && parsed.envelope.record.saveScope === 'post' && parsed.envelope.record.media.length >= (parsed.envelope.record.imageCount || 0),
          parsed.envelope.record.saveScope === 'media' ? mediaUrlsOf(parsed.envelope.record).filter((url): url is string => !!url) : [],
        );
    } catch {
      /* 読めない、または途中までのエンベロープ＝飛ばす */
    }
  }
}

// スナップショットが持つ形での `trashed` の map の項目1つを、欄ごとに検める。
// スナップショットはホストが書かないファイルなので、文字列でない id やオブジェクトの
// deletedAt は、応答まで届かせずにここで null にしなければならない。日付を描画するのは
// 拡張機能だ。
function readTrashedEntry(value: unknown): TrashedEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as { id?: unknown; deletedAt?: unknown };
  return { id: typeof v.id === 'string' ? v.id : '', deletedAt: typeof v.deletedAt === 'string' && v.deletedAt ? v.deletedAt : null };
}

function buildSavedIndex(folder: string): SavedIndex {
  const indexFile = savedIndexPath();
  const savedIndexMtimeMs = statMtimeMs(indexFile);
  const keys = new Map<string, IndexEntry>();
  const trashed = new Map<string, TrashedEntry>();
  try {
    const idx = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    // v4（#158）。それより前に書かれたスナップショットには `trashed` の map がまったく
    // 無く、それは「ゴミ箱には何も無い」と読まれる。アプリがファイルを書き直すまで知らせ
    // が出ないだけで、古いスナップショットの他の場合とまったく同じだ。
    const trash = idx && idx.trashed;
    if (trash && typeof trash === 'object' && !Array.isArray(trash)) {
      for (const [key, value] of Object.entries(trash)) {
        if (typeof key !== 'string' || !key || trashed.has(key)) continue;
        const entry = readTrashedEntry(value);
        if (entry) trashed.set(key, entry);
      }
    }
    const entries = idx && idx.entries;
    if (entries && typeof entries === 'object') {
      for (const [key, value] of Object.entries(entries)) {
        if (typeof key !== 'string' || !key || keys.has(key)) continue;
        // v1 は素の captureId の文字列を書いていた（#334 より前）＝保存済みだが画像は
        // 分からない。
        if (typeof value === 'string') keys.set(key, { id: value, media: [], owners: [], total: null });
        else if (value && typeof value === 'object') {
          // owners は v3（#34）。v2 のファイルは持たず、そのときはどの画像もエントリ
          // 自身の id に退避する＝#34 より前の振る舞いだ。
          const owners = Array.isArray((value as any).owners) ? ((value as any).owners as unknown[]).map((o) => (typeof o === 'string' && o ? o : null)) : undefined;
          const total = typeof (value as any).total === 'number' && Number.isFinite((value as any).total) && (value as any).total > 0 ? (value as any).total : null;
          mergeSavedEntry(keys, key, typeof (value as any).id === 'string' ? (value as any).id : '', mediaUrlsOf(value), owners, total, (value as any).post !== false, Array.isArray((value as any).individualMedia) ? (value as any).individualMedia.filter((url: unknown) => typeof url === 'string') : []);
        }
      }
    }
  } catch {
    // まだスナップショットが無い（新しいライブラリか、アプリがここで一度も走っていない）
    // ＝savedIndexMtimeMs は -1 のままなので、下の読み直しが、上限まで取込キューの
    // ばらけたエンベロープ全体を覆う。
  }
  scanRecentInbox(folder, savedIndexMtimeMs, keys);
  for (const e of readJournal(savedIndexMtimeMs)) mergeSavedEntry(keys, e.k, e.id, e.m, undefined, e.n, e.post, e.individualMedia);
  return { folder, savedIndexMtimeMs, journalMtimeMs: statMtimeMs(journalPath()), keys, trashed };
}

// 覚えておく索引。保存フォルダが変わったか、どちらかの出所が動いたら組み直す。2回の
// stat が、温まった問い合わせの費用のすべてだ。
function savedIndex(folder: string): SavedIndex {
  const c = savedIndexCache;
  if (c && c.folder === folder && c.savedIndexMtimeMs === statMtimeMs(savedIndexPath()) && c.journalMtimeMs === statMtimeMs(journalPath())) {
    return c;
  }
  savedIndexCache = buildSavedIndex(folder);
  return savedIndexCache;
}

// {type:'query', urls:[…]} → {ok:true, results:{[url]: {id, media}|null}, trashed:{…}}。
// 結果が null なら「ライブラリに無い」。エントリが在れば保存済みで、その media の一覧が、
// その投稿のどの画像が在るかを言う（#334）。空なら、ライブラリはその投稿を知っているが
// 画像は知らないということで、尋ねた側はそれを投稿全体として扱う。captureId は参考情報だ
// （id を読めなかったレコードは '' で答える）。
//
// `trashed` は2つ目の、疎な答え（#158）。投稿がライブラリのゴミ箱に在る url だ。同じ
// url が両方に現れることは決してない。保存済みの答えが勝つ。生きているキャプチャを持つ
// 投稿は、その投稿の他の何がゴミ箱に在ろうと保存済みだからだ（片方の画像のレコードを
// 消し、もう片方が残るのはふつうにある）。アプリ自身の索引は既にその規則を当てている。
// ここで当て直すのは、保存済みの側の後ろに、アプリのスナップショットが知りようのなかった
// 出所があと2つ（ジャーナルと取込キューの読み直し）在るからだ。
export function handleQuery(req: QueryRequest): QueryAck {
  // 取り決めでは string[] なのに守りを入れてある。このハンドラは単体テスト
  // （tests/integration/bridge-query.test.ts）からも直接呼ばれるからだ。印の問い合わせは読み取り
  // であり、中で例外を投げるより空の結果を答える方がよい。
  const urls: unknown[] = (Array.isArray(req.urls) ? req.urls : []).slice(0, QUERY_URL_CAP);
  const results: QueryAck['results'] = {};
  const trashed: NonNullable<QueryAck['trashed']> = {};
  const requests: NonNullable<QueryAck['requests']> = {};
  for (const requestId of req.requestIds || []) {
    const receipt = readRequestReceipt(readSaveFolder(), requestId);
    if (receipt) requests[requestId] = receipt;
  }
  if (!urls.length) return { ok: true, results, trashed, requests };
  const index = savedIndex(readSaveFolder());
  for (const u of urls) {
    if (typeof u !== 'string' || !u) continue;
    const key = postKeyOf(u);
    const saved = (key && index.keys.get(key)) || null;
    results[u] = saved;
    if (saved || !key) continue;
    const trash = index.trashed.get(key);
    if (trash) trashed[u] = trash;
  }
  return { ok: true, results, trashed, requests };
}

// #181: 保存1回のリンクカードのサムネイルを、保存される形（post-record.mts の
// LinkCardShape）へ解決する。下のどのハンドラも既に持っている avatarFile の塊と同じ、
// できる範囲でという約束だ（ダウンロードに失敗すれば thumbnailFile は null のままになり、
// 保存が失敗することは決してない）。入力が null（カードが無い、あるいは行き先の url の
// 無いカード。どちらにせよ normLinkCard 自身のゲートでも確かめ直す）なら null を返す。
// 3つのハンドラで共有するので、このロジックの3つの写しが、このファイルで既に習わしとして
// そうなっている avatarFile や customEmojis の塊のようにずれることはない。
async function downloadSavedLinkCard(linkCard: any, itemDir: string, base: string, budget): Promise<any> {
  if (!linkCard || !linkCard.url) return null;
  let thumbnailFile: string | null = null;
  if (linkCard.thumbnail) {
    try {
      const downloaded = await downloadLinkCardThumbnail(linkCard.thumbnail, itemDir, base, budget);
      thumbnailFile = downloaded ? itemFileRelative(base, downloaded) : null;
    } catch {
      thumbnailFile = null;
    }
  }
  return { url: linkCard.url, title: linkCard.title || null, description: linkCard.description || null, thumbnailFile };
}

// 一括取り込みの保存（#362）。media[] は投稿が持つすべての原本を順番どおりに保持する。
// image はローカル画像など単一ファイルの入口が使う欄なので、投稿保存では null のままにする。
//
// メディアがまったく無い投稿でも、その投稿について何かが届いていれば（最低でもテキスト）、
// 取込のエンベロープは書かれる。画像の無いレコードに #365 が居場所を与えるまでは表示できない
// が、その間もレコードは取込キューと DB に座っていて、#365 が入ればそのまま現れる。書くのを
// 拒めば、代わりに投稿を永久に失う。X にはブックマークの書き出しが無いので、取り込みのとき
// に取らなかったブックマークは、そのアカウントが消えた後は取り戻せない。今は残し、表示は
// 後で。
//
// 何も届かなかった投稿はその逆の場合で、拒む（#492）。プラットフォームが投稿の情報を
// まったく出さないとき（削除、凍結、非公開、年齢制限、取得の失敗）、レコードは URL 自身が
// 既に言っていること（プラットフォーム、screenName、id から解ける日付）しか持たない。それを
// 書くのは無害に見えて、無害ではなかった。noteSaved がその投稿の印を点け、以降の取り込みは
// どれもその印を読んでその投稿を飛ばす。そしてまだ救えたはずの唯一のこと＝やり直すことを、
// その抜け殻のレコードが恒久的に妨げる。ここで失敗すればやり直し1回で済み、ここで成功すれば
// 投稿を失う。recordHoldsContent が共有の規則で（post-record.mts）、印の索引も同じ規則を
// 当てるので、この修正より前に書かれた抜け殻は答えなくなる。
function receiptDir(folder: string, requestId: string): string {
  return path.join(inboxNewDir(folder), '..', 'requests', requestId);
}

function receiptFromCommittedOutput(folder: string, requestId: string, identity?: { requestNonce: string | null; payloadHash: string }): RequestReceipt | null {
  try {
    const parsed = parseInboxEnvelope(fs.readFileSync(path.join(inboxNewDir(folder), `${requestId}.json`), 'utf8'));
    if (!parsed.ok) return null;
    const record = parsed.envelope.record;
    const media = mediaUrlsOf(record);
    const file = record.image || record.video || record.media?.find((item) => item?.file)?.file;
    if (typeof file !== 'string' || !file) return null;
    return {
      state: 'completed',
      completedAt: Date.now(),
      ...identity,
      ack: { ok: true, captureId: record.retryOf || record.captureId || requestId, file, saveFolder: folder, media, mediaCount: media.length },
    };
  } catch {
    return null;
  }
}

function requestIdentity(req: SavePostRequest | SaveMediaRequest): { requestNonce: string | null; payloadHash: string } {
  const payload = { ...req, requestNonce: undefined };
  return { requestNonce: req.requestNonce || null, payloadHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}

function readRequestReceipt(folder: string, requestId: string): RequestReceipt | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(receiptDir(folder, requestId), 'result.json'), 'utf8'));
    if (raw?.state === 'processing' && Number.isInteger(raw.ownerPid) && Number.isInteger(raw.startedAt)) {
      let ownerAlive = false;
      try {
        // 時間は所有権を失効させない。長い動画、デバッガ停止、OS suspend
        // 中でもprocessが生きている限り、そのgenerationを奪ってはならない。
        process.kill(raw.ownerPid, 0);
        ownerAlive = true;
      } catch {
        ownerAlive = false;
      }
      if (ownerAlive) return { state: 'processing', ownerPid: raw.ownerPid, startedAt: raw.startedAt, generation: String(raw.generation || ''), requestNonce: raw.requestNonce ?? null, payloadHash: String(raw.payloadHash || '') };
      const identity = { requestNonce: raw.requestNonce ?? null, payloadHash: String(raw.payloadHash || '') };
      // 新版の実保存先は suffix を含み得る。元要求 ID の別項目を結果に採用しない。
      if (raw.outputVersion === 1 || fs.existsSync(path.join(receiptDir(folder, requestId), 'output.json'))) return { state: 'retryable', interruptedAt: Date.now(), ...identity };
      return receiptFromCommittedOutput(folder, requestId, identity) || { state: 'retryable', interruptedAt: Date.now(), ...identity };
    }
    if (raw?.state === 'completed' && raw.ack?.ok === true) return { state: 'completed', ack: raw.ack, completedAt: raw.completedAt, requestNonce: raw.requestNonce ?? null, payloadHash: raw.payloadHash } as RequestReceipt;
    if (raw?.state === 'failed' && typeof raw.error === 'string') return { state: 'failed', error: raw.error, completedAt: raw.completedAt, requestNonce: raw.requestNonce ?? null, payloadHash: raw.payloadHash };
    if (raw?.state === 'retryable') return { state: 'retryable', interruptedAt: raw.interruptedAt, requestNonce: raw.requestNonce ?? null, payloadHash: raw.payloadHash };
  } catch {
    try {
      const startedAt = fs.statSync(receiptDir(folder, requestId)).mtimeMs;
      return Date.now() - startedAt < 90_000 ? { state: 'claiming', startedAt } : { state: 'retryable', interruptedAt: Date.now() };
    } catch {
      /* receipt directory 自体が無い */
    }
  }
  return null;
}

const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60_000;

function compactRequestReceipts(folder: string): void {
  const root = path.dirname(receiptDir(folder, 'x'));
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return;
  }
  const cutoff = Date.now() - RECEIPT_RETENTION_MS;
  for (const name of names.slice(0, 200)) {
    if (name.includes('.interrupted-')) {
      try {
        if (fs.statSync(path.join(root, name)).mtimeMs < Date.now() - 24 * 60 * 60_000) fs.rmSync(path.join(root, name), { recursive: true, force: true });
      } catch {
        /* 次回 */
      }
      continue;
    }
    if (!isCaptureId(name)) continue;
    const receipt = readRequestReceipt(folder, name);
    if (!receipt || receipt.state === 'processing' || receipt.state === 'retryable') continue;
    try {
      if (fs.statSync(path.join(root, name, 'result.json')).mtimeMs < cutoff) fs.rmSync(path.join(root, name), { recursive: true, force: true });
    } catch {
      /* 次回の bounded sweep に任せる */
    }
  }
}

function writeRequestReceipt(folder: string, requestId: string, receipt: RequestReceipt & { generation?: string; outputVersion?: number }): void {
  const dir = receiptDir(folder, requestId);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `result.json.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(receipt), { encoding: 'utf8', flush: true });
  fs.renameSync(tmp, path.join(dir, 'result.json'));
}

// receipt の世代交代でパスを空けない。SQLite の OS ロックは終了時にも解放される。
// アプリの DB とは別の接続で、要求ごとの固定ファイルを削除・rename しない。
function acquireRequestLock(folder: string, requestId: string): DatabaseSync {
  const root = path.join(folder, '.hologram-inbox', 'request-locks');
  fs.mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(path.join(root, `${requestId}.sqlite`), { timeout: 0 });
  try {
    db.exec('BEGIN EXCLUSIVE');
    return db;
  } catch (error: any) {
    db.close();
    if (error?.errcode === 5 || error?.errcode === 6) throw Object.assign(new Error('Save request is still processing'), { code: 'request-in-progress' });
    throw error;
  }
}

async function withRequestReceipt<T extends SavePostAck | SaveMediaAck>(req: SavePostRequest | SaveMediaRequest, work: (context: ReceiptContext) => Promise<T>): Promise<T> {
  const lock = acquireRequestLock(readSaveFolder(), req.captureId);
  try {
    return await withLockedRequestReceipt(req, work);
  } finally {
    lock.close();
  }
}

async function withLockedRequestReceipt<T extends SavePostAck | SaveMediaAck>(req: SavePostRequest | SaveMediaRequest, work: (context: ReceiptContext) => Promise<T>): Promise<T> {
  const folder = readSaveFolder();
  const dir = receiptDir(folder, req.captureId);
  const identity = requestIdentity(req);
  const context: ReceiptContext = { folder, requestId: req.captureId, generation: randomBytes(16).toString('hex'), ...identity, phase: 'downloading' };
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try {
    fs.mkdirSync(dir, { recursive: false });
    writeRequestReceipt(folder, req.captureId, { state: 'processing', ownerPid: process.pid, startedAt: Date.now(), generation: context.generation, outputVersion: 1, ...identity });
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    const receipt = readRequestReceipt(folder, req.captureId);
    if (receipt && 'payloadHash' in receipt && receipt.payloadHash && (receipt.payloadHash !== identity.payloadHash || receipt.requestNonce !== identity.requestNonce)) {
      throw Object.assign(new Error('Request id belongs to a different save payload'), { code: 'request-id-conflict' });
    }
    if (receipt?.state === 'completed') {
      removeCompletedOutputOwner(folder, req.captureId);
      return receipt.ack as T;
    }
    if (receipt?.state === 'failed') throw new Error(receipt.error);
    if (receipt?.state === 'retryable') {
      const interrupted = `${dir}.interrupted-${Date.now()}-${process.pid}`;
      const hadResult = fs.existsSync(path.join(dir, 'result.json'));
      try {
        const current = hadResult ? readRequestReceipt(folder, req.captureId) : null;
        const changed = hadResult ? current?.state !== 'retryable' : fs.readdirSync(dir).some((name) => name !== 'recovery.lock' && !/^result\.json\.tmp-[0-9]+$/.test(name));
        if (changed) {
          if (current?.state === 'completed') return current.ack as T;
          throw Object.assign(new Error('Save request recovery lost ownership'), { code: 'request-in-progress' });
        }
        const recovered = await recoverRequestOutput(folder, req);
        if (recovered) {
          writeRequestReceipt(folder, req.captureId, { state: 'completed', ack: recovered, completedAt: Date.now(), ...identity });
          removeCompletedOutputOwner(folder, req.captureId);
          return recovered as T;
        }
        fs.renameSync(dir, interrupted);
      } catch {
        throw Object.assign(new Error('Save request recovery is contended'), { code: 'request-in-progress' });
      }
      try {
        return await withLockedRequestReceipt(req, work);
      } finally {
        try {
          fs.rmSync(interrupted, { recursive: true, force: true });
        } catch {
          // primary save/ackを補助cleanupで失敗へ変えない。残留物はrequest
          // idの正規directoryではなく、後続bounded cleanupへ委ねられる。
        }
      }
    }
    throw Object.assign(new Error('Save request is still processing'), { code: 'request-in-progress' });
  }
  try {
    const ack = await work(context);
    try {
      writeRequestReceipt(folder, req.captureId, { state: 'completed', ack, completedAt: Date.now(), ...identity });
      removeCompletedOutputOwner(folder, req.captureId);
    } catch {
      // 保存 commit は既に成功した。補助帳簿の失敗を save-failed に変えると
      // 呼び出し側が手動再試行し、まさに避けるべき重複を作る。
    }
    compactRequestReceipts(folder);
    return ack;
  } catch (error: any) {
    try {
      writeRequestReceipt(folder, req.captureId, context.phase === 'publishing' || error?.code === 'request-in-progress' ? { state: 'retryable', interruptedAt: Date.now(), generation: context.generation, ...identity } : { state: 'failed', error: error?.message || String(error), completedAt: Date.now(), ...identity });
    } catch {
      /* 元の保存失敗を receipt IO failure で置き換えない */
    }
    if (context.phase === 'publishing') throw Object.assign(new Error(error?.message || String(error)), { code: 'request-in-progress' });
    throw error;
  }
}

async function guardSave<T extends SavePostAck | SaveMediaAck>(req: SavePostRequest | SaveMediaRequest, save: () => Promise<T>): Promise<T> {
  if (!isCaptureId(req.captureId)) throw new Error('Invalid captureId');
  const key = postKeyOf(req.metadata.url);
  if (!key) return save();
  const folder = readSaveFolder();
  fs.mkdirSync(folder, { recursive: true });
  // 保存直前に、キャッシュを使わず索引と未反映の取込データを読み直す。
  savedIndexCache = null;
  const known = savedIndex(folder).keys.get(key);
  const scope = req.type === 'saveMedia' ? 'media' : req.metadata.saveScope === 'media' ? 'media' : 'post';
  const urls = req.type === 'saveMedia' ? [req.mediaUrl] : (req.metadata.media || []).map((media) => media.url || null);
  if (known && !req.metadata.replaces && !req.metadata.retryOf && alreadySaved(known, scope, urls)) {
    const media = urls.length ? urls : known.media;
    const owner = scope === 'media' ? known.owners[known.media.indexOf(urls[0])] || known.id : known.id;
    return { ok: true, captureId: owner, file: owner, saveFolder: folder, mediaCount: media.length, media } as T;
  }
  return save();
}

export async function handleSavePost(req: SavePostRequest): Promise<SavePostAck> {
  return withRequestReceipt(req, (context) => guardSave(req, () => savePost(req, context)));
}

async function savePost(req: SavePostRequest, context: ReceiptContext): Promise<SavePostAck> {
  const captureId = isCaptureId(req.captureId) ? req.captureId : null; // handleSave を参照
  if (!captureId) throw new Error('Invalid captureId');

  const saveFolder = readSaveFolder();
  fs.mkdirSync(saveFolder, { recursive: true });

  const base = uniqueBase(saveFolder, captureId);
  return withItemDirectory(saveFolder, base, context, async (itemDir) => {
    const meta = req.metadata;

    // メディア取得に失敗しても、取得できた本文などは残す。
    // 不足は記録して投稿全体の保存済み判定から除外する。
    let savedMedia: any[] = [];
    const announced = Array.isArray(meta.media) ? meta.media.length : 0;
    const budget = createByteBudget(); // handleSave を参照。保存の操作1回につき1つ
    try {
      savedMedia = (await cachedQuotedMedia(meta, saveFolder)) || itemizeMedia(base, await downloadMedia(meta.media, itemDir, base, budget));
    } catch (error: any) {
      throw new Error(`Media download failed: ${error?.message || error}`);
    }

    let avatarFile: string | null = null;
    try {
      avatarFile = await downloadAvatar(meta.avatar, meta.avatarReferer, saveFolder, budget);
    } catch {
      avatarFile = null;
    }

    // #289: handleSave を参照＝同じ共有の avatars/ ストア、同じできる範囲でという約束。
    let bannerFile: string | null = null;
    try {
      bannerFile = await downloadAvatar(meta.banner, undefined, saveFolder, budget);
    } catch {
      bannerFile = null;
    }

    // #181: handleSave を参照＝同じできる範囲でという約束。
    const linkCard = await downloadSavedLinkCard(meta.linkCard, itemDir, base, budget);

    const record = normalizePostRecord({
      ...meta, // 下で上書きする＝handleSave を参照
      saveIncomplete: !!meta.saveIncomplete || savedMedia.length < announced,
      captureId: base,
      image: null,
      media: savedMedia,
      quotedPost: await downloadQuotedPost(meta.quotedPost, saveFolder, budget),
      avatarFile,
      bannerFile,
      linkCard,
    });
    // その投稿について何も届かなかった＝この関数のコメントを参照。エンベロープを書く前、
    // かつ noteSaved の前に投げるので、投稿は未保存で印も付かないまま残る。次の取り込みの
    // 実行は、それを飛ばさずもう一度差し出す。
    if (!recordHoldsContent(record)) throw new Error(`Post unavailable: nothing was obtained for it (${req.metaReason || 'no post info'}, no media)`);
    const savedId = record.retryOf || base;
    const ack: SavePostAck = { ok: true, captureId: savedId, file: savedMedia.length ? savedMedia[0].file : base, saveFolder, mediaCount: savedMedia.length, media: mediaUrlsOf(record) };
    await commitSavedOutput(context, record, ack);
    return ack;
  });
}

// 右クリックした画像または動画の保存。ブリッジは選ばれたメディアそのものをダウンロードし
// （対応するどの静止画・動画の型でもよい。pixiv の Referer は任意）、
// そのファイルがレコードの主となる画像または動画になる。同時にそれは、レコードの唯一の media[] の
// 項目でもある＝このレコードが投稿のどの画像を持つかを言う行だ（#334）。それで何かが二重に
// なることはない。表示側の作品やグループの補助関数は、image ではなく media[] を読み
// （records.ts の artworkFile と groupFilesOf）、どちらもこの保存が書いた1つのファイルを
// 指す。#334 より前は、レコードはダウンロードしたファイルは持つが、それがどこから来たかは
// 持たなかったので、複数画像の投稿について、どの画像が既にライブラリに在るかを尋ねられな
// かった。これは、取り込んだライブラリの項目が作るのと同じ「イラストのレコード」の形だ。
// captureId はふつうの epochMillis-hex の形なので、SAFE_ID を通る。
export async function handleSaveMedia(req: SaveMediaRequest): Promise<SaveMediaAck> {
  return withRequestReceipt(req, (context) => guardSave(req, () => saveMedia(req, context)));
}

async function saveMedia(req: SaveMediaRequest, context: ReceiptContext): Promise<SaveMediaAck> {
  const captureId = isCaptureId(req.captureId) ? req.captureId : null; // handleSave を参照
  if (!captureId) throw new Error('Invalid captureId');
  if (!req.mediaUrl) throw new Error('Missing media URL');

  const saveFolder = readSaveFolder();
  fs.mkdirSync(saveFolder, { recursive: true });
  const base = uniqueBase(saveFolder, captureId);
  return withItemDirectory(saveFolder, base, context, async (itemDir) => {
    const budget = createByteBudget(); // handleSave を参照。保存の操作1回につき1つ
    const mediaType = req.mediaType === 'video' ? 'video' : 'image';
    const got = mediaType === 'video' ? await downloadOneMedia({ url: req.mediaUrl, referer: req.mediaReferer || undefined, type: 'video' }, itemDir, base, 0, budget) : await saveStillImage(req.mediaUrl, req.mediaReferer, itemDir, base, budget);
    if (!got) throw new Error('Media download failed (unsupported type, too large, or network error)');
    const mediaFile = itemFileRelative(base, got.file);

    const meta = { ...req.metadata, saveScope: 'media' as const };
    let avatarFile: string | null = null;
    try {
      avatarFile = await downloadAvatar(meta.avatar, meta.avatarReferer, saveFolder, budget);
    } catch {
      avatarFile = null;
    }
    // #289: handleSave を参照＝同じ共有の avatars/ ストア、同じできる範囲でという約束。
    let bannerFile: string | null = null;
    try {
      bannerFile = await downloadAvatar(meta.banner, undefined, saveFolder, budget);
    } catch {
      bannerFile = null;
    }
    // #181: handleSave を参照＝同じできる範囲でという約束。選ばれた画像の投稿自身が
    // リンクカードを持つ形は、対応するどのプラットフォームも実際には作らない（埋め込みの枠は
    // 投稿のメディアか外部リンクのカードのどちらかで、両方になることはない）。それでも、
    // いつかそれが変わったときに黙って落とさずに済むよう、この欄は通してある。
    const linkCard = await downloadSavedLinkCard(meta.linkCard, itemDir, base, budget);
    // source:'web' は、対応サイトかどうかにかかわらずウェブページ上で選ばれた原本画像を示す。
    const media = [
      {
        url: req.mediaUrl,
        alt: req.mediaAlt || null,
        file: mediaFile,
        ...(mediaType === 'video' ? { type: 'video' as const } : {}),
      },
    ];
    const record = normalizePostRecord({
      ...meta,
      captureId: base,
      image: mediaType === 'image' ? mediaFile : null,
      video: mediaType === 'video' ? mediaFile : null,
      mediaType,
      media,
      quotedPost: await downloadQuotedPost(meta.quotedPost, saveFolder, budget),
      source: 'web',
      avatarFile,
      bannerFile,
      linkCard,
    });
    const ack: SaveMediaAck = { ok: true, captureId: record.retryOf || base, file: mediaFile, saveFolder, media: mediaUrlsOf(record) };
    await commitSavedOutput(context, record, ack);
    return ack;
  });
}

// --- stdin の読み手: バイト列を溜め、揃ったメッセージを処理する ---
// 直接実行されたときだけ、本物の Native Messaging ホストとして振る舞う。このモジュールが
// （テストから）import されたときは、読み手を飛ばして内部を見せる。
//
// 入口のパスの比較は `require.main === module` の代わりだ。あちらには、このコードが走る
// 2つの形の両方で成り立つ ESM の同等物が無い。Node の型剥がしの下での生のソース
// （argv[1] がこのファイル）と、ランチャーが実際に実行する CJS のバンドル
// （dist/bridge.js。import.meta.url がそのバンドルに解決し、argv[1] がそれを指す）だ。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  logLine(`launched argv=${JSON.stringify(process.argv.slice(2))} saveFolder=${readSaveFolder()}`);
  let buffer = Buffer.alloc(0);

  // chunk に注釈を付けてあるのは、'data' のシグネチャが string | Buffer だからだ。stdin が
  // 文字列を渡すのはエンコーディングを設定したときだけで、このホストは決して設定しない
  // （Native Messaging のフレームは長さを前置したバイナリだ）。
  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const len = buffer.readUInt32LE(0);
      if (buffer.length < 4 + len) break;
      const body = buffer.subarray(4, 4 + len);
      buffer = buffer.subarray(4 + len);

      // 境界まるごとに対して解析は1つだけ（#400＝protocol.mts）。返ってくるのは、型まで
      // 絞り込まれた要求か、返すべき失敗のどちらかだ。下のどこも生のフレームから欄を
      // 読まない。
      const parsed = parseHostFrame(body.toString('utf8'));
      // 応答は、要求が id を持つときそれを返す。使い捨ての接続（保存の経路はすべてこれ）
      // には要らない。ポートは応答1つを返して閉じるからだ。ただし印は多数の問い合わせを
      // 1本のポートに多重化し、答えと問いを突き合わせなければならない。すべての型で返す
      // ので、突き合わせの規則はハンドラのものではなくメッセージのものになる。
      //
      // どの応答にも、このビルドの PROTOCOL_VERSION が押される（#205）。各ハンドラでは
      // なくこの継ぎ目1か所でだ。拡張機能はそれを自分のものと比べて、2つの半分が離れて
      // しまったことに気づく。スタンプを忘れた応答は、そのスタンプ自体より古いホストから
      // 来たものと読まれてしまう。
      //
      // 同じ継ぎ目がローカルのビルドのトークンも運ぶ（#650）＝readExtBuild を参照。
      const reply = (id: number | null, res: HostResponse) => {
        const stamped = stampProtocol(res, readExtBuild());
        sendMessage(id != null ? Object.assign({ id }, stamped) : stamped);
      };
      if (!parsed.ok) {
        logLine(`recv: ${parsed.failure.error}`);
        reply(parsed.id, parsed.failure);
        continue;
      }
      const req = parsed.request;
      // 印のポートは閲覧のひとまとまりの間ずっと開いたままで、スクロールのたびに尋ねる
      // ので、その問い合わせは bridge.log の保存1件につき1行という手がかりを埋もれさせて
      // しまう。それ以外は今もログに残す。届かなかった保存こそ、このログが在る理由の
      // 失敗だからだ。
      if (req.type !== 'query') logLine(`recv type=${req.type}`);
      // #71: 確認や保存はまさに「拡張機能がホストに話しかけた」だ＝ここまで届いた要求の
      // 型すべてについて接触の印に触る（ping と log は除く。あの2つはキャプチャの動きを
      // 運ばないので、拡張機能が仕事をしているかについて何も言わない）。
      if (req.type === 'query' || req.type === 'savePost' || req.type === 'saveMedia') touchExtensionContact();
      // 保存の応答は、そのダウンロードが落ち着いてから送る。プロセスは自然に終わるので、
      // 進行中の取得がそれを生かしておく。`save-failed` はハンドラ自身の拒否だ＝その中の
      // メッセージこそ拡張機能が分類するもの（native-error.ts）なので、手を加えずに
      // 素通しする。
      const settle = (r: SavePostRequest | SaveMediaRequest, work: Promise<SaveAck>) =>
        work
          .then((res) => {
            logSaveOutcome(r, res, null);
            reply(r.id ?? null, res);
          })
          .catch((err) => {
            logSaveOutcome(r, null, err);
            reply(r.id ?? null, { ok: false, error: err.message, code: err?.code === 'request-in-progress' || err?.code === 'request-id-conflict' ? err.code : 'save-failed' });
          });
      try {
        switch (req.type) {
          case 'savePost':
            logSaveReceived(req);
            settle(req, handleSavePost(req));
            break;
          case 'saveMedia':
            logSaveReceived(req);
            settle(req, handleSaveMedia(req));
            break;
          case 'query':
            // 読み取り専用＝「このパーマリンクのうち、既にライブラリに在るのはどれか」
            reply(req.id ?? null, handleQuery(req));
            break;
          case 'log':
            // 拡張機能が中継してきた診断（ブリッジより前の段階）。保存して応答する。
            appendLog(req.entry);
            reply(req.id ?? null, { ok: true });
            break;
          case 'ping':
            reply(req.id ?? null, { ok: true, pong: true });
            break;
        }
      } catch (err) {
        reply(req.id ?? null, { ok: false, error: err.message, code: 'save-failed' });
      }
    }
  });
}

// Chrome がポートを閉じると stdin が終わる。process.exit() を呼ばずにイベントループが
// 自然に終わるのに任せるので、書きかけの stdout（応答）は、プロセスが終わる前に必ず
// 吐き出される。

// _resetSavedIndex はテストのための継ぎ目だ。索引はプロセスの一生のあいだ覚えられる。
// それは本物のホスト（ポート1つにつきプロセス1つ）では正しく、保存フォルダを次々と辿る
// テストファイルでは正しくない。
// media-download.mts からの再 export。テストはブリッジ（上限と予算を検証している当の
// 呼び出し側）を通してダウンローダに触るし、app/src/main がバンドルを読み込んだときに
// 得るのも同じ再 export だ。
export { downloadMedia, downloadAvatar, saveStillImage, createByteBudget };

// テスト専用＝保存済み投稿の索引の覚えを落とし、テストの一式がフォルダを仕込み直せる
// ようにする。
export const _resetSavedIndex = () => (savedIndexCache = null);
