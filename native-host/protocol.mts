// Native Messaging の要求・応答と投稿メタデータを共有する。Node.js の機能へ依存しない。
import { z } from 'zod';
import { PostRecordSchema, MediaItemSchema, QuotedPostSchema, FramesSchema, LinkCardSchema } from './post-schemas.mts';

// 上げるのはメッセージの取り決め自体が変わったときだけ。アプリのバージョンと一緒には
// 決して動かさない。あちらは拡張機能から見えない理由で動く。整数1つなので、#205 の
// 判定は整数の比較になる。
//
// 上げるとき: 変わっていない相手側が取り違える変更＝要求の欄の改名、新たに必須になった
// 欄、意味が変わった応答の欄、拡張機能がこれから無条件に送る要求の種別。古い相手が
// ただ無視するだけの省略可能な欄の追加は、そのどれでもない。それで上げれば、ユーザーの
// 注意（保存のたびに出る帯）を何でもないことに使わせる。
export const PROTOCOL_VERSION = 5;

// capture id は `<epochMillis>-<hex>`。拡張機能が発行し（generateCaptureId）、ホストは
// これをファイル名の土台に使う。だからこの規則はホスト側の細部ではなく取り決めの一部だ。
// 敵対的なページと、保存フォルダのパス区切りや `..` との間に立つ唯一のものだから。
// ホストは衝突を `-<n>` を足して解消するので、ホストが返す id（取込キューのイベント id、
// 応答の captureId）はその接尾辞を持ちうる。native-host/inbox.mts の SAFE_EVENT_ID を
// 参照＝これはこのパターンにその末尾を足したものだ。
export const CAPTURE_ID_PATTERN = /^[0-9]{1,20}-[0-9a-f]{4,32}$/i;

export const CaptureIdSchema = z.string().regex(CAPTURE_ID_PATTERN);

export function isCaptureId(id: unknown): id is string {
  return CaptureIdSchema.safeParse(id).success;
}

// 応答を返すときに echo する id。使い捨ての接続（保存の経路はすべてこれ）には要らない
// ＝ポートは要求を1つ運んで閉じる。ただし保存済み投稿の印は、多数の問い合わせを1本の
// 長生きするポートに多重化し、答えと問いを突き合わせなければならない。だからこの規則は
// どのハンドラのものでもなくメッセージのものだ。id を持つ要求には、その応答で id が返る。
export type RequestId = number;

// --- 要求（拡張機能 → ホスト）-------------------------------------------------

export const AnnouncedMediaSchema = MediaItemSchema.pick({ url: true, alt: true, width: true, height: true }).extend({
  url: z.string().min(1),
  referer: z.string().optional(),
  type: z.enum(['image', 'video', 'gif', 'ugoira']).optional(),
  poster: z.string().nullable().optional(),
  frames: FramesSchema.optional(),
});
export const AnnouncedLinkCardSchema = LinkCardSchema.omit({ thumbnailFile: true }).extend({ thumbnail: z.string().nullable().default(null) });
export const CaptureMetadataSchema = PostRecordSchema.omit({ captureId: true, avatarFile: true, bannerFile: true, media: true, linkCard: true })
  .partial()
  .extend({
    media: z.array(AnnouncedMediaSchema).optional(),
    linkCard: AnnouncedLinkCardSchema.nullable().optional(),
    avatarReferer: z.string().nullable().optional(),
  });
