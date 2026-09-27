// 対応サイト外の画像保存に付けるページ文脈の抽出 (#239)。サイト固有の extractor が
// 対象にしないページで、title/description/author/published/siteName/canonical を読む。
// 旧 URL ブックマークの OGP 抽出を起点にした実装だが、現在は画像を持たないページ自体を保存しない。
// 連鎖は schema.org（JSON-LD/microdata/RDFa）、Dublin Core、Highwire も読む。
//
// 設計の記録。#239 の 2026-08-03「設計クローズ」コメントが確定した設計（その Issue の
// それ以前のコメントは、まだ生きているとそこで名指しされたものを除きすべて置き換わる）。
// 下の連鎖、ノードの選び方、日付の検証、canonical のオリジン検査は、いずれもそこから来て
// いる。「なぜ」はそのコメントを参照＝ここで欄ごとに繰り返さない。
//
// 分け方は、かつての extractOgp/buildBookmarkMeta と同じ:
//   chooseWebMeta() — 純関数。第三者のパーサー自身の出力（@marbec/web-auto-extractor の
//     WaeParsed）と、DOM から取った少しの文脈の値を受け取り、欄ごとにどの値が勝つかを
//     決める。このモジュールはパーサー自体を import せず、型としてその出力の形だけを
//     受け取る。おかげで extension/utils/extractor/web-meta.test.ts（リポジトリ直下の一式。extension/ は
//     直下の npm ワークスペースではないので、直下の一式は extension/ 自身の node_modules
//     を解決できない）が、手書きの WaeParsed のフィクスチャで、そちらにパッケージが
//     入っているかどうかに一切依存せず単体テストできる。これとは別に、
//     tests/integration/read-meta-bundle.extension-bundle.test.ts が、実際にビルドした入口のバンドル（こちらには
//     本物のパーサーが入っている）を jsdom で読み込み、本物のパーサーの出力を
//     端から端まで動かす。
//   buildWebMeta() — 組み立ての段。WebMetaResult を、buildRecord()（background.ts）が
//     保存へ変える術をすでに知っている PostRecord の形にする。かつての buildBookmarkMeta の
//     役目をそのまま写したもの。
//
// どちらの関数も chrome.* にも DOM にも触らない。触るのは入口の側
// （extension/entrypoints/read-meta.ts）で、注入まわりの気掛かりはそのファイルが持つ
// (#759: `func:` ではなく必ず `files:` の未登録スクリプトとして動く。このモジュールの
// 第三者依存をバンドルすることこそ、`func:` の直列化が注入の境界を越えて運べないものだ
// から)。
//
// ページの著者は画像の投稿者とは限らないため、汎用保存では投稿者の識別情報へ転用しない。
// buildUsers() は userId または screenName を持つレコードだけを投稿者として集計する。

import type { WaeBucket, WaeNode, WaeParsed } from '@marbec/web-auto-extractor';
import { acquisitionFailed, emptyRecord } from './record.ts';
import type { PostRecord } from './types.ts';
import type { AnnouncedMedia } from '../../../native-host/protocol.mts';

// その欄の値がどこから来たか。レコードには `metaSource` として保存する（設計コメント7）。
// 'meta' は、独自の形式を持たない素の `<meta name="...">`（今は author だけ）。
// 'ogp'/'dc'/'highwire' は、それぞれの形式が使う property 形（og:*、article:*）と name 形
// （DC.*、citation_*）の meta タグの両方を指す。'title'/'host' は最後の頼みの HTML への
// 退避。'canonical'/'tab' は `url` にだけ付く。
type WebMetaSourceKind = 'jsonld' | 'microdata' | 'rdfa' | 'ogp' | 'dc' | 'highwire' | 'meta' | 'title' | 'host' | 'canonical' | 'tab';

interface WebMetaAuthor {
  name: string;
  // scheme+host+path に正規化する（クエリとフラグメントは落とす）＝buildWebMeta が
  // PostRecord.userId へ写すのと同じ web 上の素性。投稿者が裸の名前だけで、連鎖のどこにも
  // schema.org の url/@id が無ければ null。
  url: string | null;
}

