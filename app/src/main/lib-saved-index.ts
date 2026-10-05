'use strict';

// Native Messaging ブリッジが、アプリが閉じている間の「これは既に保存済みか」
// という TL バッジの問い合わせに答えるために読む、小さく再構築可能な
// postKey->captureId の map を作る（#5 St6 / #299）。以前の、ブリッジが
// すべての sidecar から自分のスナップショットを直接作り直すやり方を置き換える
// ——ブリッジはもう一切 sidecar を書かないので、走査すべきものが何も残って
// いない。すべての投稿の URL をまだ知っている唯一の場所は DB。読み取り側は
// bridge.mts の「Saved-post index」コメント参照（このモジュールは map を
// 組み立てるだけ。configDir/bridge-saved-index.json への書き込み——デバウンス＋
// アトミック——は index.ts の担当）。
//
// Electron に依存しない（better-sqlite3 と node の組み込みのみ）ので、
// lib-db-query.ts と同様に素の node で単体テストできる。

import type Database from 'better-sqlite3';
import path from 'node:path';
import type { SavedEntry } from '../../../native-host/protocol.mts';
import { postKeyOf } from '../../../native-host/post-key.mts';

const SAVED_INDEX_FORMAT = 'hologram-bridge-saved-index';
// v2（#334）: エントリは素の captureId 文字列ではなく、投稿の保存済みメディア
// URL を持つオブジェクトになった。v3（#34）は media と並行する `owners` を
// 追加。v4（#158）は `entries` の隣に `trashed` の map を追加。ブリッジは
// 今も v1 のエントリ（「保存済み、画像は不明」として）と v2 のエントリ
// （「保存済み画像は既知、owner は不明」として）を読み、`trashed` の map が
// 無いファイルを「ゴミ箱には何も無い」として扱う。
// v7 は DB の所在から得た saveFolder を追加する。帰属を持たない旧索引は
// 別ライブラリと区別できないため、アプリで再生成するまで採用しない。
const SAVED_INDEX_VERSION = 7;
const SAVED_INDEX_FILE = 'bridge-saved-index.json';

// media は位置で意味を持つ: 配列の添字がそのままメディア行の seq であり、
// ライブラリが url を記録しなかった行はその場所を null として保持する。それが、
// URL を比較できない時（動画。ページ側の対応物はポスターフレームでしかない）に
// バッジが「投稿の何枚目の画像か」の代わりに使えるようにしている。
//
// owners は media と並行する: どの captureId がその画像を持っているか。エントリの
// `id` は postKey を最初に主張した「1件目の」レコードでしかなく、投稿の画像は
// 日常的に複数のレコードに分散する（複数画像の投稿の2枚目を保存すると、
// 2つ目のレコードが書かれる）ので、`id` はある画像がどのレコードから来たかを
// 名指しできない。それこそがまさに重複保存の警告の「置き換え」という答えが
// 必要とするもの（#34）——利用者が3枚目に属する画像を再保存した時に1件目の
// レコードを置き換えてしまうと、間違ったキャプチャをゴミ箱送りにしてしまう。
type SavedIndexEntry = Required<SavedEntry>;

// ゴミ箱にある投稿1件（#158）。意図して SavedIndexEntry には畳み込まない:
// バッジとホバー時の保存ボタンは「この postKey のエントリがある」を「ライブラリが
// この投稿を保持している」と読むので、ゴミ箱行きの投稿を `entries` の中に
// 載せてしまうと、実際にはライブラリに一切無い投稿に対してタイムラインの
// バッジを点灯させ、保存ボタンを隠してしまう。これは別の答えなので、別の map を
// 持つ。
//
// captureId はアプリが復元先を指定するのに使うもの（ゴミ箱レコード自身の
// ファイル名）で、後の画面がそれを名指しできるよう持ち回る。deletedAt は
// レコードの trashedAt で、通知に表示される。
interface TrashedIndexEntry {
  id: string;
  deletedAt: string | null;
}

// 呼び出し元が渡すままのゴミ箱レコード: buildSavedIndex が必要とする欄だけで
// それ以外は無い。ここで読むのではなく引数として受け取るのは、ゴミ箱は
// データベースではなくファイルシステムに住み、このモジュールは意図して
// fs に触れないため（モジュールコメント参照）——index.ts はゴミ箱ビューが
// 使うのと同じ一覧取得で `.trash/` を読み、それはインポートされたアーカイブが
// 植え付けたかもしれないレコードに信頼境界を適用するものでもある（#324）。
interface TrashedInput {
  captureId: string;
  url: string | null;
  trashedAt: string | null;
}

