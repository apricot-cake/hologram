// extractor（サイト別のメタデータ抽出モジュール）の登録簿＝どのサイトが在るかを知って
// いる唯一の場所 (#212)。
//
// サイトを増やす作業は、このファイルの隣にモジュールを1本足して EXTRACTORS に1行
// 加えるだけ。クリック保存の経路、ドラッグ／ホバー保存の経路、タイムラインの
// オーバーレイ、メタデータの取得、サービスワーカーの送信元検査、manifest の match
// パターンは、どれもプラットフォームごとの分岐を自前で抱えず、下の一覧を読む。
// gallery-dl や yt-dlp の extractor ディレクトリ、Zotero の translators と同じ形＝
// 1サイト1モジュール、共通の契約1つ、登録簿1つ。
//
// このディレクトリ内の相対 import には必ず .ts 拡張子を付ける。Node 自身の型剥がしが
// これらのファイルをビルドせずに走らせるうえ（スキーマのカナリアと保存用 CLI のため
// に scripts/*.cts がこのモジュールを直接 require する）、バンドラーと違って拡張子
// なしの解決を一切しないため。

import { METADATA_TIMEOUT_MS, withDeadline } from '../deadline.ts';
import bluesky from './bluesky.ts';
import { mediaSrcs } from './dom.ts';
import misskey from './misskey.ts';
import pixiv from './pixiv.ts';
import { emptyRecord } from './record.ts';
import type { CaptureSite, Extractor, MediaIdentitySite, OverlaySite, ParsedPost, ParsedProfile, PostMediaElement, PostRecord } from './types.ts';
import x from './x.ts';

// この並び順には意味がある＝崩してはいけない。ホストが固定のサイトを先に置く。
// Misskey はインスタンスごとにホストが立つので、URL のパターンもページの
// 嗅ぎ分けもホストを選ばず受け入れる。先に置くと、他のサイトのページにまで答えて
// しまう。
const EXTRACTORS: readonly Extractor[] = [x, bluesky, pixiv, misskey];

function extractorFor(platform: string | null | undefined): Extractor | null {
  if (!platform) return null;
  return EXTRACTORS.find((e) => e.platform === platform) || null;
}

// === URL 相 ===

function parsePostUrl(url): ParsedPost | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  for (const extractor of EXTRACTORS) {
    const parsed = extractor.parseUrl(u);
    if (parsed) return parsed;
  }
  return null;
}

function parseProfileUrl(url, platform?: string | null): ParsedProfile | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const candidates = platform ? EXTRACTORS.filter((extractor) => extractor.platform === platform) : EXTRACTORS;
  for (const extractor of candidates) {
    const parsed = extractor.parseProfileUrl?.(u);
    if (parsed) return parsed;
  }
  return null;
}

function getHostname(url): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// `tabUrl` に居るタブは、`platform` の保存をサービスワーカーへ頼んでよいか。コンテンツ
// スクリプトは manifest が許した場所でしか動かないが、メッセージはページが手を伸ばせる
// どこからでも来る＝だからここでオリジンを検査し直す。
function isAllowedSender(tabUrl, platform): boolean {
  const hostname = getHostname(tabUrl);
  if (!hostname) return false;
  const extractor = extractorFor(platform);
  return extractor ? extractor.isAllowedOrigin(tabUrl || '', hostname) : false;
}

// === API 相 ===

async function fetchPostMetadata(url, opts): Promise<PostRecord> {
  const parsed = parsePostUrl(url);
  if (!parsed) return emptyRecord(url, null);
  const extractor = extractorFor(parsed.platform);
  if (!extractor) return emptyRecord(url, parsed.platform);
  // SSRF とオリジンの取り違えに対する防ぎ。投稿 URL から API のホストを導く extractor
  // （Misskey のインスタンスは任意のホストに立つ）では、敵対的なページが
  // 選んだ postUrl のホストによって、こちらの特権付きバックグラウンド fetch が攻撃者
  // の名指ししたホストへ向いてしまう。呼び出し元が送信元タブのホストを知っているとき
  // は、両者の一致を必須にする。コンテンツスクリプトが抽出するのは同じインスタンスの
  // permalink だけなので、これで正当なものが弾かれることはない。ホストが固定のサイト
  // は導出ホストを宣言しないので、影響を受けない。
  const expectedHost = opts && opts.expectedHost;
  if (expectedHost && extractor.derivedApiHost && extractor.derivedApiHost(parsed) !== expectedHost) {
    return emptyRecord(url, parsed.platform);
  }
  // 上限を切る (#507)。どの extractor もネットワーク越しにプラットフォームの API へ
  // 手を伸ばす。答えも失敗も返さない要求が1つあると、保存が終わらなくなる。上限は
  // 個々の要求ではなくこの工程全体にかかる＝utils/deadline.ts を参照。
  return withDeadline(extractor.fetchPost(parsed, url), METADATA_TIMEOUT_MS, 'metadata fetch');
}

async function fetchProfileMetadata(url, opts): Promise<PostRecord> {
  const parsed = parseProfileUrl(url, opts?.platform);
  if (!parsed) return emptyRecord(url, null);
  const extractor = extractorFor(parsed.platform);
  if (!extractor?.fetchProfile) return emptyRecord(parsed.url, parsed.platform);
  const expectedHost = opts && opts.expectedHost;
  if (expectedHost && extractor.derivedApiHost && extractor.derivedApiHost(parsed) !== expectedHost) {
    return emptyRecord(parsed.url, parsed.platform);
  }
  return withDeadline(extractor.fetchProfile(parsed, parsed.url), METADATA_TIMEOUT_MS, 'profile metadata fetch');
}

