'use strict';
// 一回限りの移行用ハーネス（#207 自身の設計コメント: 「移行時一回きり・環境
// 変数ゲート」）: この書き直したエンジンの出力 URL が、同じ乱数生成クエリに
// 対して「凍結された」dialect リポジトリの出力 URL と一致するかを、採用済みの
// 5プラットフォームにわたって検証する。あえて vitest のスイートにしていない
// （dialect 自身の scripts/check-props.ts もテストファイルではなくただの
// スクリプト）— これはリポジトリの「外」、CI にも新規クローンにも決して
// 存在しない隣の checkout へ手を伸ばすので、`npm test` のグロブの一部には
// なり得ない。
//
// ゲート: DIALECT_REPO が apricot-cake/dialect のローカル checkout を指している
// 時だけ実行する（あのリポジトリは凍結・未公開＝MIT ライセンスだが npm には
// 無いので、代わりにインストールできるパッケージが存在しない）。無ければ
// →理由を表示して exit 0（隣のリポジトリを単に checkout していないだけの
// ビルドを、決して失敗させない）。セットアップの仕方は docs/開発.md か、
// このハーネスが属す Issue（#822）を参照。
//
// dialect 自身のパッケージ（packages/core）は、.ts のソースを指す .js
// 拡張子付きの import 指定子を持つ ESM TypeScript（バンドラ/tsx の慣習）—
// 素の `node` はビルド手順無しにそれを解決できないので、このハーネスは
// dialect のソースツリーではなく、コンパイル済みの dist/index.js（DIALECT_REPO
// の中で `npm run build -w @apricot-cake/dialect-core` を実行してビルド）を
// 要求する。ビルドには dialect 自身の devDependencies（DIALECT_REPO の中で
// `npm install`）も必要。
const path = require('node:path');

const DIALECT_REPO = process.env.DIALECT_REPO;

if (!DIALECT_REPO) {
  console.log('[websearch-equivalence] DIALECT_REPO が未設定 - スキップする（何を検証するはずだったかはこのファイルのヘッダーを参照）。');
  process.exit(0);
}

let dialect: any;
try {
  const distIndex = path.join(DIALECT_REPO, 'packages', 'core', 'dist', 'index.js');
  dialect = require(distIndex);
  if (typeof dialect.resolve !== 'function' || !Array.isArray(dialect.PLATFORMS)) {
    throw new Error('dist/index.js は読み込めたが resolve()/PLATFORMS をエクスポートしていない - dialect の公開 API が形を変えたかもしれない。');
  }
} catch (err) {
  console.error('[websearch-equivalence] DIALECT_REPO からビルド済みの dialect パッケージを読み込めなかった。');
  console.error('先に DIALECT_REPO の中で実行すること: npm install && npm run build -w @apricot-cake/dialect-core');
  console.error(err);
  process.exit(1);
}

const holo = {
  x: require('../app/src/renderer/src/websearch/platforms/x.ts').xPlatform,
  bluesky: require('../app/src/renderer/src/websearch/platforms/bluesky.ts').blueskyPlatform,
  misskey: require('../app/src/renderer/src/websearch/platforms/misskey.ts').misskeyPlatform,
  mastodon: require('../app/src/renderer/src/websearch/platforms/mastodon.ts').mastodonPlatform,
  pixiv: require('../app/src/renderer/src/websearch/platforms/pixiv.ts').pixivPlatform,
};
const holoText = require('../app/src/renderer/src/websearch/text.ts');

const fc = require('fast-check');

const PLATFORM_IDS = Object.keys(holo);
const CTX = { instanceHost: 'example.test' };

function dialectPlatform(id: string) {
  const p = dialect.PLATFORMS.find((x: any) => x.id === id);
  if (!p) throw new Error(`dialect に "${id}" の PLATFORMS エントリが無い - dialect がこのプラットフォームを落とした/改名したのでは`);
  return p;
}

// ここでは空白があっても構わない - Hologram 自身の `terms` フィールドは dialect
// 自身の `terms` 配列に1対1で対応する（どちらの側も terms[] の1エントリを
// 空白で分割することは無い - trim はするが分割はしない dialect の text.ts の
// andTerms を参照）。
const meanFreeString = fc.oneof(fc.constant(''), fc.constant('a"b'), fc.constant('a&b=c'), fc.constant('猫の絵'), fc.constant('(a OR b)'), fc.constant('  spaced words  '), fc.string({ maxLength: 16 }));