export const AnnouncedQuotedPostSchema = QuotedPostSchema.extend({ media: z.array(AnnouncedMediaSchema).default([]) });
export const ExtractedPostSchema = PostRecordSchema.pick({
  url: true,
  platform: true,
  text: true,
  title: true,
  displayName: true,
  screenName: true,
  userId: true,
  avatar: true,
  bio: true,
  profileLinks: true,
  banner: true,
  followers: true,
  following: true,
  authorCreatedAt: true,
  likes: true,
  reposts: true,
  replies: true,
  bookmarks: true,
  views: true,
  date: true,
  mediaType: true,
  lang: true,
  isReply: true,
  isQuote: true,
  isThread: true,
  isEdited: true,
  cw: true,
  sensitive: true,
  quotedUrl: true,
  replyToId: true,
  quotedPost: true,
  replyToPost: true,
  poll: true,
  seriesId: true,
  seriesTitle: true,
  seriesOrder: true,
  hashtags: true,
  tags: true,
  metaSource: true,
}).extend({
  media: z.array(AnnouncedMediaSchema).default([]),
  linkCard: AnnouncedLinkCardSchema.nullable().default(null),
  quotedPost: AnnouncedQuotedPostSchema.nullable().default(null),
  replyToPost: AnnouncedQuotedPostSchema.nullable().default(null),
  avatarReferer: z.string().nullable().default(null),
  metaError: z.string().nullable().default(null),
  acquisitionIssues: z
    .array(
      z.object({
        scope: z.enum(['post', 'profile', 'media']),
        reason: z.enum(['unavailable', 'fetchFailed', 'invalidResponse']),
      }),
    )
    .default([]),
});
export type AnnouncedMedia = z.output<typeof AnnouncedMediaSchema>;
export type AnnouncedLinkCard = z.output<typeof AnnouncedLinkCardSchema>;
export type CaptureMetadata = z.input<typeof CaptureMetadataSchema>;
export const HostLogEntrySchema = z.record(z.string(), z.unknown());
export type HostLogEntry = z.output<typeof HostLogEntrySchema>;
const requestCommon = { id: z.number().int().nonnegative().nullable().default(null) };
const saveCommon = {
  ...requestCommon,
  captureId: CaptureIdSchema,
  saveId: z.string().nullable().optional(),
  metadata: CaptureMetadataSchema,
  metaOk: z.boolean().optional(),
  metaReason: z.string().nullable().optional(),
  requestNonce: z
    .string()
    .regex(/^[0-9a-f]{32}$/i)
    .optional(),
};
export const SavePostRequestSchema = z.object({ type: z.literal('savePost'), ...saveCommon });
export const SaveMediaRequestSchema = z.object({
  type: z.literal('saveMedia'),
  ...saveCommon,
  mediaUrl: z.string().min(1),
  mediaReferer: z.string().nullable().optional(),
  mediaAlt: z.string().nullable().optional(),
  mediaType: z.enum(['image', 'video']).default('image'),
});
export const QueryRequestSchema = z.object({ type: z.literal('query'), ...requestCommon, urls: z.array(z.string().min(1)), requestIds: z.array(CaptureIdSchema).optional() });
export const LogRequestSchema = z.object({ type: z.literal('log'), ...requestCommon, entry: HostLogEntrySchema });
export const PingRequestSchema = z.object({ type: z.literal('ping'), ...requestCommon });
export const HostRequestSchema = z.discriminatedUnion('type', [SavePostRequestSchema, SaveMediaRequestSchema, QueryRequestSchema, LogRequestSchema, PingRequestSchema]);
export type SavePostRequest = z.input<typeof SavePostRequestSchema>;
export type SaveMediaRequest = z.input<typeof SaveMediaRequestSchema>;
export type QueryRequest = z.input<typeof QueryRequestSchema>;
export type LogRequest = z.input<typeof LogRequestSchema>;
export type PingRequest = z.input<typeof PingRequestSchema>;
export type HostRequest = z.input<typeof HostRequestSchema>;
export type HostRequestType = HostRequest['type'];
export type SaveRequestType = SavePostRequest['type'] | SaveMediaRequest['type'];

// --- 応答（ホスト → 拡張機能）---------------------------------------------------

// ホストが送るすべての応答に押される＝ack も pong も問い合わせの答えも失敗も同じ
// （#205）。ack だけでなくすべての応答に押すのは、何かがおかしいときに拡張機能が手に
// している見込みが最も高い応答は失敗だからだ。成功にしか乗らないバージョンは、まさに
// そのときに欠ける。
//
// 通信路上では省略可能で、読み手が必須にすることは決してない。これが在る前に作られた
// ホストは送らないし、無いこと自体が1つの答えになる（protocolSkewOf を参照）＝応答が
// 壊れていると言う理由にはならない。向きは常に一方向（ホスト → 拡張機能）だ。答えるのは
// ホストだけだから。拡張機能が期待する側は自分のバンドルにある PROTOCOL_VERSION で、
// 通信路上の欄は要らない。
export const VersionStampSchema = z.object({ protocolVersion: z.number().int().optional() });
export type VersionStamp = z.output<typeof VersionStampSchema>;

