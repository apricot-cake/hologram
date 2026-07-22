'use strict';

// Generate a throwaway dummy library for testing/verification (#175).
//
// Writes a full library of synthetic sidecar JSONs + placeholder images to an
// arbitrary folder (OUTSIDE the repo, separate from the real library), so features,
// design, search/collation calibration (#164/#165) and the #5 SQLite migration's
// before/after performance baseline (#293) can be exercised on volume/variety
// WITHOUT touching real data.
//
//   node scripts/gen-dummy-library.cts <outDir> [options]
//
// Options:
//   --count N       posts to generate (default 3000)
//   --authors N     distinct authors (default ~count/4, skewed: few prolific, long tail)
//   --years N       spread post dates over the last N years (default 4)
//   --seed N        PRNG seed (default 1) — output is byte-deterministic per (seed,count,args)
//   --corpus FILE   draw post text from FILE (one fragment per line) instead of the built-in pool
//   --force         overwrite even if <outDir> is non-empty (default: abort to protect existing data)
//
// Why a new script (vs scripts/inject-dummy.cjs): inject-dummy writes ~36 fixed
// condition-covering posts to the REAL save folder via Electron (canvas images).
// This one is pure Node (no Electron/deps — hand-encoded PNGs via zlib), scales to
// thousands with realistic skewed distributions, is deterministic, and refuses to
// write into the repo or the configured save folder. Runs blocklessly in CI/agents.
//
// Determinism: all randomness comes from the seeded PRNG below and a FIXED base
// date (no Date.now()), so a given (seed, count, options) reproduces the same bytes.
//
// Schema: mirrors the real sidecar = extension metadata + { captureId, image,
// media[], avatarFile } (native-host/bridge.cts). Re-derive from the real schema
// if it drifts (this is a dev tool, expected to age with schema changes).
//
// KNOWN LIMITATION (#175 follow-up): every placeholder image is a PNG, so no record
// is classified as a screenshot (isScreenshot in app/renderer/records.ts keys off a
// .jpg/.jpeg extension). Card/tile/gallery for media-bearing posts are unaffected
// (the card image is media[0] regardless), but the list-density "capture leads" and
// the gallery "screenshot rides the tail" branches are not exercised by this data.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { configDir, defaultLibraryDir } = require('../native-host/paths.cts');

// --- Seeded PRNG (mulberry32) — small, fast, deterministic --------------------
function makeRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
    // Zipf-ish skew into [0, n): exponent > 1 concentrates on low indices.
    skew: (n: number, exp: number) => Math.min(n - 1, Math.floor(n * next() ** exp)),
  };
}

// --- Hand-encoded PNG (RGB, no deps) -----------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
// A small solid-ish placeholder: base color with a diagonal two-tone band, so
// thumbnails are visually distinct at a glance. Compresses tiny (flat rows).
function makePng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const [r, g, b] = rgb;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      // diagonal band lightens a stripe ~1/4 of the way across
      const band = (x + y) % Math.max(8, Math.floor((w + h) / 6)) < 3;
      const o = row + 1 + x * 3;
      raw[o] = band ? Math.min(255, r + 60) : r;
      raw[o + 1] = band ? Math.min(255, g + 60) : g;
      raw[o + 2] = band ? Math.min(255, b + 60) : b;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// Assorted small image dimensions (varied aspect ratios so masonry height
// reservation / shotW-shotH has real variety to chew on).
const DIMS: ReadonlyArray<[number, number]> = [
  [96, 54], // 16:9 landscape
  [72, 72], // square
  [60, 90], // portrait 2:3
  [48, 120], // tall
  [120, 68], // wide
  [90, 60], // landscape 3:2
  [80, 100], // portrait 4:5
  [128, 72], // wide
];

