'use strict';

// DB を元にした読み取り経路 (#5 St4 / #297)。lib-db-import.ts (#296) が書いたテーブルから、
// サイドカーの形をした投稿レコードの配列を組み直す。あわせて、lib-db-schema.ts のスキーマ
// コメントが定めている FTS5 の全文検索の取り決めを提供する (SELECT postId,
// bm25(posts_fts) AS rank FROM posts_fts WHERE posts_fts MATCH ? ORDER BY rank)。
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
// ビルダーは使わない。lib-db-import.ts の書き込みと同じ＝bm25() に型の付いた Kysely の補助
// は無く、他の読み取りだけ別のクエリの書き方にしても、ちぐはぐになるだけ。

import type Database from 'better-sqlite3';

const POST_COLUMNS = [
  'captureId',
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
}
interface TagRow {
  postId: string;
  id: number;
  name: string;
}

// うごイラのフレームの表は、サイドカーが運んでいた配列の形で出てくる (#119 St3)。列が
// できる前に書かれた行や、JSON がもう解析できない行は null として読む。そうなると再生側は
// タイミングを持たず、ポスターへ退避する。zip を一度も落とせなかった場合と同じ結果。
function parseFrames(raw: string | null): { file: string; delay: number }[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.length ? v : null;
  } catch {
    return null;
  }
}

