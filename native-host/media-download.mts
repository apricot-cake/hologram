// できる範囲で働く、共有のメディアのダウンローダ（元のメディアと投稿者のアバター）。
//
// 同じ SSRF の防ぎ、サイズと時間の上限、保存全体のバイト予算、手動のリダイレクト処理を、
// 遠隔の画像をライブラリへ引き込む経路すべてで使い回せるよう、ブリッジから切り出した:
//   - native-host/bridge.mts          （キャプチャとドラッグ保存）
//   - app/src/main/index.ts                    （import-posts）
//   - scripts/backfill-metadata.cts   （埋め戻しと、既存データのアバターの補完）
// 1か所に置いておけば、セキュリティに関わるこの防ぎが呼び出し側の間でずれることが一切
// なくなる。ここの関数はどれもできる範囲で働く。失敗すると null を返し、それが呼び出し側に
// とってそのファイルを落とす合図になる。保存や取り込みを例外で落としてはいけない。

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns';
import crypto from 'node:crypto';
import diagnosticsChannel from 'node:diagnostics_channel';
import { once } from 'node:events';
import { Agent, setGlobalDispatcher } from 'undici';

// --- 失敗の診断（#894）---------------------------------------------------------
// ここのダウンロードはどれもできる範囲で働く。失敗すると null を返し、呼び出し側がその
// ファイルを落とす。その約束は正しい。だがそれは、「メディアが告げられたのに、何も
// ダウンロードできなかった」で死ぬ保存（bridge.mts の handleSavePost）が、その理由の
// 痕跡を何も残さない、ということでもあった。HTTP 403 も、拒んだ DNS の答えも、対応して
// いない content-type も、ソケットのリセットも、すべて同じ `null` だった。#894 はまさに
// この行き止まりだ。そこで今は失敗ごとに理由を診断チャネルへ流す。変わるのは理由だけで、
// 戻り値も上限も防ぎも触っていない。
//
// ロガーを引数にして9つのシグネチャに通すのではなくチャネルにしたのは、
// node:diagnostics_channel へ流すのが、書き出し先を自分で持たずに内部の様子を報告する
// ときのライブラリのやり方だからだ（このモジュール自身の HTTP の土台である undici も
// 同じことをしている。あちらの DiagnosticsChannel.md を参照）。購読者が居なければ流す
// 処理は `hasSubscribers` の確認1つで済むので、何も要らない取り込みは何も払わない。
// bridge.mts が購読し、失敗1件につき capture.log の行を1本書く。
export const MEDIA_FAILURE_CHANNEL = 'hologram:media-download:failure';
type MediaFailureReason =
  // 要求を出す前
  | 'not-https' // 文字列でない、または https の URL でない
  | 'no-fetch' // fetch や AbortController の無いランタイム
  | 'budget-exhausted' // その保存のバイト予算を既に使い切っていた
  | 'url-refused' // checkMediaUrl が拒んだ（https でない hop、私用範囲の IP リテラル、*.local など）
  | 'dns-refused' // 防ぎ付きの名前解決が、答えの中に私用・予約のアドレスを見つけた
  | 'dns-failed' // リゾルバ自身がエラーになった
  // 応答
  | 'redirect-no-location'
  | 'redirect-bad-location'
  | 'too-many-redirects'
  | 'http-status' // リダイレクトでない 2xx 以外すべて
  | 'content-type' // この呼び出し場所が受け付けない型。読まずに拒む
  | 'declared-too-large' // content-length がファイルごとの上限を超えている
  | 'declared-over-budget' // content-length が、その保存の残りを超えている
  // 本体
  | 'body-missing'
  | 'over-per-file-cap' // 届いたバイト数が上限を超えた
  | 'over-save-budget'
  | 'stream-broken' // 本体の途中での切断・中断・書き込み失敗
  | 'empty-body'
  | 'sniff-unsupported' // application/octet-stream だが、バイト列が受け取る型ではない
  | 'threw'; // 例外として抜けたものすべて（ネットワーク、rename、mkdir）
export interface MediaFailure {
  reason: MediaFailureReason;
  // 呼び出し側が求めた URL。そもそも文字列ですらなかったときだけ null。
  url?: string | null;
  // 実際に失敗したリダイレクトの hop。`url` 自身でないときに入る。
  hop?: string;
  // そのファイルが取るはずだった、フォルダからの相対の名前＝captureId を持つので、
  // その保存自身のブリッジの行と並べて読める。
  stem?: string;
  status?: number;
  contentType?: string;
  declared?: number;
  bytes?: number;
  sniffed?: string | null;
  host?: string;
  addresses?: string[];
  // `cause` の連鎖まるごとを1行に潰したもの（undici はネットワークの失敗を素の
  // 「fetch failed」として報告し、本当の原因はその cause に入っている）。
  error?: string;
}
const mediaFailureChannel = diagnosticsChannel.channel(MEDIA_FAILURE_CHANNEL);

function reportMediaFailure(info: MediaFailure): void {
  if (!mediaFailureChannel.hasSubscribers) return;
  mediaFailureChannel.publish(info);
}

