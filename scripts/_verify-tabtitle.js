'use strict';
// Throwaway: tabTitleOf() logic verification (pure-function fixtures, no Electron).
// Run: node scripts/_verify-tabtitle.js

// --- Minimal stubs (mirrors the real MSG/helper values) ---
const MSG = {
  kindPost: 'SNS投稿', kindImage: '取り込み画像',
  userKindMedia: 'メディア', userKindPlain: 'ポスト',
  qfPost: '投稿', qfReply: '返信', qfQuote: '引用', qfThread: 'スレッド',
  qfDateCaptured: 'キャプチャ日', qfDatePost: '投稿日',
  qfImage: '画像', qfVideo: '動画', qfGif: 'GIF',
  qfMultiImage: '複数画像',
  workspaceTitle: 'ワークスペース',
  qfEngLikes: 'いいね', qfEngReposts: 'リポスト', qfEngReplies: '返信数',
  qfEngBookmarks: 'ブックマーク', qfEngViews: '閲覧',
};
const ENG_TYPE_LABELS = { likes: MSG.qfEngLikes, reposts: MSG.qfEngReposts, replies: MSG.qfEngReplies };
const formatCount = (n) => String(n ?? 0);
const formatShortDate = (s) => (s || '').slice(0, 7);
const CF = () => null;  // no folder resolution in unit tests

// --- filterLabel (copied from viewer.js) ---
function filterLabel(f) {
  switch (f.type) {
    case 'kind':       return f.value === 'post' ? MSG.kindPost : MSG.kindImage;
    case 'userKind':   return f.value === 'media' ? MSG.userKindMedia : MSG.userKindPlain;
    case 'platform':   return ({ x: 'X', bluesky: 'Bluesky', misskey: 'Misskey', mastodon: 'Mastodon', pixiv: 'pixiv' })[f.value] || f.value;
    case 'postType':   return f.value === 'post' ? MSG.qfPost : f.value === 'reply' ? MSG.qfReply : f.value === 'quote' ? MSG.qfQuote : MSG.qfThread;
    case 'date': {
      const typeName = f.dateField === 'capturedAt' ? MSG.qfDateCaptured : MSG.qfDatePost;
      const fromStr = f.from ? formatShortDate(f.from) : '';
      const toStr = f.to ? formatShortDate(f.to) : '';
      return `${typeName}: ${fromStr}〜${toStr}`;
    }
    case 'engagement': return `${ENG_TYPE_LABELS[f.engType] || f.engType} ${f.op === 'lte' ? '≤' : '≥'} ${formatCount(f.min)}`;
    case 'tag':        return `#${f.value}`;
    case 'folder': {   const fobj = CF() && CF().byId(f.value); return fobj ? fobj.name : f.value; }
    case 'workspace':  return MSG.workspaceTitle;
    case 'media':      return f.value === 'image' ? MSG.qfImage : f.value === 'video' ? MSG.qfVideo : MSG.qfGif;
    case 'instance':   return f.value;
    case 'user':       return f.label || f.value;
    default:           return f.value || f.type;
  }
}

// --- tabTitleOf (copied from viewer.js) ---
function tabTitleOf(state, ctx) {
  const filters  = (state && state.f) || [];
  const search   = (state && state.search) || '';
  const multi    = !!(state && state.multi);
  const allCount = (ctx && ctx.allCount != null) ? ctx.allCount : 0;
  const extra = filters.length + (search ? 1 : 0) + (multi ? 1 : 0) - 1;
  const sfx = extra > 0 ? ' ＋' + extra : '';

  if (search) {
    const q = search.length > 12 ? search.slice(0, 12) + '…' : search;
    return { text: '"' + q + '"' + sfx, iconType: 'search' };
  }
  const byType = {};
  filters.forEach((f) => { (byType[f.type] = byType[f.type] || []).push(f); });

  if (byType.tag)        return { text: filterLabel(byType.tag[0])  + sfx, iconType: 'tag' };
  if (byType.user)       return { text: filterLabel(byType.user[0]) + sfx, iconType: 'user' };

  const pfInst = filters.find((f) => f.type === 'platform' || f.type === 'instance');
  if (pfInst)            return { text: filterLabel(pfInst)  + sfx, iconType: pfInst.type };

  const ptMedia = filters.find((f) => f.type === 'postType' || f.type === 'media');
  if (ptMedia)           return { text: filterLabel(ptMedia) + sfx, iconType: ptMedia.type };
  if (multi)             return { text: MSG.qfMultiImage     + sfx, iconType: 'media' };

  if (byType.date)       return { text: filterLabel(byType.date[0])       + sfx, iconType: 'date' };
  if (byType.engagement) return { text: filterLabel(byType.engagement[0]) + sfx, iconType: 'engagement' };
  if (byType.kind)       return { text: filterLabel(byType.kind[0])       + sfx, iconType: 'kind' };

  const wsFolder = filters.find((f) => f.type === 'workspace' || f.type === 'folder');
  if (wsFolder)          return { text: filterLabel(wsFolder) + sfx, iconType: wsFolder.type };

  return { text: 'すべて(' + formatCount(allCount) + ')', iconType: 'all' };
}

