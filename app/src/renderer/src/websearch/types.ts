// #207 ＝ライブラリ → ウェブ検索の翻訳エンジン。凍結された姉妹プロジェクト
// apricot-cake/dialect（MIT）から書き直したもので、順方向の経路だけ: types / platforms /
// resolve / googleFallback と、木 → QueryState のアダプタ。dialect 自身の逆翻訳・UI の
// 選択部品・共有リンクのモジュールは移していない（範囲外＝Issue を参照）。
//
// このディレクトリは全体が純粋なロジック＝DOM も Electron も i18n の実行時も無い。落とした
// こと・近似したことの注記は素の日本語の文字列で、アプリの他の UI と同じ調子で書く＝注記の
// 文はツールチップに出るデータであって常設の UI 部品ではないので、ポップオーバー自身の
// ラベルのようにメッセージ表を通ることはない。
//
// 確からしさについての注記（プラットフォームの演算子の表を信じる前に読むこと）: #822
// （2026-08-03）が、凍結された dialect のリポジトリの実物の複製（DIALECT_REPO）に対して
// 同等性のハーネス（scripts/check-websearch-equivalence.cts＝resolve.ts の姉妹を参照）を
// 走らせ、2つのエンジンが共有する概念すべてを、プラットフォームごとに 5000 件以上の生成
// された事例で当たり、食い違いは0だった。下のプラットフォームのモジュールはどれも、
// dialect が実測した演算子の表（packages/core/src/platforms/*.ts）に対して機械で検査済み
// ＝この検査が見つけた修正は、各モジュール自身のヘッダーのコメントに書いてある（誤った
// エンコード、抜けていた演算子、pixiv 自身のエラーページで壊れる強制された pixiv の URL の
// 形、など）。あるモジュールが、そのサイトに対する dialect 自身のモデルを越えて支える概念
// （Hologram だけの拡張＝例えば X の videoOnly/repliesOnly、pixiv の fromUser による作者の
// ページへの移動）は、そのモジュールのヘッダーではっきり断ってある。ハーネスにはそれらを
// 照らし合わせる相手が無いから。演算子の表に手を入れたらハーネスを走らせ直すこと＝
// DIALECT_REPO の準備については、check-websearch-equivalence.cts にあるこのファイル自身の
// コメントを参照。

/** Hologram が投稿として保存する3サイト＝ポップオーバーが行として並べるのと同じ組。
 * services/facets.ts の PF_ORDER のリテラル文字列と厳密に一致する（p.platform 自身の値）。 */
export type PlatformId = 'x' | 'bluesky' | 'pixiv';

/** 利用者の葉を、実在するプラットフォームの形の識別子まで解決したもの＝これが写している
 * services/profile-url.ts の ProfileUrlSubject のコメントを参照。x/bluesky は素のハンドル、
 * pixiv は数値の利用者 id。
 *
 * `platform` は、この人が実際にどのサイトから保存されたかを記録する。from:/acct: の絞り込み
 * が意味を持つのは、そのプラットフォームの上だけ（あるいは気にしない Google）＝別サイトの
 * 投稿から解決した利用者に、筋の通る X への翻訳は無い。resolve.ts はこの欄を使い、食い違いを
 * 黙ってやり過ごすのではなく、その条件が属さない行すべてから条件を落とす。 */
export interface ResolvedUser {
  platform: PlatformId;
  handle: string;
}

/** 条件の木から独立した、エンジンのクエリの形＝概念を平たく詰めた袋で、プラットフォームの
 * モジュールはそのうち自分に効く部分だけを読む。無い・空は「その条件は木に入っていなかった」
 * であって、「空文字列はすべてに一致する」では決してない＝どのプラットフォームのモジュール
 * も、空の配列や null を「無い」と同じに扱わなければならない。 */
