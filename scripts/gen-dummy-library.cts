'use strict';

// テスト・検証用の使い捨てダミーライブラリを生成する（#175）。
//
// プレースホルダのメディアを任意のフォルダ（リポジトリの外＝実ライブラリとは別）に
// 書き出し、合成レコードを持つ hologram.db も添える。これにより、機能・設計・
// 検索/照合のキャリブレーション（#164/#165）・#5 の性能計測を、実データに触れずに
// 量とバリエーションの面で試せる。
//
//   node scripts/gen-dummy-library.cts <outDir> [options]
//
// オプション:
//   --count N       生成する投稿数（既定 3000）
//   --authors N     投稿者数（既定 ~count/4、偏り: 少数が多作、ロングテール）
//   --years N       投稿日時を過去 N 年に散らす（既定 4）
//   --seed N        PRNG シード（既定 1）＝出力は (seed,count,args) ごとにバイト単位で決定的
//   --corpus FILE   組み込みプールの代わりに FILE（1行1フラグメント）から投稿文を取る
//   --db FILE       データベースの書き出し先（既定 <outDir>/hologram.db）
//   --force         <outDir> が空でなくても上書きする（既定: 既存データ保護のため中止）
//
// これが生成したものにアプリを向けるには: HOLOGRAM_CONFIG_DIR をスクラッチディレクトリに
// 設定し、生成された hologram.db をそこへ置き、その config の saveFolder を <outDir> に
// 設定する。レコードはデータベースへ直接入る＝ライブラリがレコードを保持する場所が
// そこだから（#302）＝メディアの隣に投稿ごとの JSON を書いても、誰も読まないファイルが
// できるだけ。
//
// なぜ新しいスクリプトか（scripts/inject-dummy.cjs との違い）: inject-dummy は
// Electron 経由（canvas 画像）で実ライブラリの保存フォルダへ約36件の固定の条件網羅用
// 投稿を書く。こちらは純粋な Node（Electron も依存も無し＝zlib で手書きエンコードした
// PNG）で、現実的な偏った分布のまま数千件までスケールし、決定的で、リポジトリや
// 設定済みの保存フォルダへの書き込みを拒否する。CI・エージェント上でもブロックせずに動く。
//
// 決定性: 全ての乱数は下の seed 付き PRNG と固定の基準日（Date.now() を使わない）
// から来るため、同じ (seed, count, options) は同じバイト列を再現する。
//
// スキーマ: レコードは実際の全プロデューサーが使うのと同じ writePost
// （app/src/main/lib-db-record-writer.ts）を通るため、生成される行はアプリ自身の
// 形からずれ得ない＝ここで選んだ FIELDS だけが古びうる（これは開発ツールで、
// スキーマ変更とともに古びるのは想定内）。
//
// 既知の制約 1: プレースホルダ画像は全て PNG のため、スクリーンショットとして
// 分類されるレコードが無い（app/src/renderer/src/services/records.ts の isScreenshot は
// .jpg/.jpeg 拡張子で判定する）。メディア付き投稿のカード/タイル/ギャラリーには
// 影響しない（カード画像はどのみち media[0] のため）が、一覧密度の「capture が
// 先頭に来る」分岐とギャラリーの「スクリーンショットが末尾に付く」分岐は、この
// データでは経由しない。
//
// 既知の制約 2: 下の表示名プールは小さく（JA 192 通り / EN 168 通り）、投稿者数は
// --count に比例して増えるため、大規模になると名前が重複する（1万投稿で JA の名前
// 1つあたり約9人、10万投稿で約91人）。実際のプラットフォームでも表示名は共有される
// ものの、一意な名前のロングテールを伴う。ここでの共有は一様で、一意なものは無い。
// ハンドルは一意のまま（投稿者の index が screenName の一部）なので、レコードの
// 識別性と投稿者ごとのグループ化は正しく保たれる。

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { configDir, defaultLibraryDir } = require('../native-host/paths.mts');
const { openDatabase } = require('../app/src/main/lib-db.ts');
const { makeTagResolver, preparePostStmts, writePost } = require('../app/src/main/lib-db-record-writer.ts');

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
    // [0, n) への Zipf 的な偏り: 指数 > 1 で小さい添字に集中する。
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
// ほぼ単色の小さなプレースホルダ: 基調色に斜めの二色バンドを入れ、サムネイルが
// 一目で見分けられるようにする。圧縮すると小さい（行が平坦なため）。
function makePng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 2; // カラータイプ: truecolor RGB
  const [r, g, b] = rgb;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0; // フィルター: なし
    for (let x = 0; x < w; x++) {
      // 斜めのバンドが横幅の約1/4のあたりでストライプを明るくする
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

// 各種の小さな画像寸法（masonry の高さ確保／shotW-shotH に実際のバリエーションを
// 与えるため、アスペクト比を散らしてある）。
const DIMS: ReadonlyArray<[number, number]> = [
  [96, 54], // 16:9 横長
  [72, 72], // 正方形
  [60, 90], // 縦長 2:3
  [48, 120], // 縦長
  [120, 68], // 横長
  [90, 60], // 横長 3:2
  [80, 100], // 縦長 4:5
  [128, 72], // 横長
];

// --- コンテンツプール（組み込み・ライセンス安全: 全てオリジナルの短文）-------
const PLATFORMS = [
  { id: 'x', weight: 0.5, hasBookmarks: true, hasViews: true, hosts: null as string[] | null },
  { id: 'bluesky', weight: 0.2, hasBookmarks: false, hasViews: false, hosts: null },
  { id: 'misskey', weight: 0.18, hasBookmarks: false, hasViews: false, hosts: ['misskey.io', 'nijimiss.moe', 'mi.sabbo.dev'] },
  { id: 'mastodon', weight: 0.12, hasBookmarks: false, hasViews: false, hosts: ['mastodon.social', 'mstdn.jp', 'fedibird.com'] },
] as const;

// 日本語の名前素材（名前っぽい語＋接尾辞）と英語の表示名。
const JA_NAME_A = ['あお', 'ゆき', 'はる', 'そら', 'みや', 'かえ', 'りん', 'なな', 'つき', 'しの', 'まこ', 'ひな', 'れい', 'かの', 'とも', 'さや'];
const JA_NAME_B = ['さん', 'ちゃん', 'っち', '部長', '研究所', 'の人', 'ノート', 'メモ', '', '', 'P', '_dev'];
const EN_FIRST = ['Alex', 'Sam', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Taylor', 'Jamie', 'Quinn', 'Avery', 'Dev', 'Nova', 'Kai', 'Luca'];
const EN_LAST = ['Wright', 'Kim', 'Rivera', 'Ono', 'Bauer', 'Stone', 'Vega', 'Frost', 'Ln', 'Codes', 'Draws', 'Lab'];

// 様々な長さの投稿を組み立てるためのテキストフラグメント。ライセンスを汚さず
// オフラインでいられるよう、オリジナルの言い回し（実在の作品からの引用なし）。
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

// サイドカーの tags[] 語彙。一般的なタグに加え、固有名詞っぽい架空の作品名／
// キャラクター名を現実的な比率で混ぜる＝#165（意味的な照合）はこれを使って、
// 未知の固有名詞が衝突する embedding の弱点を再現する必要がある。全ての名前は
// 架空（実在の作品・キャラクターではない）。
const TAG_GENERAL_JA = ['風景', '猫', '技術', '作業資料', '模写', '習作', 'ラフ', '背景', 'キャラデザ', '配色', 'ドット絵', '写真', '料理', '旅行'];
const TAG_GENERAL_EN = ['landscape', 'study', 'fanart', 'reference', 'wip', 'character', 'background', 'palette', 'photography', 'tutorial'];
const TAG_WORK = ['蒼穹のイストリア', '星霜メモリア', '紅蓮ノ刻', 'アステル戦記', 'ネビュラ・コード', '花冠のヴェルデ', 'クロノ・シアン', '銀灯のリフレイン'];
const TAG_CHARACTER = ['リィン', 'アオイ', 'セラフィナ', 'ノクト', 'ミレイユ', 'カイル', 'ユエ', 'テオドール', 'シャロ', 'ヴァイス'];

// --- 引数のパース ---------------------------------------------------------
function parseArgs(argv: string[]) {
  const opts: any = { count: 3000, authors: 0, years: 4, seed: 1, corpus: null, db: null, force: false, outDir: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--force') opts.force = true;
    else if (a === '--count') opts.count = Number(rest[++i]);
    else if (a === '--authors') opts.authors = Number(rest[++i]);
    else if (a === '--years') opts.years = Number(rest[++i]);
    else if (a === '--seed') opts.seed = Number(rest[++i]);
    else if (a === '--corpus') opts.corpus = rest[++i];
    else if (a === '--db') opts.db = rest[++i];
    else if (a.startsWith('--')) throw new Error(`不明なオプション: ${a}`);
    else if (!opts.outDir) opts.outDir = a;
    else throw new Error(`予期しない引数: ${a}`);
  }
  if (!opts.outDir) throw new Error('<outDir> がありません。使い方: node scripts/gen-dummy-library.cts <outDir> [--count N] [--seed N] [--years N] [--corpus FILE] [--db FILE] [--force]');
  if (!Number.isFinite(opts.count) || opts.count < 1) throw new Error('--count は正の数でなければなりません');
  if (!opts.authors) opts.authors = Math.max(8, Math.floor(opts.count / 4));
  return opts;
}

// 実データを壊しかねない書き込み先を拒否する: リポジトリの tree、設定済みの
// 保存フォルダ、既定のライブラリパス。「使い捨て」という約束を裏切らないため。
function assertSafeOutDir(outDir: string) {
  const abs = path.resolve(outDir);
  const repoRoot = path.resolve(__dirname, '..');
  const within = (parent: string, child: string) => {
    const rel = path.relative(parent, child);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  if (within(repoRoot, abs)) throw new Error(`リポジトリ内への書き込みを拒否: ${abs}`);
  const protectedDirs = [defaultLibraryDir()];
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg.saveFolder) protectedDirs.push(cfg.saveFolder);
  } catch {
    /* config なし＝既定のライブラリパスだけが保護対象 */
  }
  for (const p of protectedDirs) {
    if (within(path.resolve(p), abs) || within(abs, path.resolve(p))) throw new Error(`実ライブラリのパスへの書き込みを拒否: ${abs}（${p} と重複）`);
  }
}

// --- 投稿者の生成 --------------------------------------------------------
function buildAuthors(rng: ReturnType<typeof makeRng>, n: number) {
  const authors: any[] = [];
  for (let i = 0; i < n; i++) {
    // 重みでプラットフォームを選ぶ。
    let roll = rng.next();
    let plat: (typeof PLATFORMS)[number] = PLATFORMS[0];
    for (const p of PLATFORMS) {
      if (roll < p.weight) {
        plat = p;
        break;
      }
      roll -= p.weight;
    }
    const ja = rng.chance(0.7); // ライブラリは日本語寄りだが、実際の英語少数派も残す
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
      lastLocalId: null as string | null, // 自己返信の連鎖用
    });
  }
  return authors;
}