// --- Test fixtures ---
const cases = [
  // no filters
  { desc: 'no filters → すべて(N)',
    state: { f: [], search: '', multi: false }, ctx: { allCount: 1234 },
    text: 'すべて(1234)', icon: 'all' },

  // search (priority 1)
  { desc: 'search only',
    state: { f: [], search: 'イラスト', multi: false }, ctx: { allCount: 100 },
    text: '"イラスト"', icon: 'search' },

  { desc: 'search >12 chars → truncated',
    state: { f: [], search: 'あいうえおかきくけこさしすせそ', multi: false }, ctx: { allCount: 0 },
    text: '"あいうえおかきくけこさし…"', icon: 'search' },

  { desc: 'search + 1 tag → search wins + ＋1',
    state: { f: [{ type: 'tag', value: 'art' }], search: '猫', multi: false }, ctx: { allCount: 50 },
    text: '"猫" ＋1', icon: 'search' },

  // tag (priority 2)
  { desc: 'single tag',
    state: { f: [{ type: 'tag', value: 'イラスト' }], search: '', multi: false }, ctx: { allCount: 0 },
    text: '#イラスト', icon: 'tag' },

  { desc: '3 tags → first tag + ＋2',
    state: { f: [{ type: 'tag', value: 'a' }, { type: 'tag', value: 'b' }, { type: 'tag', value: 'c' }], search: '', multi: false }, ctx: { allCount: 0 },
    text: '#a ＋2', icon: 'tag' },

  // user (priority 3)
  { desc: 'user filter',
    state: { f: [{ type: 'user', value: 'x:123', label: 'Alice' }], search: '', multi: false }, ctx: {},
    text: 'Alice', icon: 'user' },

  // platform (priority 4)
  { desc: 'platform bluesky',
    state: { f: [{ type: 'platform', value: 'bluesky' }], search: '', multi: false }, ctx: {},
    text: 'Bluesky', icon: 'platform' },

  { desc: 'platform pixiv + engagement → platform wins',
    state: { f: [{ type: 'platform', value: 'pixiv' }, { type: 'engagement', engType: 'likes', op: 'gte', min: 100 }], search: '', multi: false }, ctx: {},
    text: 'pixiv ＋1', icon: 'platform' },

  // postType (priority 5)
  { desc: 'postType reply',
    state: { f: [{ type: 'postType', value: 'reply' }], search: '', multi: false }, ctx: {},
    text: '返信', icon: 'postType' },

  // media (priority 5)
  { desc: 'media image',
    state: { f: [{ type: 'media', value: 'image' }], search: '', multi: false }, ctx: {},
    text: '画像', icon: 'media' },

  // multi (priority 5, below explicit media)
  { desc: 'multiOnly only',
    state: { f: [], search: '', multi: true }, ctx: { allCount: 0 },
    text: '複数画像', icon: 'media' },

  // date (priority 6)
  { desc: 'date filter',
    state: { f: [{ type: 'date', dateField: 'capturedAt', from: '2026-01-01', to: '2026-06-30' }], search: '', multi: false }, ctx: {},
    text: 'キャプチャ日: 2026-01〜2026-06', icon: 'date' },

  // engagement (priority 7)
  { desc: 'engagement filter',
    state: { f: [{ type: 'engagement', engType: 'likes', op: 'gte', min: 500 }], search: '', multi: false }, ctx: {},
    text: 'いいね ≥ 500', icon: 'engagement' },

  // kind (priority 8)
  { desc: 'kind post',
    state: { f: [{ type: 'kind', value: 'post' }], search: '', multi: false }, ctx: {},
    text: 'SNS投稿', icon: 'kind' },

  // workspace (priority 9)
  { desc: 'workspace',
    state: { f: [{ type: 'workspace', value: '1' }], search: '', multi: false }, ctx: {},
    text: 'ワークスペース', icon: 'workspace' },
];

// --- Run ---
let pass = 0, fail = 0;
cases.forEach(({ desc, state, ctx, text, icon }) => {
  const got = tabTitleOf(state, ctx);
  const okText = got.text === text;
  const okIcon = got.iconType === icon;
  if (okText && okIcon) {
    pass++;
    console.log('  PASS', desc);
  } else {
    fail++;
    if (!okText) console.error('  FAIL', desc, '\n    text expected:', JSON.stringify(text), '\n    text got:     ', JSON.stringify(got.text));
    if (!okIcon) console.error('  FAIL', desc, '\n    icon expected:', icon, '\n    icon got:     ', got.iconType);
  }
});
console.log(`\n${pass + fail} cases: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
