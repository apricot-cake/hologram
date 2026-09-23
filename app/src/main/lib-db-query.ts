import type { PostView, PosterView } from '../shared/post-view-schemas.ts';
import { z } from 'zod';
import { PostRecordSchema, FramesSchema, QuotedPostSchema, PollSchema, LinkCardSchema } from '../../../native-host/post-schemas.mts';

// DB を元にした読み取り経路 (#5 St4 / #297)。lib-db-import.ts (#296) が書いたテーブルから、
// サイドカーの形をした投稿レコードの配列を組み直す。あわせて、lib-db-schema.ts のスキーマ
//
// 読み取り専用で、このモジュールが書くことは決してない。postsFromDb()/postsByIds() は
// lib-db-import.ts の writePost() を鏡に映したもの＝列の並びも、メディアの順序 (seq) も、
// タグの解決 (post_tags → tags.name) も同じで、INSERT が SELECT になるだけ。tagIds は tags
// と並ぶ配列として付いてくる（同じ添字が同じタグ）ので、query.ts のタグの葉は id で照合
// できる (#5 の 2026-07-18 のコメント＝改名しても id は変わらない)。まだ移行していない
// 保存済みの葉のために、名前での照合にも退避できる。
//
// Electron 非依存（better-sqlite3 と node の組み込みだけ）で lib-db.ts/lib-db-import.ts に
// 倣うので、素の node で単体テストできる。全体を通して生の sqlite ハンドルを使い、Kysely の
// は無く、他の読み取りだけ別のクエリの書き方にしても、ちぐはぐになるだけ。

import type Database from 'better-sqlite3';

const POST_COLUMNS = [
  'captureId',
  'saveScope',
  'mediaType',
  'image',
  'video',
  'url',
  'platform',
  'text',
  'title',
  'displayName',
  'screenName',
  'userId',
  'avatar',
  'avatarFile',
  'followers',
  'following',
  'authorCreatedAt',
  'likes',
  'reposts',
  'replies',
  'bookmarks',
  'views',
  'localViewCount',
  'date',
  'capturedAt',
  'updatedAt',
  'lang',
  'isReply',
  'isQuote',
  'isThread',
  'isEdited',
  'cw',
  'sensitive',
  'quotedUrl',
  'replyToId',
  'seriesId',
  'seriesTitle',
  'seriesOrder',
  'hashtags',
  'eagleName',
  'source',
  'shotW',
  'shotH',
  'mediaMaxW',
  'mediaMaxH',
  'mediaMaxBytes',
  'trashedAt',
  'userKind',
  'tagReviewed',
  'imageIndex',
  'imageCount',
  'domFilled',
  'quotedPost',
  'replyToPost',
  'poll',
  'linkCard',
  'shotAnimated',
  'metaSource',
] as const;

function fromDbBool(v: unknown): boolean | null {
  return v == null ? null : !!v;
}

interface MediaRow {
  postId: string;
  seq: number;
  url: string | null;
  alt: string | null;
  width: number | null;
  height: number | null;
  file: string;
  type: string | null;
  posterFile: string | null;
  frames: string | null; // JSON の [{file,delay}] (#119 St3)。うごイラの行だけ
  cropX: number | null;
  cropY: number | null;
  cropWidth: number | null;
  cropHeight: number | null;
  rotation: number;
  flipped: number;
}
interface TagRow {
  postId: string;
  id: number;
  name: string;
}

// DB の JSON 列も保存時と同じスキーマで読む。破損は記録し、表示のための欠損を返す。
// ここでは DB を書き換えない。取り込み・復旧の保存前検証とは別の読み取り処理。
function readJsonColumn<S extends z.ZodType>(raw: string | null, schema: S, fallback: z.output<S>): z.output<S> {
  if (raw === null) return fallback;
  try {
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    console.warn('Invalid post JSON column', error instanceof z.ZodError ? error.issues.map(({ path, code }) => ({ path, code })) : 'invalid-json');
    return fallback;
  }
}