// posts.quotedPost/replyToPost (#180) と posts.poll (#179)。1つの TEXT の列に入った JSON の
// オブジェクトで、読み方は上の parseFrames と同じ「全部か無しか」。持たない行（引用も
// リノートも無い、投票も無い、あるいは #180 の射程が外したプラットフォームでの返信先＝
// 圧倒的多数）は NULL を持ち、null として読み戻る。オブジェクトとして解析できなくなった値も
// 同じように読む。`.text`/`.media`/`.choices` を読む側が使えないものが、レンダラーまで届か
// ないようにするため。読み方が同じなので両方を1つの読み手で扱う＝ここではどちらの形も
// 「まだオブジェクトか」以上には見ない。
function parseJsonObject(raw: string | null): any | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// posts.customEmojis (#290)。JSON の CustomEmojiShape[] の列。約束事は下の parseHashtags と
// 同じ「空の配列」で、上の parseJsonObject の「null が無しを意味する」ではない。ここでは
// 空の配列と NULL の列が、まったく同じ「この投稿はカスタム絵文字を使っていない」を意味
// する。hashtags/domFilled と同じ。
// posts.hashtags は JSON の string[] の列 (lib-db-schema.ts)。書き手は writePost だけで、
// 必ず正規化した配列を入れる。だからそのどちらでもない値は、壊れたデータベースか他所の
// データベース。とはいえこの読み取りはアプリの投稿一覧そのものなので、ここで JSON.parse を
// 捕まえ損ねると、レコード1件ではなくライブラリ全体が失敗する。解析できても配列でなければ、
// レンダラーの `hashtags.map` を使う側へ、map を持たないものが届く (#324)。上の parseFrames
// と同じ「全部か無しか」の形＝読めなければ空になる。ハッシュタグが一度も届かなかった
// レコードが、もともとそう見えるのと同じ。
function parseHashtags(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// #774: タグの親子関係を、問い合わせの時点で当てる (#21 が 2026-07-18 に確定した方法＝
// 規則を投稿データに焼き付けることは決してしないので、1つ消せばその効き目は次の読み取りで
// どの投稿からも消える)。投稿レコードの導出タグの配列に要る2つの引き当てを、tag_parents
// から組む:
//
//   closureOf(id) ＝ id と、tagId → parentTagId を辿って届く祖先の全部。だから子のタグが
//     付いた投稿は、実質的に親も持つ。
//   nameOf(id)    ＝ そのタグ自身の名前。
//   labelOf(id)   ＝ lib-db-tag-vocab.ts の tagVocabOverview が使う表示名の規則。普通は
//     `name`、そのタグが isDisplay の親を持つなら `name(displayParentName)`（同名の実体
//     2つが得る、曖昧さ回避）。
//
// tag_parents が空なら null を返す＝ライブラリに規則が1つも無いので、実効の集合は素の集合
// そのもの。下の assemble() は tags テーブルの追加の読み取りを丸ごと省く。
//
// lib-db-tag-vocab.ts 経由で循環を書き込むことはできない (addTagParent も mergeTags も
// 断る) が、他所のデータベースや壊れたデータベースは循環を持ちうる。しかもこれはアプリの
// 投稿一覧全体の上で走る。だから辿りは訪問済みの集合を持ち、読み込みを固まらせるのでは
// なく部分的な答えを返して終わる。
interface TagClosure {
  closureOf(id: number): number[];
  nameOf(id: number): string;
  labelOf(id: number): string;
}
function tagClosureResolver(sqlite: Database.Database): TagClosure | null {
  const edges = sqlite.prepare('SELECT tagId, parentTagId, isDisplay FROM tag_parents').all() as Array<{ tagId: number; parentTagId: number; isDisplay: number }>;
  if (!edges.length) return null;
  const parentsOf = new Map<number, number[]>();
  const displayParentOf = new Map<number, number>();
  for (const e of edges) {
    const list = parentsOf.get(e.tagId);
    if (list) list.push(e.parentTagId);
    else parentsOf.set(e.tagId, [e.parentTagId]);
    if (e.isDisplay) displayParentOf.set(e.tagId, e.parentTagId);
  }
  const nameById = new Map((sqlite.prepare('SELECT id, name FROM tags').all() as Array<{ id: number; name: string }>).map((t) => [t.id, t.name]));
  const nameOf = (id: number): string => nameById.get(id) || '';
  const labels = new Map<number, string>();
  const labelOf = (id: number): string => {
    const hit = labels.get(id);
    if (hit != null) return hit;
    const dp = displayParentOf.get(id);
    const label = dp != null ? nameOf(id) + '(' + nameOf(dp) + ')' : nameOf(id);
    labels.set(id, label);
    return label;
  };
  // タグの id ごとに覚えておく。ライブラリのタグの数は投稿の数よりずっと少ないので、
  // そのタグが何件の投稿に付いていても、閉包を辿るのは1回で済む。
  const closures = new Map<number, number[]>();
  const closureOf = (id: number): number[] => {
    const hit = closures.get(id);
    if (hit) return hit;
    const out: number[] = [];
    const seen = new Set<number>();
    let frontier = [id];
    while (frontier.length) {
      const next: number[] = [];
      for (const cur of frontier) {
        if (seen.has(cur)) continue;
        seen.add(cur);
        out.push(cur);
        for (const p of parentsOf.get(cur) || []) next.push(p);
      }
      frontier = next;
    }
    closures.set(id, out);
    return out;
  };
  return { closureOf, nameOf, labelOf };
}

// タグの付いたもの1つの、実効のタグ集合＝素のタグに、tag_parents のつながりが含意する祖先を
// 全部足し、重複を除き、素のタグを先に並べたもの。並ぶ配列が3本（同じ添字が同じタグ）で、
// tags/tagIds がすでにそうなっているのと同じ形。id は照合のため (query.ts のタグの葉)、
// 名前は選ばれたファセットの行が葉へ書き込む値のため、ラベルはその行が見せるもののため
// （同名の実体2つは、表示に使う親でしか見分けられない）。
//
// 埋め込まずに共有しているのは、投稿者もタグを持つから (#810)。poster_tags は同じ
// tags/tag_parents の上に乗る2つ目の中間テーブルなので、そこで親子関係を当てることは、投稿で
// それを当てることと1ビット違わず同じ意味でなければならない。1つの導出に実装が2つあれば、
// #810 が塞いでいる非対称へずれていく。閉包が null（ライブラリに規則が無い）なら、実効の
// 集合は素の集合、ラベルは素の名前になる。
interface EffectiveTags {
  effectiveTagIds: number[];
  effectiveTags: string[];
  effectiveTagLabels: string[];
}
function effectiveTagsOf(closure: TagClosure | null, tags: ReadonlyArray<{ id: number; name: string }>): EffectiveTags {
  const effectiveTagIds: number[] = [];
  const effectiveTags: string[] = [];
  const effectiveTagLabels: string[] = [];
  if (!closure) {
    for (const t of tags) {
      effectiveTagIds.push(t.id);
      effectiveTags.push(t.name);
      effectiveTagLabels.push(t.name);
    }
    return { effectiveTagIds, effectiveTags, effectiveTagLabels };
  }
  const seen = new Set<number>();
  for (const t of tags)
    for (const id of closure.closureOf(t.id)) {
      if (seen.has(id)) continue;
      seen.add(id);
      effectiveTagIds.push(id);
      effectiveTags.push(closure.nameOf(id));
      effectiveTagLabels.push(closure.labelOf(id));
    }
  return { effectiveTagIds, effectiveTags, effectiveTagLabels };
}

// 取得済みの `posts` の行と、そのメディア・タグを postId でまとめ、完全な投稿レコードを
// 組み立てる。postsFromDb（全行）と postsByIds（captureId の部分集合）が共有するので、
// どちらもまったく同じ形を返す。
function assemble(sqlite: Database.Database, postRows: any[]): any[] {
  if (!postRows.length) return [];
  const ids = postRows.map((r) => r.captureId);
  const placeholders = ids.map(() => '?').join(',');

  const mediaByPost = new Map<string, MediaRow[]>();
  const mediaRows = sqlite.prepare(`SELECT postId, seq, url, alt, width, height, file, type, posterFile, frames, cropX, cropY, cropWidth, cropHeight FROM media WHERE postId IN (${placeholders}) ORDER BY postId, seq`).all(...ids) as MediaRow[];
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

  const closure = tagClosureResolver(sqlite);

  return postRows.map((r) => {
    const media = (mediaByPost.get(r.captureId) || []).map((m) => ({
      url: m.url,
      alt: m.alt,
      width: m.width,
      height: m.height,
      file: m.file,
      type: m.type,
      posterFile: m.posterFile,
      frames: parseFrames(m.frames),
      crop: m.cropX != null && m.cropY != null && m.cropWidth != null && m.cropHeight != null ? { x: m.cropX, y: m.cropY, width: m.cropWidth, height: m.cropHeight } : null,
    }));
    const tags = tagsByPost.get(r.captureId) || [];
    // #774: 実効のタグ集合（上の effectiveTagsOf）＝SELECT のたびに導出し、どのテーブルにも
    // 保存しない。#21 の 2026-07-18 のコメント「投稿データは常にユーザーが付けたタグだけ」
    // に従う。
    const { effectiveTagIds, effectiveTags, effectiveTagLabels } = effectiveTagsOf(closure, tags);
    return {
      captureId: r.captureId,
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
      hashtags: parseHashtags(r.hashtags),
      tags: tags.map((t) => t.name),
      tagIds: tags.map((t) => t.id),
      // #774（導出したもので、保存は決してしない＝上の実効の集合のコメントを参照）。
      effectiveTagIds,
      effectiveTags,
      effectiveTagLabels,
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
      domFilled: parseHashtags(r.domFilled),
      // #180: 引用・リポストと返信先の、サイドカーの下位レコード。読む
      // 理由は quotedUrl/replyToId と同じ＝インスペクタ（#180 の表示側の段が入れば）と、書き
      // 出しのサイドカーの両方が要る。
      quotedPost: parseJsonObject(r.quotedPost),
      replyToPost: parseJsonObject(r.replyToPost),
      // #179: その投稿の投票。インスペクタの投票カードと、書き出しのサイドカーのために読む。
      // quotedPost と同じ2つの使い手。
      poll: parseJsonObject(r.poll),
      // #290: その投稿自身の :shortcode: 形式のカスタム絵文字。インスペクタ（#290 自身の射程の
      // 注記どおり、表示の段が入れば）と、書き出しのサイドカーのために読む。
      // #181: リンクを共有する投稿の OGP のプレビューカード。インスペクタのリンクカードの行と、
      // 書き出しのサイドカーのために読む。quotedPost/poll と同じ2つの使い手。
      linkCard: parseJsonObject(r.linkCard),
      // #8: カードの画像がアニメーションする webp であること＝lib-card-dims.ts の
      // fillCardDims と、records.ts の imgW の例外扱いを参照（本物の .gif が拡張子だけで
      // すでに受けているのと同じ扱い）。
      shotAnimated: fromDbBool(r.shotAnimated),
      // #239: 汎用のウェブページ抽出の経路で、
      // title/description/author/published/siteName/url を何が埋めたか。書き出しのサイド
      // カーのためだけに読む＝v1 にインスペクタや UI の使い手は無い（設計コメントの7番）。
      metaSource: parseJsonObject(r.metaSource),
    };
  });
}

// 投稿を全部、capturedAt の新しい順に。lib-index.ts の list() が返すのと同じ並びなので、
// 下流（グリッドの並び、差分の帳簿）は出所が変わったことを知らずに済む。
async function postsFromDb(sqlite: Database.Database): Promise<any[]> {
  const rows = sqlite.prepare(`SELECT ${POST_COLUMNS.join(',')} FROM posts ORDER BY capturedAt DESC`).all();
  return assemble(sqlite, rows);
}

function posterProfilesFromDb(sqlite: Database.Database): Array<Record<string, any>> {
  return sqlite.prepare('SELECT posterKey AS key, platform, userId, displayName, screenName, bio, avatarFile, bannerFile, followers, following, authorCreatedAt, firstObservedAt, lastObservedAt FROM poster_profiles ORDER BY lastObservedAt DESC').all() as Array<Record<string, any>>;
}

// captureId を指定した部分集合＝狙いを絞った更新の経路（監視が起こした importChanged の
// 1回の束で、足された・更新された投稿）。並び順は保証しない（呼び出し元はこれを、描画する
// 一覧ではなく Map へ畳み込む）。
async function postsByIds(sqlite: Database.Database, captureIds: string[]): Promise<any[]> {
  if (!captureIds.length) return [];
  const placeholders = captureIds.map(() => '?').join(',');
  const rows = sqlite.prepare(`SELECT ${POST_COLUMNS.join(',')} FROM posts WHERE captureId IN (${placeholders})`).all(...captureIds);
  return assemble(sqlite, rows);
}

// FTS5 の全文検索 (#5 St4 / #297 のクエリの取り決め)。rank は bm25()＝負に大きいほど関連が
// 強いので、素の昇順の ORDER BY rank が最良の一致を先頭に置く (lib-db-schema.ts のスキーマ
// コメント)。この段では実際の検索の体験には繋いでいない（レンダラーはメモリ上のあいまい
// マッチャーを使い続ける＝全文検索の体験そのものは #29 で、そちらが最終的な使い手）。ここに
// あるのは取り決めそのもので、scripts/test-db-query.cts と bench-baseline.cts の DB アダプタ
// が動かす。形の壊れた MATCH 式（引用符の対応が取れていない、先頭に裸の演算子）は
// better-sqlite3 から throw される。ここで捕まえて「結果なし」として扱い、表には出さない。
// クエリの構文の誤りをユーザーへ見せる術を、下流がまだ持っていないため。
interface FtsHit {
  postId: string;
  rank: number;
}
function searchPostsFts(sqlite: Database.Database, query: string, limit = 200): FtsHit[] {
  const q = (query || '').trim();
  if (!q) return [];
  try {
    return sqlite.prepare('SELECT postId, bm25(posts_fts) AS rank FROM posts_fts WHERE posts_fts MATCH ? ORDER BY rank LIMIT ?').all(q, limit) as FtsHit[];
  } catch {
    return [];
  }
}

export { postsFromDb, postsByIds, posterProfilesFromDb, searchPostsFts, POST_COLUMNS };
// #810: lib-db-write.ts の投稿者タグの読み取りと共有＝effectiveTagsOf を参照。
export { tagClosureResolver, effectiveTagsOf };
export type { TagClosure, EffectiveTags };

// --- #300 (St7) の追加: これまで読み手のいなかったテーブルの書き出し ---
// (tag_parents は #86/#157 のための眠ったままのスキーマ。capturedVia は、このファイルの並びを
// 最後に触ったあとで書き手側の POST_COLUMNS＝lib-db-record-writer.ts に足されたもので、
// ここへは一度も埋め戻されなかった。localViewCount は逆に、このライブラリの利用履歴なので
// 読み手だけが扱う。) export の文を分けてあるので、上にある4つの名前の export を編集する必要は
// 一切ない。

interface TagRow2 {
  id: number;
  name: string;
  kind: string | null;
  reading: string | null;
}
// tags の行を全部、絞り込まずに（tag-types.json が往復させるのは kind を持つタグだけ。
// tag-parents.json は、kind の有無にかかわらず親のつながりに参加するタグを全部要る）。
function tagsFromDb(sqlite: Database.Database): TagRow2[] {
  return sqlite.prepare('SELECT id, name, kind, reading FROM tags ORDER BY id').all() as TagRow2[];
}

interface TagParentRow {
  tagId: number;
  parentTagId: number;
  isDisplay: boolean;
}
function tagParentsFromDb(sqlite: Database.Database): TagParentRow[] {
  return (sqlite.prepare('SELECT tagId, parentTagId, isDisplay FROM tag_parents ORDER BY tagId, parentTagId').all() as Array<{ tagId: number; parentTagId: number; isDisplay: number }>).map((r) => ({
    tagId: r.tagId,
    parentTagId: r.parentTagId,
    isDisplay: !!r.isDisplay,
  }));
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

export { tagsFromDb, tagParentsFromDb, postCapturedVia };