// === メディアの URL ===

function mediaKeyOf(platform: string, url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url) return null;
  return extractorFor(platform)?.mediaKey(url) ?? null;
}

// 1枚の絵についてページが差し出す素性のすべて。<img> は利用者が見ている最中にも綴りを
// 入れ替えられるのが日常（src、currentSrc、srcset のエントリ）なので、全部を集めて、
// どれか1つでも一致すれば一致とみなす。
function mediaKeysOf(el: PostMediaElement, platform: string): string[] {
  const keys = new Set<string>();
  for (const url of collectImageUrls(el, platform)) {
    const key = mediaKeyOf(platform, url);
    if (key) keys.add(key);
  }
  return [...keys];
}

function highResUrlOf(platform: string, url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url) return null;
  const extractor = extractorFor(platform);
  return extractor?.highResUrl ? extractor.highResUrl(url) : null;
}

// 1枚の画像について試す価値のある URL のすべて。いちばん有力な候補も含める。ブリッジ
// は最初に成功したものをダウンロードするので、高解像度への書き換えが 404 のときは
// サムネイルの src が使える退避先になる。
function collectImageUrls(el: PostMediaElement, platform: string): string[] {
  const urls = new Set<string>();
  const srcs = mediaSrcs(el);
  for (const src of srcs) urls.add(src);
  const highRes = highResUrlOf(platform, srcs[0] || '');
  if (highRes) urls.add(highRes);
  const srcset = el.getAttribute('srcset');
  if (srcset) {
    for (const entry of srcset.split(',')) {
      const url = entry.trim().split(/\s+/)[0];
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

// === DOM 相 ===

// このコンテンツスクリプトが動いているページの extractor。どの extractor も名乗り出
// ないページでは null。
function extractorForPage(): Extractor | null {
  return EXTRACTORS.find((e) => e.matchesPage()) || null;
}

// 注入されたプロフィール読み取りスクリプト用。インスタンス型のサイトは URL だけでは
// 種別を区別できないため、まず実際の DOM で extractor を選び、その extractor だけに URL
// を解析させる。OGP は API が答えないときの退避で、API の値と合流するときは背景側で API
// を優先する。
function profilePageMetadata(): PostRecord | null {
  const extractor = extractorForPage();
  if (!extractor?.parseProfileUrl) return null;
  const parsed = extractor.parseProfileUrl(new URL(location.href));
  if (!parsed) return null;
  const rec = emptyRecord(parsed.url, parsed.platform);
  if (typeof parsed.userId === 'string') rec.userId = parsed.userId;
  if (typeof parsed.screenName === 'string') rec.screenName = parsed.screenName;
  else if (typeof parsed.actor === 'string') rec.screenName = parsed.actor;
  else if (typeof parsed.acct === 'string') rec.screenName = parsed.acct;
  else if (typeof parsed.username === 'string') rec.screenName = parsed.hostPart ? `${parsed.username}@${parsed.hostPart}` : parsed.username;
  const extracted = extractor.extractProfilePage?.(parsed);
  // X の1階層 URL にはプロフィール以外のアプリ画面もある。URL の形だけでは
  // 区別できないサイトは DOM のプロフィール見出しまで確認してから候補にする。
  if (extractor.extractProfilePage && !extracted) return null;
  Object.assign(rec, extracted || {});
  const meta = (property: string) => document.querySelector<HTMLMetaElement>(`meta[property="${property}"], meta[name="${property}"]`)?.content?.trim() || null;
  rec.displayName ||= meta('og:title');
  rec.bio ||= meta('og:description') || meta('description');
  rec.avatar ||= meta('og:image');
  return rec;
}

function getCaptureSite(): CaptureSite | null {
  return extractorForPage()?.capture ?? null;
}

function getMediaIdentitySite(): MediaIdentitySite | null {
  return extractorForPage()?.mediaIdentity ?? null;
}

function getOverlaySite(): OverlaySite | null {
  return extractorForPage()?.overlay ?? null;
}

// === Manifest ===

// 常駐コンテンツスクリプトの入口と wxt.config.ts が読む。新しいサイトのホストが、
// 2度目の編集ではなくそのモジュールと一緒に入ってくるようにするため。
const RESIDENT_MATCHES: string[] = EXTRACTORS.flatMap((e) => [...(e.residentMatches ?? [])]);
const API_HOST_PERMISSIONS: string[] = EXTRACTORS.flatMap((e) => [...(e.apiHostPermissions ?? [])]);

export {
  API_HOST_PERMISSIONS,
  EXTRACTORS,
  RESIDENT_MATCHES,
  collectImageUrls,
  extractorFor,
  extractorForPage,
  fetchPostMetadata,
  fetchProfileMetadata,
  getCaptureSite,
  getHostname,
  getMediaIdentitySite,
  getOverlaySite,
  highResUrlOf,
  isAllowedSender,
  mediaKeyOf,
  mediaKeysOf,
  parsePostUrl,
  parseProfileUrl,
  profilePageMetadata,
};
export type { CaptureSite, Extractor, MediaIdentity, MediaIdentitySite, MediaItem, OverlaySite, ParsedPost, ParsedProfile, PostMediaElement, PostRecord, PostRect, RawAcquisition } from './types.ts';
