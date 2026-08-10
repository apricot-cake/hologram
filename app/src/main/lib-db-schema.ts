'use strict';

// メタデータストアの v1 DDL (#5 St2 / #295)。サイドカー → DB の移行に要るテーブルを全部
// 収めている。#5 の設計コメント（2026-07-12 から 2026-07-22 まで）と、この Issue 自身の
// 射程の注記で確認済み。lib-db.ts から切り出したのは、エンジン（開く・マイグレーション）
// と形（「現行」が何を指すか）を1ファイルに同居させないため。lib-db.ts の型付き Schema
// インターフェースが、この文字列を手で保っている写し。
//
// St2 はスキーマだけ。これらのテーブルを埋めるものはまだ無い（サイドカーの取り込みは
// St3）。だから作りたての v1 データベースは空のテーブルばかりで、受け入れの線は
// 「DDL が通り、その形に問い合わせられる」ことであって「データが往復する」ことではない。
//
// 列の名前は camelCase で、置き換える先のサイドカー JSON の欄に合わせてある
// (#5 の 2026-07-18 のコメント＝SQLite は識別子の大小を区別しないので、これはエンジンの
// 都合ではなく、連続性のために持ち込んだ命名の作法)。
//
// 全体を通して FOREIGN KEY ... ON DELETE CASCADE を使う。投稿・タグ・フォルダを消すと、
// それに従属する行が落ちる。今の delete-post がサイドカーとその投稿が持つファイルを全部
// 消すのと同じ形で、後始末の走査を別に持たずに済む。`PRAGMA foreign_keys = ON` は
// openDatabase() が接続のたびに設定する（SQLite はこれを永続化しない）。
//
// 凍結の対象は DDL の文であって、`--` の注釈ではない。注釈は言語移行 (#1079) で
// 日本語にしてある。マイグレーションは name で適用されるので、注釈は挙動に関与しない。
export const SCHEMA_V1_SQL = `
-- posts: サイドカーの欄を、名前も NULL 可否も変えずに持つ。assetClass は意図して制約の
-- 無い TEXT にしてある (#5 の 2026-07-19 のコメント: 今は 'media' | 'file' で、いずれ
-- 'link' のカードがこの軸に加わる見込み。CHECK の列挙にすると、そのたびにマイグレーション
-- が要る＝拡張できると呼んだ意味が無くなる)。
CREATE TABLE posts (
  captureId TEXT PRIMARY KEY,
  assetClass TEXT NOT NULL DEFAULT 'media',
  mediaType TEXT,
  image TEXT,
  url TEXT,
  platform TEXT,
  text TEXT,
  title TEXT,
  displayName TEXT,
  screenName TEXT,
  userId TEXT,
  avatar TEXT,
  avatarFile TEXT,
  followers INTEGER,
  authorCreatedAt TEXT,
  likes INTEGER,
  reposts INTEGER,
  replies INTEGER,
  bookmarks INTEGER,
  views INTEGER,
  date TEXT,
  capturedAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  lang TEXT,
  isReply INTEGER,
  isQuote INTEGER,
  isThread INTEGER,
  quotedUrl TEXT,
  replyToId TEXT,
  hashtags TEXT NOT NULL DEFAULT '[]',
  eagleName TEXT,
  description TEXT,
  source TEXT,
  shotW INTEGER,
  shotH INTEGER,
  trashedAt TEXT
);
CREATE INDEX idx_posts_url ON posts(url);
CREATE INDEX idx_posts_capturedAt ON posts(capturedAt);
CREATE INDEX idx_posts_trashedAt ON posts(trashedAt);

-- media: 落としたメディア1件につき1行で、寸法も持つ (#5 の 2026-07-21 のコメント＝#286 の
-- 代役画像の生成の前提)。seq はサイドカーの media[] の並び順（カードの表示順）を保つ。
-- type/posterFile は add-media-video-fields のマイグレーション (#119 St1) で、frames は
-- add-media-frames (#119 St3) で入る＝v1 より後の他の列と同じく、この歴史的な v1 の
-- 文字列には入れない。
CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  postId TEXT NOT NULL REFERENCES posts(captureId) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  url TEXT,
  alt TEXT,
  width INTEGER,
  height INTEGER,
  file TEXT NOT NULL
);
CREATE INDEX idx_media_postId ON media(postId, seq);

-- tags: 実体は名前ではなく ID (#5 の 2026-07-18 のコメント＝#21 の同名キャラクターの
-- 問題)。name に UNIQUE 制約は無い＝別々の2つのタグが表示上の名前を共有してよく、区別は
-- 親（下）が付ける。kind は列挙ではなく自由な TEXT＝#157 が、固定の
-- work/character/general の組をユーザー定義のものへ設計し直しているところなので、ここに
-- CHECK を置くと #157 が入った瞬間にマイグレーションし直すことになる。
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT,
  reading TEXT
);
CREATE INDEX idx_tags_name ON tags(name);

-- tag_parents: 1つのタグが複数の親を持ってよい (2026-07-18 10:24 のコメント)。そのうち
-- 表示に使う親の印が付くのは高々1つ（曖昧さ回避のラベルと、あのコメントが説明している
-- 検索の包含＝「アリス（東方）」）。部分ユニーク索引が「高々1つ」の側を受け持つ。
-- 「ちょうど1つ」ではなく「高々1つ」でなければならないのは、ほとんどのタグが何の曖昧さも
-- 回避せず、最後まで isDisplay=0 のままだから。
CREATE TABLE tag_parents (
  tagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  parentTagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  isDisplay INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tagId, parentTagId)
);
CREATE UNIQUE INDEX idx_tag_parents_display ON tag_parents(tagId) WHERE isDisplay = 1;

-- tag_aliases: タグへ解決する別の名前 (#86＝danbooru/Hydrus の alias)。保管の形に議論の
-- 余地は無い（別名の文字列 → タグの id）。#86 の未決は、別名が本物のタグ名と衝突した
-- ときの UI 上の優先順位で、これを配線する段の読み取り経路の話であって DDL の話ではない。
CREATE TABLE tag_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alias TEXT NOT NULL,
  tagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE
);
CREATE INDEX idx_tag_aliases_alias ON tag_aliases(alias);

-- post_tags: 投稿とタグの中間テーブル。保存済み検索はタグの葉を tagId の参照として持つ
-- (#5 の 2026-07-18 10:24 のコメント)ので、改名で保存済みクエリが孤立することは無い。
-- ハッシュタグは posts.hashtags の素の文字列のまま（タグではない葉）。
CREATE TABLE post_tags (
  postId TEXT NOT NULL REFERENCES posts(captureId) ON DELETE CASCADE,
  tagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (postId, tagId)
);
CREATE INDEX idx_post_tags_tagId ON post_tags(tagId);

-- folders: 統一された入れ物（かつての "collections"、#42）。kind に制約が掛かっているのは
-- （上の assetClass や tags.kind とは違う）、normFolders 自身の三項演算子が、この
-- マイグレーションができる前から static/dynamic の閉じた対として扱ってきたから＝#5 の
-- 確定した射程に、第三の kind を開くものは無い。tree は dynamic なフォルダの保存済み検索
-- のクエリ木（JSON で、ここでは中身を見ない＝クエリ木の形は query.ts の担当であって DB の
-- 担当ではない）。この歴史的な v1 の文字列は不変のまま。フォルダの入れ子の parentId の列
-- (#41) は lib-db.ts の add-folder-parent のマイグレーションが足す。
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'static' CHECK (kind IN ('static', 'dynamic')),
  created INTEGER,
  tree TEXT
);
CREATE TABLE folder_items (
  folderId TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  postId TEXT NOT NULL REFERENCES posts(captureId) ON DELETE CASCADE,
  PRIMARY KEY (folderId, postId)
);
CREATE INDEX idx_folder_items_postId ON folder_items(postId);

-- clip_items と poster_workspace_items は v1 の一部としてここに入って出荷されたが（この
-- 文字列は歴史的なもので、変えてはいけない）、どちらの機能も退役している＝lib-db.ts の
-- 'drop-clip-items' と 'drop-poster-workspace-items' のマイグレーションが、これらの
-- テーブルを DROP する。
CREATE TABLE clip_items (
  postId TEXT PRIMARY KEY REFERENCES posts(captureId) ON DELETE CASCADE
);
CREATE TABLE poster_workspace_items (
  posterKey TEXT PRIMARY KEY
);

-- poster-folders.json / poster-tags.json: folders/post_tags の、投稿者表示側の対応物。
-- poster_tags が（素の文字列ではなく）tagId を参照するのは、2026-07-18 のコメントがこれを
-- 投稿のタグ語彙を共有するものとして説明しているから。文字列をキーのままにすると、タグを
-- ID の実体にした目的そのものである改名への強さから、投稿者だけが外れることになる。
CREATE TABLE poster_folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE poster_folder_items (
  folderId TEXT NOT NULL REFERENCES poster_folders(id) ON DELETE CASCADE,
  posterKey TEXT NOT NULL,
  PRIMARY KEY (folderId, posterKey)
);
CREATE TABLE poster_tags (
  posterKey TEXT NOT NULL,
  tagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (posterKey, tagId)
);

-- manual-groups.json: ユーザーが定義する、画像表示のまとまり。seq はグループの中の元の
-- 配列の順序を保つ。
CREATE TABLE manual_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT
);
CREATE TABLE manual_group_items (
  groupId INTEGER NOT NULL REFERENCES manual_groups(id) ON DELETE CASCADE,
  postId TEXT NOT NULL REFERENCES posts(captureId) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  PRIMARY KEY (groupId, postId)
);

-- ungrouped.json: postKey（画像表示のグループ化のキーで、URL から導く＝captureId では
-- ない）は意図して外部キーにしていない。キーは、かつてまとめたどの単一のキャプチャより
-- 長く生き残りうる。今の JSON のストアでも同じ。
CREATE TABLE ungrouped_keys (
  postKey TEXT PRIMARY KEY
);

-- tabs: タブ1つにつき1行。windowId は #32 の段3に備えたもの（今はどの行も同じ番兵の
-- ウィンドウを使う）。state は列に展開せず、中身を見ない JSON の塊のまま置く（履歴の
-- スタックとスクロール位置とクエリ木）＝ここでタブの state の中へ問い合わせるものは無く、
-- まるごと再生するだけ。だから関係の列にしても、レンダラーの state の形に欄が増えるたび
-- マイグレーションが要るようになるだけで、何も得られない。それを成り立たせている取り決め
-- は、レンダラーがこれらの列以外の全部を塊の中に入れること (services/tab-state.ts の
-- HologramTabPersist)。state の列の中ではなく隣に書かれた欄は、この INSERT が落とす欄
-- (#565)。
CREATE TABLE tabs (
  id TEXT PRIMARY KEY,
  windowId TEXT NOT NULL DEFAULT 'main',
  position INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  state TEXT NOT NULL
);
CREATE INDEX idx_tabs_windowId ON tabs(windowId, position);
CREATE TABLE tab_windows (
  windowId TEXT PRIMARY KEY,
  activeTabId TEXT REFERENCES tabs(id)
);

-- posts_fts: FTS5。reading の列は最初から入れてある (#5 の 2026-07-17 のコメント＝FTS5 は
-- あとから列を足すのに索引の全再構築が要るので、#164 まで誰も埋めないとしても、列と
-- クエリの取り決めは今のうちに入れる)。行の指し方は fts-rowid-addressing の
-- マイグレーション (#444) 以降 rowid＝下の POSTS_FTS_SQL を参照。あちらが同じ列の並びで
-- このテーブルを作り直す。
-- 独立している（content= の外部コンテンツのつながりを持たない）:
-- 埋めるのは St3（サイドカーの取り込み＝「導出索引の段」）の担当なので、この
-- マイグレーションは形が存在すれば足りる。hashtags/tagsText は FTS 用に事前トークン化した
-- （空白で連結した）写しで、posts.hashtags の JSON とは別物＝設計コメントが求める
-- 「事前トークン化」。クエリの取り決め: rank は保存した列ではなく bm25(posts_fts)＝
-- "SELECT postId, bm25(posts_fts) AS rank FROM posts_fts WHERE posts_fts MATCH ? ORDER BY
-- rank"。bm25() の列の重み付けと、事前トークン化した reading を語単位で一致させるかは、
-- どちらも実装時の判断に委ねてある (#5 の 2026-07-21 のコメント)。St4 が読み取り経路を
-- 配線するときに決める。
-- tokenize='trigram': 日本語の部分一致が正しく効くと St1 (#294) が確かめたのと同じ
-- トークナイザ (unicode61 は CJK のテキストを区切らない＝「猫がすき」のような連なりは
-- 1つの塊のトークンになるので、素の MATCH '猫' はまったく当たらない)。列を指定した
-- MATCH (col:term) は trigram でも効く。
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
`;