// 今この瞬間、ビルドの置き場に座っているローカルビルドの拡張機能がどれか（#650）。
// バージョンではないし、上の取り決めの一部でもない。`npm run ext:build` が1回完了する
// たびにちょうど1回変わる、中身に意味の無いトークンだ。これで、その置き場から読み込ま
// れた拡張機能は、自分のバンドルが古くなったことに気づき、人が chrome://extensions の
// ボタンを押すのを待たずに chrome.runtime.reload() を呼べる。
//
// プロトコルバージョンと同じ席に乗る。理由も同じだ。拡張機能は保存のたび、印の
// 問い合わせのたびに、既にこのホストと話している。だから2本目の通り道も、2つ目の
// プロセスも、ポートも要らずに知らせが届く。Native Messaging はホストの側から始められ
// ない（Chrome の規則）ので、取れる形は拡張機能が始めた往復に乗って返ることだけ＝これが
// それだ。
//
// 拡張機能を自分でビルドしていない人には存在しない。ホストがこれを出すのは、これが読む
// スタンプファイルをビルドが書いたときだけで（bridge.mts の readExtBuild を参照）、
// リリース版のインストールのリリース版ホストが見つけることはない。バージョンのスタンプ
// とまったく同じく、通信路上では省略可能で読み手が必須にすることは決してない＝古い
// ホストは送らず、そのとき拡張機能はただ比べる相手を持たない。
export const DevBuildStampSchema = z.object({ extBuild: z.string().min(1).optional() });
export type DevBuildStamp = z.output<typeof DevBuildStampSchema>;

// 1本のパーマリンクについてホストが言うこと。それを持つレコードの captureId と、その
// 投稿のどの画像がライブラリに在るか（#334）。位置で対応するので、添字はレコードの中の
// その画像の番号であり、null はライブラリが URL を持たなかった画像を表す。空の一覧は
// 「保存済みだが画像を区別できない」を意味し、オーバーレイはそれを投稿全体と読む。
export const SavedEntrySchema = z.object({ post: z.boolean().optional(), individualMedia: z.array(z.string()).optional(), id: z.string(), media: z.array(z.string().nullable()), total: z.number().int().nonnegative().nullable().optional(), owners: z.array(z.string().nullable()).optional() });
export type SavedEntry = z.output<typeof SavedEntrySchema>;

export type SavedResults = Record<string, SavedEntry | null>;

// 投稿がライブラリのゴミ箱に入っているパーマリンクについてホストが言うこと（#158）。
// 保存済みではないが、レコードとファイルはまだそこに在り、保存し直せばユーザーが
// 捨てたつもりの投稿の2つ目の複製が黙ってできてしまう。
//
// SavedEntry の目印ではなく SavedResults とは別の map にしたのは意図してそうしている。
// どの読み手も「項目が在る」を「ライブラリがこの投稿を持っている」と扱う（タイムライン
// の印が点き、ホバーの保存ボタンが隠れる）が、ゴミ箱の投稿は持っていない。2つの答えを
// 分けておくことは、この追加を両方向で後方互換にもしている＝古い拡張機能はこの欄を
// 無視し、古いホストはこれを送らない。
export const TrashedEntrySchema = z.object({ id: z.string(), deletedAt: z.string().nullable() });
export type TrashedEntry = z.output<typeof TrashedEntrySchema>;

export type TrashedResults = Record<string, TrashedEntry>;

export const AckCommonSchema = z.object({ ok: z.literal(true), captureId: z.string().min(1), file: z.string(), saveFolder: z.string(), media: z.array(z.string().nullable()) });
export type AckCommon = z.output<typeof AckCommonSchema>;

export const SavePostAckSchema = AckCommonSchema.extend({ mediaCount: z.number().int().nonnegative() });
export type SavePostAck = z.output<typeof SavePostAckSchema>;

export type SaveMediaAck = AckCommon;

export type SaveAck = SavePostAck | SaveMediaAck;

export const RequestReceiptSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('claiming'), startedAt: z.number().int().nonnegative() }),
  z.object({ state: z.literal('processing'), ownerPid: z.number().int().positive(), startedAt: z.number().int().nonnegative(), generation: z.string(), requestNonce: z.string().nullable(), payloadHash: z.string() }),
  z.object({ state: z.literal('retryable'), interruptedAt: z.number().int().nonnegative(), requestNonce: z.string().nullable().optional(), payloadHash: z.string().optional() }),
  z.object({ state: z.literal('completed'), ack: z.union([SavePostAckSchema, AckCommonSchema]), completedAt: z.number().int().nonnegative().optional(), requestNonce: z.string().nullable().optional(), payloadHash: z.string().optional() }),
  z.object({ state: z.literal('failed'), error: z.string(), completedAt: z.number().int().nonnegative().optional(), requestNonce: z.string().nullable().optional(), payloadHash: z.string().optional() }),
]);
export type RequestReceipt = z.output<typeof RequestReceiptSchema>;
export const QueryAckSchema = z.object({ ok: z.literal(true), results: z.record(z.string(), SavedEntrySchema.nullable()), trashed: z.record(z.string(), TrashedEntrySchema).optional(), requests: z.record(z.string(), RequestReceiptSchema).optional() });
export type QueryAck = z.output<typeof QueryAckSchema>;