// --- Content pools (built-in, license-safe: all original short phrases) -------
const PLATFORMS = [
  { id: 'x', weight: 0.5, hasBookmarks: true, hasViews: true, hosts: null as string[] | null },
  { id: 'bluesky', weight: 0.2, hasBookmarks: false, hasViews: false, hosts: null },
  { id: 'misskey', weight: 0.18, hasBookmarks: false, hasViews: false, hosts: ['misskey.io', 'nijimiss.moe', 'mi.sabbo.dev'] },
  { id: 'mastodon', weight: 0.12, hasBookmarks: false, hasViews: false, hosts: ['mastodon.social', 'mstdn.jp', 'fedibird.com'] },
] as const;

// Japanese name material (given-name-ish + suffix), plus English display names.
const JA_NAME_A = ['あお', 'ゆき', 'はる', 'そら', 'みや', 'かえ', 'りん', 'なな', 'つき', 'しの', 'まこ', 'ひな', 'れい', 'かの', 'とも', 'さや'];
const JA_NAME_B = ['さん', 'ちゃん', 'っち', '部長', '研究所', 'の人', 'ノート', 'メモ', '', '', 'P', '_dev'];
const EN_FIRST = ['Alex', 'Sam', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Taylor', 'Jamie', 'Quinn', 'Avery', 'Dev', 'Nova', 'Kai', 'Luca'];
const EN_LAST = ['Wright', 'Kim', 'Rivera', 'Ono', 'Bauer', 'Stone', 'Vega', 'Frost', 'Ln', 'Codes', 'Draws', 'Lab'];

// Text fragments to compose posts of varied length. Original phrasing (no quotes
// from real works) to stay license-clean and offline.
const JA_FRAG = [
  '今日は朝からずっと作業してた',
  '新しいペンタブの描き心地が良すぎる',
  'TypeScriptの型で唸ってたけど解決した',
  'この配色、我ながら気に入ってる',
  'ラフから線画までやっと進んだ',
  'コーヒー飲みながらデバッグ中',
  '締め切り前の追い込み、がんばる',
  '空の色がきれいだったので写真撮った',
  '積んでた本をようやく読み始めた',
  '猫が邪魔してくるけどそれも幸せ',
  'ローカル保存できるの本当に助かる',
  '過去の投稿を見返すと成長を感じる',
  'アップデートの検証、地道にやってる',
  '深夜のテンションで描いた落書き',
  '資料集めが一番時間かかるんだよな',
  '週末は展示を見に行く予定',
  'やっとバグの原因が分かってスッキリ',
  '手元にライブラリがあると探すのが速い',
];
const EN_FRAG = [
  'spent the whole morning refactoring',
  'the new brush feels incredible',
  'finally cracked that type error',
  'pretty happy with this color palette',
  'lineart is done, coloring next',
  'debugging with coffee again',
  'crunch mode before the deadline',
  'the sky looked unreal today',
  'started reading that book at last',
  'the cat is helping (not helping)',
  'local-first archiving is a lifesaver',
  'looking back at old posts, so much growth',
  'slow and steady verification pass',
  'a late-night doodle, no regrets',
  'gathering references takes forever',
  'gallery visit planned for the weekend',
  'so relieved I found the root cause',
  'having my own searchable library is huge',
];
const JA_HASH = ['#イラスト', '#作業配信', '#プログラミング', '#写真', '#日記', '#ねこ', '#創作', '#技術書', '#ドット絵', '#デザイン'];
const EN_HASH = ['#art', '#devlog', '#typescript', '#photography', '#gamedev', '#sketch', '#oc', '#design', '#pixelart', '#writing'];

// Sidecar tags[] vocabulary. General tags plus PROPER-NOUN-LIKE fictional work /
// character names, mixed in at a realistic ratio — #165 (semantic collation) needs
// these to reproduce the embedding weakness where unknown proper nouns collide.
// All names are invented (not real works/characters).
const TAG_GENERAL_JA = ['風景', '猫', '技術', '作業資料', '模写', '習作', 'ラフ', '背景', 'キャラデザ', '配色', 'ドット絵', '写真', '料理', '旅行'];
const TAG_GENERAL_EN = ['landscape', 'study', 'fanart', 'reference', 'wip', 'character', 'background', 'palette', 'photography', 'tutorial'];
const TAG_WORK = ['蒼穹のイストリア', '星霜メモリア', '紅蓮ノ刻', 'アステル戦記', 'ネビュラ・コード', '花冠のヴェルデ', 'クロノ・シアン', '銀灯のリフレイン'];
const TAG_CHARACTER = ['リィン', 'アオイ', 'セラフィナ', 'ノクト', 'ミレイユ', 'カイル', 'ユエ', 'テオドール', 'シャロ', 'ヴァイス'];

// --- Argument parsing ---------------------------------------------------------
function parseArgs(argv: string[]) {
  const opts: any = { count: 3000, authors: 0, years: 4, seed: 1, corpus: null, force: false, outDir: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--force') opts.force = true;
    else if (a === '--count') opts.count = Number(rest[++i]);
    else if (a === '--authors') opts.authors = Number(rest[++i]);
    else if (a === '--years') opts.years = Number(rest[++i]);
    else if (a === '--seed') opts.seed = Number(rest[++i]);
    else if (a === '--corpus') opts.corpus = rest[++i];
    else if (a.startsWith('--')) throw new Error(`Unknown option: ${a}`);
    else if (!opts.outDir) opts.outDir = a;
    else throw new Error(`Unexpected argument: ${a}`);
  }
  if (!opts.outDir) throw new Error('Missing <outDir>. Usage: node scripts/gen-dummy-library.cts <outDir> [--count N] [--seed N] [--years N] [--corpus FILE] [--force]');
  if (!Number.isFinite(opts.count) || opts.count < 1) throw new Error('--count must be a positive number');
  if (!opts.authors) opts.authors = Math.max(8, Math.floor(opts.count / 4));
  return opts;
}

// Refuse destinations that could clobber real data: the repo tree, the configured
// save folder, and the default library path. Keeps the "throwaway" promise honest.
function assertSafeOutDir(outDir: string) {
  const abs = path.resolve(outDir);
  const repoRoot = path.resolve(__dirname, '..');
  const within = (parent: string, child: string) => {
    const rel = path.relative(parent, child);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  if (within(repoRoot, abs)) throw new Error(`Refusing to write inside the repository: ${abs}`);
  const protectedDirs = [defaultLibraryDir()];
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg.saveFolder) protectedDirs.push(cfg.saveFolder);
  } catch {
    /* no config — only the default library path is protected */
  }
  for (const p of protectedDirs) {
    if (within(path.resolve(p), abs) || within(abs, path.resolve(p))) throw new Error(`Refusing to write to the real library path: ${abs} (overlaps ${p})`);
  }
}