// 取得済みの `posts` の行と、そのメディア・タグを postId でまとめ、完全な投稿レコードを
// 組み立てる。postsFromDb（全行）と postsByIds（captureId の部分集合）が共有するので、
// どちらもまったく同じ形を返す。
function assemble(sqlite: Database.Database, postRows: any[], hydrateQuotes = true): PostView[] {
  if (!postRows.length) return [];
  const ids = postRows.map((r) => r.captureId);
  const placeholders = ids.map(() => '?').join(',');
  const quotes = new Map<string, PostView>();
  if (hydrateQuotes) {
    const refs = sqlite.prepare(`SELECT captureId, quotedPostId FROM posts WHERE captureId IN (${placeholders}) AND quotedPostId IS NOT NULL`).all(...ids) as Array<{ captureId: string; quotedPostId: string }>;
    const quoteIds = [...new Set(refs.map((r) => r.quotedPostId))];
    if (quoteIds.length) {
      const rows = sqlite.prepare(`SELECT ${POST_COLUMNS.join(',')} FROM posts WHERE captureId IN (${quoteIds.map(() => '?').join(',')})`).all(...quoteIds);
      const byId = new Map(assemble(sqlite, rows, false).map((p) => [p.captureId, p]));
      for (const ref of refs) {
        const quote = byId.get(ref.quotedPostId);
        if (quote) quotes.set(ref.captureId, quote);
      }
    }
  }

  const mediaByPost = new Map<string, MediaRow[]>();
  const mediaRows = sqlite.prepare(`SELECT postId, seq, url, alt, width, height, file, type, posterFile, frames, cropX, cropY, cropWidth, cropHeight, rotation, flipped FROM media WHERE postId IN (${placeholders}) ORDER BY postId, seq`).all(...ids) as MediaRow[];
  for (const m of mediaRows) {
    let list = mediaByPost.get(m.postId);
    if (!list) mediaByPost.set(m.postId, (list = []));
    list.push(m);
  }

  // rowid ＝ 挿入の順（post_tags に明示の seq の列は無い＝writePost() はサイドカーの元の
  // tags[] の順に挿入し、素の rowid テーブルは列を足さずにその順を読み取り順として保つ）。
  const tagsByPost = new Map<string, TagRow[]>();
  const tagRows = sqlite.prepare(`SELECT pt.postId AS postId, t.id AS id, t.name AS name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId IN (${placeholders}) ORDER BY pt.postId, pt.rowid`).all(...ids) as TagRow[];
  for (const t of tagRows) {
    let list = tagsByPost.get(t.postId);
    if (!list) tagsByPost.set(t.postId, (list = []));
    list.push(t);
  }

  return postRows.map((r) => {
    const media = (mediaByPost.get(r.captureId) || []).map((m) => ({
      url: m.url ?? '',
      alt: m.alt,
      width: m.width,
      height: m.height,
      file: m.file,
      type: m.type,
      posterFile: m.posterFile,
      frames: readJsonColumn(m.frames, FramesSchema.nullable(), null),
      ...(m.rotation ? { rotation: m.rotation as 90 | 180 | 270 } : {}),
      ...(m.flipped ? { flipped: true } : {}),
      crop: m.cropX != null && m.cropY != null && m.cropWidth != null && m.cropHeight != null ? { x: m.cropX, y: m.cropY, width: m.cropWidth, height: m.cropHeight } : null,
    }));
    const tags = tagsByPost.get(r.captureId) || [];
    return {
      captureId: r.captureId,
      saveScope: r.saveScope,
      mediaType: r.mediaType,
      image: r.image,
      video: r.video,
      url: r.url,
      platform: r.platform,
      text: r.text,
      title: r.title,
      displayName: r.displayName,
      screenName: r.screenName,
      userId: r.userId,
      avatar: r.avatar,
      avatarFile: r.avatarFile,
      followers: r.followers,
      following: r.following,
      authorCreatedAt: r.authorCreatedAt,
      likes: r.likes,
      reposts: r.reposts,
      replies: r.replies,
      bookmarks: r.bookmarks,
      views: r.views,
      // SNS 側の views と混ぜない。これは画像ビューを開くたびに DB が増やす
      // ライブラリ固有の利用履歴で、未閲覧はマイグレーションの既定値 0。
      localViewCount: r.localViewCount,
      date: r.date,
      capturedAt: r.capturedAt,
      updatedAt: r.updatedAt,
      lang: r.lang,
      isReply: fromDbBool(r.isReply),
      isQuote: fromDbBool(r.isQuote),
      isThread: fromDbBool(r.isThread),
      // #189: プラットフォームが報告する編集の状態。上の isReply/isQuote/isThread と同じ、
      // 「null は信号が無いこと」の約束事。
      isEdited: fromDbBool(r.isEdited),
      // #178: cw は投稿者自身が書いた CW の文。sensitive は、プラットフォームがその信号を
      // 運んでいる限り (X/Bluesky) 確定した答えで、上の「null は信号が無いこと」の
      // 約束事ではない＝PostRecordShape.sensitive を参照。
      cw: r.cw,
      sensitive: fromDbBool(r.sensitive),
      quotedUrl: r.quotedUrl,
      replyToId: r.replyToId,
      // #188: pixiv のシリーズの所属。読む理由は quotedUrl/replyToId と同じ＝インスペクタが
      // 見せ、書き出しのサイドカーが運ぶ。
      seriesId: r.seriesId,
      seriesTitle: r.seriesTitle,
      seriesOrder: r.seriesOrder,
      hashtags: readJsonColumn(r.hashtags, PostRecordSchema.shape.hashtags, []),
      tags: tags.map((t) => t.name),
      tagIds: tags.map((t) => t.id),
      media,
      eagleName: r.eagleName,
      source: r.source,
      shotW: r.shotW,
      shotH: r.shotH,
      // #162: レコード単位のメディアの大きさの集計（寸法とファイルサイズのファセット）。
      // add-media-max-dims のマイグレーションより前に書かれた行では null。マイグレーション
      // が足しただけで誰も埋め戻さない、他のどの列とも同じ。
      mediaMaxW: r.mediaMaxW,
      mediaMaxH: r.mediaMaxH,
      mediaMaxBytes: r.mediaMaxBytes,
      trashedAt: r.trashedAt,
      userKind: r.userKind,
      tagReviewed: fromDbBool(r.tagReviewed),
      // #560: 個別画像の保存が、元の投稿の中で何番目だったか。インスペクタが見せ、書き出しの
      // サイドカーが運ばなければならないので読む（書き手側だけに留まる capturedVia/replaces
      // とは違う）。
      imageIndex: r.imageIndex,
      imageCount: r.imageCount,
      // #202: どの欄がプラットフォームの API ではなくページから来たか。読む理由は imageIndex
      // と同じ＝書き出しのサイドカーが運ばなければならない。運ばないと、ZIP を往復するだけで
      // ページから読んだ値が、API の保証した値へ黙って貼り替わる。持ち方は hashtags と同じ
      // JSON の string[] なので、解析も同じ「全部か無しか」。
      domFilled: readJsonColumn(r.domFilled, PostRecordSchema.shape.domFilled, []),
      // #180: 引用・リポストと返信先の、サイドカーの下位レコード。読む
      // 理由は quotedUrl/replyToId と同じ＝インスペクタ（#180 の表示側の段が入れば）と、書き
      // 出しのサイドカーの両方が要る。
      quotedPost: quotes.has(r.captureId) ? QuotedPostSchema.parse(quotes.get(r.captureId)) : readJsonColumn(r.quotedPost, QuotedPostSchema.nullable(), null),
      replyToPost: readJsonColumn(r.replyToPost, QuotedPostSchema.nullable(), null),
      // #179: その投稿の投票。インスペクタの投票カードと、書き出しのサイドカーのために読む。
      // quotedPost と同じ2つの使い手。
      poll: readJsonColumn(r.poll, PollSchema.nullable(), null),
      // #290: その投稿自身の :shortcode: 形式のカスタム絵文字。インスペクタ（#290 自身の射程の
      // 注記どおり、表示の段が入れば）と、書き出しのサイドカーのために読む。
      // #181: リンクを共有する投稿の OGP のプレビューカード。インスペクタのリンクカードの行と、
      // 書き出しのサイドカーのために読む。quotedPost/poll と同じ2つの使い手。
      linkCard: readJsonColumn(r.linkCard, LinkCardSchema.nullable(), null),
      // #8: カードの画像がアニメーションする webp であること＝lib-card-dims.ts の
      // fillCardDims と、records.ts の imgW の例外扱いを参照（本物の .gif が拡張子だけで
      // すでに受けているのと同じ扱い）。
      shotAnimated: fromDbBool(r.shotAnimated),
      // #239: 汎用のウェブページ抽出の経路で、
      // title/description/author/published/siteName/url を何が埋めたか。書き出しのサイド
      // カーのためだけに読む＝v1 にインスペクタや UI の使い手は無い（設計コメントの7番）。
      metaSource: readJsonColumn(r.metaSource, PostRecordSchema.shape.metaSource, null),
    };
  });
}