interface WebMetaResult {
  acquisitionError?: 'fetchFailed' | 'invalidResponse';
  title: string | null;
  description: string | null;
  author: WebMetaAuthor | null;
  published: string | null;
  siteName: string | null;
  // og:image だけを、絶対 URL に直して入れる。#195 の extractOgp から変えていない。この
  // 設計で schema.org に画像の連鎖は無い（ImageObject のノードは他の欄のためのノード候補
  // であって、画像の別の出所ではない）。
  image: string | null;
  url: string | null;
  // 欄の名前（PostRecord ではなくこの interface 自身のキー）→ 出所。値が実際に入った欄の
  // エントリしか持たない。
  metaSource: Partial<Record<'title' | 'description' | 'author' | 'published' | 'siteName' | 'url', WebMetaSourceKind>>;
}

interface WebMetaContext {
  // そのタブの今の location.href。schema.org のノード自身の url/mainEntityOfPage を、
  // 「このノードはこのページを説明しているか」の検査で突き合わせる相手。同じオリジンの
  // canonical が無いときは、レコード自身の `url` の最後の頼みでもある。
  pageUrl: string;
  // <link rel="canonical"> の href。すでに絶対 URL へ解決済み。無ければ null。
  canonicalHref: string | null;
  // document.baseURI。ほとんどの場合 pageUrl と等しいが、<base href> タグを持つページでは
  // 違いうる。実際のブラウザで相対の og:image/author の URL が解決される先はこちら。
  baseURI: string;
}

// この設計が「そのページ自身の中身」として扱う schema.org の型名。確度の高い順（設計
// コメント4のノード選択の規則）。形式ごとに試す（jsonld/microdata/rdfa がそれぞれ独立に
// 自分のノードを選ぶ。selectSchemaNode を参照）ので、ある形式のノードに無い欄でも、
// OGP/DC/Highwire へ落ちる前に別の形式のノードが答えられる（2026-08-02 の設計コメントが
// 見つけた YouTube の例＝JSON-LD の VideoObject には author が無く、microdata の方には
// ある）。
const ARTICLE_TYPES = ['Article', 'NewsArticle', 'BlogPosting', 'ScholarlyArticle', 'TechArticle', 'SocialMediaPosting', 'DiscussionForumPosting'];
const TYPE_PRIORITY = [...ARTICLE_TYPES, 'CreativeWork', 'VideoObject', 'ImageObject'];

// `datePublished`/`uploadDate` は、ISO 8601 / RFC 3339 として読み返せて、かつ YYYY-MM-DD
// で始まらなければならない（設計コメント6）。`July 3, 2025` のような自由記述の日付を、
// 推し量って誤った ISO の値にすることはない。この段では単に受け付けないだけ（下の連鎖は
// 残りの段を引き続き試す）。
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function validIsoDate(s: string | null): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!ISO_DATE_RE.test(trimmed)) return null;
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function absolutize(u: string | null, base: string): string | null {
  if (!u) return null;
  try {
    return new URL(u, base).href;
  } catch {
    return null;
  }
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function hostnameOf(u: string): string | null {
  try {
    return new URL(u).hostname || null;
  } catch {
    return null;
  }
}

// scheme+host+path だけ＝設計が PostRecord.userId に与えているのと同じ正規化（クエリと
// フラグメントは素性を持たず、追跡の雑音とページ内の錨でしかない）。
function normalizeIdentityUrl(raw: string | null, base: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, base);
    return u.origin + u.pathname;
  } catch {
    return null;
  }
}

