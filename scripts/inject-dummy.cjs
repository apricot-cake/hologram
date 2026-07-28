'use strict';

// Populate the library with condition-covering dummy posts for testing the viewer
// (platforms, post types, media, engagement ranges, dates, languages, hashtags,
// tags). Runs via Electron because it renders placeholder images with a canvas.
//
//   app/node_modules/.bin/electron scripts/inject-dummy.cjs  [saveFolder]
//
// With no folder argument it writes to the configured save folder. Images go to the
// save folder, records go into the library database (~/.hologram/hologram.db) —
// **CLOSE THE APP FIRST**: the database has a single writer and this tool takes
// that role for the duration.
//
// Why .cjs (not .cts): as the ELECTRON entry it must load via the classic CommonJS
// loader so Electron's require('electron') injection applies — a .ts/.cts entry goes
// through Node 22's ESM CJS-translator where that injection is absent (require dies
// with ERR_MODULE_NOT_FOUND). require('../native-host/paths.cts') below still works:
// a classic require() of a .cts sibling type-strips it fine. Plain JS anyway, so .cjs
// costs no type coverage. Do NOT rename back to .cts. (See make-icons.cjs for detail.)

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const _os = require('node:os');
const path = require('node:path');
const { configDir, defaultLibraryDir } = require('../native-host/paths.cts');

function resolveFolder() {
  const arg = process.argv.find((a, i) => i >= 2 && !a.startsWith('--') && !a.endsWith('.js'));
  if (arg) return arg;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg.saveFolder) return cfg.saveFolder;
  } catch {
    /* no config */
  }
  return defaultLibraryDir(); // SAME default the app uses (was ~/Hologram, which the app never watches)
}

const COLORS = { x: '#14171a', bluesky: '#0085ff', misskey: '#86b300', mastodon: '#6364ff' };

