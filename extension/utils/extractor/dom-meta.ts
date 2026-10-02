// 投稿の情報の第2の出所＝ページ自身が画面に出しているもの (#202)。プラットフォームに
// は依存しない。「どの要素が本文を持つか」の規則はすべてそのサイト自身のモジュール
// （その capture site の extractDomMeta）の担当で、このファイルが持つのは、サイトごとに
// 違ってはいけない2つだけ:
//
//   1. 省略表記の数値をどう数として読むか（`1.2万` → 12000）
//   2. API のどの欄なら画面側の値で埋めてよいか、そしてそれはいつか
//
// そもそもなぜ第2の出所が要るか。プラットフォームの API は、画面にはっきり出ている
// 投稿に対して何も答えられないことがある。X では、鍵付きアカウントも年齢制限付きの
// 投稿も、匿名の埋め込み用エンドポイントからは墓標として返る。こちら側でどうログイン
// してもどちらも解けない（x.ts の fetchXTweet を参照）。2026-07-29 に実ライブラリの
// X 投稿951件で実測したところ、これが45件＝4.7%にあたる。その本文・投稿者・
// 各種の数は、保存している当人には見えていて、他の何にも見えていない。残りの失敗
// （削除・凍結・404）は画面にも出ていないので、ここからは届かないし届くべきでもない。
//
// API の値が必ず勝つ。画面側の値は API が null のまま残した欄を埋めるだけで、API が
// 答えた欄を上書きすることは一切ない。両者は日常的に、そして無害に食い違う（取得と
// クリックの間に数が増える、描画されたテキストが省略記号で切れている）。その場面で
// ページを採るのは、正確な値を概数と引き換えにするだけで何の得もない。おかげでサイトの
// 改装が起きたときの壊れ方も穏やかなものになる＝セレクタが当たらなくなれば値が出ない
// だけで、保存はこの仕組みが無かった頃とまったく同じ形に落ち着く。
//
// ここから保存へ例外を投げてはいけない。extractDomMeta は、こちらが形を支配していない
// ページに対して、コンテンツスクリプトの中で、投稿を選んでから保存するまでの途中で
// 走る。そこで例外が飛べば保存そのものが死ぬ。これが足そうとしているメタデータが
// 欠けるより、はるかに悪い結末になる。呼び出しはここ（readDomMeta）で一度だけ包んで
// あるので、サイト側のモジュールが覚えておく必要はない。

import type { ContentSite, DomMeta, PostRecord } from './types.ts';
import { AnnouncedMediaSchema } from '../../../native-host/protocol.mts';
import { acquisitionFailed } from './record.ts';

// 画面側の値で埋めてよいレコードの欄。これ以外は埋めない。「DomMeta のキー全部」に
// せず明示で並べるのは、形に欄を足すことが両側で意図した行為になるようにするため。
// url / platform / raw は変更しない。画像は投稿IDと配信元を検証した snapshot から別途補完する。
//
// 1つの配列にまとめず値の型で分けてあるのは、下の健全性検査も合流もキャストなしで
// 書けるようにするため。`string | number` の合併型を DomMeta へ代入すると、各欄の型の
// 共通部分まで絞られる＝つまり何も入らなくなる。
const DOM_FILLABLE_TEXT = ['text', 'displayName', 'screenName', 'date'] as const;
const DOM_FILLABLE_COUNT = ['likes', 'reposts', 'replies', 'bookmarks', 'views'] as const;
const DOM_FILLABLE: readonly string[] = [...DOM_FILLABLE_TEXT, ...DOM_FILLABLE_COUNT];

type DomFillableField = (typeof DOM_FILLABLE_TEXT)[number] | (typeof DOM_FILLABLE_COUNT)[number];

// 上のうち、欠けていると利用者が実際に気づくもの。投稿者と本文が空の部分保存は壊れた
// レコードに見えるが、リポスト数だけが無いものは普通の投稿に見える。使い道はバナーの
// 文言だけ（domRescuedEssentials を参照）で、何を埋めるかには一切関わらない。
const DOM_ESSENTIAL_FIELDS: readonly DomFillableField[] = ['text', 'displayName'];