// 投稿を全部、capturedAt の新しい順に。lib-index.ts の list() が返すのと同じ並びなので、
// 下流（グリッドの並び、差分の帳簿）は出所が変わったことを知らずに済む。
async function postsFromDb(sqlite: Database.Database): Promise<PostView[]> {
  const rows = sqlite.prepare(`SELECT ${POST_COLUMNS.join(',')} FROM posts WHERE isContext = 0 ORDER BY capturedAt DESC`).all();
  return assemble(sqlite, rows);
}

function posterProfilesFromDb(sqlite: Database.Database): PosterView[] {
  return sqlite.prepare('SELECT posterKey AS key, platform, userId, displayName, screenName, bio, avatarFile, bannerFile, followers, following, authorCreatedAt, firstObservedAt, lastObservedAt FROM poster_profiles ORDER BY lastObservedAt DESC').all() as PosterView[];
}

// captureId を指定した部分集合＝狙いを絞った更新の経路（監視が起こした importChanged の
// 1回の束で、足された・更新された投稿）。並び順は保証しない（呼び出し元はこれを、描画する
// 一覧ではなく Map へ畳み込む）。
async function postsByIds(sqlite: Database.Database, captureIds: string[]): Promise<PostView[]> {
  return postsByIdsSync(sqlite, captureIds);
}