// type: post | reply | quote | thread ; media: image | video | gif | none
const POSTS = [
  // --- X ---
  {
    platform: 'x',
    type: 'post',
    media: 'image',
    lang: 'ja',
    displayName: 'てすと太郎',
    screenName: 'testuser1',
    userId: '111',
    likes: 1234567,
    reposts: 89000,
    replies: 4200,
    bookmarks: 56000,
    views: 9800000,
    tags: ['開発'],
    text: 'TypeScriptの型パズル、解けた時の快感がすごい。再帰型テンプレートリテラル最高 #typescript #プログラミング',
  },
  { platform: 'x', type: 'reply', media: 'none', lang: 'en', displayName: 'Dev Jane', screenName: 'devjane', userId: '112', likes: 3, reposts: 0, replies: 1, bookmarks: 0, views: 210, tags: [], text: 'Good morning! Replying with coffee and code.' },
  { platform: 'x', type: 'quote', media: 'none', lang: 'ja', displayName: 'サンプル花子', screenName: 'hanako', userId: '113', likes: 48, reposts: 12, replies: 3, bookmarks: 5, views: 8900, tags: [], quotedUrl: 'https://x.com/someone/status/999', text: 'これは面白い視点。引用元も見てほしい #ガジェット' },
  { platform: 'x', type: 'thread', media: 'video', lang: 'ja', displayName: 'キャンパー', screenName: 'camper', userId: '114', likes: 320, reposts: 40, replies: 8, bookmarks: 22, views: 41000, tags: ['アウトドア'], text: 'スレッドの続き。今回のキャンプ動画です #キャンプ' },
  { platform: 'x', type: 'post', media: 'gif', lang: 'en', displayName: 'Meme Lord', screenName: 'memelord', userId: '115', likes: 88000, reposts: 21000, replies: 900, bookmarks: 12000, views: 3400000, tags: ['fun'], text: 'when the build finally passes #funny #devlife' },
  { platform: 'x', type: 'post', media: 'image', lang: 'ja', displayName: 'ねこ好き', screenName: 'nekozuki', userId: '116', likes: 250000, reposts: 33000, replies: 1200, bookmarks: 41000, views: 5600000, tags: ['猫', '癒し'], text: 'うちの子、今日も可愛い #ねこ #cat' },
  { platform: 'x', type: 'reply', media: 'image', lang: 'ja', displayName: '質問たろう', screenName: 'qtaro', userId: '117', likes: 12, reposts: 1, replies: 4, bookmarks: 2, views: 1500, tags: [], text: 'これってどうやるんですか？ #質問' },
  { platform: 'x', type: 'post', media: 'none', lang: 'en', displayName: 'Long Writer', screenName: 'longwriter', userId: '118', likes: 540, reposts: 60, replies: 30, bookmarks: 80, views: 72000, tags: ['essay'], text: 'A longer post to test truncation and the click-to-expand behaviour. '.repeat(6) + '#longread' },
  { platform: 'x', type: 'quote', media: 'image', lang: 'ja', displayName: '引用man', screenName: 'quoteman', userId: '119', likes: 700, reposts: 90, replies: 15, bookmarks: 33, views: 110000, tags: [], quotedUrl: 'https://x.com/foo/status/888', text: '参考になる図解。元ツイ必見 #引用 #typescript' },
  { platform: 'x', type: 'post', media: 'video', lang: 'en', displayName: 'Gamer X', screenName: 'gamerx', userId: '120', likes: 4200, reposts: 510, replies: 88, bookmarks: 300, views: 880000, tags: ['gaming'], text: 'clutch play of the night #gaming' },
  { platform: 'x', type: 'post', media: 'none', lang: 'ja', displayName: 'ふつうの人', screenName: 'normaluser', userId: '121', likes: 2, reposts: 0, replies: 0, bookmarks: 0, views: 95, tags: [], text: 'おなかすいた' },
  { platform: 'x', type: 'thread', media: 'image', lang: 'ja', displayName: '絵描き', screenName: 'ekaki', userId: '122', likes: 9800, reposts: 2100, replies: 140, bookmarks: 3300, views: 720000, tags: ['イラスト'], text: '制作過程まとめ（1/4）#制作過程 #イラスト' },

  // --- Bluesky (no bookmarks/views) ---
  { platform: 'bluesky', type: 'post', media: 'image', lang: 'en', displayName: 'Alice', screenName: 'alice.bsky.social', userId: 'did:plc:alice', likes: 152, reposts: 33, replies: 11, tags: ['atproto'], text: 'AT Protocol is fun to build on. Custom feeds are powerful #atproto' },
  { platform: 'bluesky', type: 'reply', media: 'none', lang: 'ja', displayName: 'ぼぶ', screenName: 'bob.bsky.social', userId: 'did:plc:bob', likes: 9, reposts: 0, replies: 2, tags: [], text: '日記がわりに使ってます #日記' },
  { platform: 'bluesky', type: 'quote', media: 'image', lang: 'en', displayName: 'Carol', screenName: 'carol.bsky.social', userId: 'did:plc:carol', likes: 410, reposts: 70, replies: 25, quotedUrl: 'https://bsky.app/profile/x/post/abc', text: 'love this piece #art' },
  { platform: 'bluesky', type: 'post', media: 'none', lang: 'ja', displayName: 'ねこ部', screenName: 'nekobu.bsky.social', userId: 'did:plc:neko', likes: 88, reposts: 5, replies: 3, tags: ['猫'], text: 'Blueskyにも猫アカ作った #ねこ' },
  { platform: 'bluesky', type: 'post', media: 'video', lang: 'en', displayName: 'Naturalist', screenName: 'nature.bsky.social', userId: 'did:plc:nat', likes: 1200, reposts: 200, replies: 40, tags: ['nature'], text: 'morning birdsong #nature #photography' },
  { platform: 'bluesky', type: 'reply', media: 'image', lang: 'ja', displayName: '通りすがり', screenName: 'tori.bsky.social', userId: 'did:plc:tori', likes: 4, reposts: 0, replies: 1, tags: [], text: 'よこからすみません' },
  { platform: 'bluesky', type: 'post', media: 'gif', lang: 'en', displayName: 'Memer', screenName: 'memer.bsky.social', userId: 'did:plc:mem', likes: 5300, reposts: 1100, replies: 60, tags: ['meme'], text: 'mood #meme' },
  { platform: 'bluesky', type: 'post', media: 'none', lang: 'ja', displayName: '長文おじさん', screenName: 'choubun.bsky.social', userId: 'did:plc:cho', likes: 33, reposts: 2, replies: 0, tags: ['技術'], text: '長文テスト。'.repeat(20) + ' #typescript' },
  { platform: 'bluesky', type: 'quote', media: 'none', lang: 'en', displayName: 'News Bot', screenName: 'news.bsky.social', userId: 'did:plc:news', likes: 77, reposts: 30, replies: 5, quotedUrl: 'https://bsky.app/profile/y/post/zzz', text: 'breaking: it works #news' },

  // --- Misskey (reactions as likes; instances) ---
  { platform: 'misskey', host: 'misskey.io', type: 'post', media: 'image', lang: 'ja', displayName: 'みすきー民', screenName: 'mkuser', userId: 'mk001', likes: 230, reposts: 18, replies: 7, tags: ['Misskey'], text: 'カスタム絵文字とMFMが楽しい :blobcat: #Misskey' },
  { platform: 'misskey', host: 'misskey.io', type: 'reply', media: 'none', lang: 'ja', displayName: 'ノート職人', screenName: 'notemaster', userId: 'mk002', likes: 12, reposts: 0, replies: 3, tags: [], text: 'MFMの基本は公式ドキュメントが参考になりますよ #MFM' },
  { platform: 'misskey', host: 'nijimiss.moe', type: 'quote', media: 'video', lang: 'ja', displayName: 'にじみす民', screenName: 'nijifan', userId: 'nj001', likes: 45, reposts: 8, replies: 3, quotedUrl: 'https://misskey.io/notes/aaa', tags: ['にじみす'], text: 'テーマ変更手順を動画にしました #にじみす' },
  { platform: 'misskey', host: 'misskey.io', type: 'post', media: 'gif', lang: 'ja', displayName: 'サバ管', screenName: 'serveradmin', userId: 'mk006', likes: 567, reposts: 89, replies: 23, tags: ['サーバー管理'], text: '深夜にアップデートして祈る #ねこ' },
  { platform: 'misskey', host: 'nijimiss.moe', type: 'post', media: 'none', lang: 'ja', displayName: '技術好き', screenName: 'gijutsu', userId: 'nj002', likes: 89, reposts: 10, replies: 4, tags: ['技術'], text: '自鯖立てた話 #プログラミング' },
  { platform: 'misskey', host: 'misskey.io', type: 'post', media: 'image', lang: 'ja', displayName: 'カメラ部', screenName: 'camera', userId: 'mk010', likes: 3400, reposts: 420, replies: 60, tags: ['写真'], text: '夕焼けが綺麗だった #写真 #photography' },
  { platform: 'misskey', host: 'misskey.io', type: 'reply', media: 'image', lang: 'ja', displayName: 'もぐもぐ', screenName: 'mogu', userId: 'mk011', likes: 6, reposts: 0, replies: 1, tags: [], text: 'おいしそう' },
  { platform: 'misskey', host: 'misskey.io', type: 'post', media: 'none', lang: 'en', displayName: 'EN user', screenName: 'enuser', userId: 'mk012', likes: 40, reposts: 3, replies: 2, tags: [], text: 'testing misskey from english locale #english' },
  { platform: 'misskey', host: 'nijimiss.moe', type: 'post', media: 'video', lang: 'ja', displayName: 'ゲーマー', screenName: 'gamer_mk', userId: 'nj003', likes: 780, reposts: 120, replies: 30, tags: ['ゲーム'], text: '今日のプレイ動画 #ゲーム' },

  // --- Mastodon ---
  { platform: 'mastodon', host: 'mastodon.social', type: 'post', media: 'image', lang: 'en', displayName: 'Mastodon User', screenName: 'mastodonuser', userId: 'm001', likes: 412, reposts: 88, replies: 14, tags: ['fediverse'], text: 'loving the open social web #mastodon #fediverse' },
  { platform: 'mastodon', host: 'mstdn.jp', type: 'reply', media: 'none', lang: 'ja', displayName: 'ますとどん太郎', screenName: 'mstdntaro', userId: 'm002', likes: 23, reposts: 2, replies: 5, tags: [], text: 'mstdn.jp から返信テスト #マストドン' },
];