// X（および数を省略表記で描く他のサイト）が出す略記に掛ける倍率。両方の語彙が要るのは、
// ページがこちらではなく UI の言語に従うから＝英語の UI は `1.2K`、日本語の UI は
// `1.2万` と出す。
//
// 結果が概数になるのは作りからしてそうで、これは欠陥ではなく仕様。`1.2万` は12000から
// 12999までのどの値でもありうるし、正確な値をページは持っていない。ライブラリがこれを
// 使う先＝エンゲージメントのファセットの以上／以下の絞り込みと並べ替えは、それで
// 損なわれない。正確な値は、API が答えたときにその API が寄こすものが入る。
const COUNT_SUFFIXES: ReadonlyArray<readonly [string, number]> = [
  ['k', 1e3],
  ['m', 1e6],
  ['b', 1e9],
  ['万', 1e4],
  ['億', 1e8],
  ['兆', 1e12],
];

// 全角数字と全角のピリオド。日本語の X の UI は数を ASCII で描くが、ページがそうしない
// のも自由だし、畳んでおく代償は replace 1回で済む。
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９．]/g, (c) => (c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
}

// 描かれた数1つを数値にする。テキストが数をまったく持たなければ null。
//
// 文字列全体を走査せず、先頭の数とそのすぐ後ろの接尾辞だけを読むのは意図してのこと。
// aria-label は UI の言語で書かれた文（`1,234 Likes. Like` / `いいね 1,234 件`）で、
// 走査すればその中のどこからでも平気で数を拾ってしまう。呼ぶ側は「それ自体が数である
// はず」の最小のテキストを渡す。数で始まらない文は、推し量らずに null と答える。
function parseCount(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  // 区切り記号と空白（X が使う非改行スペースも含む）。どれも数字と接尾辞の間に挟まる
  // 雑音でしかない。
  const s = toHalfWidthDigits(raw)
    .replace(/[\s ,、，]/g, '')
    .toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)(.?)/);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = m[2] || '';
  const mult = COUNT_SUFFIXES.find(([sfx]) => sfx === suffix)?.[1] ?? 1;
  return Math.round(n * mult);
}

// 記録する価値のある画面側の文字列、または null。空文字も空白だけのものも null にする。
// 本文がそもそも DOM に無い年齢制限付きの投稿では、`text` に "" を書くのではなく手を
// 触れずに残さなければならない。本文が空のレコードは、本文だけの投稿でその本文を
// 取り落としたものと見分けが付かなくなるから。
function cleanText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return s ? s : null;
}

// この投稿についてページが何を出しているかを capture site に尋ねる。その答えの失敗が
// 保存の失敗になることは決してない。サイトが規則を持たないとき（#202 の段2までは X 以外
// のすべて）、その規則が理解できる要素でないとき、読んで例外が飛んだときは null を返す。
function readDomMeta(site: ContentSite | null | undefined, post: Element | null | undefined): DomMeta | null {
  if (!site?.extractDomMeta || !post) return null;
  try {
    const meta = site.extractDomMeta(post);
    if (!meta || typeof meta !== 'object') return null;
    // 掃除し直すのは必ず境界のこちら側。サイトのモジュールはセレクタが出したものを
    // そのまま返してよく、以下の処理はどれも「値は使えるか、無いかのどちらか」を
    // 前提にしている。負の数や有限でない数は保存せずに落とす。エンゲージメントの数が
    // そうなることはありえないので、そういう値は解析を間違えたという意味であって、
    // その投稿のいいねが -1という意味ではない。
    const out: DomMeta = {};
    if (meta.snapshot) out.snapshot = meta.snapshot;
    for (const field of DOM_FILLABLE_TEXT) {
      const s = cleanText(meta[field]);
      if (s !== null) out[field] = s;
    }
    for (const field of DOM_FILLABLE_COUNT) {
      const n = meta[field];
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[field] = n;
    }
    return out;
  } catch {
    return null;
  }
}