// --- Author generation --------------------------------------------------------
function buildAuthors(rng: ReturnType<typeof makeRng>, n: number) {
  const authors: any[] = [];
  for (let i = 0; i < n; i++) {
    // Pick a platform by weight.
    let roll = rng.next();
    let plat: (typeof PLATFORMS)[number] = PLATFORMS[0];
    for (const p of PLATFORMS) {
      if (roll < p.weight) {
        plat = p;
        break;
      }
      roll -= p.weight;
    }
    const ja = rng.chance(0.7); // library skews Japanese but keeps a real EN minority
    const displayName = ja ? rng.pick(JA_NAME_A) + rng.pick(JA_NAME_B) : `${rng.pick(EN_FIRST)} ${rng.pick(EN_LAST)}`;
    const handleBase = `${ja ? 'user' : rng.pick(EN_FIRST).toLowerCase()}${i}`;
    let screenName: string, userId: string;
    if (plat.id === 'bluesky') {
      screenName = `${handleBase}.bsky.social`;
      userId = `did:plc:${crypto
        .createHash('sha1')
        .update('plc' + i)
        .digest('hex')
        .slice(0, 24)}`;
    } else if (plat.id === 'x') {
      screenName = handleBase;
      userId = String(100000000 + i);
    } else {
      screenName = handleBase;
      userId = `${plat.id[0]}k${String(i).padStart(5, '0')}`;
    }
    const host = plat.hosts ? plat.hosts[rng.skew(plat.hosts.length, 1.5)] : null;
    authors.push({
      i,
      platform: plat,
      host,
      ja,
      displayName,
      screenName,
      userId,
      hasAvatar: rng.chance(0.7),
      lastLocalId: null as string | null, // for self-reply chains
    });
  }
  return authors;
}