// 現行の posts_fts の定義。マイグレーションがテーブルを落として作り直せるように、独立
// した文にしてある（FTS5 に ALTER は無く、何かを変えるには作り直すしかない）。意図して
// SCHEMA_V1_SQL の中の文の写しにしてあり、埋め込みにはしていない。あちらの文字列は
// 歴史的なもので、こちらが動いても動いてはいけないため。fts-rowid-addressing の
// マイグレーション (#444) は行のキーを付け直すためにテーブルを作り直したが、形は変えて
// いない。形を変える最初のものが add-post-cw-sensitive のマイグレーション (#178)。cw は
// 投稿自身の言葉（投稿者が書いた内容警告の文）で、text/title と同じ位置付けだから、
// posts の行だけでなく検索できる索引にも入る。
//
// 意図して外部コンテンツのテーブル (content=posts) にはしていない。そのぶんこの索引は
// テキストの写しを自前で抱えることになるが、#444 で検討したうえで退けた。FTS5 は外部
// コンテンツの行を「SELECT <fts の全列> FROM <content>」として読むので、`posts` に無い
// 3列と同じ名前の列を `posts` に生やすことになる。事前トークン化した hashtags・tagsText・
// reading は post_tags/tags から導いたもので、投稿ではなく索引に属する。この形がここで
// 買えるのは保管の節約だけ。#444 が実際に抱えていた欠陥である行の指し方は、rowid の
// キー (posts.ftsRowid) が解いている。
export const POSTS_FTS_SQL = `
CREATE VIRTUAL TABLE posts_fts USING fts5(
  postId UNINDEXED,
  text,
  title,
  displayName,
  screenName,
  eagleName,
  memo,
  hashtags,
  tagsText,
  reading,
  cw,
  tokenize = 'trigram'
);
`;

// posts_fts の列を書き込みの順で並べたもの。マイグレーションの索引の作り直しと、共有の
// レコードライターの INSERT が同じものを使うので、両者がずれることはない。
// #36: `description` から改名した。この対について「現行」を名乗るのは
// rename-description-to-memo のマイグレーション (lib-db.ts) になり、その役を
// add-post-cw-sensitive から引き継いだ。
export const POSTS_FTS_COLUMNS = 'postId, text, title, displayName, screenName, eagleName, memo, hashtags, tagsText, reading, cw';
