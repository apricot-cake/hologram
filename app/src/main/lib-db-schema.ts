// 現行形式の空のライブラリを作る。旧形式の変換はアプリ外で行う。
export const SCHEMA_VERSION = 48;

export const POSTS_FTS_SQL = `
CREATE VIRTUAL TABLE posts_fts USING fts5(
  postId UNINDEXED,
  text,
  title,
  displayName,
  screenName,
  eagleName,
  hashtags,
  tagsText,
  reading,
  cw,
  tokenize = 'trigram'
);
`;

// レコードライターが全文検索索引へ書き込む列の順序。
export const POSTS_FTS_COLUMNS = 'postId, text, title, displayName, screenName, eagleName, hashtags, tagsText, reading, cw';

export const CURRENT_SCHEMA_SQL = `
CREATE TABLE posts (
  captureId TEXT PRIMARY KEY,
  isContext INTEGER NOT NULL DEFAULT 0 CHECK(isContext IN (0, 1)),
  postKey TEXT,
  quotedPostId TEXT REFERENCES posts(captureId) ON DELETE SET NULL,
  saveScope TEXT NOT NULL DEFAULT 'post' CHECK(saveScope IN ('post', 'media')),
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
  source TEXT,
  shotW INTEGER,
  shotH INTEGER,
  trashedAt TEXT,
  userKind TEXT,
  tagReviewed INTEGER,
  capturedVia TEXT,
  video TEXT,
  ftsRowid INTEGER,
  replaces TEXT,
  imageIndex INTEGER,
  imageCount INTEGER,
  domFilled TEXT,
  isEdited INTEGER,
  cw TEXT,
  sensitive INTEGER,
  seriesId TEXT,
  seriesTitle TEXT,
  seriesOrder INTEGER,
  quotedPost TEXT,
  replyToPost TEXT,
  mediaMaxW INTEGER,
  mediaMaxH INTEGER,
  mediaMaxBytes INTEGER,
  poll TEXT,
  linkCard TEXT,
  shotAnimated INTEGER,
  metaSource TEXT,
  localViewCount INTEGER NOT NULL DEFAULT 0 CHECK(localViewCount >= 0),
  following INTEGER);

CREATE INDEX idx_posts_url ON posts(url);

CREATE INDEX idx_posts_capturedAt ON posts(capturedAt);

CREATE INDEX idx_posts_trashedAt ON posts(trashedAt);

CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  postId TEXT NOT NULL REFERENCES posts(captureId) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  url TEXT,
  alt TEXT,
  width INTEGER,
  height INTEGER,
  file TEXT NOT NULL,
  type TEXT,
  posterFile TEXT,
  frames TEXT,
  cropX REAL,
  cropY REAL,
  cropWidth REAL,
  cropHeight REAL);

CREATE INDEX idx_media_postId ON media(postId, seq);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  groupId TEXT,
  reading TEXT
);

CREATE INDEX idx_tags_name ON tags(name);



CREATE TABLE post_tags (
  postId TEXT NOT NULL REFERENCES posts(captureId) ON DELETE CASCADE,
  tagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (postId, tagId)
);

CREATE INDEX idx_post_tags_tagId ON post_tags(tagId);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'static' CHECK (kind IN ('static', 'dynamic')),
  created INTEGER,
  tree TEXT,
  parentId TEXT REFERENCES folders(id) ON DELETE CASCADE);

CREATE TABLE folder_items (
  folderId TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  postId TEXT NOT NULL REFERENCES posts(captureId) ON DELETE CASCADE,
  PRIMARY KEY (folderId, postId)
);

CREATE INDEX idx_folder_items_postId ON folder_items(postId);

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

CREATE TABLE manual_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE manual_group_items (
  groupId INTEGER NOT NULL REFERENCES manual_groups(id) ON DELETE CASCADE,
  postId TEXT NOT NULL REFERENCES posts(captureId) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  PRIMARY KEY (groupId, postId)
);

CREATE TABLE ungrouped_keys (
  postKey TEXT PRIMARY KEY
);

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

CREATE TABLE store_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

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

CREATE UNIQUE INDEX idx_posts_ftsRowid ON posts(ftsRowid);

CREATE TABLE history (
          id INTEGER PRIMARY KEY,
          ts INTEGER NOT NULL,
          u TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          state TEXT NOT NULL
        );

CREATE INDEX idx_history_ts ON history(ts, id);

CREATE TABLE "poster_profiles" (
          posterKey TEXT PRIMARY KEY,
          platform TEXT,
          userId TEXT,
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
        ,
  following INTEGER);
${POSTS_FTS_SQL}
CREATE INDEX posts_postKey ON posts(postKey);
CREATE INDEX posts_quotedPostId ON posts(quotedPostId);
`;