interface SavedIndexFile {
  format: typeof SAVED_INDEX_FORMAT;
  version: typeof SAVED_INDEX_VERSION;
  generatedAt: string;
  saveFolder: string;
  entries: Record<string, SavedIndexEntry>; // postKey -> エントリ
  trashed: Record<string, TrashedIndexEntry>; // postKey -> ゴミ箱のレコード（#158）
}

// postKey を最初に主張した投稿が、エントリの captureId を勝ち取る（同じキーに
// 潰れる2つの投稿について、bridge.mts の旧 sidecar 再走査が既に持っていたのと
// 同じ「参考情報であって権威的ではない」という許容度）——バッジが「はい、
// 保存済みです」と答えるのに必要なのは、何らかの captureId だけ。
//
// ただし「メディア」は、そのキーを共有するすべてのレコードにまたがる和集合
// （#334）: 複数画像投稿の2枚目を保存すると2つ目のレコードが書かれるので、
// その投稿のうちライブラリにある画像は複数のレコードに分散する。レコード単位で
// 読むと、バッジは既に保存済みの画像を保存できると案内してしまう。
function buildSavedIndex(sqlite: Database.Database, trash: readonly TrashedInput[] = [], now: () => string = () => new Date().toISOString()): SavedIndexFile {
  const entries: Record<string, SavedIndexEntry> = {};
  // 同じ投稿を複数レコードから合流するとき、既出 URL を配列の線形走査で探すと、
  // legacy インポートなどが大量の media 行を持ち込んだ場合に二乗時間になる。
  // 出力の順序は entry.media に任せ、所属判定だけを Set で一定時間にする。
  const mediaUrlsByKey = new Map<string, Set<string>>();
  const individualMediaUrlsByKey = new Map<string, Set<string>>();
  // ライブラリが「何も」保持していない投稿は何も答えない（#492）——そうしないと
  // バッジは、permalink 自体が語ること以外何も持たないレコードについて利用者に
  // 「保存済み」と伝えてしまい、それ以降のすべての取り込みがその言葉を信じて
  // その投稿をスキップしてしまう——投稿をもう一度取り込めるように、バッジが
  // 暗いままでなければならない唯一のケース。これは
  // native-host/post-record.mts の recordHoldsContent を SQL で表現したもの
  // （ブリッジが書き込み時に適用するのと同じ規則）で、両者が等価であることは
  // saved-index.test.ts で検証している。投稿ごとのフィルタではなく1つのクエリに
  // まとめてあるのは、大きなライブラリが後で捨てる行まで持ち歩かなくて済むよう
  // にするため。
  const rows = sqlite
    .prepare(
      `SELECT p.captureId, p.url, p.imageCount, p.saveScope, p.saveIncomplete FROM posts p
        WHERE p.url IS NOT NULL AND p.trashedAt IS NULL AND p.isContext = 0
          AND (IFNULL(p.image, '') <> ''
            OR IFNULL(p.video, '') <> ''
            OR IFNULL(p.text, '') <> ''
            OR IFNULL(p.title, '') <> ''
            OR IFNULL(p.displayName, '') <> ''
            OR IFNULL(p.linkCard, '') <> ''
            OR EXISTS (SELECT 1 FROM media m WHERE m.postId = p.captureId))`,
    )
    .all() as Array<{ captureId: string; url: string; imageCount: number | null; saveScope: string; saveIncomplete: number }>;
  // 生きているすべての投稿のメディアを1回で走査し、持ち主ごとにまとめる。
  // 投稿ごとのクエリ（ライブラリ全体分の準備済みステートメントの往復）より安く、
  // JOIN がゴミ箱行きの投稿を締め出す。
  const mediaByPost = new Map<string, Array<string | null>>();
  const mediaRows = sqlite.prepare('SELECT m.postId, m.seq, m.url FROM media m JOIN posts p ON p.captureId = m.postId WHERE p.trashedAt IS NULL ORDER BY m.postId, m.seq').all() as Array<{
    postId: string;
    seq: number;
    url: string | null;
  }>;
  for (const row of mediaRows) {
    const list = mediaByPost.get(row.postId) || [];
    // 到着順ではなく seq による位置: 隙間（途中から削除されたメディア行）が、
    // その後の画像を間違った seq へずらしてはいけない。
    list[row.seq] = row.url || null;
    mediaByPost.set(row.postId, list);
  }
  for (const row of rows) {
    const key = postKeyOf(row.url);
    if (!key) continue;
    const media = mediaByPost.get(row.captureId) || [];
    const entry = entries[key];
    if (!entry) {
      entries[key] = {
        post: !row.saveIncomplete && row.saveScope === 'post' && media.length >= (row.imageCount || 0),
        individualMedia: row.saveScope === 'media' ? media.filter((url): url is string => !!url) : [],
        id: row.captureId,
        media: Array.from(media, (url) => url ?? null),
        owners: Array.from(media, () => row.captureId),
        total: row.imageCount && row.imageCount > 0 ? row.imageCount : media.length || null,
      };
      mediaUrlsByKey.set(key, new Set(media.filter((url): url is string => !!url)));
      continue;
    }
    entry.post ||= !row.saveIncomplete && row.saveScope === 'post' && media.length >= (row.imageCount || 0);
    if (row.saveScope === 'media') {
      let individualMediaUrls = individualMediaUrlsByKey.get(key);
      if (!individualMediaUrls) {
        // 先頭レコード内の重複は、後続の個別保存と合流するときだけ除く。
        individualMediaUrls = new Set(entry.individualMedia);
        entry.individualMedia = [...individualMediaUrls];
        individualMediaUrlsByKey.set(key, individualMediaUrls);
      }
      for (const url of media) {
        if (!url || individualMediaUrls.has(url)) continue;
        individualMediaUrls.add(url);
        entry.individualMedia.push(url);
      }
    }
    entry.total = Math.max(entry.total || 0, row.imageCount || 0, media.length) || null;
    // URL の無い画像は、そのキーを最初に主張した「1件目の」レコードからだけ
    // 保持する（bridge.mts の mergeSavedEntry も自身の2つの情報源について同じ
    // ことを言っている）: その位置は自分自身のレコードの中でだけ意味を持ち、
    // 他のどこでも意味を持たない。
    let mediaUrls = mediaUrlsByKey.get(key);
    if (!mediaUrls) {
      mediaUrls = new Set(entry.media.filter((url): url is string => !!url));
      mediaUrlsByKey.set(key, mediaUrls);
    }
    for (const url of media) {
      if (!url || mediaUrls.has(url)) continue;
      mediaUrls.add(url);
      entry.media.push(url);
      entry.owners.push(row.captureId);
    }
    entry.total = Math.max(entry.total || 0, entry.media.length) || null;
  }
  return { format: SAVED_INDEX_FORMAT, version: SAVED_INDEX_VERSION, generatedAt: now(), saveFolder: path.dirname(path.resolve(sqlite.name)), entries, trashed: buildTrashedMap(trash, entries) };
}

