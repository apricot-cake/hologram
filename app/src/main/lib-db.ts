'use strict';

// メタデータストアの SQLite エンジンの層 (#5 / #294 St1。スキーマは #295 St2)。データベース
// を開き、未適用のマイグレーションを当て、型の付いた Kysely のインスタンスを返す。DDL 自体は
// lib-db-schema.ts に居る＝このファイルはエンジン（開く・マイグレーションする）のまま、
// あちらは形（「現行」が何を指すか）のまま。
//
// Electron 非依存に保つ（better-sqlite3 と node の組み込みだけ）ので、マイグレーションの
// 実行部を素の node で単体テストできる。lib-index/lib-archive に倣う。
//
// 単一ライター。このデータベースを書き込みで開くのは Electron のメインプロセスだけ。他の
// プロセス（Chrome が起こす Native Messaging ブリッジ）は .db に一切触れない＝取込キューへ
// 追記し、アプリがそれを取り込む (#299)。WAL があるので読み手は入れる（性能計測の道具が開く
// 読み取り専用のスナップショット、#293）。
//
// 配られているネイティブのバイナリは N-API なので、同じ better-sqlite3 の .node が、素の
// node の下でも Electron の下でも、作り直しの手順なしに読み込まれる（2026-07-24 に node 24 /
// Electron 43 で確認。NODE_MODULE_VERSION は 137 と 148）。これのために electron-rebuild の
// 配線を足してはいけない＝docs/build.md を参照。

import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { Generated } from 'kysely';
import { POSTS_FTS_COLUMNS, POSTS_FTS_SQL, SCHEMA_V1_SQL } from './lib-db-schema.ts';