// `<meta name>`/`<meta property>` の名前1つ → その最初の空でない値。突き合わせは必ず大小
// 文字を無視する。ライブラリは metatags を、ページ自身の属性の綴りそのままをキーにして
// 返す（2026-08-03 に公開パッケージで確認＝`DC.creator`、`Dc.Creator`、`dc.creator` は
// どれもページが書いたその綴りで読み返る）し、実在のページは Dublin Core / Highwire の
// タグを不統一に綴る。引くたびに metatags のキーを走査するのではなく、解析1回につき1度
// だけ組み立てる（chooseWebMeta）。
function lowerMetaMap(metatags: Record<string, string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, values] of Object.entries(metatags || {})) {
    const v = values?.[0];
    const lower = key.toLowerCase();
    if (typeof v === 'string' && v.trim() && !(lower in out)) out[lower] = v.trim();
  }
  return out;
}

function metaLookup(map: Record<string, string>, names: string[]): string | null {
  for (const name of names) {
    const v = map[name.toLowerCase()];
    if (v) return v;
  }
  return null;
}

// schema.org のノード自身の `url`/`mainEntityOfPage` の値。形式が返した形がどちらでも
// 取れる＝素の文字列か、`@id`/`url` を持つオブジェクト（mainEntityOfPage は
// `{"@type":"WebPage","@id":"..."}` の形であることが多い）。
function urlishOf(v: unknown): string | null {
  if (typeof v === 'string') return v || null;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o['@id'] === 'string') return o['@id'];
    if (typeof o.url === 'string') return o.url;
  }
  return null;
}

function resolvedLocation(raw: string | null, base: string): { origin: string; pathname: string } | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, base);
    return { origin: u.origin, pathname: u.pathname };
  } catch {
    return null;
  }
}

// この設計が Readability 自身の連鎖の上に足す唯一の規則（設計コメント5）。別のページを
// はっきり名指ししているノードは退ける。一覧ページは Article のノードを予告1件につき1つ、
// いくつも持つのが普通で、構わず先頭を選べば、#202 が他所ですでに防いでいる
// 「唯一の実害ある壊れ方」（別の投稿・記事から取って埋めてしまう）になる。url も
// mainEntityOfPage も持たないノードは、どちらの主張もしていないので、それだけを理由に
// 退けることはない。1件だけを載せるページの JSON-LD は、たいてい両方の欄を丸ごと省く
// （2026-08-02 の設計コメントが見つけた YouTube の VideoObject のフィクスチャがその一例）。
function nodeMismatchesPage(node: WaeNode, ctx: WebMetaContext): boolean {
  const claims = [urlishOf(node.url), urlishOf(node.mainEntityOfPage)].filter((v): v is string => !!v);
  if (!claims.length) return false;
  const page = resolvedLocation(ctx.pageUrl, ctx.pageUrl);
  if (!page) return false; // ページ自身を解決できないときは通す＝「主張なし」と同じ扱い
  return !claims.some((c) => {
    const loc = resolvedLocation(c, ctx.baseURI);
    return !!loc && loc.origin === page.origin && loc.pathname === page.pathname;
  });
}

// 形式ごとに1ノード。TYPE_PRIORITY の順に試し、nodeMismatchesPage に引っかかるノードは
// 飛ばす。その形式に使えるものが何も無ければ null（たいていのページは microdata も RDFa も
// 持たない）。
function selectSchemaNode(bucket: WaeBucket | undefined, ctx: WebMetaContext): WaeNode | null {
  if (!bucket) return null;
  for (const type of TYPE_PRIORITY) {
    const nodes = bucket[type];
    if (!nodes || !nodes.length) continue;
    const hit = nodes.find((n) => !nodeMismatchesPage(n, ctx));
    if (hit) return hit;
  }
  return null;
}

