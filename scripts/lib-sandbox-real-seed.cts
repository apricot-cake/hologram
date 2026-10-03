'use strict';

// サンドボックス検証インスタンス向けの実データシード（#286）。
//
// フィクスチャは、本物のライブラリが再現する2つのものをどちらもカバーしない:
// レイアウトや性能の問題が現れる多様性・規模と、バグを引き起こす特定の1投稿。
// このモジュールは <tree>/.sandbox を、本物のライブラリの DB のスナップショット
// と生成した代役メディアで満たし、本物のライブラリはインスタンスから届かない
// ままで、両方を検証可能にする。
//
// 設計は #286 の 2026-07-25 決定コメントによる:
//   - DB は SQLite の Online Backup API 経由で届く（lib-db-snapshot の根拠が
//     そのまま当てはまる: 稼働中の .db を生でファイルコピーすると裂けることが
//     ある）。ソース側の接続は読み取り専用で、ここでは本物のライブラリにも
//     本物の設定ディレクトリにも一切書き込まない。
//   - メディアはデフォルトで代役: 参照されるファイルごとに、DB がすでに記録
//     しているアスペクト比で1枚 PNG を生成する（ダウンロード済みメディアなら
//     media.width/height、カード画像なら posts.shotW/shotH）。masonry の高さ
//     確保とロード後のアスペクト比は本物のライブラリと一致する一方、個人の
//     画像は一切コピーされない。DB が寸法を知らないファイルは、共有の正方形
//     プレースホルダー1枚に落ちる。
//   - 本物のファイルがコピーされるのは、明示的に指定した captureId のみ
//     （--capture）。すなわち特定の投稿でバグを再現する場合。丸ごとコピーする
//     ことは決してない。それを使ったシードには印が付き、インスタンスは画面上で
//     警告できる。その画面を撮ると個人データが含まれるため。
//   - 分離は起動前に機械的に検証する（verifyIsolation）: スナップショットは
//     絶対パスを一切含んではならず、すべてのメディア参照はサンドボックスの
//     ライブラリ内に解決されなければならない。
//
// 代役の忠実度。完全な忠実度と誤解されないよう明記しておく:
//   - ピクセル寸法は長辺を `maxDim` まで縮小する（アスペクト比は保つ）ので、
//     デコードのコストは本物のライブラリのものではない。レイアウトはそうでは
//     ない。レイアウトは DB 自身の shotW/shotH と、ロード後のアスペクト比で
//     駆動されるため。
//   - 動画ファイルには代役を用意しない（.mp4 という名前の PNG は再生できない）。
//     ポスターフレームには用意し、カードが表示するのはそれ。再生そのものは
//     ここでは再現できない。
//   - ゴミ箱の投稿はスキップする: そのファイルは .trash/ 配下にあり、ゴミ箱の
//     表示はそこにある投稿ごとの JSON レコードで駆動される。DB スナップショットは
//     それを運ばない。

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const os = require('node:os');

const repoRoot = path.join(__dirname, '..');
const appMainDir = path.join(repoRoot, 'app', 'src', 'main');
const { openDatabase } = require(path.join(appMainDir, 'lib-db.ts'));
const { cardImageFile } = require(path.join(appMainDir, 'lib-card-dims.ts'));
const { resolveInSaveFolder } = require(path.join(appMainDir, 'lib-save-folder-path.ts'));

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
// DB が寸法を記録していないすべての参照で共有する1つのサイズ（カード画像が
// 寸法が欠けたローカル画像や、共有ストアのアバター全般）。正方形にしてある:
// アバターがその大半を占め、
// 円形で表示されるため。
const PLACEHOLDER_DIM = 400;
const DEFAULT_MAX_DIM = 512;

// ---- PNG エンコード（依存なし、scripts/gen-dummy-library.cts と同じ手法） -----

let crcTable: number[] | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// わずかな水平グラデーションを持つべた塗り色。フィクスチャシードの画像と同じ
// 見た目にすることで、実データのサンドボックスが一目で「生成物」だと分かる。
// Deflate レベル1: 各行はどれも同一なので、この安いレベルでもサイズは損せず、
// 1万枚の実行を分単位ではなく十数秒に収める。
function makePng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const row = Buffer.alloc(1 + w * 3); // filter byte 0 + RGB pixels
  for (let x = 0; x < w; x++) {
    const f = 0.75 + (0.25 * x) / w;
    row[1 + x * 3] = Math.round(rgb[0] * f);
    row[2 + x * 3] = Math.round(rgb[1] * f);
    row[3 + x * 3] = Math.round(rgb[2] * f);
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level: 1 })), pngChunk('IEND', Buffer.alloc(0))]);
}