// スキーマの変更1つにつき1エントリ。配列の順に当て、いったん出荷したら並べ替えも編集も決して
// しない＝`user_version` が何本走ったかを記録するので、適用済みのエントリを書き直すと既存の
// データベースが黙って食い違う。足すのは末尾だけ。
//
// add-source-mtime と drop-source-mtime (#297。#302 で退役)。posts.sourceMtimeMs は、繰り返し
// 走るサイドカー→DB の同期が、ファイルの動いていない投稿の導出をやり直さずに済ませるための
// ものだった。同期はもう無く、DB へ直接書く。だからこの列に読み手は残っていない。並びが追記
// だけのものなので、両方のエントリはそのまま残す。作りたてのデータベースは2つを続けて走らせ、
// 正しい形に着地する。
const MIGRATIONS: Migration[] = [
  { name: 'schema-v1', up: (db) => db.exec(SCHEMA_V1_SQL) },
  { name: 'add-source-mtime', up: (db) => db.exec('ALTER TABLE posts ADD COLUMN sourceMtimeMs INTEGER') },
  // #135: クリップの機能は退役した（フォルダ・お気に入り・ピン留めのボードがその役を継いだ）。
  { name: 'drop-clip-items', up: (db) => db.exec('DROP TABLE clip_items') },
  // 投稿者側のワークスペースの UI は 2026-06-27 に退役した（投稿者の整理は poster-folder に
  // まとめた）が、この永続化の層だけが取り残された＝以降、レンダラーのコードはこれを読みも
  // 書きもしていない。
  { name: 'drop-poster-workspace-items', up: (db) => db.exec('DROP TABLE poster_workspace_items') },
  // St5 (#298) には、一時的なサイドカー由来の索引と、DB が持つ書き込み経路とを切り替える、
  // 永続でトランザクショナルなスイッチが要る。これを config.json ではなく SQLite に置くと、
  // 写された・復元されたデータベースは自分の解釈を自分で運び、古くなった JSON から黙って
  // 取り込み直されることがなくなる。
  {
    name: 'add-store-state',
    up: (db) =>
      db.exec(`
        CREATE TABLE store_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        ALTER TABLE posts ADD COLUMN userKind TEXT;
        ALTER TABLE posts ADD COLUMN tagReviewed INTEGER;
      `),
  },
  // #41: フォルダは平らなテーブルのままで、木のつながりは parentId だけ。孤立したつながりや
  // 循環したつながりは、レンダラーが読むときに直す。一方 FK は、永続化された正当な親が、その
  // 部分木より長く残ることを防ぐ。
  { name: 'add-folder-parent', up: (db) => db.exec('ALTER TABLE folders ADD COLUMN parentId TEXT REFERENCES folders(id) ON DELETE CASCADE') },
  // #119 St1: 動画と GIF のメディアは、その種別と、落としたポスターフレームのファイル名を
  // 持つ（静止画は動画ファイル自体からは測れないし、サムネイルも作れない）。どちらも NULL 可
  // ＝マイグレーション以前の行と、静止画のエントリ全部（圧倒的多数）は null のまま。
  {
    name: 'add-media-video-fields',
    up: (db) =>
      db.exec(`
        ALTER TABLE media ADD COLUMN type TEXT;
        ALTER TABLE media ADD COLUMN posterFile TEXT;
      `),
  },
  // #362: そのレコードを作った取り込みの経路（'x-bookmarks' の一括取り込み。後の一括アダプタ
  // は自分の値を足す）。整理ではなく、保存した時点の事実＝取り込みのあとでは組み直せないので
  // 記録する（X にブックマークの書き出しは無い）。NULL 可＝普通の保存はどれも null のまま。
  { name: 'add-captured-via', up: (db) => db.exec('ALTER TABLE posts ADD COLUMN capturedVia TEXT') },
  // #299: アプリ内部の動画の取り込み経路 (ipc-transfer.ts の import-images) は、この列ができる
  // より前からサイドカーの `video` の欄を作っていた＝normalizePostRecord と PostRecordShape は、
  // このマイグレーションと並んでそれを得た。`image` と `video` を分けるのは、レンダラー自身の
  // `image || video` という UI の取り決めに合わせたもの（投稿が主たる成果物として持つのは、
  // 2つのうち高々1つ）。
  { name: 'add-post-video', up: (db) => db.exec('ALTER TABLE posts ADD COLUMN video TEXT') },
  // #299 (St6): 永続の Native Messaging ブリッジ取込キューの、1回だけ適用したことを示す受領
  // 記録。inbox_events は、実際に `posts` へ適用したエンベロープ1件につき1行を記録する
  // (eventId = captureId)＝走査のやり直しやセグメントの再生が、何かを書く前に確かめる冪等性の
  // 台帳（設計コメントの「適用の規則」）。sourceSegment は、まだ loose なイベントでは NULL で、
  // 圧縮が畳み込めばそのセグメントの id になる (#299 の設計コメント「保持量と圧縮」)＝
  // セグメントを読み直さずに、全部適用済みだと証明できるように記録する。inbox_segments は、
  // 実際に再生した圧縮済みのセグメントのファイル1つにつき1行を記録する。だから普通の再起動
  // では、イベントが全部片付いているセグメントを開き直さずに済む（セグメントの中身をもう一度
  // 再生するのは、これらの行も消えている DB 喪失からの回収のときだけ）。
  {
    name: 'add-inbox-tables',
    up: (db) =>
      db.exec(`
        CREATE TABLE inbox_events (
          eventId TEXT PRIMARY KEY,
          captureId TEXT NOT NULL,
          payloadSha256 TEXT NOT NULL,
          importedAt TEXT NOT NULL,
          sourceSegment TEXT
        );
        CREATE INDEX idx_inbox_events_captureId ON inbox_events(captureId);
        CREATE TABLE inbox_segments (
          segmentId TEXT PRIMARY KEY,
          payloadSha256 TEXT NOT NULL,
          importedAt TEXT NOT NULL
        );
      `),
  },
  // #302: サイドカーの走査が無くなったので、mtime を比べられるファイルから投稿を導出する
  // ものは何も無い＝上の add-source-mtime の注記を参照。
  { name: 'drop-source-mtime', up: (db) => db.exec('ALTER TABLE posts DROP COLUMN sourceMtimeMs') },
  // #292: 取得時の原本の層。ある投稿のために届いた payload 1件につき1行＝1つの投稿に複数ある
  // のが普通（プラットフォームの投稿の endpoint と、その投稿者プロフィールの endpoint）。だから
  // sourceKind は列であって、`posts` に付く1つの塊ではない。payload は受け取ったバイト列を
  // gzip したもの。sha256 は圧縮前のバイト列に対して取るので、どう圧縮したかではなく payload
  // そのものを指す。byteLength は、レコード単位の上限のせいでバイト列を落としたときも圧縮前の
  // 大きさを記録する (encoding = 'omitted:oversize'、payload は NULL)。形と上限は
  // native-host/raw-payload.mts、この層が在る理由は docs/decisions/0011 を参照。
  //
  // UNIQUE(postId, sourceKind, sha256) があるので、同じ書き込みを当て直しても結果は同じになり
  // （取込キューのセグメントの再生、ZIP の再取り込み）、先の取得を消すことは決してない＝この
  // テーブルは追記だけで、writePost がまるごと書き直す media/post_tags/FTS の行とは違う。同じ
  // 経路から来た同一のバイト列は同じ原本なので、それを畳むことは、#292 が v1 から先送りした、
  // レコードをまたぐ重複排除にはあたらない。
  {
    name: 'add-raw-payloads',
    up: (db) =>
      db.exec(`
        CREATE TABLE raw_payloads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          postId TEXT NOT NULL REFERENCES posts(captureId) ON DELETE CASCADE,
          sourceKind TEXT NOT NULL,
          acquiredAt TEXT NOT NULL,
          contentType TEXT,
          encoding TEXT NOT NULL,
          sha256 TEXT NOT NULL,
          byteLength INTEGER NOT NULL,
          payload BLOB
        );
        CREATE INDEX idx_raw_payloads_postId ON raw_payloads(postId);
        CREATE UNIQUE INDEX idx_raw_payloads_identity ON raw_payloads(postId, sourceKind, sha256);
      `),
  },
  // #119 St3: pixiv のうごイラは、pixiv 自身のフレーム画像の zip として保存する。フレームごと
  // の表示時間は、その中のどこにも入っていない。frames のテーブルではなく1つの列の JSON に
  // しているのは、この並びが常にまるごと、1つのメディアについて、再生側からしか読まれないから
  // ＝個別のフレームを問い合わせたり結合したりするものは何も無い。他のメディアの行（つまり
  // ほとんど全部）では null。
  { name: 'add-media-frames', up: (db) => db.exec('ALTER TABLE media ADD COLUMN frames TEXT') },
  // #444: 投稿ごとに安定した FTS の行のキーを持たせ、書き込み経路が posts_fts を UNINDEXED の
  // postId の列で指すのをやめさせる。FTS5 の仮想テーブルが持つ索引は MATCH と rowid だけなので、
  // `WHERE postId = ?` は索引の全走査になる＝投稿1件あたりの書き込みの費用がライブラリとともに
  // 増え（変更前の木で実測して1万行 2.2ms → 3万行 8.0ms）、一括の操作はどれも O(N²) だった。
  //
  // posts 自身の暗黙の rowid ではなく ftsRowid にした理由。主キーが TEXT のテーブルの暗黙の
  // rowid は VACUUM をまたいで安定しない (SQLite 自身が注意している)。そのままだと FTS の行が
  // 全部、黙って違う投稿を指し直すことになる。今のアプリで VACUUM をするものは無いが、明示の
  // 列にしておけば、これからも VACUUM しないでいる義務を負わずに済む。
  //
  // 種を入れる UPDATE は、その暗黙の rowid をちょうど1回だけ、まだそれが正しいうちに読む。この
  // マイグレーションのあと、この列を持つのはレコードライター (lib-db-record-writer.ts)。あちらは
  // 書き直しのときに投稿のキーを使い回し、まだ持たない投稿には FTS5 に割り当てさせる。
  //
  // posts_fts は写し替えではなく、落として `posts` から作り直す。作り直しは FTS5 が行のキーを
  // 付け直す唯一の方法であり、導出し直すことで「投稿1件につき FTS の行はちょうど1つ」が以降
  // 成り立つ（古い書き込み経路が残した孤児の行は消える）。それに導出の2列は計算し直すのが安い
  // ＝hashtags は posts.hashtags の JSON の配列を空白で連結したもの（事前トークン化した写し。
  // lib-db-schema.ts のスキーマコメント）、tagsText はその投稿のタグの名前。reading はまだ誰も
  // 書かないので NULL のまま (#164)。
  //
  // posts_fts の DDL と列の並びは、POSTS_FTS_SQL/POSTS_FTS_COLUMNS を埋め込まずにここへ直接
  // 書いてある（下の add-post-cw-sensitive のマイグレーションとは違う。あちらが「現行」を名乗る
  // 側）。このマイグレーションは歴史的なもので、出荷したときの10列ちょうどの形を、後の
  // マイグレーション (#178) がそれらの定数を11列のテーブルの記述に変えたあとも作り続けなければ
  // ならないから。共有の定数をここへ埋め込んでいたせいで、#178 が入った瞬間に、凍結されている
  // はずのこのマイグレーションの SQL が黙って変わった＝作りたてのデータベースすべてで
  // db.test.ts と db-schema.test.ts が落ちて発覚した（「12列に対して11個の値」）。
  {
    name: 'fts-rowid-addressing',
    up: (db) =>
      db.exec(`
        ALTER TABLE posts ADD COLUMN ftsRowid INTEGER;
        UPDATE posts SET ftsRowid = rowid;
        CREATE UNIQUE INDEX idx_posts_ftsRowid ON posts(ftsRowid);
        DROP TABLE posts_fts;
        CREATE VIRTUAL TABLE posts_fts USING fts5(
          postId UNINDEXED,
          text,
          title,
          displayName,
          screenName,
          eagleName,
          description,
          hashtags,
          tagsText,
          reading,
          tokenize = 'trigram'
        );
        INSERT INTO posts_fts (rowid, postId, text, title, displayName, screenName, eagleName, description, hashtags, tagsText, reading)
          SELECT
            p.ftsRowid, p.captureId, p.text, p.title, p.displayName, p.screenName, p.eagleName, p.description,
            COALESCE(CASE WHEN json_valid(p.hashtags) THEN (SELECT group_concat(h.value, ' ' ORDER BY h.key) FROM json_each(p.hashtags) h) END, ''),
            COALESCE((SELECT group_concat(t.name, ' ' ORDER BY pt.rowid) FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = p.captureId), ''),
            NULL
          FROM posts p;
      `),
  },
  // #34: そのレコードが置き換える captureId。二重保存の警告に「置換」と答えたときに書かれる。
  // 関係ではなく、未処理を示す印＝アプリがこれを消費し（古いキャプチャをゴミ箱へ、タグを統合
  // し、フォルダと手動グループの行を張り替える）、NULL に戻す。だから null でない値は「まだ
  // 掃かれていない」を意味する。意図して外部キーにはしていない＝掃き終わる頃には古い投稿は
  // 消えているし、再生は、このデータベースが一度も持たなかった captureId を指す印を運びうる。
  { name: 'add-post-replaces', up: (db) => db.exec('ALTER TABLE posts ADD COLUMN replaces TEXT') },
  // #560: 複数画像の投稿のうち、ドラッグでの保存が何枚目を取ったか（1始まり）と、その投稿が
  // 何枚持っていたか。拡張機能はドラッグ保存ができた時からこの2つを送っていたが、受け取る列が
  // 無かったので、それを読む詳細パネルの行は決して埋まらなかった。media の行の位置ではなく素の
  // NULL 可の列2つにした理由。レコードの media[] は落とした1枚しか持たないので、位置がこれを
  // 運べる行は存在しない。これは、その絵の出どころである投稿についての事実であり、投稿に
  // ついての事実が居る場所は投稿の行だから。他のどの経路でも null
  // (PostRecordShape.imageIndex を参照)。
  {
    name: 'add-post-image-index',
    up: (db) =>
      db.exec(`
        ALTER TABLE posts ADD COLUMN imageIndex INTEGER;
        ALTER TABLE posts ADD COLUMN imageCount INTEGER;
      `),
  },
  // #202: プラットフォームの API が何も答えなかったせいで、レコードのどの欄をページから読んだ
  // か。`hashtags` とまったく同じく、1つの TEXT の列に JSON の string[] を入れる＝投稿と一緒に
  // 読まれる小さな注記であって、結合したり絞り込んだりする対象では決してないので、自前の
  // テーブルは要らない。API の取得が完全に成功したレコードでは空 ('[]')。
  { name: 'add-post-dom-filled', up: (db) => db.exec('ALTER TABLE posts ADD COLUMN domFilled TEXT') },
  // #189: プラットフォーム自身の API が、この投稿を編集済みと報告しているか、そしていつか。列を
  // 2つにしているのは、それぞれ独立した問いに答えるから＝X の edit_control は時刻をまったく
  // 持たない (PostRecordShape.editedAt を参照) ので、isEdited=1 で editedAt=NULL の行がありうる。
  // このマイグレーションより前に書かれた行と、編集の信号を持たないプラットフォームでは、どちら
  // も null。
  {
    name: 'add-post-edited-fields',
    up: (db) =>
      db.exec(`
        ALTER TABLE posts ADD COLUMN isEdited INTEGER;
        ALTER TABLE posts ADD COLUMN editedAt TEXT;
      `),
  },
  // #178: 内容警告の文 (Misskey の note.cw / Mastodon の spoiler_text) と、プラットフォーム
  // 自身のセンシティブ・成人向けの印 (Mastodon の sensitive / X の possibly_sensitive /
  // Bluesky の self-label)＝プラットフォームごとの出どころは PostRecordShape.cw/sensitive を
  // 参照。このマイグレーションより前に書かれた行と、そうした信号を持たないプラットフォームでは
  // どちらも null（Misskey にノート単位のセンシティブの真偽値は無く、X と Bluesky に CW の
  // 自由記述は無い）。
  //
  // cw は投稿者自身が書いた言葉で、text/title と同じ位置付け。だから posts の行だけでなく
  // posts_fts も、これを索引するよう形を作り直す。FTS5 に ALTER は無く、列を足すには作り直す
  // しかない（fts-rowid-addressing (#444) と同じ理由）。作り直しは投稿ごとの既存の ftsRowid を
  // 使い回し（マイグレーションの順序上、この時点で fts-rowid-addressing はすでに走っている）、
  // hashtags/tagsText をあのマイグレーションとまったく同じに計算し直す。reading はまだ誰も
  // 書かないので NULL のまま (#164)。上の ALTER で足したばかりの cw 自身は既存のどの行でも
  // NULL なので、写した値は今のところ何もしないのと同じで、各投稿が初めて書き直されたときに
  // 実体を持つ。
  {
    name: 'add-post-cw-sensitive',
    up: (db) =>
      db.exec(`
        ALTER TABLE posts ADD COLUMN cw TEXT;
        ALTER TABLE posts ADD COLUMN sensitive INTEGER;
        DROP TABLE posts_fts;
        ${POSTS_FTS_SQL}
        INSERT INTO posts_fts (rowid, ${POSTS_FTS_COLUMNS})
          SELECT
            p.ftsRowid, p.captureId, p.text, p.title, p.displayName, p.screenName, p.eagleName, p.description,
            COALESCE(CASE WHEN json_valid(p.hashtags) THEN (SELECT group_concat(h.value, ' ' ORDER BY h.key) FROM json_each(p.hashtags) h) END, ''),
            COALESCE((SELECT group_concat(t.name, ' ' ORDER BY pt.rowid) FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = p.captureId), ''),
            NULL,
            p.cw
          FROM posts p;
      `),
  },
  // #188: pixiv のシリーズの所属＝その作品がどのシリーズに属し、その中で何番目か（1始まり）。
  // illust の payload の seriesNavData から取る (PostRecordShape の
  // seriesId/seriesTitle/seriesOrder を参照)。このマイグレーションより前に書かれた行と、
  // シリーズでない投稿・pixiv でない投稿では、3つとも null。
  {
    name: 'add-post-series-fields',
    up: (db) =>
      db.exec(`
        ALTER TABLE posts ADD COLUMN seriesId TEXT;
        ALTER TABLE posts ADD COLUMN seriesTitle TEXT;
        ALTER TABLE posts ADD COLUMN seriesOrder INTEGER;
      `),
  },
  // #180: 引用・リノートと、（Misskey だけの）返信先の、サイドカーの下位レコード＝欄の一式は
  // native-host/post-record.mts の QuotedPostShape を参照。JSON のテキストとして持つ
  // (hashtags/domFilled と同じ約束事)。どちらも投稿1件につき0個か1個で、自前のテーブルに値する
  // ほど広がらない。posts_fts には足さない。あの FTS5 の索引にはまだ生きた呼び出し元が無い
  // (lib-db-query.ts のモジュールのコメント＝繋がっている全文検索の経路は、レンダラーのメモリ
  // 上の textHaystackOf だけ)。誰も読まない列のために作り直しても、マイグレーションの費用が
  // 要るだけで今のところ見返りが無い。いずれ FTS を使う側が入ったときに、これを拾う。
  {
    name: 'add-post-quoted-refs',
    up: (db) =>
      db.exec(`
        ALTER TABLE posts ADD COLUMN quotedPost TEXT;
        ALTER TABLE posts ADD COLUMN replyToPost TEXT;
      `),
  },
  // #162: 寸法とファイルサイズのファセットのための、レコード単位のメディアの大きさの集計＝
  // native-host/post-record.mts の PostRecordShape.mediaMaxW/H/Bytes と、書き込み時の測定に
  // ついては app/src/main/lib-media-dims.ts を参照。このマイグレーションより前に書かれた行では
  // null で、そのレコードが何か別の理由で次に書かれるまでそのまま（shotW/shotH と同じ「既存の
  // 書き込み時の仕掛けに乗せ、埋め戻しの走査はしない」という決定＝#162 の 2026-07-18 の設計
  // コメント）。
  {
    name: 'add-media-max-dims',
    up: (db) =>
      db.exec(`
        ALTER TABLE posts ADD COLUMN mediaMaxW INTEGER;
        ALTER TABLE posts ADD COLUMN mediaMaxH INTEGER;
        ALTER TABLE posts ADD COLUMN mediaMaxBytes INTEGER;
      `),
  },
  // #290: その投稿自身の :shortcode: 形式のカスタム絵文字（Misskey と Mastodon だけ）＝
  // native-host/post-record.mts の CustomEmojiShape を参照。JSON のテキストとして持ち、上の
  // quotedPost/replyToPost と同じ約束事（投稿ごとの小さな配列で、自前のテーブルに値しない）。
  // このマイグレーションより前に書かれた行と、Misskey/Mastodon 以外の投稿では null。
  {
    name: 'add-post-custom-emojis',
    up: (db) => db.exec(`ALTER TABLE posts ADD COLUMN customEmojis TEXT;`),
  },
  // #36: ユーザーが投稿に添える自由記述のメモ。Eagle 移行由来の `description` の欄を、同義の
  // 欄を2つ抱えるのをやめて同じ列へ統合する (PostRecordShape.memo と、#36 の受け入れの注記
  // 「description を参照するコードが残っていない」を参照)。足して写して落とす手順ではなく
  // RENAME COLUMN を使う。このファイルの他の場所ですでに頼っているものだから
  // (drop-source-mtime はより新しい DROP COLUMN を使い、同じ SQLite のバージョンの対応を要する)。
  // そして、2周目を要さずに既存の行の中身を全部保つ。
  //
  // posts_fts に ALTER は無い（上の fts-rowid-addressing と add-post-cw-sensitive が回避したの
  // と同じ FTS5 の制約）ので、ここでも落として作り直し、投稿ごとの ftsRowid を使い回す＝あの
  // 2つのマイグレーションが使ったのとまったく同じ作り直しの手順で、posts.description の代わりに
  // 改名したばかりの posts.memo の列を読むだけ。POSTS_FTS_SQL/POSTS_FTS_COLUMNS について
  // 「現行」を名乗るのは、これで今やこのマイグレーション（今までは add-post-cw-sensitive がその
  // 役を持っていた）。この追記だけの並びの中で、これより後に走るもののうち `description` の列を
  // 当てにするものは、作りたてのデータベースでも既存のものでも1つも無い。
  {
    name: 'rename-description-to-memo',
    up: (db) =>
      db.exec(`
        ALTER TABLE posts RENAME COLUMN description TO memo;
        DROP TABLE posts_fts;
        ${POSTS_FTS_SQL}
        INSERT INTO posts_fts (rowid, ${POSTS_FTS_COLUMNS})
          SELECT
            p.ftsRowid, p.captureId, p.text, p.title, p.displayName, p.screenName, p.eagleName, p.memo,
            COALESCE(CASE WHEN json_valid(p.hashtags) THEN (SELECT group_concat(h.value, ' ' ORDER BY h.key) FROM json_each(p.hashtags) h) END, ''),
            COALESCE((SELECT group_concat(t.name, ' ' ORDER BY pt.rowid) FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = p.captureId), ''),
            NULL,
            p.cw
          FROM posts p;
      `),
  },
  // #23 St1: 投稿者の名寄せ＝現実の同じ投稿者・アカウントを指す posterKey を、壊さずに元へ
  // 戻せる形でまとめる（設計は Issue 上で 2026-07-11/07-16/07-19/07-20 に確定）。グループの
  // `primaryKey` は、どの読み手も畳み込む先の正規の posterKey
  // (ファセット・述語・buildUsers)。`members` (poster_alias_group_members) は、そのグループが
  // 束ねる posterKey を全部運ぶ。primaryKey も含む。posterKey へのユニーク索引が「キー1つに
  // つきグループ1つ」の不変条件で、レンダラーの resolve()/membersOf() が曖昧さのない答えを
  // 得るために頼っている＝キーが2つのグループに居ると、正規のキーが「どれか」決まらなくなる。
  {
    name: 'add-poster-aliases',
    up: (db) =>
      db.exec(`
        CREATE TABLE poster_alias_groups (
          id TEXT PRIMARY KEY,
          primaryKey TEXT NOT NULL
        );
        CREATE TABLE poster_alias_group_members (
          groupId TEXT NOT NULL REFERENCES poster_alias_groups(id) ON DELETE CASCADE,
          posterKey TEXT NOT NULL,
          PRIMARY KEY (groupId, posterKey)
        );
        CREATE UNIQUE INDEX idx_poster_alias_members_posterKey ON poster_alias_group_members(posterKey);
      `),
  },
  // #179: 投稿に付いた投票 (X / Misskey / Mastodon)＝native-host/post-record.mts の PollShape を
  // 参照。1つの列に JSON のテキストとして持つ。quotedPost/replyToPost と同じ約束事で、理由も
  // 同じ＝投稿1件につき0個か1個で、中に選択肢がいくつか入るだけ。自前のテーブルに値するほど
  // 広がらない。このマイグレーションより前に書かれた行と、投票を持たない投稿（圧倒的多数）では
  // null。posts_fts に足さないのは add-post-quoted-refs が挙げるのと同じ理由＝あの索引にはまだ
  // 生きた呼び出し元が無く、誰も読まない列のために作り直しても、マイグレーションの費用が要る
  // だけで今のところ見返りが無い。
  {
    name: 'add-post-poll',
    up: (db) => db.exec(`ALTER TABLE posts ADD COLUMN poll TEXT;`),
  },
  // #236: 任意のファイルの取り込み（「収蔵」）。assetClass はすでに在った (v1 の DDL、既定は
  // 'media') が、'file' を書くものはまだ無かった＝これがもう半分で、収蔵品それ自身の
  // ファイル名。image/video と同じ位置付け（'media' の行では全部 null、'file' の行では全部
  // 埋まる）。3つのうちどれを埋めるかを決める唯一の場所は、lib-local-intake.ts の
  // buildLocalRecord を参照。
  { name: 'add-post-file', up: (db) => db.exec('ALTER TABLE posts ADD COLUMN file TEXT') },
  // #181: リンクを共有する投稿が埋め込む OGP のプレビューカード (Bluesky の external embed /
  // Mastodon の status.card / X 自身のカードの仕掛け)＝native-host/post-record.mts の
  // LinkCardShape を参照。JSON のテキストとして持ち、quotedPost/replyToPost/poll と同じ約束事
  // ＝投稿1件につき0個か1個で、自前のテーブルに値するほど広がらない。posts_fts に足さないのは
  // それらと同じ理由＝あの索引にはまだ生きた呼び出し元が無い（繋がっている検索の経路は
  // services/query.ts の textHaystackOf と services/fulltext.ts で、どちらもこれをメモリ上の
  // 投稿から直に読む）。
  {
    name: 'add-post-link-card',
    up: (db) => db.exec(`ALTER TABLE posts ADD COLUMN linkCard TEXT;`),
  },
  // #145: 全体の履歴ページを支えるストア。行はライブラリの範囲に属する（設定のディレクトリでは
  // ない＝captureId・フォルダ・タグの参照は、そのライブラリに対してしか解決しない。Issue の
  // 2026-08-02 の設計コメント §3 を参照）。#144 の push のエントリ1件につき1行（replace の
  // エントリ＝入力中の文字、ギャラリーのページ送り、並べ替えは一切記録しない。push か replace
  // かは、足す前にレンダラーが決める）。`state` はそのエントリの種別ごとの復元の状態を間引いた
  // もの（複数選択もスクロール位置も持たない＝設計コメントの §3「state は間引く」を参照）で、
  // そうすることで5万行が数十 MB の範囲に収まる。`u` と `title` は、tab-state.ts がすでに導いて
  // いる疑似 URL と表示用のラベル (navEntryUrl / tabTitleOf)＝このテーブルは自前のラベル生成の
  // 処理を1つも足さない。
  {
    name: 'add-history-table',
    up: (db) =>
      db.exec(`
        CREATE TABLE history (
          id INTEGER PRIMARY KEY,
          ts INTEGER NOT NULL,
          u TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          state TEXT NOT NULL
        );
        CREATE INDEX idx_history_ts ON history(ts, id);
      `),
  },
  // #289: 投稿者プロフィールのスナップショットのストア＝投稿者ごとの現在の行1つと、投稿者自身
  // の見た目 (displayName/screenName/bio/links/avatar(+File)/banner(+File)) が実際に変わった
  // ときだけ行が増える履歴のテーブル。変わったかどうかは内容のハッシュで確かめる
  // (lib-poster-profile.ts の posterAppearanceHash)。これは SQL:2011 が記述し SQL Server が
  // 組み込みで実装している、システムバージョニングの時間テーブルの形（現在のテーブルと、同じ
  // スキーマを映した履歴のテーブル）。SQLite に相当する組み込みは無いので、このマイグレーション
  // が対を手で組む (#289 の 2026-08-02 の設計コメント)。
  //
  // followers と authorCreatedAt は両方のテーブルに一緒に乗るが、意図して内容のハッシュの外に
  // 置く。これらはその時点の数え上げで、そのままにすると人気のある投稿者の投稿を保存するほぼ
  // 毎回、新しい履歴の行を発行してしまい、「何かが変わったときだけ行が増える」が成り立たなく
  // なる。ハッシュの変化が作った行にはこれらも記録するし、現在の行はハッシュが動いたかどうかに
  // 関わらず、観測のたびに更新する。
  //
  // posterKey は主キーで、どこへの外部キーでもない。services/query.ts の userKey() がすでに
  // 作り、poster_folders/poster_tags がすでにキーにしているのと同じ文字列だが、これを名指す
  // posts の列は無い（投稿者のキーは投稿の行から導くもので、行に保存はしない）ので、ここから
  // 参照する先が存在しない。投稿を全部あとから消された投稿者も、行を保ったまま残る
  // (poster_folders/poster_tags がすでに従っている「能動的な後始末はしない」のと同じ約束事)。
  // これは意図してのこと＝このストアの目的はまさに、かつてそれを裏付けた投稿より長く生き残る
  // ことだから。
  //
  // 書き手は lib-db-record-writer.ts の writePost で、観測した投稿と同じトランザクションの中
  // （別の書き込み経路は無いので、投稿者が、きっかけになった投稿に対して半端に更新された状態に
  // なることは決してない）。
  //
  // ここでデータの埋め戻しは走らせない。既存のライブラリの投稿者の行を posts のテーブルから
  // 計算するには、内容のハッシュのために node:crypto が要る。しかし狭く絞った MigrationDb
  // （exec と pragma だけ。このファイル自身のモジュールのコメント）はそこへ手が届かない＝
  // lib-backfill-poster-profiles.ts が、store_state を関門にして遅らせて1回だけそれをやる。
  // lib-db-write.ts の ensureLibraryId と lib-migrate-poster-key-host.ts の1回きりの書き直しが
  // どちらもすでに使っている、「マイグレーションを要さずに次の起動で得る」のと同じ形。
  {
    name: 'add-poster-profiles',
    up: (db) =>
      db.exec(`
        CREATE TABLE poster_profiles (
          posterKey TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          userId TEXT,
          instance TEXT,
          displayName TEXT,
          screenName TEXT,
          bio TEXT,
          links TEXT,
          avatar TEXT,
          avatarFile TEXT,
          banner TEXT,
          bannerFile TEXT,
          followers INTEGER,
          authorCreatedAt TEXT,
          contentHash TEXT NOT NULL,
          provenance TEXT NOT NULL,
          firstObservedAt TEXT NOT NULL,
          lastObservedAt TEXT NOT NULL
        );
        CREATE TABLE poster_profile_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          posterKey TEXT NOT NULL REFERENCES poster_profiles(posterKey) ON DELETE CASCADE,
          observedAt TEXT NOT NULL,
          displayName TEXT,
          screenName TEXT,
          bio TEXT,
          links TEXT,
          avatar TEXT,
          avatarFile TEXT,
          banner TEXT,
          bannerFile TEXT,
          followers INTEGER,
          authorCreatedAt TEXT,
          contentHash TEXT NOT NULL,
          provenance TEXT NOT NULL
        );
        CREATE UNIQUE INDEX idx_poster_profile_snapshots_identity ON poster_profile_snapshots(posterKey, contentHash, observedAt);
        CREATE INDEX idx_poster_profile_snapshots_key ON poster_profile_snapshots(posterKey, observedAt);
      `),
  },
  // #8: カードの画像 (shotW/shotH が記述するのと同じファイル) が、アニメーションする webp か
  // どうか＝app/src/main/lib-card-dims.ts の fillCardDims と、records.ts の imgW の例外扱いを
  // 参照。このマイグレーションより前に書かれた行では null。shotW/shotH/mediaMaxW 自身と同じ
  // 「既存の書き込み時の仕掛けに乗せる」約束事。
  { name: 'add-post-shot-animated', up: (db) => db.exec('ALTER TABLE posts ADD COLUMN shotAnimated INTEGER') },
  // #239: 汎用のウェブページ抽出の経路 (#195 のブックマーク保存の経路) で、
  // title/description/author/published/siteName/url を何が埋めたか (schema.org の形式 / OGP /
  // Dublin Core / Highwire / 素の HTML への退避)＝native-host/post-record.mts の
  // PostRecordShape.metaSource を参照。1つの TEXT の列に JSON のオブジェクト（欄の名前 → 出所の
  // 文字列）を入れる。quotedPost/poll/linkCard と同じ約束事＝投稿1件につき0個か1個で、自前の
  // テーブルに値するほど広がらない。このマイグレーションより前に書かれた行と、プラットフォーム
  // の extractor が作ったレコードでは null（あちらの欄は、出所の記録が記述するような退避の連鎖
  // ではなく、そのプラットフォーム自身の API から来る）。
  {
    name: 'add-post-meta-source',
    up: (db) => db.exec(`ALTER TABLE posts ADD COLUMN metaSource TEXT;`),
  },
  // #919: poster_profiles.platform の NOT NULL を外す。書き込み経路はプラットフォームの無い
  // 投稿者のためにすでに作ってあった＝lib-poster-profile.ts の posterKeyOf にはそのための
  // `web:<host>:<id>` の明示の分岐があり (#760)、posterInstanceOf は null を返す。しかし DDL が
  // その行を禁じていたので、投稿者を出しているページのブックマークは全部 (#195 はそれらを
  // platform: null、投稿者のページの URL を userId として保存する＝Qiita、YouTube、ニュース
  // サイト、技術ブログ)、取り込みの時点で
  // 「NOT NULL constraint failed: poster_profiles.platform」に当たり、カードにならなかった。
  // ここではスキーマが実装に従う。逆ではない。platform を必須にすればブックマークの投稿者を
  // 捨てることになるし、'web' のような番兵の値を置くと、下流のどのプラットフォームの絞り込みと
  // 集計にも、不明なプラットフォームが本物のように見えてしまう。
  //
  // SQLite は列の制約をその場で緩められないので、これは定石どおりの作り直し。ただし1つ厄介な
  // 点がある。poster_profile_snapshots は poster_profiles への ON DELETE CASCADE の参照を持ち、
  // マイグレーションの実行部はトランザクションを持っている（トランザクションの中では何もしない
  // `PRAGMA foreign_keys = OFF` は使えない）。その子がまだ古い親を指している状態で親を落とすと、
  // 履歴が丸ごと CASCADE で消える。そこで、まず子の行を FK の無い一時テーブルへ退避させ、あとから
  // 子を元の DDL で作り直す。こうすると RENAME の瞬間にも、宙に浮いた参照が残らない。
  {
    name: 'poster-profile-platform-nullable',
    up: (db) =>
      db.exec(`
        CREATE TABLE poster_profiles_v2 (
          posterKey TEXT PRIMARY KEY,
          platform TEXT,
          userId TEXT,
          instance TEXT,
          displayName TEXT,
          screenName TEXT,
          bio TEXT,
          links TEXT,
          avatar TEXT,
          avatarFile TEXT,
          banner TEXT,
          bannerFile TEXT,
          followers INTEGER,
          authorCreatedAt TEXT,
          contentHash TEXT NOT NULL,
          provenance TEXT NOT NULL,
          firstObservedAt TEXT NOT NULL,
          lastObservedAt TEXT NOT NULL
        );
        INSERT INTO poster_profiles_v2 (posterKey, platform, userId, instance, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, followers, authorCreatedAt, contentHash, provenance, firstObservedAt, lastObservedAt)
          SELECT posterKey, platform, userId, instance, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, followers, authorCreatedAt, contentHash, provenance, firstObservedAt, lastObservedAt FROM poster_profiles;
        CREATE TABLE poster_profile_snapshots_stage (
          id INTEGER PRIMARY KEY,
          posterKey TEXT NOT NULL,
          observedAt TEXT NOT NULL,
          displayName TEXT,
          screenName TEXT,
          bio TEXT,
          links TEXT,
          avatar TEXT,
          avatarFile TEXT,
          banner TEXT,
          bannerFile TEXT,
          followers INTEGER,
          authorCreatedAt TEXT,
          contentHash TEXT NOT NULL,
          provenance TEXT NOT NULL
        );
        INSERT INTO poster_profile_snapshots_stage (id, posterKey, observedAt, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, followers, authorCreatedAt, contentHash, provenance)
          SELECT id, posterKey, observedAt, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, followers, authorCreatedAt, contentHash, provenance FROM poster_profile_snapshots;
        DROP TABLE poster_profile_snapshots;
        DROP TABLE poster_profiles;
        ALTER TABLE poster_profiles_v2 RENAME TO poster_profiles;
        CREATE TABLE poster_profile_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          posterKey TEXT NOT NULL REFERENCES poster_profiles(posterKey) ON DELETE CASCADE,
          observedAt TEXT NOT NULL,
          displayName TEXT,
          screenName TEXT,
          bio TEXT,
          links TEXT,
          avatar TEXT,
          avatarFile TEXT,
          banner TEXT,
          bannerFile TEXT,
          followers INTEGER,
          authorCreatedAt TEXT,
          contentHash TEXT NOT NULL,
          provenance TEXT NOT NULL
        );
        INSERT INTO poster_profile_snapshots (id, posterKey, observedAt, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, followers, authorCreatedAt, contentHash, provenance)
          SELECT id, posterKey, observedAt, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, followers, authorCreatedAt, contentHash, provenance FROM poster_profile_snapshots_stage;
        DROP TABLE poster_profile_snapshots_stage;
        CREATE UNIQUE INDEX idx_poster_profile_snapshots_identity ON poster_profile_snapshots(posterKey, contentHash, observedAt);
        CREATE INDEX idx_poster_profile_snapshots_key ON poster_profile_snapshots(posterKey, observedAt);
      `),
  },
];