// --- プラットフォームごとの投稿 local-id + URL ----------------------------------------
function localId(rng: ReturnType<typeof makeRng>, platform: string): string {
  if (platform === 'x' || platform === 'mastodon') return String(rng.int(10 ** 17, 10 ** 18 - 1));
  // bsky rkey / misskey note id: base32 っぽいトークン
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

// --- テキスト/タグの合成 -----------------------------------------------------
function synthText(rng: ReturnType<typeof makeRng>, ja: boolean, corpus: string[] | null): string {
  const frags = corpus || (ja ? JA_FRAG : EN_FRAG);
  const sep = ja && !corpus ? '。' : ' ';
  // 長さの区分: 短1、中2〜3、長4〜8（短・中に重み寄せ）
  const r = rng.next();
  const n = r < 0.5 ? 1 : r < 0.85 ? rng.int(2, 3) : rng.int(4, 8);
  const parts: string[] = [];
  for (let k = 0; k < n; k++) parts.push(rng.pick(frags));
  let text = parts.join(sep);
  if (ja && !corpus && !text.endsWith('。')) text += '。';
  // ハッシュタグ（約40%）
  if (rng.chance(0.4)) {
    const pool = ja ? JA_HASH : EN_HASH;
    const h = rng.int(1, 3);
    const picked = new Set<string>();
    for (let k = 0; k < h; k++) picked.add(rng.pick(pool));
    text += ' ' + [...picked].join(' ');
  }
  // 文中の URL（約8%）
  if (rng.chance(0.08)) text += ` https://example.com/${rng.int(1000, 9999)}`;
  return text;
}
function synthTags(rng: ReturnType<typeof makeRng>, ja: boolean): string[] {
  if (!rng.chance(0.55)) return []; // 約45%はタグなし（実際の、ほぼタグなしのライブラリを模す）
  const tags = new Set<string>();
  const n = rng.int(1, 4);
  for (let k = 0; k < n; k++) {
    const r = rng.next();
    // タグ選択の約35%は固有名詞っぽいもの（作品/キャラクター）＝#165 のキャリブレーション信号
    if (r < 0.2) tags.add(rng.pick(TAG_WORK));
    else if (r < 0.35) tags.add(rng.pick(TAG_CHARACTER));
    else tags.add(rng.pick(ja ? TAG_GENERAL_JA : TAG_GENERAL_EN));
  }
  return [...tags];
}

// エンゲージメント数はテールの重い分布（ほとんどは小さく、一部だけバズる）。
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

  // 安全弁: --force が無い限り、空でないフォルダを絶対に上書きしない。
  if (fs.existsSync(outDir)) {
    const entries = fs.readdirSync(outDir);
    if (entries.length && !opts.force) {
      throw new Error(`拒否: ${outDir} は空ではありません（${entries.length} 件）。上書きするには --force を使うか、空のフォルダを選んでください。`);
    }
  }
  fs.mkdirSync(outDir, { recursive: true });
  const avatarDir = path.join(outDir, 'avatars');
  fs.mkdirSync(avatarDir, { recursive: true });

  // 実行1回につきデータベース1つ: レコードはここに着地し、メディアは outDir に残る。
  const dbFile = path.resolve(opts.db || path.join(outDir, 'hologram.db'));
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbFile + suffix, { force: true });
  const handle = openDatabase(dbFile);
  const stmts = preparePostStmts(handle.sqlite);
  const resolveTagId = makeTagResolver(handle.sqlite);

  const rng = makeRng(opts.seed);
  const corpus: string[] | null = opts.corpus
    ? fs
        .readFileSync(opts.corpus, 'utf8')
        .split(/\r?\n/)
        .map((s: string) => s.trim())
        .filter(Boolean)
    : null;
  if (opts.corpus && (!corpus || !corpus.length)) throw new Error(`--corpus のファイルが空です: ${opts.corpus}`);

  const authors = buildAuthors(rng, opts.authors);
  const avatarWritten = new Set<number>();

  // 固定の日付ウィンドウ（決定的＝Date.now() を使わない）: 投稿は定数のアンカーから
  // 過去 `years` 年に散らばる。
  const anchor = Date.parse('2026-06-01T00:00:00Z');
  const spanMs = opts.years * 365 * 86400000;

  const stats = { platform: {} as Record<string, number>, media: {} as Record<string, number>, tagged: 0, replies: 0, quotes: 0, threads: 0, artwork: 0, bytes: 0 };
  const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] || 0) + 1);
  const write = (file: string, data: Buffer | string) => {
    fs.writeFileSync(file, data as any);
    stats.bytes += Buffer.byteLength(data as any);
  };

  for (let i = 0; i < opts.count; i++) {
    // 投稿の所有を多作な少数派に偏らせる（Zipf 的なロングテール）。
    const author = authors[rng.skew(authors.length, 1.7)];
    const id = `gen-${String(i).padStart(6, '0')}`;
    const plat = author.platform;

    // 投稿の種類。少数派は「artwork」（取り込んだイラスト）レコード: 画像自体が
    // コンテンツで、エンゲージメントのスクリーンショットは無く、source マーカーが
    // 設定される＝アプリがサポートする drag/eagle-migration のレコード形を模す。
    const isArtwork = rng.chance(0.2);

    const dateMs = anchor - Math.floor(rng.next() * spanMs);
    const date = new Date(dateMs).toISOString();
    const capturedAt = new Date(dateMs + rng.int(60, 86400) * 1000).toISOString();

    // アバター（投稿者ごとに共有、1回だけ書き出す）。
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

    // メイン画像（投稿ならスクリーンショットのプレースホルダ、それ以外は artwork 自体）。
    const [iw, ih] = DIMS[rng.skew(DIMS.length, 1)];
    let cardDims: [number, number] = [iw, ih]; // カードが表示するもの＝下で media[0] が引き継ぐ
    const tint: [number, number, number] = plat.id === 'x' ? [30, 40, 55] : plat.id === 'bluesky' ? [0, 90, 180] : plat.id === 'misskey' ? [120, 160, 40] : [95, 95, 200];
    const imageName = `${id}.png`;
    write(path.join(outDir, imageName), makePng(iw, ih, tint));

    // 添付された原本（複数画像）、artwork 以外の画像投稿向け。
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
        const nMedia = rng.next() < 0.7 ? 1 : rng.int(2, 4); // ほとんどは1枚、一部は複数画像
        for (let m = 0; m < nMedia; m++) {
          const [mw, mh] = DIMS[rng.skew(DIMS.length, 1)];
          const mfile = `${id}-media-${m}.png`;
          write(path.join(outDir, mfile), makePng(mw, mh, [tint[0] + 20, tint[1] + 20, tint[2] - 10]));
          if (m === 0) cardDims = [mw, mh];
          media.push({ url: `https://example.com/orig/${id}/${m}.png`, alt: rng.chance(0.3) ? 'alt text' : null, width: mw, height: mh, file: mfile });
        }
      }
    }

    const lid = localId(rng, plat.id);
    const type = isArtwork ? 'post' : rng.pick(['post', 'post', 'post', 'reply', 'quote', 'thread']);
    // 自己返信の連鎖: 一部の返信はこの投稿者の直前の投稿の local id を指す。
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
      // ファイルから測定するのではなくここで設定する: ジェネレーターはカード画像の
      // サイズを既に知っており、lib-card-dims.ts は今書いたばかりのものを読み直す
      // だけになる（大規模だとヘッダー読み取りが3万回、同じ数字のために）。
      shotW: cardDims[0],
      shotH: cardDims[1],
    };
    if (author.host) rec.host = author.host;
    if (isArtwork) {
      rec.source = rng.chance(0.5) ? 'eagle-migration' : 'drag';
      rec.title = rec.tags[0] || (ja ? '無題' : 'untitled');
      if (rng.chance(0.3)) rec.url = ''; // 取り込んだ artwork の一部は source URL を持たない
    }

    writePost(stmts, resolveTagId, rec);
    author.lastLocalId = lid;

    // 集計。
    bump(stats.platform, plat.id);
    bump(stats.media, rec.mediaType);
    if (rec.tags.length) stats.tagged++;
    if (rec.isReply) stats.replies++;
    if (rec.isQuote) stats.quotes++;
    if (rec.isThread) stats.threads++;
    if (isArtwork) stats.artwork++;
  }

  handle.sqlite.close();

  // サマリー。
  const mb = (stats.bytes / 1048576).toFixed(1);
  console.log(`${opts.count} 件の投稿を生成 → ${outDir}（レコードは ${dbFile}）`);
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
