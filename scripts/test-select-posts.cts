'use strict';

// Auto-select test posts for the capture test matrix (test-plan.md section A).
// Queries PUBLIC APIs only and prints a session sheet: per cell, the URL to
// open, the action, and what to expect. Cells that inherently need an in-page
// human pick (X timeline/search etc.) get the page URL + selection criteria.
//
//   node scripts/test-select-posts.cts          (needs network)
//
// Flow: run this → open each URL → Alt+S + click (or drag) → the watcher
// (scripts/test-watch-verify.cts) auto-verifies every capture as it lands.

const { fetchXTweet } = require('../extension/utils/metadata.ts');

const rows: any[] = [];
function row(id, label, url, action, expect) {
  rows.push({ id, label, url, action, expect });
}

async function j(url, opts?) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// --- X: no public search API. Validate curated evergreen posts via the
// syndication API; cells with no live candidate fall back to human criteria.
async function selectX() {
  const alive = async (id) => {
    try {
      const r = await fetchXTweet({ id, screenName: null }, `https://x.com/i/web/status/${id}`);
      return r && r.text ? r : null;
    } catch {
      return null;
    }
  };
  const jack = await alive('20');
  const obama = await alive('266031293945503744'); // single photo, evergreen
  row('A-1a', 'X TL', 'https://x.com/home', 'クリック', 'エンゲージ>0の投稿を選ぶ');
  row('A-1k', 'X 検索結果', 'https://x.com/search?q=%E7%8C%AB%20filter%3Aimages&f=live', 'クリック', '検索文脈でも本人の投稿が保存される');
  row('A-1b', 'X 詳細（プレーン）', jack ? 'https://x.com/jack/status/20' : null, 'クリック', 'url が素のパーマリンク（/photo等なし）');
  row('A-1l', 'X 詳細（画像）', obama ? 'https://x.com/BarackObama/status/266031293945503744' : null, 'クリック', 'media[] ?name=orig・原寸DL');
  row('A-1c', 'X プロフィール', 'https://x.com/jack', 'クリック', 'プロフィール文脈でも対象投稿が保存される');
  row('A-1e', 'X TL上の引用', 'https://x.com/home', 'クリック（引用ツイート全体）', '引用した側が保存・quotedUrlが引用元');
  row('A-1i', 'X 動画投稿', null, 'クリック', 'mediaType=video（TL/検索で動画投稿を選ぶ）');
  row('A-1m', 'X ドラッグ（TL/詳細の画像）', obama ? 'https://x.com/BarackObama/status/266031293945503744' : null, '画像をドラッグ', '画像の属する投稿として保存');
  row('A-1n', 'X ドラッグ（ライトボックス）★修正検証', obama ? 'https://x.com/BarackObama/status/266031293945503744/photo/1' : null, 'ライトボックスを開き、右側の返信欄の画像をドラッグ', '返信の投稿として保存される（ライトボックス投稿に化けない）。本体画像のドラッグはライトボックス投稿として保存');
  row('A-1o', 'X ドラッグ（アバター/バナー）★修正検証', 'https://x.com/jack', 'プロフィールのバナー/アバターをドラッグ', 'ドロップゾーンが出ない（捏造レコードを作らない）');
}