// 索引のうちゴミ箱を扱う半分（#158）。何がここに載るかは2つの規則で決まる:
//
//   1. `entries` が既に持っている postKey は「除外」する。投稿のキャプチャの
//      1つを削除しつつ、もう1つがまだライブラリにあるのはよくあること
//      （同じ投稿の2枚目の画像はそれ自身のレコード）で、生きている方こそが
//      その投稿にふさわしい答え——「既に保存済み」、その裏にある
//      copy/replace/skip の質問込みで。ゴミ箱の通知は、ライブラリがもう
//      まったく保持していない投稿のためのもの。
//   2. 同じ postKey を共有する2つのゴミ箱レコードは、「より新しい」削除の方を
//      残す。通知は日付を名指しするので、2つのうち古い方を名指しすると間違った
//      判断の日付になってしまう。trashedAt を持たないレコードは、それを
//      持つどのレコードにも負ける（スタンプが無いのは、削除したてではなく
//      失敗したレコード書き込みが残した跡）。
function buildTrashedMap(trash: readonly TrashedInput[], entries: Record<string, SavedIndexEntry>): Record<string, TrashedIndexEntry> {
  const trashed: Record<string, TrashedIndexEntry> = {};
  for (const rec of trash) {
    const key = postKeyOf(rec.url);
    if (!key || entries[key]) continue;
    const deletedAt = rec.trashedAt || null;
    const existing = trashed[key];
    if (existing && (existing.deletedAt || '') >= (deletedAt || '')) continue;
    trashed[key] = { id: rec.captureId, deletedAt };
  }
  return trashed;
}

export { buildSavedIndex, SAVED_INDEX_FORMAT, SAVED_INDEX_VERSION, SAVED_INDEX_FILE };
export type { SavedIndexFile, TrashedIndexEntry, TrashedInput };