export const LogAckSchema = z.object({ ok: z.literal(true) });
export type LogAck = z.output<typeof LogAckSchema>;

export const PongAckSchema = z.object({ ok: z.literal(true), pong: z.literal(true) });
export type PongAck = z.output<typeof PongAckSchema>;

export type HostErrorCode = z.output<typeof HostFailureSchema>['code'];

export const HostFailureSchema = z.object({ ok: z.literal(false), error: z.string(), code: z.enum(['invalid-json', 'malformed-request', 'unknown-type', 'save-failed', 'request-in-progress', 'request-id-conflict']) });
export type HostFailure = z.output<typeof HostFailureSchema>;

export type HostResponse = SaveAck | QueryAck | LogAck | PongAck | HostFailure;

// 出ていく応答1つにスタンプを押す。ホストの送信ループではなくここに在るので、
// 「どの応答も、どの取り決めが書いたかを言う」が取り決め自身の性質になる＝2つ目の
// 作り手（テストダブル、将来のホスト）がこれを忘れて、その沈黙を拡張機能に「古い
// ホスト」と読ませることがない。
// `extBuild` が同じ呼び出しに相乗りするのは、「どの応答もどの取り決めが書いたかを言う」
// と「どの応答もディスク上のローカルビルドがどれかを言う」が離れられないようにするため。
// 継ぎ目は1つだけで、片方を忘れる作り手は両方を忘れる。言うことが何も無いときは丸ごと
// 省くので、ふつうのインストールへの応答は #650 の前にここが送っていたものとバイト単位で
// 同じになる。
export function stampProtocol<T extends HostResponse>(res: T, extBuild?: string | null): T & VersionStamp & DevBuildStamp {
  const stamped = Object.assign({ protocolVersion: PROTOCOL_VERSION } as VersionStamp & DevBuildStamp, res);
  if (extBuild) stamped.extBuild = extBuild;
  return stamped;
}

// 応答1つのスタンプから、どちら側が遅れているかを出す（#205）。整数の比較だけで、
// それ以外は何もしない。バージョンごとの表も、機能の探りも無い。
//
//   'host-old' ＝デスクトップアプリ（ホストを同梱している側）を更新する必要がある。
//   'host-new' ＝拡張機能の側を更新する必要がある。
//
// スタンプが無いときは 'host-old' と読む。これは意図してそうしている。この取り決めを
// 持つホストはどれも応答にスタンプを押すので、沈黙はスタンプが在る前のホストを意味する。
// まさにこの判定を足した理由がそれだ。うまくいかなかったインストールがディスクに残した
// bridge.js が、何か月も誰も見ていない取り決めで保存に答え続けている（#511）。
export type ProtocolSkew = 'match' | 'host-old' | 'host-new';

export function protocolSkewOf(hostVersion: number | null): ProtocolSkew {
  if (hostVersion === null || hostVersion < PROTOCOL_VERSION) return 'host-old';
  if (hostVersion > PROTOCOL_VERSION) return 'host-new';
  return 'match';
}

// 受け取った応答1つに載っているスタンプ。載っていなければ null。整数でないものと数値
// でないものも null になる＝比べられないスタンプは、無いスタンプより良くはない。無いもの
// として扱えば、失敗は「ユーザーに更新を伝える」経路に留まり、3つ目の経路を作らずに済む。
export function hostProtocolVersion(raw: unknown): number | null {
  const result = VersionStampSchema.safeParse(raw);
  return result.success ? (result.data.protocolVersion ?? null) : null;
}

// 受け取った応答1つに載っているビルドのスタンプ。載っていなければ null（#650）。
// 空文字列も null と読む。ビルドが出すのは中身に意味の無いトークンか、まったく何も無いか
// のどちらかで、"" はそのどちらでもない。無いものとして扱えば、壊れたスタンプが本物の
// スタンプと比べられることが一切なくなる。
export function hostExtBuild(raw: unknown): string | null {
  const result = DevBuildStampSchema.safeParse(raw);
  return result.success ? (result.data.extBuild ?? null) : null;
}