// 上の失敗を購読する。チャネルの名前ではなくこれを export しているので、呼び出し側は
// 運び方を知らずに済み、形はこのモジュールのものであり続ける。
//
// ハンドラを包んであるのは、例外を投げる購読者が publish() から戻ってこないからだ。
// Node はそれを次のティックで捕捉されない例外として投げ直す。ブリッジではそれは、保存の
// 途中でホストのプロセスが死ぬことを意味する。診断が、それが説明する当のものより高く
// つくことは決してあってはならない。だから購読者の失敗はここで飲み込む＝ログの書き手が
// 既に従っているのと同じ、できる範囲でという規則だ。
export function subscribeMediaFailures(onFailure: (info: MediaFailure) => void): () => void {
  const handler = (msg: unknown) => {
    try {
      onFailure(msg as MediaFailure);
    } catch {
      /* 例外を投げる購読者が、それが報告している当のダウンロードを壊してはいけない */
    }
  };
  mediaFailureChannel.subscribe(handler);
  return () => mediaFailureChannel.unsubscribe(handler);
}

// エラーとその `cause` の連鎖を1行に潰す。深さに上限があるのは cause の連鎖が循環し
// うるからで、長さに上限があるのは、これが、既に長い URL の隣に並ぶログの行に入るからだ。
function describeError(err: unknown): string {
  const parts: string[] = [];
  let cur: any = err;
  for (let depth = 0; depth < 4 && cur; depth++) {
    const name = (cur && cur.name) || 'Error';
    const message = (cur && cur.message) || String(cur);
    const code = cur && cur.code ? ` (${cur.code})` : '';
    parts.push(`${name}: ${message}${code}`.slice(0, 200));
    cur = cur && cur.cause !== cur ? cur.cause : null;
  }
  return parts.join(' <- ');
}

// --- 元のメディアのダウンロード（できる範囲で）---
// 対応している静止画の content-type → ファイルの拡張子。それ以外（svg、avif、HTML の
// エラーページ、…）は保存せずに飛ばす。下の VIDEO_MIME_EXT とは分けてある（アバターの
// 拡張子の問い合わせにも使う。あちらが動画になることはない）。
export const MEDIA_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
// 対応している動画の content-type（#119 St1: X / Misskey / Mastodon の直リンク URL）。
export const VIDEO_MIME_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};
// 書庫の content-type（#119 St3: pixiv のうごイラはフレーム画像の zip そのものだ。
// アニメーションを1ファイルにする形は、変換しない限り無く、変換にはエンコーダを抱える
// ことになる）。自前の表にしてあるので、zip が静止画や動画の項目に着くことは決してない。
// そこに着けば何もそれを表示できない。
export const ARCHIVE_MIME_EXT: Record<string, string> = {
  'application/zip': 'zip',
};
// 形式の名を挙げるのではなく「これが何なのか分からない」を意味する content-type。これを
// 答える CDN は、バイト列が非対応だと主張しているのではない。何も主張しないと言っている
// だけだ（Bluesky の動画のサムネイルがまさにそうする、#119 St2）。だから形式は代わりに
// バイト列から読む（下の sniffMagic）。それ以外の、表に載らない型は今も読まずに拒む。
const SNIFFABLE_TYPES = new Set(['application/octet-stream']);
const SNIFF_BYTES = 16; // 下のどの署名にも足りる
export const MAX_MEDIA = 12; // 投稿ごとの添付の上限
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // これより大きいものは飛ばす（静止画）
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 動画は写真よりはるかに大きくなる
// 原寸のうごイラの書庫はフル解像度のフレーム数十枚なので、静止画ではなく動画の側に置く。
export const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
// ファイルごとの上限に加えて、保存の操作1回あたりのバイト予算（#389）。ファイルごとの
// 上限が抑えるのは応答1つであって、クリック1回ではない。動画の上限で添付が12個なら、
// 保存1回が約 2.4GB のネットワークとディスクを動かす。512MB は、自前の上限が許すどの形も
// 上回る（静止画12枚で 300MB。動画かうごイラの書庫と poster で 225MB）ので、まともな
// 投稿が拒まれることは無い。そして、対応しているどのプラットフォームが受け付ける単一
// ファイルの最大（X の動画、512MB）とも一致する。これより多くを求める保存は、実在の投稿
// ではない。
export const MAX_SAVE_BYTES = 512 * 1024 * 1024;
// 同時に動かす添付の数。本体はディスクへ流し込むので、メモリはもうこの数に比例しない。
// 2にしておけば、複数画像の投稿が直列になって、ダウンロードの総和と同じだけ待たされる
// ことにならない。
export const MEDIA_CONCURRENCY = 2;
export const MEDIA_TIMEOUT_MS = 12000; // 画像ごとの中断
export const VIDEO_TIMEOUT_MS = 60000; // 動画は静止画より引き落とすのに時間がかかる
const MAX_MEDIA_REDIRECTS = 4; // リダイレクトの連鎖を抑える