// 空白なし: 他のすべてのフィールドは、Hologram の配列を dialect 側の空白結合の
// フラット文字列（hashtag/hashtagOr/excludeHashtag/exclude/keywordsOr/
// excludeUser）か単一のフラット文字列（fromUser）へ対応させる - 内部に空白を
// 含むエントリは、静かに dialect 側で複数の語へ再分割されてしまい、この
// ハーネスが公平な比較を組み立てるために頼っている配列⇔文字列の往復を壊す。
//
// また、クリーンにすると何も残らなくなる空でない文字列も除外する（例:
// "#" だけのハッシュタグエントリ、")" だけの fromUser）: dialect の
// words()+stripHash/stripAt のパイプラインは、空判定を「一度だけ」（要素ごとの
// hash/@/引用符/括弧の除去より前、結合済みの文字列全体に対して）行い、その後の
// 要素ごとの除去の後には二度と再判定しない。そのため「2段目の除去でだけ」
// 空になるエントリは、dialect 自身の出力に空のトークン/パラメータを残して
// しまう（例: 裸の "#" トークン、空の "&author="）。これは計測された設計判断
// というより実装順序の副産物に見える（dialect のコメントにはそれを論じたもの
// が無い）— 文字どおりの "#" ハッシュタグや ")" の作者名はどのみち現実的な
// 意味を持たず、Hologram のより厳格な振る舞い（クリーン後に空だと分かった
// 葉を丸ごと落とす）の方が2つのうちより擁護できるので、このハーネスはこの点で
// バイト単位の一致は追わない。
function reducesToNothingWhenCleaned(s: string): boolean {
  return s.length > 0 && holoText.stripAt(holoText.stripHash(s)) === '';
}
const meanTokenString = fc.oneof(fc.constant(''), fc.constant('a"b'), fc.constant('a&b=c'), fc.constant('猫の絵'), fc.constant('(a)'), fc.constant('#already-hash'), fc.constant('@already-at'), fc.string({ maxLength: 16 })).filter((s: string) => !/[\s　]/.test(s) && !reducesToNothingWhenCleaned(s));

const arbSeed = fc.record({
  terms: fc.array(meanFreeString, { maxLength: 3 }),
  keywordsOr: fc.array(meanTokenString, { maxLength: 2 }),
  exclude: fc.array(meanTokenString, { maxLength: 2 }),
  hashtag: fc.array(meanTokenString, { maxLength: 3 }),
  hashtagOr: fc.array(meanTokenString, { maxLength: 2 }),
  excludeHashtag: fc.array(meanTokenString, { maxLength: 2 }),
  fromUser: fc.option(meanTokenString, { nil: null }),
  excludeUser: fc.array(meanTokenString, { maxLength: 2 }),
  since: fc.option(fc.constant('2026-01-01'), { nil: null }),
  until: fc.option(fc.constant('2026-06-30'), { nil: null }),
  mediaOnly: fc.boolean(),
  videoOnly: fc.boolean(),
  excludeReplies: fc.boolean(),
  repliesOnly: fc.boolean(),
  minLikes: fc.option(fc.integer({ min: 1, max: 200000 }), { nil: null }),
  minReposts: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: null }),
  minReplies: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: null }),
});

// Hologram にしか無い拡張で、照合すべき dialect 側の概念が無いもの（各
// プラットフォームモジュールのヘッダーコメントと Issue に記載済み）- 両側の
// 状態を組み立てる「前」にプラットフォームごとにゼロにするので、比較が
// 誠実なままになる: dialect もモデル化しているすべての概念が同一に変換される
// ことだけを検証し、拡張の方は Hologram 自身の単体/プロパティテストスイート
// （websearch-platforms.test.ts / websearch-props.test.ts）に任せる。
function seedForPlatform(seed: any, platformId: string) {
  const s = { ...seed };
  if (platformId === 'x') {
    // videoOnly/repliesOnly: dialect はどちらも Bluesky 限定にスコープしている。
    // hashtagOr: dialect はこれも Bluesky 限定にスコープしている（X 自身の
    // OR グループ対応は keywordsOr だけ）。excludeHashtag: dialect の X
    // モジュールにはこの概念も無い（フラットな exclude(-word) だけで、独立した
    // 「除外ハッシュタグ」演算子は無い）。
    s.videoOnly = false;
    s.repliesOnly = false;
    s.hashtagOr = [];
    s.excludeHashtag = [];
  } else if (platformId === 'mastodon') {
    // videoOnly: dialect には Mastodon 向けのこの概念が無い（mediaOnly だけ）。
    s.videoOnly = false;
  } else if (platformId === 'pixiv') {
    // fromUser: dialect の pixiv モジュールは fromUser の概念をそもそも一切
    // 読まない。excludeHashtag: dialect の pixiv モジュールはこれも読まない
    // （根底の演算子が同一なので、Hologram 側では代わりに exclude へ畳んで
    // ある）。minLikes: dialect には pixiv 向けの数値の「いいね」下限の概念が
    // 無い（UI で選ぶ pixivPopular セレクタだけがあり、Hologram はそれを
    // 一切公開していない）。
    s.fromUser = null;
    s.excludeHashtag = [];
    s.minLikes = null;
  }
  return s;
}