// --- Post local-id + URL per platform ----------------------------------------
function localId(rng: ReturnType<typeof makeRng>, platform: string): string {
  if (platform === 'x' || platform === 'mastodon') return String(rng.int(10 ** 17, 10 ** 18 - 1));
  // bsky rkey / misskey note id: base32-ish token
  const alpha = 'abcdefghijklmnopqrstuvwxyz234567';
  let s = '';
  for (let k = 0; k < 13; k++) s += alpha[rng.int(0, alpha.length - 1)];
  return s;
}
function postUrl(author: any, lid: string): string {
  const p = author.platform.id;
  if (p === 'x') return `https://x.com/${author.screenName}/status/${lid}`;
  if (p === 'bluesky') return `https://bsky.app/profile/${author.screenName}/post/${lid}`;
  if (p === 'mastodon') return `https://${author.host}/@${author.screenName}/${lid}`;
  return `https://${author.host}/notes/${lid}`;
}

// --- Text / tag synthesis -----------------------------------------------------
function synthText(rng: ReturnType<typeof makeRng>, ja: boolean, corpus: string[] | null): string {
  const frags = corpus || (ja ? JA_FRAG : EN_FRAG);
  const sep = ja && !corpus ? '。' : ' ';
  // length class: short 1, medium 2-3, long 4-8 (weighted toward short/medium)
  const r = rng.next();
  const n = r < 0.5 ? 1 : r < 0.85 ? rng.int(2, 3) : rng.int(4, 8);
  const parts: string[] = [];
  for (let k = 0; k < n; k++) parts.push(rng.pick(frags));
  let text = parts.join(sep);
  if (ja && !corpus && !text.endsWith('。')) text += '。';
  // hashtags (~40%)
  if (rng.chance(0.4)) {
    const pool = ja ? JA_HASH : EN_HASH;
    const h = rng.int(1, 3);
    const picked = new Set<string>();
    for (let k = 0; k < h; k++) picked.add(rng.pick(pool));
    text += ' ' + [...picked].join(' ');
  }
  // an inline URL (~8%)
  if (rng.chance(0.08)) text += ` https://example.com/${rng.int(1000, 9999)}`;
  return text;
}
function synthTags(rng: ReturnType<typeof makeRng>, ja: boolean): string[] {
  if (!rng.chance(0.55)) return []; // ~45% untagged (mirrors a real, mostly-untagged library)
  const tags = new Set<string>();
  const n = rng.int(1, 4);
  for (let k = 0; k < n; k++) {
    const r = rng.next();
    // ~35% of tag picks are proper-noun-like (work/character) — the #165 calibration signal
    if (r < 0.2) tags.add(rng.pick(TAG_WORK));
    else if (r < 0.35) tags.add(rng.pick(TAG_CHARACTER));
    else tags.add(rng.pick(ja ? TAG_GENERAL_JA : TAG_GENERAL_EN));
  }
  return [...tags];
}

// Engagement counts with a heavy-tailed distribution (most posts small, a few viral).
function engagement(rng: ReturnType<typeof makeRng>): number {
  const r = rng.next();
  if (r < 0.6) return rng.int(0, 50);
  if (r < 0.9) return rng.int(50, 2000);
  if (r < 0.99) return rng.int(2000, 80000);
  return rng.int(80000, 3000000);
}