interface UgoiraFrame {
  file: string;
  delay: number;
}
interface MediaEntry {
  url: string;
  referer?: string;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
  // 無い場合（旧い形、または静止画）は 'image' を意味する。それ以外の値はさらに
  // `poster` を持つ（#119 St1）。'ugoira' は `frames` も持つ（#119 St3）。
  type?: 'image' | 'video' | 'gif' | 'ugoira';
  poster?: string | null;
  frames?: UgoiraFrame[];
}
export interface MediaDescriptor {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  file: string;
  type?: string;
  posterFile?: string;
  frames?: UgoiraFrame[];
}
// ダウンロードが残すもの＝確定したフォルダからの相対のファイル名と、応答の content-type
// から解決した拡張子。
interface SavedFile {
  file: string;
  ext: string;
}
// 応答ごとの上限。まとめてあるので、共有の取得処理が静止画にも動画にも使え、呼び出し場所
// ごとに3つの引数を正しい順で書き直さずに済む。
interface FetchLimits {
  mimeExt: Record<string, string>;
  maxBytes: number;
  timeoutMs: number;
}
const STILL_LIMITS: FetchLimits = { mimeExt: MEDIA_MIME_EXT, maxBytes: MAX_MEDIA_BYTES, timeoutMs: MEDIA_TIMEOUT_MS };
const VIDEO_LIMITS: FetchLimits = { mimeExt: VIDEO_MIME_EXT, maxBytes: MAX_VIDEO_BYTES, timeoutMs: VIDEO_TIMEOUT_MS };
const ARCHIVE_LIMITS: FetchLimits = { mimeExt: ARCHIVE_MIME_EXT, maxBytes: MAX_ARCHIVE_BYTES, timeoutMs: VIDEO_TIMEOUT_MS };

// --- 保存全体のバイト予算（#389）-----------------------------------------------
// 保存の操作1回につき予算1つを、その操作が行うすべてのダウンロード（メディア、poster
// フレーム、アバター）で共有する。バイト数は届いた時点で数える。後で失敗する転送のバイト
// 数も含める。それらは既にネットワークとディスクを使って支払われているからだ。予算を
// 超えると、動いている取得を `signal` で中断し、それ以上の取得を始めないようにする。
interface ByteBudget {
  readonly signal: AbortSignal;
  readonly blown: boolean;
  remaining(): number;
  take(bytes: number): boolean;
}
export function createByteBudget(total: number = MAX_SAVE_BYTES): ByteBudget {
  const ctrl = new AbortController();
  let spent = 0;
  return {
    get signal() {
      return ctrl.signal;
    },
    get blown() {
      return spent >= total;
    },
    remaining: () => Math.max(0, total - spent),
    take(bytes: number) {
      spent += bytes;
      if (spent > total) {
        ctrl.abort();
        return false;
      }
      return true;
    },
  };
}

// --- SSRF の防ぎ ---------------------------------------------------------------
// メディアの URL はページや、敵対的かもしれない Misskey・Mastodon のインスタンスから
// 来る。だから細工した URL は、ダウンローダを内部の資源（クラウドのメタデータ
// 169.254.169.254、ループバック、RFC1918）へ向けさせうる。これは目隠しの SSRF だ
// （取得したバイト列はユーザーのディスクに書かれ、攻撃者に返ることは決してない）し、
// https も既に必須にしている。それでも私用・予約の宛先は拒み、リダイレクトの hop ごとに
// 確認し直す。IP リテラルと、明らかにローカルなホスト名は、取得の前に弾く。ホスト名は
// 下の防ぎ付きのディスパッチャが解決する。A と AAAA の結果がすべて公開のものでなければ
// ならず、その後 Node は、検証済みのその結果の集合にだけ接続する。これで、確認と解決の
// 隙間を作らずに DNS リバインディングを塞ぐ。
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const o = parts.map(Number);
  if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = o;
  if (a === 0 || a === 10 || a === 127) return true; // this-network / RFC1918 / ループバック
  if (a === 169 && b === 254) return true; // リンクローカル。クラウドのメタデータを含む
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT（RFC6598）
  if (a === 192 && b === 0 && o[2] === 0) return true; // IETF のプロトコル割り当て
  if (a >= 224) return true; // マルチキャストと予約（224-255）
  return false;
}
export function isPrivateIp(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) return isPrivateIPv4(ip);
  if (fam === 6) {
    const lc = ip.toLowerCase();
    if (lc === '::1' || lc === '::') return true; // ループバック / 未指定
    const mapped = lc.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/); // ::ffff:a.b.c.d / ::a.b.c.d（ドット表記）
    if (mapped) return isPrivateIPv4(mapped[1]);
    // ::ffff:0:0/96 の IPv4 射影を16進で書いた形。WHATWG の URL パーサはドット表記の
    // 射影リテラル（たとえば ::ffff:127.0.0.1）を16進（::ffff:7f00:1）へ正規化するので、
    // checkMediaUrl が上のドット表記を見ることは決してない。埋め込まれた v4 を下位32
    // ビットから取り戻し、同じ私用範囲の確認を当てる。各グループは16進1〜4桁になり
    // うる（先頭の0は落ちる: 192.168.0.1 → ::ffff:c0a8:1）。
    const mapped6 = lc.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped6) {
      const hi = Number.parseInt(mapped6[1], 16);
      const lo = Number.parseInt(mapped6[2], 16);
      const v4 = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
      return isPrivateIPv4(v4);
    }
    if (/^f[cd][0-9a-f]{2}:/.test(lc)) return true; // fc00::/7 ユニークローカル
    if (/^fe[89ab][0-9a-f]:/.test(lc)) return true; // fe80::/10 リンクローカル
    if (lc.startsWith('ff')) return true; // ff00::/8 マルチキャスト
    return false;
  }
  return false; // IP リテラルではない
}

