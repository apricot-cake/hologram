// 取得した原本の層の、通信路上の形（#292）。あるレコードのために届いた payload 1つに
// つき1行を、手を加えずに保つ。こうすれば、今は誰も正規化していない欄も、何年も前に
// 保存した投稿から取り戻せる。プラットフォームがその後に削除した投稿からも取り戻せる。
//
// この層が在る理由（#292 の「取得の原則」）。画面（ファセット、問い合わせ、UI）は
// 取り返しがつく＝作らずにおいても何も失わない。本当に必要になった日に足せるからだ。
// 取得はそうではない。投稿は削除され、アカウントは消え、保存の時点で残さなかったものは
// 永久に失われる。だから既に手元に在るデータの既定は「全部残す」であり、正規化された列へ
// 引き上げるかどうかは要求次第のままにする。このモジュールは「全部残す」側の半分だ。
//
// 境界（#292 の 2026-07-25 の設計コメント）は「保存中のレコードのために届いた payload」。
// Cookie も Authorization などの要求ヘッダもページの DOM も、決してその一部ではない。
// このモジュールが見るのは、取得のコードが渡すと決めた応答の本体だけなので、それらが
// 事故で混ざり込むことはありえない。
//
// Electron から切り離してある（node の組み込みモジュールだけ）のと .mts なのは、
// post-record.mts や inbox.mts と同じ理由だ。native-host/bridge.mts は CJS からこれを
// require() し、app/src/main は ESM として import する。両側が1つの形で一致しなければ
// ならない。

import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

// レコードごとの、圧縮前のバイト数に対する予算（#292 の「レコードごとの圧縮前の上限」）。
// 実際の投稿の payload より2桁大きい（tweet-result の本体は約5〜20 KB、最大の pixiv の
// イラストの応答で約30 KB）ので、ふつうの保存でこれが働くことはない。切り詰めるためでは
// なく、病的な応答に上限を与えるために在る。
const RAW_PAYLOAD_MAX_BYTES = 2 * 1024 * 1024;

// 上限がバイト列を落としたとき `encoding` に記録する。保存の失敗にはしない。これは意図
// してそうしている（#292）。KB 単位の予算を守るために投稿を失うのでは、この層の狙い
// そのものが逆さまになる。行は書かれるので、取得が起きたという事実と、その同一性
// （sourceKind、sha256、サイズ）は、バイト列が残らなくても残る。
const OMITTED_OVERSIZE = 'omitted:oversize';
const ENCODING_GZIP = 'gzip';

// 取得の場所が渡してくるもの＝受け取ったそのままの本体。
interface RawPayloadInput {
  // どの取得が作ったか。応答の本体なら 'api:<platform>/<endpoint>'。
  // 'dom:<platform>/v<n>' は DOM の extractor（サイト別のメタデータ抽出モジュール）が
  // 出す、バージョン付きの中間表現のために取ってある（#292 がその経路での原本と定めて
  // いる形。今日、レコードの欄を埋める DOM の経路は無い）。
  sourceKind: string;
  acquiredAt?: string;
  contentType?: string | null;
  body: string;
}

// 取込キューのエンベロープや書き出しのサイドカーを運ばれ、raw_payloads に着くもの。
// sha256 は圧縮前のバイト列に対して取る（#292）ので、ある1つの圧縮結果ではなく
// payload そのものを指す。
interface RawPayloadShape {
  sourceKind: string;
  acquiredAt: string;
  contentType: string | null;
  encoding: string; // 'gzip' | 'omitted:oversize'
  sha256: string;
  byteLength: number; // 圧縮前
  payloadBase64: string | null; // 省いたときは null
}

function normStr(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

// 入力それぞれを圧縮してハッシュを取り、レコードごとの共有の予算を、取得が起きた順に
// 使っていく。単体で、あるいは残りに収まらない payload は、黙って落としたり小さくして
// やり直したりせず、省いたものとして記録する。v1 は圧縮のやり直しも、レコードをまたぐ
// 重複除去もしない（#292）。
function packRawPayloads(inputs: unknown, opts: { maxBytes?: number; now?: () => string } = {}): RawPayloadShape[] {
  if (!Array.isArray(inputs)) return [];
  const maxBytes = opts.maxBytes ?? RAW_PAYLOAD_MAX_BYTES;
  const now = opts.now || (() => new Date().toISOString());
  const out: RawPayloadShape[] = [];
  let spent = 0;
  for (const item of inputs) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const sourceKind = normStr(raw.sourceKind);
    if (!sourceKind || typeof raw.body !== 'string') continue;
    const bytes = Buffer.from(raw.body, 'utf8');
    const fits = bytes.length <= maxBytes - spent;
    if (fits) spent += bytes.length;
    out.push({
      sourceKind,
      acquiredAt: normStr(raw.acquiredAt) || now(),
      contentType: normStr(raw.contentType),
      encoding: fits ? ENCODING_GZIP : OMITTED_OVERSIZE,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length,
      payloadBase64: fits ? gzipSync(bytes).toString('base64') : null,
    });
  }
  return out;
}

// 通信路から戻ってきた、既に詰め終わった一覧を検証する（取込キューのエンベロープ、
// 書き出しのサイドカー）。形の壊れたものは例外を投げずに落とす。壊れた項目1つが、
// それが属する投稿を失わせてはいけない。
function normalizeRawPayloads(v: unknown): RawPayloadShape[] {
  if (!Array.isArray(v)) return [];
  const out: RawPayloadShape[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const sourceKind = normStr(raw.sourceKind);
    const sha256 = normStr(raw.sha256);
    if (!sourceKind || !sha256) continue;
    const payloadBase64 = normStr(raw.payloadBase64);
    const encoding = normStr(raw.encoding) || (payloadBase64 ? ENCODING_GZIP : OMITTED_OVERSIZE);
    out.push({
      sourceKind,
      acquiredAt: normStr(raw.acquiredAt) || '',
      contentType: normStr(raw.contentType),
      encoding,
      sha256,
      byteLength: typeof raw.byteLength === 'number' && Number.isFinite(raw.byteLength) ? raw.byteLength : 0,
      payloadBase64: encoding === ENCODING_GZIP ? payloadBase64 : null,
    });
  }
  return out;
}

// 読み取りの側。いずれ原本を画面に出す誰か（インスペクタ、埋め戻しの処理）のためのものだ。
// 元の本体のテキストを返し、バイト列がそもそも保存されなかったか、もう検証を通らない
// ときは null を返す。sha256 の確認が要点だ＝受け取ったものと同じハッシュに戻らない
// payload は原本ではない。
function unpackRawPayload(row: { encoding: string; sha256: string; payload: Buffer | Uint8Array | null }): string | null {
  if (row.encoding !== ENCODING_GZIP || !row.payload) return null;
  let bytes: Buffer;
  try {
    bytes = gunzipSync(Buffer.from(row.payload));
  } catch {
    return null;
  }
  if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) return null;
  return bytes.toString('utf8');
}

export { RAW_PAYLOAD_MAX_BYTES, ENCODING_GZIP, OMITTED_OVERSIZE, packRawPayloads, normalizeRawPayloads, unpackRawPayload };
export type { RawPayloadInput, RawPayloadShape };