function main() {
  const opts = parseArgs(process.argv);
  assertSafeOutDir(opts.outDir);
  const outDir = path.resolve(opts.outDir);

  // Safety valve: never overwrite a non-empty folder unless --force.
  if (fs.existsSync(outDir)) {
    const entries = fs.readdirSync(outDir);
    if (entries.length && !opts.force) {
      throw new Error(`Refusing: ${outDir} is not empty (${entries.length} entries). Use --force to overwrite, or pick an empty folder.`);
    }
  }
  fs.mkdirSync(outDir, { recursive: true });
  const avatarDir = path.join(outDir, 'avatars');
  fs.mkdirSync(avatarDir, { recursive: true });

  const rng = makeRng(opts.seed);
  const corpus: string[] | null = opts.corpus
    ? fs
        .readFileSync(opts.corpus, 'utf8')
        .split(/\r?\n/)
        .map((s: string) => s.trim())
        .filter(Boolean)
    : null;
  if (opts.corpus && (!corpus || !corpus.length)) throw new Error(`--corpus file is empty: ${opts.corpus}`);

  const authors = buildAuthors(rng, opts.authors);
  const avatarWritten = new Set<number>();

  // Fixed date window (deterministic — no Date.now()): posts spread over the last
  // `years` back from a constant anchor.
  const anchor = Date.parse('2026-06-01T00:00:00Z');
  const spanMs = opts.years * 365 * 86400000;

  const stats = { platform: {} as Record<string, number>, media: {} as Record<string, number>, tagged: 0, replies: 0, quotes: 0, threads: 0, artwork: 0, bytes: 0 };
  const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] || 0) + 1);
  const write = (file: string, data: Buffer | string) => {
    fs.writeFileSync(file, data as any);
    stats.bytes += Buffer.byteLength(data as any);
  };

  for (let i = 0; i < opts.count; i++) {
    // Skew post ownership toward a prolific minority (Zipf-ish long tail).
    const author = authors[rng.skew(authors.length, 1.7)];
    const id = `gen-${String(i).padStart(6, '0')}`;
    const plat = author.platform;

    // Post type. A minority are "artwork" (imported illustration) records: the image
    // IS the content, no engagement screenshot, source marker set — mirrors the
    // drag/eagle-migration record shape the app also supports.
    const isArtwork = rng.chance(0.2);

    const dateMs = anchor - Math.floor(rng.next() * spanMs);
    const date = new Date(dateMs).toISOString();
    const capturedAt = new Date(dateMs + rng.int(60, 86400) * 1000).toISOString();

    // Avatar (shared per author, written once).
    let avatarFile: string | null = null;
    if (author.hasAvatar) {
      const hash = crypto
        .createHash('sha1')
        .update('av' + author.i)
        .digest('hex')
        .slice(0, 16);
      const rel = `avatars/${hash}.png`;
      if (!avatarWritten.has(author.i)) {
        const c = 60 + (author.i % 6) * 28;
        write(path.join(avatarDir, `${hash}.png`), makePng(64, 64, [c, 120, 200 - (author.i % 5) * 20]));
        avatarWritten.add(author.i);
      }
      avatarFile = rel;
    }

    // Primary image (screenshot placeholder for posts, the artwork itself otherwise).
    const [iw, ih] = DIMS[rng.skew(DIMS.length, 1)];
    const tint: [number, number, number] = plat.id === 'x' ? [30, 40, 55] : plat.id === 'bluesky' ? [0, 90, 180] : plat.id === 'misskey' ? [120, 160, 40] : [95, 95, 200];
    const imageName = `${id}.png`;
    write(path.join(outDir, imageName), makePng(iw, ih, tint));

    // Attached originals (multi-image), for non-artwork image posts.
    let mediaType = 'image';
    const media: any[] = [];
    if (isArtwork) {
      mediaType = 'image';
    } else {
      const roll = rng.next();
      if (roll < 0.25) mediaType = 'none';
      else if (roll < 0.35) mediaType = 'video';
      else if (roll < 0.42) mediaType = 'gif';
      if (mediaType === 'image' || mediaType === 'gif') {
        const nMedia = rng.next() < 0.7 ? 1 : rng.int(2, 4); // most single, some multi-image
        for (let m = 0; m < nMedia; m++) {
          const [mw, mh] = DIMS[rng.skew(DIMS.length, 1)];
          const mfile = `${id}-media-${m}.png`;
          write(path.join(outDir, mfile), makePng(mw, mh, [tint[0] + 20, tint[1] + 20, tint[2] - 10]));
          media.push({ url: `https://example.com/orig/${id}/${m}.png`, alt: rng.chance(0.3) ? 'alt text' : null, width: mw, height: mh, file: mfile });
        }
      }
    }

    const lid = localId(rng, plat.id);
    const type = isArtwork ? 'post' : rng.pick(['post', 'post', 'post', 'reply', 'quote', 'thread']);
    // Self-reply chain: some replies point at this author's previous post's local id.
    let replyToId: string | null = null;
    if (type === 'reply' && author.lastLocalId && rng.chance(0.4)) replyToId = author.lastLocalId;

    const ja = author.ja;
    const likes = engagement(rng);
    const rec: any = {
      captureId: id,
      image: imageName,
      url: postUrl(author, lid),
      platform: plat.id,
      text: isArtwork ? '' : synthText(rng, ja, corpus),
      displayName: author.displayName,
      screenName: author.screenName,
      userId: author.userId,
      likes: isArtwork ? null : likes,
      reposts: isArtwork ? null : Math.floor(likes * (0.05 + rng.next() * 0.2)),
      replies: isArtwork ? null : Math.floor(likes * rng.next() * 0.05),
      bookmarks: !isArtwork && plat.hasBookmarks ? Math.floor(likes * rng.next() * 0.1) : null,
      views: !isArtwork && plat.hasViews ? likes * rng.int(5, 60) : null,
      date,
      capturedAt,
      mediaType: isArtwork ? 'image' : mediaType,
      lang: ja ? 'ja' : 'en',
      isReply: type === 'reply' || null,
      isQuote: type === 'quote' || null,
      isThread: type === 'thread' || null,
      quotedUrl: type === 'quote' ? `https://example.com/quoted/${rng.int(1000, 9999)}` : null,
      replyToId,
      tags: synthTags(rng, ja),
      media,
      avatarFile,
    };
    if (author.host) rec.host = author.host;
    if (isArtwork) {
      rec.source = rng.chance(0.5) ? 'eagle-migration' : 'drag';
      rec.title = rec.tags[0] || (ja ? '無題' : 'untitled');
      if (rng.chance(0.3)) rec.url = ''; // some imported artwork has no source URL
    }

    write(path.join(outDir, `${id}.json`), JSON.stringify(rec, null, 2));
    author.lastLocalId = lid;

    // Tally.
    bump(stats.platform, plat.id);
    bump(stats.media, rec.mediaType);
    if (rec.tags.length) stats.tagged++;
    if (rec.isReply) stats.replies++;
    if (rec.isQuote) stats.quotes++;
    if (rec.isThread) stats.threads++;
    if (isArtwork) stats.artwork++;
  }

  // Summary.
  const mb = (stats.bytes / 1048576).toFixed(1);
  console.log(`Generated ${opts.count} posts → ${outDir}`);
  console.log(`  seed=${opts.seed}  authors=${opts.authors}  years=${opts.years}  size=${mb} MB`);
  console.log(
    `  platform: ${Object.entries(stats.platform)
      .map(([k, v]) => `${k}=${v}`)
      .join('  ')}`,
  );
  console.log(
    `  mediaType: ${Object.entries(stats.media)
      .map(([k, v]) => `${k}=${v}`)
      .join('  ')}`,
  );
  console.log(`  tagged=${stats.tagged}  replies=${stats.replies}  quotes=${stats.quotes}  threads=${stats.threads}  artwork=${stats.artwork}`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`gen-dummy-library: ${(err as Error).message}\n`);
  process.exit(1);
}