// コネクタのふつうの DNS の名前解決を、全アドレスを見る防ぎに差し替える。検証済みの
// レコードを net.connect に返すことで（下で autoSelectFamily を有効にしてある）、A と
// AAAA の切り替えを保ったまま、接続をこの集合そのものに固定する。
export function createGuardedLookup(resolveAll = dns.lookup) {
  return (hostname, options, callback) => {
    resolveAll(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) {
        // #894: 名前が解決しない場合と、拒むアドレスに解決する場合の両方が、上流では
        // 何も分からない1つの「fetch failed」として現れる。
        reportMediaFailure({ reason: 'dns-failed', host: hostname, error: describeError(err) });
        callback(err);
        return;
      }
      if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(({ address }) => !net.isIP(address) || isPrivateIp(address))) {
        // 答えはそのまま報告する。#894 の有力な仮説は、anycast の答えの集合にこの防ぎが
        // 私用と読むアドレスが時々混じる CDN があるというもので、実際のアドレス以外に
        // それを裏づけたり否定したりできるものが無い。
        reportMediaFailure({
          reason: 'dns-refused',
          host: hostname,
          addresses: Array.isArray(addresses) ? addresses.map(({ address }) => String(address)) : [],
        });
        const refused = new Error(`DNS resolution refused for ${hostname}`) as NodeJS.ErrnoException;
        refused.code = 'EHOSTUNREACH';
        callback(refused);
        return;
      }
      callback(null, addresses);
    });
  };
}

const MEDIA_DISPATCHER = new Agent({
  connect: {
    lookup: createGuardedLookup(),
    autoSelectFamily: true,
  },
});
// Node のグローバルな fetch は、Node が内部に抱えた（より古い）undici を通して送る。
// MEDIA_DISPATCHER を要求ごとの `dispatcher` オプションとして渡すと、その内部の fetch は
// こちらの（より新しい v8 以降の）undici の Request クラスで Request を組み立て、その
// クラスが、v2 にしかないメソッドが無いとしてハンドラを拒む（「invalid onRequestStart
// method」）。コネクタも createGuardedLookup も走る前にだ。代わりにプロセス全体の既定と
// して登録すれば、そのハンドラの形の確認をまるごと回避できる。だから下の呼び出しごとの
// `request` のオプションには、必ず付けないでおくこと。
setGlobalDispatcher(MEDIA_DISPATCHER);

// URL を1本検証する。https であること、IP リテラルなら公開の範囲であること、明らかに
// ローカルなホスト名でないこと。成功したら解析した URL を返し、そうでなければ null。
export function checkMediaUrl(urlStr: string): URL | null {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^\[|\]$/g, ''); // net.isIP がリテラルを見られるよう IPv6 の角括弧を外す
  if (net.isIP(host)) return isPrivateIp(host) ? null : u;
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')) return null;
  return u;
}

// 先頭のバイト列から形式の名を出す。認識するのは2つの許可リストが既に持つ形式だけで、
// 答えは MIME の文字列であり、呼び出し側はそれを自分の `mimeExt` で引き直す。つまり
// 判別は、呼び出し場所が受け付ける型の中から選ぶだけで、それを広げることは決してできない
// （mp4 と判別された静止画のダウンロードは、content-type で拒まれるのと同じく拒まれる）。
// これはどのブラウザも、渡された application/octet-stream に対して行うことを写している
// （WHATWG mimesniff）。そしてヘッダの経路より厳しい確認だ。ここではバイト列そのものが
// 一致しなければならない。
export function sniffMagic(head: Buffer): string | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (head.length >= 6 && /^GIF8[79]a$/.test(head.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (head.length >= 4 && head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm'; // EBML（.mkv も同じ。あちらは受け付けない）
  if (head.length >= 4 && head.subarray(0, 2).toString('latin1') === 'PK' && head[2] <= 8 && head[3] <= 8) return 'application/zip';
  // ISO base media: サイズが前置された 'ftyp' ボックス。そのブランドが、QuickTime を
  // mp4 系の他すべてから分ける。
  if (head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp') {
    return head.subarray(8, 10).toString('latin1') === 'qt' ? 'video/quicktime' : 'video/mp4';
  }
  return null;
}

// 応答の本体を `tmpPath` へ書き、ファイルごとの上限と保存の予算を、実際に届いたバイト数に
// 対して守らせる。Content-Length で既に早めに抜ける道はあるが、あれは攻撃者が決められる。
// チャンク転送の本体、実際より小さく申告した本体、そもそも終わらない本体は、ここで転送の
// 途中で切る。メモリに載るのは今のチャンクだけだ。書いたバイト数と先頭のバイト列
// （sniffMagic 用）か、止まった理由を返す。呼び出し側はどちらにせよ一時ファイルを消し、
// 理由を診断の1行にする（#894）。上限、壊れた転送、読めない本体を1つの null に潰さず、
// ここで区別しているのはそのためだ。
type StreamOutcome = { ok: true; bytes: number; head: Buffer } | { ok: false; reason: 'body-missing' | 'over-per-file-cap' | 'over-save-budget' | 'stream-broken'; bytes: number; error?: string };

async function streamToFile(res: Response, cap: number, budget: ByteBudget, tmpPath: string): Promise<StreamOutcome> {
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') return { ok: false, reason: 'body-missing', bytes: 0 };
  const reader = body.getReader();
  // 'wx' にしてあるので、名前が衝突したら、別の保存の書きかけのファイルを上書きせずに
  // 失敗する。エラーの listener はストリームと同じティックで付ける。open の失敗
  // （'EEXIST'、読み取り専用のフォルダ）は非同期に発火するので、そうしないと扱われない
  // 'error' イベントになってしまう。
  const out = fs.createWriteStream(tmpPath, { flags: 'wx' });
  const failed = new Promise<never>((_, reject) => out.once('error', reject));
  failed.catch(() => {}); // 誰も await しないまま終わることがある
  let total = 0;
  const head: Buffer[] = []; // 先頭のチャンク。SNIFF_BYTES を満たすまでだけ保つ
  let headLen = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      // 順番に意味があり、変えていない。ファイルごとの上限を超えた後は予算に手を付け
      // ない。そのバイト数は使ったのではなく拒んだものだからだ。
      if (total > cap) return { ok: false, reason: 'over-per-file-cap', bytes: total };
      if (!budget.take(value.length)) return { ok: false, reason: 'over-save-budget', bytes: total };
      const chunk = Buffer.from(value);
      if (headLen < SNIFF_BYTES) {
        head.push(chunk.subarray(0, SNIFF_BYTES - headLen));
        headLen += head[head.length - 1].length;
      }
      if (!out.write(chunk)) await Promise.race([once(out, 'drain'), failed]);
    }
    out.end();
    // 'finish' ではなく 'close'。Windows はハンドルがまだ開いているファイルの rename も
    // 削除も拒むし、呼び出し側は次にまさにそれをする。
    await Promise.race([once(out, 'close'), failed]);
    return { ok: true, bytes: total, head: Buffer.concat(head) };
  } catch (error) {
    return { ok: false, reason: 'stream-broken', bytes: total, error: describeError(error) }; // 本体の途中での切断・中断・書き込み失敗
  } finally {
    reader.cancel().catch(() => {}); // 本体を読み切った後は何もしない
    if (!out.destroyed) out.destroy();
    if (!out.closed) await once(out, 'close').catch(() => {}); // 上を参照
  }
}