function toDialectState(seed: any, platformId: string) {
  const s = dialect.defaultState();
  s.terms = seed.terms;
  s.keywordsOr = seed.keywordsOr.join(' ');
  s.exclude = seed.exclude.join(' ');
  s.fromUser = seed.fromUser ?? '';
  s.excludeUser = seed.excludeUser.join(' ');
  s.hashtag = seed.hashtag.join(' ');
  s.hashtagOr = seed.hashtagOr.join(' ');
  s.excludeHashtag = seed.excludeHashtag.join(' ');
  s.since = seed.since ?? '';
  s.until = seed.until ?? '';
  s.mediaOnly = seed.mediaOnly;
  s.videoOnly = seed.videoOnly;
  s.excludeReplies = seed.excludeReplies;
  s.repliesOnly = seed.repliesOnly;
  s.minLikes = seed.minLikes != null ? String(seed.minLikes) : '';
  s.minReposts = seed.minReposts != null ? String(seed.minReposts) : '';
  s.minReplies = seed.minReplies != null ? String(seed.minReplies) : '';
  // X には利用者向けのソート概念が無く、常に新着順（f=live）を要求する - dialect
  // 自身のソートをそれに合わせておくことで、URL の残りが公平な比較になり、
  // この意図的で明記済みの1点の乖離（x.ts 自身のコメントを参照）で失敗しない
  // ようにする。
  if (platformId === 'x') s.sort = 'new';
  return s;
}

function toHoloState(seed: any) {
  return { ...seed };
}

// src=typed_query は Hologram が付ける無害な X の UI 起点マーカーで、dialect
// は付けない（x.ts のコメントを参照）- 比較する前に取り除く。上のソート強制の
// ほかに、もう1つの意図的で明記済みの乖離。
function normalizeHoloUrl(platformId: string, url: string | null): string | null {
  if (url == null) return null;
  if (platformId === 'x') return url.replace('&src=typed_query', '');
  return url;
}

let checked = 0;
let mismatches = 0;
const mismatchSamples: string[] = [];
const mismatchCountByPlatform: Record<string, number> = {};

for (const platformId of PLATFORM_IDS) {
  const dPlatform = dialectPlatform(platformId);
  const hPlatform = (holo as any)[platformId];
  fc.assert(
    fc.property(arbSeed, (rawSeed: unknown) => {
      checked++;
      const seed = seedForPlatform(rawSeed, platformId);
      const dialectUrl = dialect.resolve(dPlatform, toDialectState(seed, platformId), CTX)?.url ?? null;
      const holoUrl = normalizeHoloUrl(platformId, hPlatform.build(toHoloState(seed), CTX)?.url ?? null);
      if (dialectUrl !== holoUrl) {
        mismatches++;
        mismatchCountByPlatform[platformId] = (mismatchCountByPlatform[platformId] ?? 0) + 1;
        if (mismatchSamples.length < 40) {
          mismatchSamples.push(`[websearch-equivalence] MISMATCH platform=${platformId}\n  dialect: ${dialectUrl}\n  holo:    ${holoUrl}\n  seed:    ${JSON.stringify(seed)}`);
        }
      }
    }),
    { seed: 20260802, numRuns: 1000 },
  );
}

for (const line of mismatchSamples) console.error(line);
console.log(`[websearch-equivalence] プラットフォームごとの不一致: ${JSON.stringify(mismatchCountByPlatform)}`);
console.log(`[websearch-equivalence] ${PLATFORM_IDS.length}プラットフォームにわたって${checked}件を検証、不一致${mismatches}件。`);
process.exit(mismatches > 0 ? 1 : 0);