function postUrl(p, i) {
  const id = 1000 + i;
  if (p.platform === 'x') return `https://x.com/${p.screenName}/status/20622285024${id}`;
  if (p.platform === 'bluesky') return `https://bsky.app/profile/${p.screenName}/post/3k${id}`;
  if (p.platform === 'mastodon') return `https://${p.host}/@${p.screenName}/1100000000000${id}`;
  return `https://${p.host}/notes/dummy${id}`;
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 360, height: 240, webPreferences: { offscreen: false } });
  await win.loadURL('data:text/html,<body style="margin:0"><canvas id="c" width="320" height="200"></canvas></body>');

  const folder = resolveFolder();
  fs.mkdirSync(folder, { recursive: true });
  const base = Date.parse('2026-06-05T12:00:00Z');

  // The app's own DB modules are ESM — dynamic import (not require) so this classic
  // CommonJS Electron entry can still load them. Using the shared writePost keeps
  // the dummy rows from drifting away from the shape real producers write.
  const { openDatabase } = await import('../app/src/main/lib-db.ts');
  const { makeTagResolver, preparePostStmts, writePost } = await import('../app/src/main/lib-db-record-writer.ts');
  const handle = openDatabase(path.join(configDir(), 'hologram.db'));
  const stmts = preparePostStmts(handle.sqlite);
  const resolveTagId = makeTagResolver(handle.sqlite);

  for (let i = 0; i < POSTS.length; i++) {
    const p = POSTS[i];
    const id = `dummy-${String(i + 1).padStart(4, '0')}`;
    const color = COLORS[p.platform] || '#555';
    const label = p.platform === 'x' ? 'X' : p.platform === 'bluesky' ? 'Bluesky' : p.platform === 'misskey' ? 'Misskey' : 'Mastodon';
    const sub = `#${i + 1} · ${p.media}`;

    const dataUrl = await win.webContents.executeJavaScript(
      `(()=>{const c=document.getElementById('c'),x=c.getContext('2d');` +
        `x.fillStyle=${JSON.stringify(color)};x.fillRect(0,0,320,200);` +
        `x.fillStyle='#ffffff';x.textAlign='center';x.font='bold 28px sans-serif';x.fillText(${JSON.stringify(label)},160,96);` +
        `x.font='15px sans-serif';x.globalAlpha=0.85;x.fillText(${JSON.stringify(sub)},160,128);` +
        `return c.toDataURL('image/jpeg',0.72);})()`,
    );

    // Dummy avatar: a colored circle + the poster's initial on white. Distinguishable
    // from the monogram fallback (which is a grey square) so a glance tells real-but-
    // un-backfilled posters apart from these dummies. Lets the poster tile/inspector
    // avatar path be exercised without real avatarFile data.
    const initial = (p.displayName || p.screenName || '?').trim().charAt(0) || '?';
    const avDataUrl = await win.webContents.executeJavaScript(
      `(()=>{const c=document.getElementById('c'),x=c.getContext('2d');` +
        `x.fillStyle='#ffffff';x.fillRect(0,0,320,200);` +
        `x.fillStyle=${JSON.stringify(color)};x.beginPath();x.arc(160,100,92,0,Math.PI*2);x.fill();` +
        `x.fillStyle='#ffffff';x.textAlign='center';x.textBaseline='middle';x.font='bold 96px sans-serif';x.fillText(${JSON.stringify(initial)},160,106);` +
        `return c.toDataURL('image/jpeg',0.82);})()`,
    );

    const date = new Date(base - i * 3 * 86400000).toISOString();
    const capturedAt = new Date(base - i * 3 * 86400000 + 3600000).toISOString();
    const rec = {
      captureId: id,
      image: `${id}.jpg`,
      url: postUrl(p, i),
      platform: p.platform,
      text: p.text,
      displayName: p.displayName,
      screenName: p.screenName,
      userId: p.userId || null,
      likes: p.likes ?? null,
      reposts: p.reposts ?? null,
      replies: p.replies ?? null,
      bookmarks: p.bookmarks ?? null,
      views: p.views ?? null,
      date,
      capturedAt,
      mediaType: p.media,
      lang: p.lang,
      isReply: p.type === 'reply' || null,
      isQuote: p.type === 'quote' || null,
      isThread: p.type === 'thread' || null,
      quotedUrl: p.quotedUrl || null,
      avatarFile: `${id}-avatar.jpg`,
      tags: p.tags || [],
    };
    fs.writeFileSync(path.join(folder, `${id}.jpg`), Buffer.from(dataUrl.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(folder, `${id}-avatar.jpg`), Buffer.from(avDataUrl.split(',')[1], 'base64'));
    writePost(stmts, resolveTagId, rec);
  }

  handle.sqlite.close();
  console.log(`Wrote ${POSTS.length} dummy posts (images in ${folder}, records in the library database)`);
  app.quit();
});