export interface QueryState {
  /** 肯定のキーワードの語。AND で結ぶ。 */
  terms: string[];
  /** 「このキーワードのどれか」のまとまり1つ（ファセットの CNF は本文の OR の組を必ず1つしか
   * 持たない）。 */
  keywordsOr: string[];
  /** 除外するキーワード。 */
  exclude: string[];
  /** 肯定のタグ・ハッシュタグ。AND で結ぶ。pixiv のタグの葉もハッシュタグの葉も、どちらも
   * ここへ来る＝pixiv 自身の検索がそもそもタグ検索なので、Hologram の2つの葉の型は翻訳した
   * 時点で1つの概念に潰れる。 */
  hashtag: string[];
  /** 「このタグのどれか」のまとまり1つ。 */
  hashtagOr: string[];
  /** 除外するタグ・ハッシュタグ。 */
  excludeHashtag: string[];
  /** 解決した投稿者1人、または null ＝実在のハンドルまで解決できなかった葉は、推測として
   * ここに入るのではなく、落としたものとして報告される（ResolvedUser を参照）。プラット
   * フォームごとの絞り込み（これはこの行に属するか）は、ここではなく resolve.ts でやる＝
   * アダプタの仕事は「木は何と言ったか」で止まる。 */
  fromUser: ResolvedUser | null;
  /** 除外する投稿者。AND で結ぶ。 */
  excludeUser: ResolvedUser[];
  /** 投稿された日付の境界。ローカルの日付の YYYY-MM-DD の文字列（木自身のローカルの日の
   * 意味付けによって解決済み＝services/query.ts の localDayRange を参照）。ライブラリだけの
   * 日付の軸（保存した日時など）はこの欄に届かない＝アダプタがそれらを落とす。 */
  since: string | null;
  until: string | null;
  mediaOnly: boolean;
  videoOnly: boolean;
  excludeReplies: boolean;
  repliesOnly: boolean;
  minLikes: number | null;
  minReposts: number | null;
  minReplies: number | null;
}

export function emptyQueryState(): QueryState {
  return {
    terms: [],
    keywordsOr: [],
    exclude: [],
    hashtag: [],
    hashtagOr: [],
    excludeHashtag: [],
    fromUser: null,
    excludeUser: [],
    since: null,
    until: null,
    mediaOnly: false,
    videoOnly: false,
    excludeReplies: false,
    repliesOnly: false,
    minLikes: null,
    minReposts: null,
    minReplies: null,
  };
}

/** プラットフォームのモジュールが実際に読む形。QueryState と同じだが、fromUser と
 * excludeUser は、このプラットフォーム向けの素のハンドルの文字列まで既に絞り込んである
 * （resolve.ts の仕事＝narrowForPlatform を参照）＝プラットフォームの build() が
 * ResolvedUser やプラットフォーム間の食い違いを知る必要は一切なく、「使えるハンドルが
 * あるか無いか」だけを見ればいい。 */
export type PlatformQueryState = Omit<QueryState, 'fromUser' | 'excludeUser'> & {
  fromUser: string | null;
  excludeUser: string[];
};

/** テストと呼び出し側の便宜。全項目が空の PlatformQueryState で、単体テストはこれを展開し、
 * 気にする欄だけを上書きできる。QueryState の ResolvedUser の形が邪魔にならない
 * （fromUser/excludeUser は2つの型の間で違う）。 */
export function emptyPlatformQueryState(): PlatformQueryState {
  return { ...emptyQueryState(), fromUser: null, excludeUser: [] };
}

/** 何ひとつ設定されていないときに限り真＝これに出くわしたプラットフォームのモジュールは、
 * クエリの無い検索 URL ではなく null を組み立てるべき（X と Bluesky は空の q を拒む。
 * pixiv には素の「全タグ」の閲覧が無い）。 */
export function isEmptyState(s: PlatformQueryState): boolean {
  return (
    s.terms.length === 0 &&
    s.keywordsOr.length === 0 &&
    s.exclude.length === 0 &&
    s.hashtag.length === 0 &&
    s.hashtagOr.length === 0 &&
    s.excludeHashtag.length === 0 &&
    s.fromUser == null &&
    s.excludeUser.length === 0 &&
    s.since == null &&
    s.until == null &&
    !s.mediaOnly &&
    !s.videoOnly &&
    !s.excludeReplies &&
    !s.repliesOnly &&
    s.minLikes == null &&
    s.minReposts == null &&
    s.minReplies == null
  );
}

/** クエリそのものの他に、プラットフォームのモジュールが組み立てのたびに要りうる文脈。 */
export type PlatformCtx = Record<string, never>;

export interface ApproxNote {
  /** 近似した条件を表す短い日本語のラベル（行の警告アイコンのツールチップの内訳に出る）。 */
  note: string;
}
export interface DropNote {
  /** その条件を翻訳できなかった理由を述べる、短い日本語の文。 */
  reason: string;
}

export interface PlatformResult {
  /** null は、検索できる形に翻訳できるものが残らなかったか（このプラットフォームが使えない
   * ものをすべて落とした後の isEmptyState）を表す。 */
  url: string | null;
  /** そのまま URL に入った概念。 */
  applied: string[];
  approximated: ApproxNote[];
  dropped: DropNote[];
}

export interface PlatformDef {
  id: PlatformId;
  /** 表示するラベル＝固有名詞なので訳さない。 */
  label: string;
  build(state: PlatformQueryState, ctx: PlatformCtx): PlatformResult;
}