export function postsByIdsSync(sqlite: Database.Database, captureIds: string[]): PostView[] {
  if (!captureIds.length) return [];
  const placeholders = captureIds.map(() => '?').join(',');
  const rows = sqlite.prepare(`SELECT ${POST_COLUMNS.join(',')} FROM posts WHERE isContext = 0 AND captureId IN (${placeholders})`).all(...captureIds);
  return assemble(sqlite, rows);
}

export { postsFromDb, postsByIds, posterProfilesFromDb, POST_COLUMNS };

interface TagRow2 {
  id: number;
  name: string;
  groupId: string | null;
  reading: string | null;
}
function tagsFromDb(sqlite: Database.Database): TagRow2[] {
  return sqlite.prepare('SELECT id, name, groupId, reading FROM tags ORDER BY id').all() as TagRow2[];
}

// POST_COLUMNS の1つの抜け（上のモジュールのコメントを参照）を、POST_COLUMNS や assemble()
// をその場で書き換えるのではなく、補いの引き当てで埋める＝このファイルの既存の読み取り経路を、
// 他のどの呼び出し元にとっても1バイトも変えないため。
function postCapturedVia(sqlite: Database.Database, captureIds: string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!captureIds.length) return out;
  const placeholders = captureIds.map(() => '?').join(',');
  for (const row of sqlite.prepare(`SELECT captureId, capturedVia FROM posts WHERE captureId IN (${placeholders})`).all(...captureIds) as Array<{ captureId: string; capturedVia: string | null }>) {
    out.set(row.captureId, row.capturedVia);
  }
  return out;
}

export { tagsFromDb, postCapturedVia };