interface Migration {
  name: string;
  up: (db: MigrationDb) => void;
}

// マイグレーションに要る、better-sqlite3 の一部分。意図して狭くしている＝テストは素の偽物を
// 渡すし、マイグレーションはクエリビルダーに一切触れない（生の DDL だけ＝Kysely の型付き
// スキーマが記述するのは現行の形で、歴史的な形ではない）。
interface MigrationDb {
  exec: (sql: string) => unknown;
  pragma: (source: string, options?: { simple?: boolean }) => unknown;
}

class DatabaseCorruptError extends Error {}

// `user_version` より先のマイグレーションを全部、それぞれ自分のトランザクションの中で走らせ、
// 同じトランザクションの中で `user_version` を進める。だから中断された実行もきれいにやり直せる。
// `user_version` は SQLite のヘッダ自体にある4バイトの整数＝最初のマイグレーションが走る前に
// 作っておく帳簿のテーブルが要らない。
//
// 単体テストのために export している。どんな MigrationDb でも受けるので、順序の保証と、途中から
// 再開する保証を、本物のデータベース無しに確かめられる。
function runMigrations(db: MigrationDb, migrations = MIGRATIONS) {
  const applied = Number(db.pragma('user_version', { simple: true })) || 0;
  if (applied > migrations.length) {
    throw new Error(`database schema is newer than this build (user_version=${applied}, known=${migrations.length})`);
  }
  for (let i = applied; i < migrations.length; i++) {
    db.exec('BEGIN');
    try {
      migrations[i].up(db);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${i + 1} (${migrations[i].name}) failed: ${err.message}`);
    }
  }
  return { from: applied, to: migrations.length };
}

// `file` にあるデータベースを開き（無ければ作り）、{ db, sqlite } を返す。`db` は Kysely の
// クエリビルダー、`sqlite` は Kysely が扱わない操作のための生のハンドル（バックアップの
// スナップショット #301、pragma の確認）。
//
// quick_check はどのマイグレーションよりも先に走る。integrity_check が完全にやることの、安い
// 構造の走査（ページと索引の整合。テーブルをまたぐ検証はしない）。壊れたファイルを開いてそこへ
// 書くと回収が難しくなるので、失敗はあとで分かりにくいクエリのエラーとして現れる前に、ここで
// DatabaseCorruptError を throw する。完全な integrity_check は定期の走査の担当 (#301)。
function openDatabase(file: string, opts: { readonly?: boolean } = {}) {
  const sqlite = new Database(file, { readonly: !!opts.readonly });

  // そもそも SQLite でないファイルは、ここで判定を返すのではなく SQLITE_NOTADB を throw する。
  // だから2つの形を同じエラーへ流し込むしかないし、どちらにせよハンドルを閉じないとファイルが
  // 掴まれたままになる。
  let check: unknown;
  try {
    check = sqlite.pragma('quick_check', { simple: true });
  } catch (err) {
    sqlite.close();
    throw new DatabaseCorruptError(`cannot read ${file} as a database: ${err.message}`);
  }
  if (check !== 'ok') {
    sqlite.close();
    throw new DatabaseCorruptError(`quick_check failed for ${file}: ${check}`);
  }

  // WAL は接続をまたいで残る（ファイルのヘッダに入っている）が、開くたびに設定する。WAL でない
  // バックアップから復元したデータベースにも、これを取り戻させるため。
  if (!opts.readonly) sqlite.pragma('journal_mode = WAL');
  // 他の接続が書き込みロックを持っているときは、throw せずに待つ＝読み取り専用の性能計測の
  // 道具も、バックアップのスナップショットも、普段の利用と重なるため。
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  if (!opts.readonly) runMigrations(sqlite);

  const db = new Kysely<Schema>({ dialect: new SqliteDialect({ database: sqlite }) });
  return { db, sqlite };
}

// SCHEMA_V1_SQL (#295 St2) を型で映したもの。列の名前が camelCase なのは、置き換える先の
// サイドカー JSON に合わせるため (#5 の 2026-07-18 のコメント)＝SQLite 自体は識別子の大小を
// 区別しないので、これはエンジンの要求ではなく命名の作法。lib-db-schema.ts とは手で歩調を
// 合わせる。手で書いたマイグレーションの文字列から型を生成する仕組みは Kysely に無いので、
// あちらに足してここに足さなかった列は、それを使う最初のクエリで型検査に落ちるだけ＝実行時に
// ずれることはありえない。
interface PostsTable {
  captureId: string;
  assetClass: string;
  mediaType: string | null;
  image: string | null;
  video: string | null; // add-post-video のマイグレーション (#299)＝PostRecordShape.video を参照
  url: string | null;
  platform: string | null;
  text: string | null;
  title: string | null;
  displayName: string | null;
  screenName: string | null;
  userId: string | null;
  avatar: string | null;
  avatarFile: string | null;
  followers: number | null;
  authorCreatedAt: string | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  bookmarks: number | null;
  views: number | null;
  date: string | null;
  capturedAt: string;
  updatedAt: string;
  lang: string | null;
  isReply: number | null;
  isQuote: number | null;
  isThread: number | null;
  quotedUrl: string | null;
  replyToId: string | null;
  hashtags: string; // JSON の string[]＝タグでない葉は素のテキストのまま (#5 の 2026-07-18 のコメント)
  eagleName: string | null;
  memo: string | null; // rename-description-to-memo のマイグレーション (#36)＝PostRecordShape.memo を参照
  source: string | null;
  shotW: number | null;
  shotH: number | null;
  trashedAt: string | null;
  userKind: string | null;
  tagReviewed: number | null;
  capturedVia: string | null; // add-captured-via のマイグレーション (#362)＝取り込みの経路。null は普通の保存
  // fts-rowid-addressing のマイグレーション (#444)＝この投稿の posts_fts の rowid。内部の
  // キーで、意図して POST_COLUMNS に入れていない。このデータベースの FTS の索引の中の行を
  // 指すもので、書き出しや他のライブラリでは何も意味しない。
  ftsRowid: number | null;
  replaces: string | null; // add-post-replaces のマイグレーション (#34)＝未処理の置き換えの印。掃かれれば null
  // add-post-image-index のマイグレーション (#560)＝PostRecordShape.imageIndex を参照
  imageIndex: number | null;
  imageCount: number | null;
  // add-post-dom-filled のマイグレーション (#202)＝JSON の string[] で、持ち方は hashtags と
  // 同じ。PostRecordShape.domFilled を参照。これより前に書かれた行では null。
  domFilled: string | null;
  // add-post-edited-fields のマイグレーション (#189)＝PostRecordShape.isEdited/editedAt を参照。
  isEdited: number | null;
  editedAt: string | null;
  // add-post-cw-sensitive のマイグレーション (#178)＝PostRecordShape.cw/sensitive を参照。
  cw: string | null;
  sensitive: number | null;
  // add-post-series-fields のマイグレーション (#188)＝PostRecordShape の
  // seriesId/seriesTitle/seriesOrder を参照。
  seriesId: string | null;
  seriesTitle: string | null;
  seriesOrder: number | null;
  // add-post-quoted-refs のマイグレーション (#180)＝JSON の QuotedPostShape で、持ち方の約束事
  // は hashtags/domFilled と同じ。PostRecordShape.quotedPost/replyToPost を参照。
  quotedPost: string | null;
  replyToPost: string | null;
  // add-media-max-dims のマイグレーション (#162)＝PostRecordShape.mediaMaxW/H/Bytes を参照。
  mediaMaxW: number | null;
  mediaMaxH: number | null;
  mediaMaxBytes: number | null;
  // add-post-custom-emojis のマイグレーション (#290)＝JSON の CustomEmojiShape[] で、持ち方の
  // 約束事は hashtags/domFilled と同じ。PostRecordShape.customEmojis を参照。
  customEmojis: string | null;
  // add-post-poll のマイグレーション (#179)＝JSON の PollShape で、持ち方の約束事は
  // quotedPost/replyToPost と同じ。PostRecordShape.poll を参照。
  poll: string | null;
  // add-post-file のマイグレーション (#236)＝assetClass:'file' のレコードにおける、取り込んだ
  // ものそれ自身のファイル（それらの行では image/video/mediaType は null のまま）。
  // PostRecordShape.file を参照。
  file: string | null;
  // add-post-link-card のマイグレーション (#181)＝JSON の LinkCardShape で、持ち方の約束事は
  // quotedPost/replyToPost/poll と同じ。PostRecordShape.linkCard を参照。
  linkCard: string | null;
  // add-post-shot-animated のマイグレーション (#8)＝PostRecordShape.shotAnimated を参照。
  shotAnimated: number | null;
  // add-post-meta-source のマイグレーション (#239)＝JSON の Record<string,string> で、持ち方の
  // 約束事は quotedPost/replyToPost/poll/linkCard と同じ。PostRecordShape.metaSource を参照。
  metaSource: string | null;
}
interface MediaTable {
  id: Generated<number>;
  postId: string;
  seq: number;
  url: string | null;
  alt: string | null;
  width: number | null;
  height: number | null;
  file: string;
  type: string | null; // add-media-video-fields のマイグレーション (#119 St1)
  posterFile: string | null; // add-media-video-fields のマイグレーション (#119 St1)
  frames: string | null; // add-media-frames のマイグレーション (#119 St3)＝JSON の [{file,delay}]。うごイラだけ
}
interface TagsTable {
  id: Generated<number>;
  name: string;
  kind: string | null; // 意図して自由なテキスト＝固定の3値の列挙は #157 が設計し直している最中
  reading: string | null; // #164 がこれを埋め戻す。それまではどの行でも空
}
interface TagParentsTable {
  tagId: number;
  parentTagId: number;
  isDisplay: number;
}
interface TagAliasesTable {
  id: Generated<number>;
  alias: string;
  tagId: number;
}
interface PostTagsTable {
  postId: string;
  tagId: number;
}
interface FoldersTable {
  id: string;
  name: string;
  kind: string;
  created: number | null;
  parentId: string | null;
  tree: string | null; // JSON の保存済み検索の木。dynamic なフォルダだけ
}
interface FolderItemsTable {
  folderId: string;
  postId: string;
}
interface PosterFoldersTable {
  id: string;
  name: string;
}
interface PosterFolderItemsTable {
  folderId: string;
  posterKey: string;
}
interface PosterTagsTable {
  posterKey: string;
  tagId: number;
}
// add-poster-aliases のマイグレーション (#23 St1)。
interface PosterAliasGroupsTable {
  id: string;
  primaryKey: string;
}
interface PosterAliasGroupMembersTable {
  groupId: string;
  posterKey: string;
}
interface ManualGroupsTable {
  id: Generated<number>;
}
interface ManualGroupItemsTable {
  groupId: number;
  postId: string;
  seq: number;
}
interface UngroupedKeysTable {
  postKey: string;
}
interface TabsTable {
  id: string;
  windowId: string;
  position: number;
  pinned: number;
  title: string | null;
  state: string; // JSON＝履歴とクエリ木。中身を見ない再生用の状態（列で問い合わせない）
}
interface TabWindowsTable {
  windowId: string;
  activeTabId: string | null;
}
interface StoreStateTable {
  key: string;
  value: string;
}
// add-inbox-tables のマイグレーション (#299 St6)＝MIGRATIONS のコメントを参照。
interface InboxEventsTable {
  eventId: string;
  captureId: string;
  payloadSha256: string;
  importedAt: string;
  sourceSegment: string | null;
}
interface InboxSegmentsTable {
  segmentId: string;
  payloadSha256: string;
  importedAt: string;
}
// add-raw-payloads のマイグレーション (#292)＝MIGRATIONS のエントリを参照。payload は BLOB。
// better-sqlite3 は Buffer を束縛し Buffer を読み戻すので、型は文字列ではなく node の buffer
// の型になる。
interface RawPayloadsTable {
  id: Generated<number>;
  postId: string;
  sourceKind: string;
  acquiredAt: string;
  contentType: string | null;
  encoding: string;
  sha256: string;
  byteLength: number;
  payload: Buffer | null;
}
// add-poster-profiles のマイグレーション (#289)＝現在と履歴のテーブルを分けた理由と、
// followers/authorCreatedAt が contentHash の外に乗っている理由は、MIGRATIONS のエントリを
// 参照。links は JSON の文字列 (ProfileLinkShape[] | null) で、持ち方の約束事は
// posts.hashtags/domFilled と同じ。
interface PosterProfilesTable {
  posterKey: string;
  // poster-profile-platform-nullable のマイグレーション (#919) 以降、NULL 可。投稿者を出して
  // いるページのブックマークにはプラットフォームが無く、posterKeyOf は番兵の値ではなく
  // `web:<host>:<id>` という自分のキーをそれに与える。
  platform: string | null;
  userId: string | null;
  instance: string | null;
  displayName: string | null;
  screenName: string | null;
  bio: string | null;
  links: string | null;
  avatar: string | null;
  avatarFile: string | null;
  banner: string | null;
  bannerFile: string | null;
  followers: number | null;
  authorCreatedAt: string | null;
  contentHash: string;
  provenance: string;
  firstObservedAt: string;
  lastObservedAt: string;
}
interface PosterProfileSnapshotsTable {
  id: Generated<number>;
  posterKey: string;
  observedAt: string;
  displayName: string | null;
  screenName: string | null;
  bio: string | null;
  links: string | null;
  avatar: string | null;
  avatarFile: string | null;
  banner: string | null;
  bannerFile: string | null;
  followers: number | null;
  authorCreatedAt: string | null;
  contentHash: string;
  provenance: string;
}
// postsFts は FTS5 (posts_fts)。普通のテーブルではなく仮想テーブルなので、Kysely の型付きの
// insert/select は効くが、DDL の補助は当たらない＝作るのは lib-db-schema.ts の生の SQL。
// postId は UNINDEXED（一致の結果がそれを `posts` へ連れ戻す。MATCH がそれを探すことは決して
// ない）。rank は問い合わせ時の bm25() の式であって保存した列ではないので、ここに欄を持たない。
interface PostsFtsTable {
  postId: string;
  text: string | null;
  title: string | null;
  displayName: string | null;
  screenName: string | null;
  eagleName: string | null;
  memo: string | null; // rename-description-to-memo のマイグレーション (#36)
  hashtags: string | null; // 空白で連結したトークン。posts.hashtags の JSON ではない
  tagsText: string | null; // 解決したタグの名前を空白で連結（post_tags に直接索引できるテキストは無い）
  reading: string | null; // #164 がこれを埋め戻す。それまではどの行でも空
  cw: string | null; // add-post-cw-sensitive のマイグレーション (#178)＝投稿者自身が書いた CW の文
}

// add-history-table のマイグレーション (#145)＝MIGRATIONS のエントリを参照。state は JSON で、
// TabsTable.state が使うのと同じ「中身を見ない再生用の塊」の約束事（列で問い合わせない＝その
// 行の復元の振り分けがどう読むかは kind が決める）。
interface HistoryTable {
  id: Generated<number>;
  ts: number;
  u: string;
  kind: string;
  title: string;
  state: string;
}

interface Schema {
  posts: PostsTable;
  media: MediaTable;
  tags: TagsTable;
  tag_parents: TagParentsTable;
  tag_aliases: TagAliasesTable;
  post_tags: PostTagsTable;
  folders: FoldersTable;
  folder_items: FolderItemsTable;
  poster_folders: PosterFoldersTable;
  poster_folder_items: PosterFolderItemsTable;
  poster_tags: PosterTagsTable;
  poster_alias_groups: PosterAliasGroupsTable;
  poster_alias_group_members: PosterAliasGroupMembersTable;
  manual_groups: ManualGroupsTable;
  manual_group_items: ManualGroupItemsTable;
  ungrouped_keys: UngroupedKeysTable;
  tabs: TabsTable;
  tab_windows: TabWindowsTable;
  history: HistoryTable;
  store_state: StoreStateTable;
  posts_fts: PostsFtsTable;
  inbox_events: InboxEventsTable;
  inbox_segments: InboxSegmentsTable;
  raw_payloads: RawPayloadsTable;
  poster_profiles: PosterProfilesTable;
  poster_profile_snapshots: PosterProfileSnapshotsTable;
}

export { openDatabase, runMigrations, DatabaseCorruptError, MIGRATIONS };
export type { Migration, MigrationDb, Schema };