// itemprop の繰り返しと、JSON-LD 自身の配列値のプロパティ（著者が複数など）は、どちらも
// 素の配列としてここへ来る。下のどの欄も読むのは先頭のエントリ。設計コメント4の
// 「著者が配列のときは先頭の1名だけ」に従う（`A, B` と繋げれば、でっち上げの投稿者1人と
// して読まれてしまう）。
function firstOf(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

function schemaText(node: WaeNode | null, keys: string[]): string | null {
  if (!node) return null;
  for (const key of keys) {
    const v = firstOf(node[key]);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function schemaAuthor(node: WaeNode | null, ctx: WebMetaContext): WebMetaAuthor | null {
  if (!node) return null;
  const raw = firstOf(node.author) ?? firstOf(node.creator);
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const name = raw.trim();
    return name ? { name, url: null } : null;
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const name = schemaText({ name: o.name } as WaeNode, ['name']);
    if (!name) return null;
    const rawUrl = typeof o.url === 'string' ? o.url : typeof o['@id'] === 'string' ? (o['@id'] as string) : null;
    return { name, url: normalizeIdentityUrl(rawUrl, ctx.baseURI) };
  }
  return null;
}

function schemaDate(node: WaeNode | null): string | null {
  if (!node) return null;
  return validIsoDate(schemaText(node, ['datePublished'])) || validIsoDate(schemaText(node, ['uploadDate']));
}

function schemaSiteName(node: WaeNode | null): string | null {
  if (!node) return null;
  const p = firstOf(node.publisher);
  if (typeof p === 'string') return p.trim() || null;
  if (p && typeof p === 'object' && !Array.isArray(p)) return schemaText(p as WaeNode, ['name']);
  return null;
}

// 判断だけをする純関数。このページについての第三者のパーサー自身の出力（手を加えず、解釈も
// していないもの）と、DOM から取った少しの文脈の値を受け取り、欄ごとに値を1つ選び、それが
// どこから来たかを言う。chrome.* も Document も使わない。この分け方がテストと注入の境界に
// とってなぜ効くかは、このファイルの冒頭を参照。
function chooseWebMeta(parsed: WaeParsed, ctx: WebMetaContext): WebMetaResult {
  // schema.org の形式ごとに1ノードを、それぞれ独立に選ぶ。形式をまたいで1つを共有するので
  // はない。JSON-LD のノードに無い欄も、schema.org から完全に落ちる前に microdata/RDFa の
  // ノードで拾える機会がある（2026-08-02 の設計コメントの YouTube 修正）。
  const schemaNodes: Array<[WaeNode | null, WebMetaSourceKind]> = [
    [selectSchemaNode(parsed.jsonld, ctx), 'jsonld'],
    [selectSchemaNode(parsed.microdata, ctx), 'microdata'],
    [selectSchemaNode(parsed.rdfa, ctx), 'rdfa'],
  ];
  const meta = lowerMetaMap(parsed.metatags);
  const metaSource: WebMetaResult['metaSource'] = {};

  let title: string | null = null;
  for (const [node, src] of schemaNodes) {
    title = schemaText(node, ['headline', 'name']);
    if (title) {
      metaSource.title = src;
      break;
    }
  }
  if (!title) {
    title = metaLookup(meta, ['og:title']);
    if (title) metaSource.title = 'ogp';
  }
  if (!title) {
    title = metaLookup(meta, ['dc.title', 'dcterms.title']);
    if (title) metaSource.title = 'dc';
  }
  if (!title) {
    // ライブラリは <title> タグ自身のテキストをこのキーで拾う。
    title = metaLookup(meta, ['title']);
    if (title) metaSource.title = 'title';
  }

  let description: string | null = null;
  for (const [node, src] of schemaNodes) {
    description = schemaText(node, ['description']);
    if (description) {
      metaSource.description = src;
      break;
    }
  }
  if (!description) {
    description = metaLookup(meta, ['og:description']);
    if (description) metaSource.description = 'ogp';
  }
  if (!description) {
    description = metaLookup(meta, ['dc.description']);
    if (description) metaSource.description = 'dc';
  }

  let author: WebMetaAuthor | null = null;
  for (const [node, src] of schemaNodes) {
    author = schemaAuthor(node, ctx);
    if (author) {
      metaSource.author = src;
      break;
    }
  }
  if (!author) {
    const name = metaLookup(meta, ['author']);
    if (name) {
      author = { name, url: null };
      metaSource.author = 'meta';
    }
  }
  if (!author) {
    const name = metaLookup(meta, ['dc.creator', 'dcterms.creator']);
    if (name) {
      author = { name, url: null };
      metaSource.author = 'dc';
    }
  }
  if (!author) {
    const name = metaLookup(meta, ['citation_author']);
    if (name) {
      author = { name, url: null };
      metaSource.author = 'highwire';
    }
  }
  if (!author) {
    // #202 と同じ型の防ぎであり、この連鎖の最後の段（設計コメント5）。値が URL の
    // article:author は Facebook のプロフィールへのリンクであって名前ではない。ここでは
    // 一切受け付けないし、この下に落ちる先も無い。
    const raw = metaLookup(meta, ['article:author']);
    if (raw && !looksLikeUrl(raw)) {
      author = { name: raw, url: null };
      metaSource.author = 'ogp';
    }
  }

  let published: string | null = null;
  for (const [node, src] of schemaNodes) {
    published = schemaDate(node);
    if (published) {
      metaSource.published = src;
      break;
    }
  }
  if (!published) {
    published = validIsoDate(metaLookup(meta, ['article:published_time']));
    if (published) metaSource.published = 'ogp';
  }
  if (!published) {
    published = validIsoDate(metaLookup(meta, ['citation_date', 'citation_publication_date']));
    if (published) metaSource.published = 'highwire';
  }
  if (!published) {
    published = validIsoDate(metaLookup(meta, ['dc.date']));
    if (published) metaSource.published = 'dc';
  }

  let siteName: string | null = null;
  for (const [node, src] of schemaNodes) {
    siteName = schemaSiteName(node);
    if (siteName) {
      metaSource.siteName = src;
      break;
    }
  }
  if (!siteName) {
    siteName = metaLookup(meta, ['og:site_name']);
    if (siteName) metaSource.siteName = 'ogp';
  }
  if (!siteName) {
    siteName = hostnameOf(ctx.pageUrl);
    if (siteName) metaSource.siteName = 'host';
  }

  const image = absolutize(metaLookup(meta, ['og:image']), ctx.baseURI);

  // 設計コメント5。canonical が勝つのは、それがタブ自身のオリジンに留まっているときだけ。
  // ブックマークのカードはこの欄が言う先を開くし、ページはどんな canonical/og:url でも
  // 自由に書ける。だからオリジンの外を指すものは、この保存自身の permalink を名指しして
  // いないものとして扱う。
  let url: string;
  if (ctx.canonicalHref && sameOrigin(ctx.canonicalHref, ctx.pageUrl)) {
    url = ctx.canonicalHref;
    metaSource.url = 'canonical';
  } else {
    url = ctx.pageUrl;
    metaSource.url = 'tab';
  }

  return { title, description, author, published, siteName, image, url, metaSource };
}

// chooseWebMeta() が読んだものを、buildRecord()（background.ts）が保存できる PostRecord の形へ
// 組み立てる。platform は null のままにする。サイドバーのサイトのファセットは、サイト固有の
// プラットフォームを持たないレコードに、解決できるドメインごとの行を与える (#253)。
function buildWebMeta(meta: WebMetaResult, tabUrl: string): PostRecord {
  const url = meta.url || tabUrl;
  const rec = emptyRecord(url, null);
  if (meta.acquisitionError) acquisitionFailed(rec, 'post', meta.acquisitionError);
  rec.title = meta.title || url;
  rec.text = meta.description || null;
  rec.date = meta.published || null;
  // 出典サイトの表示は残すが、ページの著者を画像の投稿者として登録しない。
  rec.displayName = meta.siteName || hostnameOf(url) || url;
  rec.userId = null;
  rec.screenName = null;
  const metaSource = { ...meta.metaSource };
  delete metaSource.author;
  if (Object.keys(metaSource).length) rec.metaSource = metaSource;
  if (meta.image) {
    rec.mediaType = 'image';
    rec.media = [{ url: meta.image, alt: null, width: null, height: null } as AnnouncedMedia];
  }
  return rec;
}

export { buildWebMeta, chooseWebMeta };
export type { WebMetaAuthor, WebMetaContext, WebMetaResult, WebMetaSourceKind };