// メディアファイルを1つ、直接ディスクへ取得し、フォルダからの相対の名前を返す。何か
// 失敗すれば null。`stem` はその名前から拡張子を除いたもので、拡張子は応答の
// content-type が届いて初めて分かる。i.pximg.net の pixiv の原本は、pixiv の Referer が
// 無いと403になる。そこへは呼び出し側が referer を渡す。他のホストでは省く。リダイレクト
// は手動で辿るので、hop ごとに SSRF の防ぎで検証し直せる。
//
// 本体は隣に置いた一時ファイルへ流し込み、rename で確定する。だからどの時点で失敗した
// ダウンロード（非対応の型、ファイルごとの上限、保存の予算、リダイレクト、切断、時間
// 切れ）も、完成したように見えるファイルも一時ファイルも残さない。目的地と同じ
// ディレクトリにするのは意図してそうしている。rename が原子的なのは1つのファイル
// システムの中だけだ。
async function downloadToFile(url: unknown, referer: unknown, limits: FetchLimits, dir: string, stem: string, budget: ByteBudget): Promise<SavedFile | null> {
  // 下の `return null` はどれもここを通るので、失敗が理由を言わずに去ることは決して
  // ない（#894）。戻り値の型は null なので、呼び出し場所の見た目は前とまったく同じだ。
  const failed = (info: Omit<MediaFailure, 'url' | 'stem'>): null => {
    reportMediaFailure({ url: typeof url === 'string' ? url : null, stem, ...info });
    return null;
  };
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return failed({ reason: 'not-https' });
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') return failed({ reason: 'no-fetch' });
  if (budget.blown) return failed({ reason: 'budget-exhausted' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), limits.timeoutMs);
  let tmpPath = ''; // 後始末する名前が決まった時点で入る
  let committed = false;
  // try の外に置いてあるので、下の catch でも、ネットワークの失敗が死んだ hop の名を
  // 言える。診断の要点は、「fetch failed」だけではどの要求が失敗したのかを言わない、
  // ということそのものだ。
  let current = url;
  // リダイレクトで別の場所へ行った場合にだけ報告する値打ちがある。
  const hopOf = () => (current === url ? {} : { hop: current });
  try {
    const headers = typeof referer === 'string' && /^https:\/\//i.test(referer) ? { Referer: referer } : undefined;
    // 予算を超えると、超えた当のダウンロードだけでなく、この保存のダウンロードが
    // すべて中断される。
    const signal = AbortSignal.any([ctrl.signal, budget.signal]);
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_MEDIA_REDIRECTS; hop++) {
      if (!checkMediaUrl(current)) return failed({ reason: 'url-refused', ...hopOf() }); // SSRF の防ぎ。hop ごとに
      const request = { signal, redirect: 'manual' as const, headers };
      res = await fetch(current, request);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) return failed({ reason: 'redirect-no-location', status: res.status, ...hopOf() });
        try {
          current = new URL(loc, current).href;
        } catch {
          return failed({ reason: 'redirect-bad-location', status: res.status, hop: loc });
        }
        continue;
      }
      break;
    }
    // 上限より長い連鎖は、リダイレクトを掴んだままループを抜ける＝ただのエラーの
    // ステータスと区別してあるので、「連鎖が終わらなかった」はそれ自身として読める。
    if (res && res.status >= 300 && res.status < 400) return failed({ reason: 'too-many-redirects', status: res.status, ...hopOf() });
    if (!res || !res.ok) return failed({ reason: 'http-status', status: res ? res.status : undefined, ...hopOf() });
    const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    let ext = limits.mimeExt[ct];
    // 表に無い型は、本体を1バイトも読まずに拒む。ただし「分からない」の型は例外で、
    // そちらは代わりに、転送の後にマジックバイトで決める（SNIFFABLE_TYPES）。
    if (!ext && !SNIFFABLE_TYPES.has(ct)) return failed({ reason: 'content-type', status: res.status, contentType: ct, ...hopOf() });
    // Content-Length は手がかりであって、保証では決してない。正直なサーバーはここで
    // 転送まるごとを省いてくれるし、嘘をつくサーバーは上のバイト数の勘定が止める。
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limits.maxBytes) return failed({ reason: 'declared-too-large', declared, ...hopOf() });
    if (Number.isFinite(declared) && declared > budget.remaining()) return failed({ reason: 'declared-over-budget', declared, ...hopOf() });
    // 最終的な名前には拡張子が要るが、バイト列から判別するダウンロードは本体の後で
    // しかそれを知らない。だから一時ファイルは stem だけから名前を付け、拡張子を選ぶのは
    // 下の rename だ。
    const stemPath = path.join(dir, stem);
    fs.mkdirSync(path.dirname(stemPath), { recursive: true });
    tmpPath = path.join(path.dirname(stemPath), `.${path.basename(stemPath)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
    const got = await streamToFile(res, limits.maxBytes, budget, tmpPath);
    if (!got.ok) return failed({ reason: got.reason, bytes: got.bytes, error: got.error, ...hopOf() });
    if (!got.bytes) return failed({ reason: 'empty-body', ...hopOf() });
    if (!ext) {
      const sniffed = sniffMagic(got.head);
      ext = limits.mimeExt[sniffed || ''];
      // このバイト列は、この呼び出し側が受け取る型のどれでもない。
      if (!ext) return failed({ reason: 'sniff-unsupported', contentType: ct, sniffed, bytes: got.bytes, ...hopOf() });
    }
    const file = `${stem}.${ext}`;
    fs.renameSync(tmpPath, path.join(dir, file)); // 確定の地点
    committed = true;
    return { file, ext };
  } catch (error) {
    return failed({ reason: 'threw', error: describeError(error), ...hopOf() }); // ネットワーク・中断・解析の失敗
  } finally {
    clearTimeout(timer);
    if (!committed) {
      ctrl.abort(); // もう見捨てる本体のソケットを解放する
      if (tmpPath) {
        try {
          fs.rmSync(tmpPath, { force: true });
        } catch {
          /* 取り残された一時ファイルの後始末。できる範囲で */
        }
      }
    }
  }
}

// 静止画を1枚 <dir>/<stem>.<ext> へダウンロードする（ドラッグ保存自身の作品、アバター）。
// 投稿まるごとを保存する呼び出し側は、代わりに downloadMedia を通る。
export async function saveStillImage(url: unknown, referer: unknown, dir: string, stem: string, budget: ByteBudget = createByteBudget()): Promise<SavedFile | null> {
  return downloadToFile(url, referer, STILL_LIMITS, dir, stem, budget);
}

function descriptorOf(entry: MediaEntry, file: string): MediaDescriptor {
  return {
    url: entry.url,
    alt: entry.alt != null ? String(entry.alt) : null,
    width: typeof entry.width === 'number' && Number.isFinite(entry.width) ? entry.width : null,
    height: typeof entry.height === 'number' && Number.isFinite(entry.height) ? entry.height : null,
    file,
  };
}

// メディアの項目を1つダウンロードする。静止画はこれまでどおり <base>-media-<i>.<ext>
// へ行く。動く項目（video と gif は動画ファイル1つ、ugoira はフレームの zip）は、
// アニメーション自体を試す前に、poster フレーム（プラットフォームが渡していれば）も
// <base>-poster.<ext> へ取得する。添字は付けない。対応しているどのプラットフォームも
// 投稿ごとに2つ以上のアニメーションを持たないからだ。先に取ることで、アニメーションの
// ダウンロードが失敗しても poster は着く。アニメーションが非対応・大きすぎる・ネット
// ワークで失敗した場合、その項目はまるごと消えるのではなく静止画に降格する（posterFile
// がその `file` になり、`type` は付かないまま）。本当に二重に失敗したとき（poster も
// アニメーションも無い）だけ、取得できない写真と同じくその項目を落とす。その完全な失敗
// のときは null を返す（呼び出し側が落とす）。
export async function downloadOneMedia(entry: MediaEntry | null | undefined, dir: string, base: string, i: number, budget: ByteBudget = createByteBudget()): Promise<MediaDescriptor | null> {
  if (!entry) return null;
  const limits = entry.type === 'ugoira' ? ARCHIVE_LIMITS : entry.type === 'video' || entry.type === 'gif' ? VIDEO_LIMITS : null;
  if (!limits) {
    const got = await downloadToFile(entry.url, entry.referer, STILL_LIMITS, dir, `${base}-media-${i}`, budget);
    return got ? descriptorOf(entry, got.file) : null;
  }

  let posterFile: string | undefined;
  if (typeof entry.poster === 'string' && entry.poster) {
    const posterGot = await downloadToFile(entry.poster, entry.referer, STILL_LIMITS, dir, `${base}-poster`, budget);
    if (posterGot) posterFile = posterGot.file;
  }

  const got = await downloadToFile(entry.url, entry.referer, limits, dir, `${base}-media-${i}`, budget);
  // フレームの表は書庫と一緒にだけ運ぶ。zip が無ければ、その時間の情報が言う相手が
  // 無いし、下の降格は素の静止画だ。
  if (got) return { ...descriptorOf(entry, got.file), type: entry.type, posterFile, frames: entry.type === 'ugoira' ? entry.frames : undefined };
  if (posterFile) return descriptorOf(entry, posterFile); // 静止画に降格する
  return null;
}

// 投稿の添付をダウンロードする。`budget` はその保存の共有のバイト予算だ＝その保存の
// すべてのダウンロード（アバターも）に必ず同じものを渡す。そうすれば上限が、呼び出し
// ごとではなく操作全体を覆う。
//
// 添付1つにつき Promise 1つではなく、大きさの決まったワーカーの一群にしてある。同時に
// 開く転送は多くても MEDIA_CONCURRENCY までなので、ソケットもディスクへの書き込みも
// 溜め込むチャンクも、添付の数に比例しない（#389）。各ワーカーが自分の添字にだけ書くので、
// 順番も保たれる。
export async function downloadMedia(mediaList: unknown, dir: string, base: string, budget: ByteBudget = createByteBudget()): Promise<MediaDescriptor[]> {
  if (!Array.isArray(mediaList) || !mediaList.length) return [];
  const list: MediaEntry[] = mediaList.slice(0, MAX_MEDIA);
  const saved: (MediaDescriptor | null)[] = new Array(list.length).fill(null);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      // 予算を超えるとキューは止まる。既に着いたものはそのまま残す。
      if (i >= list.length || budget.blown) return;
      try {
        saved[i] = await downloadOneMedia(list[i], dir, base, i, budget);
      } catch (error) {
        // downloadToFile は自分の失敗を飲み込むので、ここに来たということは、項目自体が
        // 例外を投げるほど壊れていたということだ＝拒まれたダウンロードと区別が付かない
        // ままにするより、自前の行を持つ値打ちがある（#894）。
        reportMediaFailure({ reason: 'threw', url: (list[i] && list[i].url) || null, stem: `${base}-media-${i}`, error: describeError(error) });
        saved[i] = null; // 添付1つの不具合が保存を失敗させることは決してない
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MEDIA_CONCURRENCY, list.length) }, worker));
  return saved.filter((v): v is MediaDescriptor => Boolean(v));
}

// 投稿者のアバターを共有のストア <dir>/avatars/ へダウンロードする。表示側がオフラインで
// 見せられるようにするためだ（表示のときに外部を取得しない）。ファイルはキャプチャごと
// ではなく、アバターの URL ごとに1つ。旧い <captureId>-avatar.<ext> の方式は、保存の
// たびに同じアイコンを取得して書いていたので、よく保存する投稿者では同一の複製が何十も
// 積み上がった。対応しているどのプラットフォームでも、アバターの URL は中身で決まる
// （bsky の CDN の bafkrei… のハッシュ、twimg の profile_images の id、pximg の日付入りの
// パス）。だから「同じ URL なら同じ画素」だ。ファイルは URL のハッシュをキーにし、既に
// ファイルが在れば取得も書き込みも飛ばす。変わったアバターは新しい URL で届き、新しい
// ファイルとして着く。置き換えられた方は、古いサイドカーの参照先としてだけ残る（小さい
// ので、掃除はしない）。
// フォルダからの相対のパス 'avatars/<hash>.<ext>' を返す（スラッシュはサイドカーの正規の
// 形）。失敗すれば null。メディアと同じく、失敗が保存を失敗させることは決してない。
// 旧いサイドカーの <captureId>-avatar.<ext> のファイルには一切手を付けない。
export const AVATAR_SUBDIR = 'avatars';
export async function downloadAvatar(avatar: unknown, referer: unknown, dir: string, budget: ByteBudget = createByteBudget()): Promise<string | null> {
  if (typeof avatar !== 'string' || !avatar) return null;
  const hash = crypto.createHash('sha1').update(avatar).digest('hex').slice(0, 16);
  const sub = path.join(dir, AVATAR_SUBDIR);
  // 拡張子は応答の content-type からしか分からないので、対応しているものを1つずつ
  // 問い合わせる。当たれば、この URL そのものが既にダウンロード済みということだ。
  for (const ext of new Set(Object.values(MEDIA_MIME_EXT))) {
    if (fs.existsSync(path.join(sub, `${hash}.${ext}`))) return `${AVATAR_SUBDIR}/${hash}.${ext}`;
  }
  // stem をスラッシュ区切りにしておくと、サイドカーの正規の形がそのまま返ってくる。
  const got = await saveStillImage(avatar, referer, dir, `${AVATAR_SUBDIR}/${hash}`, budget);
  return got ? got.file : null;
}

// #181: OGP のカードのサムネイル。すぐ上の downloadAvatar と同じく、できる範囲で働き、
// Referer を渡さないという約束だ。ただし共有の中身で決まるストアではなくレコードごと
// （`<base>-linkcard.<ext>`）になる。カードのサムネイルはリンク先の記事に結びついていて、
// 人（downloadAvatar）にもインスタンスごとの絵文字（下の downloadCustomEmojis）にも
// 結びついていない。だからその2つが在る理由であるレコードをまたいだ使い回しは、ここには
// 当てはまらない。
//
// Referer は一切渡さない（pixiv の mediaReferer とは違う）。#181 のカードのデータは
// プラットフォーム自身の、既に取得済みの API の応答から来る（Bluesky の external の埋め
// 込み、Mastodon の status.card、X のカードの仕組み）。外部のページ自体を取得して得たもの
// では決してない。だからこの URL は常にプラットフォーム自身の CDN（cdn.bsky.app、その
// インスタンス自身のメディアのホスト、pbs.twimg.com）であって、リンク先の記事のオリジンに
// なることは決してない。したがって 2026-07-27 のセキュリティレビューが挙げた、オリジンを
// またぐ Referer の懸念（#181 に記録され、#122 のようなページ取得の設計に向けられたもの）
// は、このダウンロードでは生じない。
export async function downloadLinkCardThumbnail(url: unknown, dir: string, base: string, budget: ByteBudget = createByteBudget()): Promise<string | null> {
  const got = await saveStillImage(url, undefined, dir, `${base}-linkcard`, budget);
  return got ? got.file : null;
}

interface CustomEmojiEntry {
  shortcode: string;
  url: string;
}
// downloadCustomEmojis が項目1つについて残すもの＝告げられた shortcode と url、そして
// 共有のストアでのフォルダからの相対のファイル名。その絵文字1つが失敗したときは null
// （保存全体を失敗させることは決してない＝downloadAvatar や downloadMedia と同じ、
// できる範囲でという約束）。
export interface CustomEmojiDescriptor {
  shortcode: string;
  url: string;
  file: string | null;
}
const MAX_EMOJI = 30; // 投稿ごとに、種類の異なる :shortcode: 絵文字の上限

// 投稿自身の `:shortcode:` のカスタム絵文字（#290＝Misskey と Mastodon だけ）を、共有の
// ストア <dir>/emoji/ へ、絵文字の URL ごとに1ファイルでダウンロードする。上の
// downloadAvatar の avatars/ のストアとまったく同じだ（理由も同じ。同じインスタンスの
// 多くの投稿で同じ絵文字が使い回されるので、よく使われる絵文字を保存し直すときは、複製を
// もう1つ書かずに既に在るファイルを使い回す）。URL のハッシュをキーにするのも同じ理由で、
// この機能が対応するどのプラットフォームでも、慣習として中身でアドレスが決まる
// （shortcode はインスタンスの中だけのもので、インスタンスをまたぐと別の画像に使い回され
// うるので、shortcode 自体は決してキーの一部にしない）。
//
// 動く形式（gif と webp。アニメーション PNG も image/png として来る）には、
// downloadOneMedia の動画の経路のような poster フレームの別工程は要らない。
// STILL_LIMITS と MEDIA_MIME_EXT が、絵文字の画像が届きうる型をすべて覆っているし、
// #290 は、動く画像を降格させずそのまま保てと言っている。
//
// 絵文字1つのダウンロードの失敗が、他の絵文字や保存を落とすことは決してない（項目ごとの
// try/catch）。file は null のままになり、表示側は素の :shortcode: のテキストに退避する。
// 失敗したアバターやメディアの項目と同じ約束だ。
export const EMOJI_SUBDIR = 'emoji';
export async function downloadCustomEmojis(list: unknown, dir: string, budget: ByteBudget = createByteBudget()): Promise<CustomEmojiDescriptor[]> {
  if (!Array.isArray(list) || !list.length) return [];
  const sub = path.join(dir, EMOJI_SUBDIR);
  const out: CustomEmojiDescriptor[] = [];
  for (const raw of list.slice(0, MAX_EMOJI) as CustomEmojiEntry[]) {
    if (!raw || typeof raw.shortcode !== 'string' || !raw.shortcode || typeof raw.url !== 'string' || !raw.url) continue;
    let file: string | null = null;
    try {
      const hash = crypto.createHash('sha1').update(raw.url).digest('hex').slice(0, 16);
      // 拡張子は応答の content-type からしか分からないので、先に対応しているものを
      // 1つずつ問い合わせる。当たれば、この URL そのものが既にダウンロード済みという
      // ことだ（downloadAvatar の同じ問い合わせを参照）。
      for (const ext of new Set(Object.values(MEDIA_MIME_EXT))) {
        if (fs.existsSync(path.join(sub, `${hash}.${ext}`))) {
          file = `${EMOJI_SUBDIR}/${hash}.${ext}`;
          break;
        }
      }
      if (!file) {
        const got = await saveStillImage(raw.url, undefined, dir, `${EMOJI_SUBDIR}/${hash}`, budget);
        file = got ? got.file : null;
      }
    } catch {
      file = null;
    }
    out.push({ shortcode: raw.shortcode, url: raw.url, file });
  }
  return out;
}

// i.pximg.net の pixiv のアバターは、pixiv の Referer が無いと403になる。呼び出し側が
// アバターの URL を持っていて referer を保存していないとき（旧い取り込みのデータは
// avatarReferer より古い）は、ダウンロードが弾かれないよう、ホストから referer を導く。
export function pixivRefererFor(url: unknown): string | undefined {
  try {
    const h = new URL(url as string).hostname.toLowerCase();
    if (h === 'pximg.net' || h.endsWith('.pximg.net')) return 'https://www.pixiv.net/';
  } catch {
    /* 解析できる URL ではない */
  }
  return undefined;
}