// --- Bluesky: fully automatic via the public AppView.
async function selectBluesky() {
  const posts: any[] = [];
  for (const actor of ['bsky.app', 'jay.bsky.team', 'pfrazee.com']) {
    try {
      const f = await j(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${actor}&limit=60&filter=posts_with_replies`);
      for (const it of f.feed || []) if (it.post) posts.push(it.post);
    } catch {
      /* next actor */
    }
  }
  try {
    const s = await j('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=photo&limit=60');
    for (const p of s.posts || []) posts.push(p);
  } catch {
    /* search may be unavailable */
  }

  const urlOf = (p) => {
    const m = (p.uri || '').match(/\/app\.bsky\.feed\.post\/([^/]+)$/);
    return m && p.author && p.author.handle ? `https://bsky.app/profile/${p.author.handle}/post/${m[1]}` : null;
  };
  const embedType = (p) => (p.embed && p.embed.$type) || '';
  const imgCount = (p) => {
    const e = p.embed;
    if (!e) return 0;
    if ((e.$type || '').includes('recordWithMedia')) return ((e.media && e.media.images) || []).length;
    return (e.images || []).length;
  };
  const pick = (fn) => {
    const p = posts.find((q) => urlOf(q) && fn(q));
    return p ? urlOf(p) : null;
  };

  row('A-2a', 'Bluesky TL', 'https://bsky.app/', 'クリック', 'フィードの投稿が本人のものとして保存');
  row(
    'A-2b',
    'Bluesky 詳細',
    pick((p) => p.likeCount > 0 && p.replyCount > 0 && !(p.record && p.record.reply) && !embedType(p)),
    'クリック',
    'DID・エンゲージ一致',
  );
  row(
    'A-2g',
    'Bluesky 複数画像',
    pick((p) => imgCount(p) > 1),
    'クリック',
    '画像が枚数ぶん原寸DLされる',
  );
  row(
    'A-2e',
    'Bluesky リプライ',
    pick((p) => p.record && p.record.reply),
    'クリック',
    'isReply/isThread・replyToId',
  );
  row(
    'A-2f',
    'Bluesky 引用（詳細ページで）★修正検証',
    pick((p) => embedType(p).includes('embed.record')),
    'クリック（引用した側の本体）',
    '保存されるのは引用した側（引用元に化けない）。quotedUrl=引用元',
  );
  row(
    'A-2h',
    'Bluesky 動画',
    pick((p) => embedType(p).includes('embed.video')),
    'クリック',
    'mediaType=video',
  );
  row(
    'A-2i',
    'Bluesky ドラッグ',
    pick((p) => imgCount(p) >= 1 && p.likeCount > 0),
    '画像をドラッグ',
    'url canonical（/liked-by等が付かない）',
  );
}

// --- Misskey: misskey.io global timeline.
async function selectMisskey() {
  let notes: any[] = [];
  try {
    notes = await j('https://misskey.io/api/notes/global-timeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 100 }),
    });
  } catch {
    /* keep empty */
  }
  if (!Array.isArray(notes)) notes = [];
  const urlOf = (n) => `https://misskey.io/notes/${n.id}`;
  const imgs = (n) => (n.files || []).filter((f) => f.type && f.type.startsWith('image/') && f.type !== 'image/gif');
  const pick = (fn) => {
    const n = notes.find((q) => q && q.id && fn(q));
    return n ? urlOf(n) : null;
  };

  row('A-3a', 'Misskey TL', 'https://misskey.io/', 'クリック', 'TLのノートが本人のものとして保存');
  row(
    'A-3b',
    'Misskey 詳細（画像）',
    pick((n) => imgs(n).length >= 1 && !n.replyId && !n.renoteId),
    'クリック',
    '作者・画像一致',
  );
  row(
    'A-3g',
    'Misskey 複数画像',
    pick((n) => imgs(n).length > 1),
    'クリック',
    '画像が枚数ぶんDL',
  );
  row(
    'A-3e',
    'Misskey リプライ ★修正検証',
    pick((n) => n.replyId),
    'クリック',
    '親ノートではなくリプライ本人が保存される',
  );
  row(
    'A-3f',
    'Misskey 引用リノート',
    pick((n) => n.renoteId && (n.text || (n.files || []).length)),
    'クリック',
    'isQuote=true（画像のみ引用も）',
  );
  row(
    'A-3d',
    'Misskey 純リノート（TLで）',
    pick((n) => n.renoteId && !n.text && !(n.files || []).length && !n.cw && !n.poll),
    'TLでリノートをクリック',
    '元ノートとして保存・isQuoteなし',
  );
}

// --- Mastodon: mastodon.social public timeline (reblogs excluded by the API
// — the boost cell stays a human pick on the web UI).
async function selectMastodon() {
  let media: any[] = [];
  let all: any[] = [];
  try {
    media = await j('https://mastodon.social/api/v1/timelines/public?limit=40&only_media=true');
  } catch {
    /* skip */
  }
  try {
    all = await j('https://mastodon.social/api/v1/timelines/public?limit=40');
  } catch {
    /* skip */
  }
  // public timeline can be auth-gated — fall back to known active accounts
  if (!Array.isArray(media) || !media.length || !Array.isArray(all) || !all.length) {
    for (const acct of ['Gargron', 'Mastodon']) {
      try {
        const a = await j(`https://mastodon.social/api/v1/accounts/lookup?acct=${acct}`);
        if (!a || !a.id) continue;
        const st = await j(`https://mastodon.social/api/v1/accounts/${a.id}/statuses?limit=40&exclude_reblogs=true`);
        const stm = await j(`https://mastodon.social/api/v1/accounts/${a.id}/statuses?limit=40&only_media=true`);
        if (Array.isArray(st)) all = (all || []).concat(st);
        if (Array.isArray(stm)) media = (media || []).concat(stm);
      } catch {
        /* next */
      }
    }
    // replies need exclude_replies=false on a busy account
    try {
      const a = await j('https://mastodon.social/api/v1/accounts/lookup?acct=Gargron');
      const rep = await j(`https://mastodon.social/api/v1/accounts/${a.id}/statuses?limit=40&exclude_reblogs=true&exclude_replies=false`);
      if (Array.isArray(rep)) all = all.concat(rep);
    } catch {
      /* skip */
    }
  }
  const urlOf = (s) => `https://mastodon.social/@${s.account.acct}/${s.id}`;
  const pick = (arr, fn) => {
    const s = (arr || []).find((q) => q && q.account && !q.reblog && fn(q));
    return s ? urlOf(s) : null;
  };

  row('A-4a', 'Mastodon TL', 'https://mastodon.social/public/local', 'クリック', 'TLの投稿が本人のものとして保存');
  row(
    'A-4b',
    'Mastodon 詳細（画像）',
    pick(media, (s) => (s.media_attachments || []).some((a) => a.type === 'image')),
    'クリック',
    '作者・画像一致',
  );
  row(
    'A-4g',
    'Mastodon 複数画像',
    pick(media, (s) => (s.media_attachments || []).filter((a) => a.type === 'image').length > 1),
    'クリック',
    '画像が枚数ぶんDL',
  );
  row(
    'A-4e',
    'Mastodon リプライ',
    pick(all, (s) => s.in_reply_to_id),
    'クリック',
    'isReply=true',
  );
  row('A-4d', 'Mastodon ブースト（TLで）', 'https://mastodon.social/public/local', 'ブースト表示をクリック', '元投稿として保存（ブースト側に化けない）');
  row('A-4f', 'Mastodon 引用（4.4+）★修正検証', null, '引用プレビュー内をクリック', '引用した側が保存される（要: 引用投稿を目視で発見）');
}

// --- pixiv: daily ranking JSON.
async function selectPixiv() {
  let items: any[] = [];
  try {
    const r = await j('https://www.pixiv.net/ranking.php?mode=daily&format=json&p=1', { headers: { Referer: 'https://www.pixiv.net/' } });
    items = Array.isArray(r.contents) ? r.contents : [];
  } catch {
    /* skip */
  }
  const ok = (c) => c && c.illust_id && String(c.illust_type) !== '2';
  const urlOf = (c) => `https://www.pixiv.net/artworks/${c.illust_id}`;
  const single = items.find((c) => ok(c) && Number(c.illust_page_count) === 1);
  const multi = items.find((c) => ok(c) && Number(c.illust_page_count) > 1);

  row('A-5a', 'pixiv 作品ページ', single ? urlOf(single) : null, 'クリック（作品画像）', 'タイトル/作者/タグ/キャプション');
  row('A-5b', 'pixiv 複数ページ ★修正検証', multi ? `${urlOf(multi)}（${multi.illust_page_count}p）` : null, 'クリック', '全ページ原寸DL（拡張子混在でも404しない）');
  row('A-5c', 'pixiv 検索/ランキンググリッド', 'https://www.pixiv.net/ranking.php?mode=daily', 'グリッドのサムネをクリック', 'クリックした作品のIDが保存される（隣に化けない）');
  row('A-5d', 'pixiv ドラッグ（ページ指定）', multi ? `${urlOf(multi)}（2枚目以降を展開してドラッグ）` : null, '2枚目の画像をドラッグ', 'imageIndex=2/N・そのページの原寸');
}

(async () => {
  console.log('テスト対象の自動選別中…（公開APIを照会）\n');
  await Promise.all([selectX(), selectBluesky(), selectMisskey(), selectMastodon(), selectPixiv()]);

  rows.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  console.log('# キャプチャテスト・セッションシート');
  console.log(`生成: ${new Date().toISOString()}　手順: URLを開く → Alt+S → アクション。検証は test-watch-verify.cts が自動。\n`);
  console.log('| # | セル | URL / 選び方 | アクション | 期待 |');
  console.log('|---|------|--------------|-----------|------|');
  for (const r of rows) {
    const url = r.url || '（自動選別できず — 対象ページで条件に合う投稿を選ぶ）';
    console.log(`| ${r.id} | ${r.label} | ${url} | ${r.action} | ${r.expect} |`);
  }
  const missing = rows.filter((r) => !r.url).length;
  console.log(`\n${rows.length} セル（自動選別 ${rows.length - missing} / 手動選択 ${missing}）`);
})();