// レコードの空いている欄だけを、ページが出していたもので埋め、埋めた欄の名前を返す。
// レコードはその場で書き換える（1行前に fetchPostMetadata が組み立てた、この保存自身の
// 作業用の写しだから）。返した一覧はレコードの `domFilled` に載る。
//
// 下の条件には2つ、崩してはいけない点がある:
//   - falsy ではなく `== null` で見る。本物の0（「まだいいねが無い」）は API が出した
//     答えであって、画面側の「0」でそれを置き換えても、良くて何も変わらず、悪ければ
//     古くなった値になる。
//   - 取得が成功したときにも同じことをする。X の埋め込み用エンドポイントはリポスト・
//     ブックマーク・表示回数を報告できない。「今回は返さなかった」のではなく、そもそも
//     その欄を持たない（x.ts の冒頭を参照）。だからこの3つはどの X のレコードでも
//     永久に null で、ページだけがその値の在り処になる。取得が失敗したときに限ると、
//     この3つは永久に空のままになる。
function mergeDomMeta(rec: PostRecord, dom: DomMeta | null | undefined): string[] {
  if (!rec || !dom) return [];
  // API が提供しない反応数だけを通常補完する。投稿本体の DOM 補完は、
  // 埋め込み対象外の応答に限る。通信・解析の失敗を補完で隠さない。
  if (rec.platform !== 'x') return [];
  const restricted = rec.metaError === 'protected' || rec.metaError === 'ageRestricted' || rec.metaError === 'embedUnavailable';
  if (rec.metaError && !restricted) return [];
  const postId = (url: string | null | undefined) => {
    try {
      const u = new URL(url || '');
      return u.protocol === 'https:' && ['x.com', 'twitter.com'].includes(u.hostname) ? u.pathname.match(/^\/[^/]+\/status\/(\d+)(?:\/|$)/)?.[1] : undefined;
    } catch {
      return undefined;
    }
  };
  // 再描画やページ遷移で別投稿の情報になっていた場合は、本文・反応数も混ぜない。
  if (dom.snapshot && (!postId(rec.url) || postId(rec.url) !== postId(dom.snapshot.url))) return [];
  const filled: string[] = [];
  for (const field of DOM_FILLABLE_TEXT) {
    if (!restricted) continue;
    const value = dom[field];
    if (value == null || rec[field] != null) continue; // API が答えた＝必ずそちらが勝つ
    rec[field] = value;
    filled.push(field);
  }
  for (const field of DOM_FILLABLE_COUNT) {
    if (!restricted && field !== 'reposts' && field !== 'bookmarks' && field !== 'views') continue;
    const value = dom[field];
    if (value == null || rec[field] != null) continue;
    rec[field] = value;
    filled.push(field);
  }
  if (restricted && dom.snapshot) {
    const id = postId(rec.url);
    if (id && id === postId(dom.snapshot.url)) {
      const media = AnnouncedMediaSchema.array().safeParse(dom.snapshot.media);
      const valid =
        media.success &&
        media.data.every((item) => {
          try {
            const u = new URL(item.url);
            return u.protocol === 'https:' && u.hostname === 'pbs.twimg.com' && u.pathname.startsWith('/media/') && item.type === 'image';
          } catch {
            return false;
          }
        });
      if (valid && media.success && !rec.media.length) {
        rec.media = media.data;
        if (rec.media.length) {
          rec.mediaType = 'image';
          filled.push('media');
        }
      }
      if (!valid || !dom.snapshot.mediaComplete) acquisitionFailed(rec, 'media', 'unavailable');
      if (valid && dom.snapshot.complete === true && dom.snapshot.mediaComplete === true && dom.screenName && (rec.text || rec.media.length)) filled.push('post');
    }
  }
  return filled;
}

// 人が欠けていると気づく類のものを、ページが救えたか。決めるのは部分保存のバナーの
// 文言だけ（#202 で確定した設計＝metaOk の意味は変えず、保存は琥珀色のまま、文だけが
// 変わる）。何かが保存されるかどうかには一切関わらない。
//
// 両方ではなく、要となる欄が1つ埋まれば十分とする。「両方」にすると、これがいちばん
// 効く投稿でこそ黙ってしまうから＝キャプションの無い画像投稿には救うべき本文が無く、
// その投稿者名がページから届くかどうかが、使えるレコードと空のレコードの分かれ目に
// なる。
function domRescuedEssentials(domFilled: readonly string[] | null | undefined): boolean {
  if (!Array.isArray(domFilled)) return false;
  return DOM_ESSENTIAL_FIELDS.some((f) => domFilled.includes(f));
}

export { DOM_ESSENTIAL_FIELDS, DOM_FILLABLE, DOM_FILLABLE_COUNT, DOM_FILLABLE_TEXT, cleanText, domRescuedEssentials, mergeDomMeta, parseCount, readDomMeta };
export type { DomFillableField };