// 応答の読み手が前提にしてよいこと。すべて省略可能なのは意図してそうしている。両側は
// まったく別の通り道で更新される（Chrome ウェブストアと、アプリ自身の更新機構）ので、
// ack は、それを読む拡張機能より古いホストからも新しいホストからも届きうる。ここで欄を
// 必須にすれば、バージョンのずれが「保存が失敗した」に化ける。事実はその逆で、どちらに
// せよレコードはディスクに在る。厳密な作り手側の型から導出しているのでそこからずれられ
// ない。ずれがユーザーに伝わるものになるのは #205 の側。
export const HostAckViewSchema = z.looseObject({
  ...SavePostAckSchema.partial().shape,
  ...QueryAckSchema.partial().shape,
  ...PongAckSchema.partial().shape,
  ...VersionStampSchema.shape,
  ...DevBuildStampSchema.shape,
  ok: z.literal(true),
});
export type HostAckView = z.output<typeof HostAckViewSchema>;

// --- 解析 -----------------------------------------------------------------------

export type ParsedRequest = { ok: true; request: HostRequest } | { ok: false; id: RequestId | null; failure: HostFailure };

function failure(id: RequestId | null, code: HostErrorCode, error: string): ParsedRequest {
  return { ok: false, id, failure: { ok: false, error, code } };
}

// 不正値を補正せず、既存の失敗応答へ変換する。値自体はエラーに含めない。
export function parseHostRequest(raw: unknown): ParsedRequest {
  const result = HostRequestSchema.safeParse(raw);
  if (result.success) return { ok: true, request: result.data };
  const idResult = z.object({ id: requestCommon.id }).safeParse(raw);
  const id = idResult.success ? idResult.data.id : null;
  const typeResult = z.object({ type: z.string() }).safeParse(raw);
  if (typeResult.success && !['savePost', 'saveMedia', 'query', 'log', 'ping'].includes(typeResult.data.type)) return failure(id, 'unknown-type', 'Unknown message type');
  const detail = result.error.issues.map(({ path, code }) => path.join('.') + ': ' + code).join(', ');
  return failure(id, 'malformed-request', 'Invalid native message: ' + detail);
}

// 同じことを、Native Messaging のフレーム1つの UTF-8 の本体から始める。こうすると
// 「バイト列が JSON ではなかった」は、ホストのループがそれぞれ勝手に作る場合分けでは
// なく、この取り決めの場合分けになる。
export function parseHostFrame(body: string): ParsedRequest {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return failure(null, 'invalid-json', 'Invalid JSON message');
  }
  return parseHostRequest(raw);
}

// 応答がどの要求のものか。特定の要求に属さない応答は null（保存の経路のポートはどれも
// 要求を1つしか運ばないので、その応答に id は要らない）。echo の規則はどのハンドラの
// ものでもなくメッセージのものだ。RequestId を参照。
export function responseId(raw: unknown): RequestId | null {
  const result = z.object({ id: requestCommon.id }).safeParse(raw);
  return result.success ? result.data.id : null;
}

// `protocolVersion` が両方の側に在るのは、取り決めがホストに尋ねられた問いではないから
// だ。たまたま返ってきた応答に相乗りするだけであり、保存を失敗させるほど古びたホスト
// こそ、そのバージョンが最も重要になる。null は、応答がスタンプを運ばなかったことを表す
// （protocolSkewOf を参照）。
// `extBuild` が両方の側に在る理由も `protocolVersion` と同じだ。要求への答えではなく、
// たまたま返ってきた応答に相乗りする。そして「ディスク上のビルドが変わった」の運び手と
// して、失敗した応答は成功した応答と同じだけ役に立つ。null は、応答がスタンプを運ば
// なかったことを表す（#650）。
export type ReadResponse = { ok: true; ack: HostAckView; protocolVersion: number | null; extBuild: string | null } | { ok: false; error: string; code: HostErrorCode | null; protocolVersion: number | null; extBuild: string | null };

// 応答の既知のフィールドを検証する。未知の追加フィールドは更新順序の違いに備えて保持する。
export function readHostResponse(raw: unknown): ReadResponse {
  const protocolVersion = hostProtocolVersion(raw);
  const extBuild = hostExtBuild(raw);
  const ack = HostAckViewSchema.safeParse(raw);
  if (ack.success) return { ok: true, ack: ack.data, protocolVersion, extBuild };
  const failed = HostFailureSchema.partial({ error: true, code: true }).safeParse(raw);
  return { ok: false, error: failed.success && failed.data.error ? failed.data.error : 'Native host returned an error', code: failed.success ? (failed.data.code ?? null) : null, protocolVersion, extBuild };
}