// ファイル名ごとに決定的: 同じライブラリは再シードしても同じ色になり、隣り合う
// カードは違う色になる（順序で縞模様にならないよう、カウンタではなくハッシュ）。
function colorFor(name: string): [number, number, number] {
  const h = crypto.createHash('sha1').update(name).digest();
  // 明るめで彩度低めに保つ: 各チャンネル 140..235 だと、コンテンツではなく
  // プレースホルダーだと読める。
  return [140 + (h[0] % 96), 140 + (h[1] % 96), 140 + (h[2] % 96)];
}

// ---- スナップショット ---------------------------------------------------------

// 読み取り専用のソース接続に対する SQLite の Online Backup API。openDatabase は
// readonly モードでは quick_check だけ実行しマイグレーションはしないので、
// 本物のデータベースには一切書き込まれない — サンドボックスのコピーは、後で
// アプリがそれを開いた時にマイグレーションされる。
//
// 1つ注意点。仮定ではなく実測: WAL のデータベースを読むと、アプリがまだ起動
// していない場合、その -shm（と空の -wal）が隣に実体化される。これは SQLite の
// 読み手側の記帳であってデータの変更ではない — .db のバイト列は同一のまま出て
// くる。代わりの手（immutable=1 で URI を開く）はこれを避けられるが、代償として
// 「誰もそのファイルに書き込んでいない」ことを仮定する。稼働中のライブラリに
// 対してはまさに間違った仮定になる。
async function snapshotDatabaseFile(srcDbFile: string, destDbFile: string): Promise<{ bytes: number }> {
  if (!fs.existsSync(srcDbFile)) throw new Error(`本物のデータベースが見つからない: ${srcDbFile}`);
  fs.mkdirSync(path.dirname(destDbFile), { recursive: true });
  // 上書きする宛先の隣に WAL/SHM が残っていると、その（今や置き換えられた）
  // データベースの続きとして読まれてしまう。
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(destDbFile + suffix, { force: true });
  const handle = openDatabase(srcDbFile, { readonly: true });
  try {
    await handle.sqlite.backup(destDbFile);
  } finally {
    handle.sqlite.close();
  }
  return { bytes: fs.statSync(destDbFile).size };
}

// ---- 代役の計画 ---------------------------------------------------------------

interface StandinPlan {
  files: Map<string, { width: number; height: number; known: boolean }>;
  videos: string[];
  trashedPosts: number;
  postCount: number;
}

// データベースが持つすべてのメディア参照を、データベースが知っている寸法と
// 組にする。cardImageFile() はどのファイルをカードが表示するかを決める
// アプリ自身の規則なので、shotW/shotH はそれが計測したまさにそのファイルに
// 乗る。
function planStandins(sqlite: any): StandinPlan {
  const plan: StandinPlan = { files: new Map(), videos: [], trashedPosts: 0, postCount: 0 };
  const mediaByPost = new Map<string, any[]>();
  for (const m of sqlite.prepare('SELECT postId, seq, file, posterFile, width, height, type FROM media ORDER BY postId, seq').all()) {
    let list = mediaByPost.get(m.postId);
    if (!list) mediaByPost.set(m.postId, (list = []));
    list.push(m);
  }

  const add = (file: string | null, width: number | null, height: number | null) => {
    if (!file) return;
    if (VIDEO_EXT.test(file)) {
      plan.videos.push(file);
      return;
    }
    const known = Number.isFinite(width) && Number.isFinite(height) && (width as number) > 0 && (height as number) > 0;
    const prev = plan.files.get(file);
    // 二重に参照されるファイル（共有アバター、ポスター）は、最初に見えた
    // 「既知の」寸法を保つ — 後から来るプレースホルダーがそれを上書きしては
    // ならない。
    if (prev && (prev.known || !known)) return;
    plan.files.set(file, known ? { width: width as number, height: height as number, known: true } : { width: PLACEHOLDER_DIM, height: PLACEHOLDER_DIM, known: false });
  };

  for (const p of sqlite.prepare('SELECT captureId, image, video, avatarFile, shotW, shotH, trashedAt FROM posts').all()) {
    plan.postCount++;
    if (p.trashedAt) {
      plan.trashedPosts++;
      continue;
    }
    const media = mediaByPost.get(p.captureId) || [];
    const cardFile = cardImageFile({ image: p.image, media });
    if (cardFile) add(cardFile, p.shotW, p.shotH);
    for (const m of media) {
      add(m.file, m.width, m.height);
      if (m.posterFile) add(m.posterFile, m.width, m.height);
    }
    add(p.image, null, null);
    add(p.video, null, null);
    add(p.avatarFile, null, null);
  }
  return plan;
}

// 長辺を `maxDim` まで縮小し、アスペクト比は保つ: アプリはカードの高さを DB
// 自身の shotW/shotH から確保し、ロード後にアスペクト比を測り直すので、生き
// 残らなければならないのはピクセル数ではなく「比率」の方。
function scaleDims(width: number, height: number, maxDim: number): [number, number] {
  const long = Math.max(width, height);
  if (long <= maxDim) return [Math.max(1, Math.round(width)), Math.max(1, Math.round(height))];
  const k = maxDim / long;
  return [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))];
}

function writeStandins(destLibrary: string, plan: StandinPlan, opts: { maxDim?: number } = {}): { written: number; placeholders: number; escaped: string[] } {
  const maxDim = opts.maxDim || DEFAULT_MAX_DIM;
  fs.mkdirSync(destLibrary, { recursive: true });
  let written = 0;
  let placeholders = 0;
  const escaped: string[] = [];
  for (const [file, dims] of plan.files) {
    // アプリがレコードのメディア参照を解決する時に適用するのと同じ封じ込め
    // 規則 — 悪意ある行や旧式の行がサンドボックスの外へ書き込んではならない。
    const dest = resolveInSaveFolder(destLibrary, file);
    if (!dest) {
      escaped.push(file);
      continue;
    }
    const [w, h] = scaleDims(dims.width, dims.height, maxDim);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, makePng(w, h, colorFor(file)));
    written++;
    if (!dims.known) placeholders++;
  }
  return { written, placeholders, escaped };
}

// ---- 実物の狙い撃ちコピー -------------------------------------------------------

// 1つの投稿が持つファイル: その投稿を再現するために本物でなければならないもの。
function filesOfPost(sqlite: any, captureId: string): string[] {
  const p = sqlite.prepare('SELECT captureId, image, video, avatarFile FROM posts WHERE captureId = ?').get(captureId);
  if (!p) return [];
  const files = [p.image, p.video, p.avatarFile];
  for (const m of sqlite.prepare('SELECT file, posterFile FROM media WHERE postId = ? ORDER BY seq').all(captureId)) {
    files.push(m.file, m.posterFile);
  }
  return files.filter((f: string | null): f is string => !!f);
}

// 指定された投稿の代役を、本物のバイト列で上書きする。これがサンドボックスの
// 中に個人の画像を置く唯一の経路 — 呼び出し側はそれをシードレポートに記録し、
// インスタンスが生きている間ずっと画面上で警告できるようにする。
function copyRealMedia(sqlite: any, captureIds: string[], srcLibrary: string, destLibrary: string): { copied: string[]; missing: string[]; unknownIds: string[] } {
  const copied: string[] = [];
  const missing: string[] = [];
  const unknownIds: string[] = [];
  for (const id of captureIds) {
    const files = filesOfPost(sqlite, id);
    if (!files.length) {
      unknownIds.push(id);
      continue;
    }
    for (const file of files) {
      const src = resolveInSaveFolder(srcLibrary, file);
      const dest = resolveInSaveFolder(destLibrary, file);
      if (!src || !dest || !fs.existsSync(src)) {
        missing.push(file);
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      copied.push(file);
    }
  }
  return { copied, missing, unknownIds };
}

// ---- 機械的な分離検証 -----------------------------------------------------------

interface IsolationInput {
  dbFile: string;
  configPath: string;
  sandboxLibrary: string;
  realConfigDir: string;
  realSaveFolder: string;
}

// インスタンスの起動「前」に実行する: 本物のパスをまだ知っているサンドボックスは、
// そこへ書き込めるサンドボックスである。互いに独立した3つの問い。それぞれ壊れ方が
// 違うため:
//   1. 設定の saveFolder は本物を指していないか?
//   2. スナップショットはその自身のバイト列に絶対パスを含んでいないか?
//      （今日の時点ではスキーマの何もそれを保存しないが、これはそれが起こり
//      始めた時に気付くための検証）
//   3. すべてのメディア参照はサンドボックスのライブラリの「内側」に解決される
//      か?
function verifyIsolation(input: IsolationInput): { ok: boolean; problems: string[]; checked: { pathNeedles: number; mediaRefs: number } } {
  const problems: string[] = [];

  const cfg = JSON.parse(fs.readFileSync(input.configPath, 'utf8'));
  const norm = (p: string) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
  if (!cfg.saveFolder || norm(cfg.saveFolder) !== norm(input.sandboxLibrary)) problems.push(`config の saveFolder がサンドボックスのライブラリになっていない: ${cfg.saveFolder}`);
  // #176: hologram.db は今やライブラリフォルダの内側に置かれる。
  // 意味のある検証は、サンドボックス自身の db が本物のライブラリのコピーその
  // ものになっていないこと（realSaveFolder に対して検証する）。realConfigDir
  // の検証も残す: configDir は依然としてマシンローカルな状態（ログ、サムネイル
  // キャッシュ）を持ち、ここには何もその内側に入れ子であるべきではない。
  if (norm(input.dbFile).startsWith(norm(input.realSaveFolder) + '/')) problems.push(`サンドボックスのデータベースが本物のライブラリの内側にある: ${input.dbFile}`);
  if (norm(input.dbFile).startsWith(norm(input.realConfigDir) + '/')) problems.push(`サンドボックスのデータベースが本物の設定ディレクトリの内側にある: ${input.dbFile}`);
  if (norm(input.sandboxLibrary).startsWith(norm(input.realSaveFolder) + '/')) problems.push(`サンドボックスのライブラリが本物のライブラリの内側にある: ${input.sandboxLibrary}`);

  // バイト列の走査: 本物のルートを明示的に、加えて一般ケースとしてホーム
  // ディレクトリも（このファイルにはそもそも利用者の絶対パスが一切入るべき
  // ではない）。両方の区切り文字を対象にする — Windows のパスはどちらの形でも
  // 保存され得る。
  const needles = new Set<string>();
  for (const p of [input.realConfigDir, input.realSaveFolder, os.homedir()]) {
    needles.add(p);
    needles.add(p.replace(/\\/g, '/'));
    needles.add(p.replace(/\//g, '\\'));
  }
  const bytes = fs.readFileSync(input.dbFile);
  for (const needle of needles) {
    const at = bytes.indexOf(Buffer.from(needle, 'utf8'));
    if (at >= 0) problems.push(`スナップショットがバイト位置 ${at} に絶対パス (${needle}) を含んでいる: ${JSON.stringify(bytes.subarray(Math.max(0, at - 40), at + needle.length + 40).toString('utf8'))}`);
  }

  const handle = openDatabase(input.dbFile, { readonly: true });
  let mediaRefs = 0;
  try {
    const refs: string[] = [];
    for (const p of handle.sqlite.prepare('SELECT image, video, avatarFile FROM posts').all()) refs.push(p.image, p.video, p.avatarFile);
    for (const m of handle.sqlite.prepare('SELECT file, posterFile FROM media').all()) refs.push(m.file, m.posterFile);
    for (const ref of refs) {
      if (!ref) continue;
      mediaRefs++;
      if (path.isAbsolute(ref)) problems.push(`スナップショット内に絶対パスのメディア参照がある: ${ref}`);
      else if (!resolveInSaveFolder(input.sandboxLibrary, ref)) problems.push(`メディア参照がサンドボックスのライブラリの外へ抜け出している: ${ref}`);
    }
  } finally {
    handle.sqlite.close();
  }

  return { ok: problems.length === 0, problems, checked: { pathNeedles: needles.size, mediaRefs } };
}

// ---- 全体の進行 ----------------------------------------------------------------

interface SeedOptions {
  realConfigDir: string;
  realSaveFolder: string;
  sandboxConfigDir: string;
  sandboxLibrary: string;
  captureIds?: string[];
  maxDim?: number;
  log?: (msg: string) => void;
  successMarkerPath?: string;
  publishReceiptPath?: string;
}

function syncDirectory(dir: string): boolean {
  // Node on Windows cannot open a directory handle that fsyncSync can pass to
  // FlushFileBuffers. Do not pretend that file fsync also persists directory entries.
  if (process.platform === 'win32') return false;
  const handle = fs.openSync(dir, 'r');
  try {
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  return true;
}

function syncFile(file: string) {
  // Windows の FlushFileBuffers は GENERIC_WRITE を持つ handle を要求するため `r+`。
  // 呼び出すのはこの試行が生成した staging のみで、実 source は開かない。
  const handle = fs.openSync(file, 'r+');
  try {
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function syncTree(root: string): boolean {
  let directoriesDurable = true;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else syncFile(full);
    }
    directoriesDurable = syncDirectory(dir) && directoriesDurable;
  };
  walk(root);
  return directoriesDurable;
}

function writeDurableReceipt(receiptPath: string, value: unknown): boolean {
  const handle = fs.openSync(receiptPath, 'wx');
  try {
    fs.writeFileSync(handle, JSON.stringify(value, null, 2));
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  return syncDirectory(path.dirname(receiptPath));
}

function assertRealSeedPublishComplete(receiptPath: string) {
  if (fs.existsSync(receiptPath)) {
    throw new Error(`未完了の実データシードを検出したため起動を拒否します。実データを表示せず、--reseed で回復してください: ${receiptPath}`);
  }
}

function assertSandboxSeedProvenance(input: { receiptPath: string; markerPath: string; library: string }) {
  assertRealSeedPublishComplete(input.receiptPath);
  let hasLibrary = fs.existsSync(path.join(input.library, 'hologram.db'));
  if (!hasLibrary) {
    try {
      hasLibrary = fs.readdirSync(input.library).length > 0;
    } catch {
      hasLibrary = false;
    }
  }
  if (!hasLibrary) return;
  let mode = '';
  try {
    mode = JSON.parse(fs.readFileSync(input.markerPath, 'utf8')).mode;
  } catch {
    /* marker が無い・壊れている既存DBは provenance 不明として拒否する。 */
  }
  if (mode !== 'real' && mode !== 'fixture') throw new Error(`seed provenance/成功 metadata のないライブラリを検出したため起動を拒否します。自動削除せず、--reseed で明示的に回復してください: ${input.library}`);
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const normalize = (value: string) => (process.platform === 'win32' ? value.toLowerCase() : value);
  const relative = path.relative(normalize(parent), normalize(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

interface PublishReceipt {
  version: 1;
  state: 'preparing' | 'publishing';
  attemptId: string;
  library: string;
  config: string;
  marker: string;
  stagingLibrary: string;
  stagingConfig: string;
  stagingMarker: string;
}

function readOwnedReceipt(receiptPath: string, expected: { library: string; config: string; marker: string }): PublishReceipt {
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as PublishReceipt;
  if (receipt.version !== 1 || !/^[a-f0-9]{32}$/.test(receipt.attemptId) || receipt.library !== expected.library || receipt.config !== expected.config || receipt.marker !== expected.marker) throw new Error(`実データシード receipt が現在の sandbox 所有物と一致しません。自動削除しません: ${receiptPath}`);
  const expectedLibrary = path.join(path.dirname(expected.library), `.hologram-real-seed-${receipt.attemptId}`);
  const expectedConfig = path.join(path.dirname(expected.config), `.config.real-seed-${receipt.attemptId}.json`);
  const expectedMarker = `${expected.marker}.real-seed-${receipt.attemptId}`;
  if (receipt.stagingLibrary !== expectedLibrary || receipt.stagingConfig !== expectedConfig || receipt.stagingMarker !== expectedMarker) throw new Error(`実データシード receipt の staging 所有記録が不正です。任意パスを削除しません: ${receiptPath}`);
  return receipt;
}

function recoverRealSeedAttempt(receiptPath: string, expected: { library: string; config: string; marker: string }) {
  if (!fs.existsSync(receiptPath)) return;
  const receipt = readOwnedReceipt(receiptPath, expected);
  const errors: unknown[] = [];
  for (const target of [receipt.stagingLibrary, receipt.stagingConfig, receipt.stagingMarker]) {
    try {
      fs.rmSync(target, { recursive: target === receipt.stagingLibrary, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, '未完了シードの試行所有物をすべて撤去できません。receipt を保持します');
  fs.rmSync(receiptPath);
  syncDirectory(path.dirname(receiptPath));
}

function existingRealPath(file: string): string {
  return fs.realpathSync.native(file);
}

function futureRealPath(file: string): string {
  const missing: string[] = [];
  let cursor = file;
  while (!fs.existsSync(cursor)) {
    missing.unshift(path.basename(cursor));
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error(`生成先の親実パスを解決できません: ${file}`);
    cursor = parent;
  }
  return path.join(existingRealPath(cursor), ...missing);
}

// 書き込み先は、文字列上だけでなく symlink を解決した実パスでも実データの
// config/library と完全に別でなければならない。検査前に書き込みを始めると、誤った
// 引数を後段の cleanup が recursive delete してしまい得るため、これは最初に行う。
function validateSeedPaths(opts: SeedOptions): { sandboxConfigDir: string; sandboxLibrary: string } {
  for (const [name, value] of Object.entries({
    realConfigDir: opts.realConfigDir,
    realSaveFolder: opts.realSaveFolder,
    sandboxConfigDir: opts.sandboxConfigDir,
    sandboxLibrary: opts.sandboxLibrary,
  })) {
    if (!path.isAbsolute(value)) throw new Error(`${name} は絶対パスで指定してください: ${value}`);
  }

  const realConfigDir = existingRealPath(opts.realConfigDir);
  const realSaveFolder = existingRealPath(opts.realSaveFolder);
  const sandboxConfigDir = futureRealPath(opts.sandboxConfigDir);
  const sandboxLibrary = futureRealPath(opts.sandboxLibrary);
  const sources = [realConfigDir, realSaveFolder];
  const destinations = [sandboxConfigDir, sandboxLibrary];
  for (const destination of destinations) {
    for (const source of sources) {
      if (isSameOrInside(destination, source) || isSameOrInside(source, destination)) {
        throw new Error(`実データの生成先と source は別かつ包含しない実パスでなければなりません: ${destination} / ${source}`);
      }
    }
  }
  if (isSameOrInside(sandboxLibrary, sandboxConfigDir) || isSameOrInside(sandboxConfigDir, sandboxLibrary)) {
    throw new Error(`sandboxConfigDir と sandboxLibrary は包含しない別の実パスでなければなりません: ${sandboxConfigDir} / ${sandboxLibrary}`);
  }
  return { sandboxConfigDir, sandboxLibrary };
}

async function seedRealSandbox(opts: SeedOptions) {
  const log = opts.log || (() => {});
  const destinations = validateSeedPaths(opts);
  // #176: hologram.db は今やライブラリフォルダの「内側」に置かれる。
  // ソース側（本物のライブラリ自身のデータベース）も宛先側（これは、下で
  // config.saveFolder = opts.sandboxLibrary に対して起動した時に、サンドボックス
  // 化されたアプリ自身の ensureDb()/dbFile() が探す場所）も両方とも。
  const dbFile = path.join(destinations.sandboxLibrary, 'hologram.db');
  const configPath = path.join(destinations.sandboxConfigDir, 'config.json');
  if (opts.successMarkerPath && !path.isAbsolute(opts.successMarkerPath)) throw new Error(`successMarkerPath は絶対パスで指定してください: ${opts.successMarkerPath}`);
  const successMarkerPath = opts.successMarkerPath ? futureRealPath(opts.successMarkerPath) : null;
  if (opts.publishReceiptPath && !path.isAbsolute(opts.publishReceiptPath)) throw new Error(`publishReceiptPath は絶対パスで指定してください: ${opts.publishReceiptPath}`);
  const publishReceiptPath = opts.publishReceiptPath ? futureRealPath(opts.publishReceiptPath) : null;
  const sourcePaths = [existingRealPath(opts.realConfigDir), existingRealPath(opts.realSaveFolder)];
  for (const protectedPath of [successMarkerPath, publishReceiptPath]) {
    if (protectedPath && sourcePaths.some((source) => isSameOrInside(protectedPath, source))) {
      throw new Error(`成功 marker/receipt は source の外に置いてください: ${protectedPath}`);
    }
  }
  const outputs = [destinations.sandboxLibrary, configPath, successMarkerPath, publishReceiptPath].filter((value): value is string => !!value);
  for (let i = 0; i < outputs.length; i++) {
    for (let j = i + 1; j < outputs.length; j++) {
      if (isSameOrInside(outputs[i], outputs[j]) || isSameOrInside(outputs[j], outputs[i])) throw new Error(`library/config/marker/receipt は相互に同一でも包含関係でもない実パスにしてください: ${outputs[i]} / ${outputs[j]}`);
    }
  }
  if (fs.existsSync(destinations.sandboxLibrary) || fs.existsSync(configPath) || (successMarkerPath && fs.existsSync(successMarkerPath)) || (publishReceiptPath && fs.existsSync(publishReceiptPath))) {
    throw new Error('既存の sandbox library/config には実データを重ねません。--reseed で明示的に撤去してください');
  }

  // 成功 marker (seed.json) が書かれるのは呼び出し元へ return した後である。
  // それまでは一意な staging だけを試行所有物とし、false/throw のどの経路でも
  // それだけを消す。既存 library や source を recursive delete することはない。
  const attemptId = crypto.randomBytes(16).toString('hex');
  const stagingLibrary = path.join(path.dirname(destinations.sandboxLibrary), `.hologram-real-seed-${attemptId}`);
  const stagingConfig = path.join(destinations.sandboxConfigDir, `.config.real-seed-${attemptId}.json`);
  const stagingMarker = successMarkerPath ? `${successMarkerPath}.real-seed-${attemptId}` : null;
  const createdConfigDir = !fs.existsSync(destinations.sandboxConfigDir);
  const createdLibraryParent = !fs.existsSync(path.dirname(destinations.sandboxLibrary));
  fs.mkdirSync(destinations.sandboxConfigDir, { recursive: true });
  fs.mkdirSync(path.dirname(destinations.sandboxLibrary), { recursive: true });
  const stagingDb = path.join(stagingLibrary, 'hologram.db');

  let receiptWritten = false;
  if (publishReceiptPath && successMarkerPath) {
    const directoryDurable = writeDurableReceipt(publishReceiptPath, {
      version: 1,
      state: 'preparing',
      attemptId,
      library: destinations.sandboxLibrary,
      config: configPath,
      marker: successMarkerPath,
      stagingLibrary,
      stagingConfig,
      stagingMarker,
    });
    receiptWritten = true;
    if (!directoryDurable) log('警告: Windows の Node.js は directory fsync を提供しないため、receipt の内容は flush 済みですが directory entry の耐久性は OS に依存します');
  }
  fs.mkdirSync(stagingLibrary);

  const cleanupStaging = () => {
    const errors: unknown[] = [];
    for (const cleanup of [() => fs.rmSync(stagingLibrary, { recursive: true, force: true }), () => fs.rmSync(stagingConfig, { force: true }), () => stagingMarker && fs.rmSync(stagingMarker, { force: true })]) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  };
  const removeEmptyCreatedParents = () => {
    for (const dir of [createdConfigDir ? destinations.sandboxConfigDir : null, createdLibraryParent ? path.dirname(destinations.sandboxLibrary) : null]) {
      if (!dir) continue;
      try {
        fs.rmdirSync(dir);
      } catch {
        /* 成功成果物または第三者のファイルがあれば消さない。 */
      }
    }
  };

  try {
    const snap = await snapshotDatabaseFile(path.join(opts.realSaveFolder, 'hologram.db'), stagingDb);
    log(`スナップショット: ${(snap.bytes / 1048576).toFixed(1)} MB（SQLite backup API 経由）`);

    const handle = openDatabase(stagingDb, { readonly: true });
    let plan: StandinPlan;
    try {
      plan = planStandins(handle.sqlite);
    } finally {
      handle.sqlite.close();
    }
    const standins = writeStandins(stagingLibrary, plan, { maxDim: opts.maxDim });
    log(`代役: ${standins.written}枚（プレースホルダー${standins.placeholders}枚、動画参照${plan.videos.length}件は不在のまま、ゴミ箱の投稿${plan.trashedPosts}件はスキップ）`);

    let realMedia: { copied: string[]; missing: string[]; unknownIds: string[] } = { copied: [], missing: [], unknownIds: [] };
    const captureIds = opts.captureIds || [];
    if (captureIds.length) {
      // 読み書き可能で開き直した? いいや: またしても読み取り専用。コピーは
      // ソース側のライブラリを読むだけで、宛先は普通の fs — DB は投稿がどの
      // ファイルを持つかを調べる時にしか参照しない。
      const h2 = openDatabase(stagingDb, { readonly: true });
      try {
        realMedia = copyRealMedia(h2.sqlite, captureIds, opts.realSaveFolder, stagingLibrary);
      } finally {
        h2.sqlite.close();
      }
      log(`本物のメディア: ${captureIds.length}件のキャプチャに対して${realMedia.copied.length}ファイルをコピー`);
      if (realMedia.unknownIds.length) log(`  スナップショットにそのcaptureIdが無い: ${realMedia.unknownIds.join(', ')}`);
      if (realMedia.missing.length) log(`  本物のライブラリに見当たらない: ${realMedia.missing.join(', ')}`);
    }

    // 最後に書く。分離検証がインスタンスの使う config を読むようにするため。
    fs.writeFileSync(stagingConfig, JSON.stringify({ saveFolder: destinations.sandboxLibrary, extensionId: 'testextensionidabcdefghijklmnop' }, null, 2));

    const isolation = verifyIsolation({
      dbFile: stagingDb,
      configPath: stagingConfig,
      sandboxLibrary: destinations.sandboxLibrary,
      realConfigDir: opts.realConfigDir,
      realSaveFolder: opts.realSaveFolder,
    });
    if (!isolation.ok) {
      const err: any = new Error(`サンドボックスの分離検証に失敗した:\n  - ${isolation.problems.join('\n  - ')}`);
      err.problems = isolation.problems;
      throw err;
    }
    log(`分離検証: ok（メディア参照${isolation.checked.mediaRefs}件、パスの探索対象${isolation.checked.pathNeedles}件）`);

    const report = {
      mode: 'real',
      seededAt: new Date().toISOString(),
      source: { configDir: opts.realConfigDir, saveFolder: opts.realSaveFolder },
      db: { file: dbFile, bytes: snap.bytes, posts: plan.postCount },
      standins: { written: standins.written, placeholders: standins.placeholders, escaped: standins.escaped, videosAbsent: plan.videos.length, trashedSkipped: plan.trashedPosts },
      realMedia: { captureIds, files: realMedia.copied, missing: realMedia.missing, unknownIds: realMedia.unknownIds },
      maxDim: opts.maxDim || DEFAULT_MAX_DIM,
    };
    if (stagingMarker) fs.writeFileSync(stagingMarker, JSON.stringify(report, null, 2));

    const publicationDirectoriesDurable = syncTree(stagingLibrary);
    syncFile(stagingConfig);
    if (stagingMarker) syncFile(stagingMarker);
    if (!publicationDirectoriesDurable) log('警告: Windows の Node.js は directory fsync を提供しないため、公開ファイルは flush 済みですが directory entry の耐久性は OS に依存します');

    fs.renameSync(stagingLibrary, destinations.sandboxLibrary);
    syncDirectory(path.dirname(destinations.sandboxLibrary));
    try {
      fs.renameSync(stagingConfig, configPath);
      syncDirectory(path.dirname(configPath));
      if (stagingMarker && successMarkerPath) fs.renameSync(stagingMarker, successMarkerPath);
      if (successMarkerPath) syncDirectory(path.dirname(successMarkerPath));
    } catch (error) {
      // 片方の cleanup が Windows のロック等で失敗しても、残りはすべて独立して
      // 試す。どれかが失敗したら receipt を残し、次回起動を fail closed にする。
      const cleanupErrors: unknown[] = [];
      for (const cleanup of [() => successMarkerPath && fs.rmSync(successMarkerPath, { force: true }), () => fs.rmSync(configPath, { force: true }), () => fs.existsSync(destinations.sandboxLibrary) && fs.renameSync(destinations.sandboxLibrary, stagingLibrary)]) {
        try {
          cleanup();
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      if (publishReceiptPath && cleanupErrors.length === 0) {
        fs.rmSync(publishReceiptPath, { force: true });
        syncDirectory(path.dirname(publishReceiptPath));
        receiptWritten = false;
      }
      if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], '実データシードの公開と cleanup に失敗しました。receipt を保持して次回起動を拒否します');
      throw error;
    }

    if (publishReceiptPath) {
      fs.rmSync(publishReceiptPath);
      syncDirectory(path.dirname(publishReceiptPath));
      receiptWritten = false;
    }

    const cleanupErrors = cleanupStaging();
    removeEmptyCreatedParents();
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, '実データシード後の staging cleanup に失敗しました');
    return report;
  } catch (error) {
    const cleanupErrors = cleanupStaging();
    if (receiptWritten && cleanupErrors.length === 0 && !fs.existsSync(destinations.sandboxLibrary) && !fs.existsSync(configPath) && (!successMarkerPath || !fs.existsSync(successMarkerPath))) {
      fs.rmSync(publishReceiptPath as string, { force: true });
      syncDirectory(path.dirname(publishReceiptPath as string));
      receiptWritten = false;
    }
    removeEmptyCreatedParents();
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], '実データシードと staging cleanup に失敗しました。receipt を保持します');
    throw error;
  }
}

module.exports = { seedRealSandbox, snapshotDatabaseFile, planStandins, writeStandins, copyRealMedia, verifyIsolation, assertRealSeedPublishComplete, assertSandboxSeedProvenance, recoverRealSeedAttempt, scaleDims, makePng, DEFAULT_MAX_DIM, PLACEHOLDER_DIM };
