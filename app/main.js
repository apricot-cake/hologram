'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, nativeImage, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');

// native-host/ lives outside app/. In dev it's a sibling dir; when packaged it
// is bundled as an extraResource under resources/native-host.
const nativeHostDir = app.isPackaged
  ? path.join(process.resourcesPath, 'native-host')
  : path.join(__dirname, '..', 'native-host');
const { configDir, defaultLibraryDir } = require(path.join(nativeHostDir, 'paths'));
const installer = require(path.join(nativeHostDir, 'install'));

// Pin userData to the SAME directory the native host reads its config from, so
// the bridge (plain Node, spawned by Chrome) and this app always agree.
// Must run before app is ready.
app.setPath('userData', configDir());

const CONFIG_PATH = path.join(configDir(), 'config.json');

// Custom scheme to serve images from the (arbitrary) save folder. Lets the
// renderer lazy-load images by filename without disabling webSecurity or
// loading every image into JS memory.
protocol.registerSchemesAsPrivileged([
  { scheme: 'psimg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

let win = null;

// --- Config ---
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

// Explicit config wins; otherwise fall back to the shared default library dir
// (same resolution as the bridge's readSaveFolder). Never returns null now —
// a fresh install just uses defaultLibraryDir() without the user picking one.
function getSaveFolder() {
  const folder = readConfig().saveFolder;
  return (typeof folder === 'string' && folder.trim()) ? folder : defaultLibraryDir();
}

// Watch the save folder and tell the renderer to refresh when files change
// (e.g. a new capture arrives, or dummy data is injected). Debounced because a
// single capture writes both a .jpg and a .json.
let folderWatcher = null;
let watchDebounce = null;
function watchSaveFolder() {
  if (folderWatcher) {
    try { folderWatcher.close(); } catch { /* already closed */ }
    folderWatcher = null;
  }
  const folder = getSaveFolder();
  if (!folder) return;
  try {
    folderWatcher = fs.watch(folder, (_event, filename) => {
      if (filename && !/\.(jpe?g|jfif|png|webp|gif|json)$/i.test(filename)) return;
      clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => {
        if (win && !win.isDestroyed()) win.webContents.send('posts-changed');
      }, 400);
      // バックアップ「変更時」: 連続書き込みをまとめるため長め(90s)にデバウンス。
      if (!SMOKE) {
        const b = readBackupConfig();
        if (b.dir && b.onChange) {
          clearTimeout(backupChangeDebounce);
          backupChangeDebounce = setTimeout(() => { runBackup('change'); }, 90000);
        }
      }
    });
  } catch (err) {
    console.error('Failed to watch save folder:', err);
  }
}

// --- Posts (scan sidecars) ---
function listPosts() {
  const folder = getSaveFolder();
  if (!folder) return { saveFolder: null, posts: [] };

  let files;
  try {
    files = fs.readdirSync(folder);
  } catch {
    return { saveFolder: folder, posts: [] };
  }

  const posts = [];
  for (const f of files) {
    if (!f.toLowerCase().endsWith('.json')) continue;
    if (f === 'config.json' || f === '.index.json' || f === 'tag-groups.json' || f === 'ungrouped.json' || f === 'manual-groups.json' || f === 'folders.json') continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8'));
      // Keep records with an image, a (poster-less) video, or downloaded media.
      if (rec && (rec.image || rec.video || (Array.isArray(rec.media) && rec.media.length))) posts.push(rec);
    } catch {
      // Skip corrupt/partial sidecar.
    }
  }
  posts.sort((a, b) => new Date(b.capturedAt || 0) - new Date(a.capturedAt || 0));
  return { saveFolder: folder, posts };
}

// --- Native host registration (idempotent, on each launch) ---
function ensureHostRegistered() {
  try {
    // Don't clobber an existing registration: the launcher may have been written
    // with a node binary on an ASCII path, whereas process.execPath here is the
    // Electron binary (possibly under a non-ASCII path that cmd.exe would mangle
    // in a .bat). Only do a full install when nothing is registered yet.
    if (fs.existsSync(installer.manifestPath())) return;
    installer.install({ exe: process.execPath, runAsNode: true });
  } catch (err) {
    console.error('Failed to register native messaging host:', err);
  }
}

// --- Image protocol ---
// Screenshots are JPEG; downloaded original media may be png/webp/gif.
const EXT_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v'
};
function mimeForFile(name) {
  return EXT_MIME[path.extname(name || '').toLowerCase()] || 'application/octet-stream';
}

// Thumbnails: the image-view tile grid downscaled full-resolution originals
// (multi-MB pixiv/X art) into ~180px cells, which made scrolling stutter as the
// GPU decoded every full image. Instead serve a resized JPEG via psimg://…?w=N,
// generated once with Electron's built-in nativeImage and cached on disk
// (keyed by name + mtime + width, so re-migration invalidates it). The
// full-resolution original is still served when no ?w= is given (lightbox/viewer).
const THUMB_EXT = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.avif', '.svg']);
function thumbCacheDir() { return path.join(configDir(), 'thumb-cache'); }

async function getThumbnail(resolved, name, w) {
  if (!THUMB_EXT.has(path.extname(name).toLowerCase())) return null;
  let st;
  try { st = await fs.promises.stat(resolved); } catch { return null; }
  // q3: resize by the SHORT edge (not width). Tiles are square + object-fit:cover, so the
  // short edge is what maps to the tile. Resizing by width made wide images (e.g. 1920x1080)
  // become 180x101, which then got upscaled vertically into the square tile → heavy blur.
  const key = `${name}.${Math.round(st.mtimeMs)}.w${w}.q3.jpg`.replace(/[^\w.\-]/g, '_');
  const cachePath = path.join(thumbCacheDir(), key);
  try { return await fs.promises.readFile(cachePath); } catch { /* cache miss */ }
  try {
    let img = nativeImage.createFromPath(resolved);
    if (img.isEmpty()) return null;
    const sz = img.getSize();
    if (Math.min(sz.width, sz.height) > w) {
      img = (sz.width >= sz.height) ? img.resize({ height: w, quality: 'best' }) : img.resize({ width: w, quality: 'best' });
    }
    const buf = img.toJPEG(90);
    fs.promises.mkdir(thumbCacheDir(), { recursive: true })
      .then(() => fs.promises.writeFile(cachePath, buf)).catch(() => { /* cache best-effort */ });
    return buf;
  } catch { return null; }
}

function registerImageProtocol() {
  protocol.handle('psimg', async (request) => {
    try {
      const folder = getSaveFolder();
      if (!folder) return new Response('No save folder', { status: 404 });

      const url = new URL(request.url);
      const name = path.basename(decodeURIComponent(url.pathname.replace(/^\/+/, '')));
      if (!name) return new Response('Not found', { status: 404 });

      const filePath = path.join(folder, name);
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(folder))) {
        return new Response('Forbidden', { status: 403 });
      }

      const w = parseInt(url.searchParams.get('w') || '', 10);
      if (Number.isFinite(w) && w >= 64 && w <= 720) {
        const thumb = await getThumbnail(resolved, name, w);
        if (thumb) return new Response(thumb, { headers: { 'content-type': 'image/jpeg' } });
        // fall through to the original if thumbnailing failed
      }

      const data = await fs.promises.readFile(resolved);
      return new Response(data, { headers: { 'content-type': mimeForFile(name) } });
    } catch {
      return new Response('Error', { status: 500 });
    }
  });
}

// --- IPC ---
ipcMain.handle('get-config', () => {
  const cfg = readConfig();
  return { saveFolder: getSaveFolder(), extensionId: cfg.extensionId || null };
});

ipcMain.handle('set-extension-id', (_event, id) => {
  const cfg = readConfig();
  cfg.extensionId = (typeof id === 'string' ? id.trim() : '');
  writeConfig(cfg);
  try {
    // Update only the manifest's allowed origin; keep the existing launcher.
    if (fs.existsSync(installer.manifestPath())) {
      installer.updateAllowedOrigin(cfg.extensionId);
    } else {
      installer.install({ exe: process.execPath, runAsNode: true, extensionId: cfg.extensionId });
    }
  } catch (err) {
    console.error('Failed to update native host origin:', err);
  }
  return { extensionId: cfg.extensionId };
});

ipcMain.handle('pick-save-folder', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths[0]) {
    return { saveFolder: getSaveFolder() };
  }
  const cfg = readConfig();
  cfg.saveFolder = res.filePaths[0];
  writeConfig(cfg);
  watchSaveFolder();
  return { saveFolder: cfg.saveFolder };
});

ipcMain.handle('list-posts', () => listPosts());

// Tag groups (migrated from Eagle's library metadata) live alongside the
// sidecars as <saveFolder>/tag-groups.json: { groups: [{id,name,tags[]}] }.
ipcMain.handle('get-tag-groups', () => {
  const folder = getSaveFolder();
  if (!folder) return { groups: [] };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folder, 'tag-groups.json'), 'utf8'));
    return { groups: Array.isArray(j.groups) ? j.groups : [] };
  } catch {
    return { groups: [] };
  }
});

// Persistent per-post "do not group" set (image-view). Post keys whose images
// should stay individual tiles (e.g. several pics from one post that aren't a
// multi-page work). Lives as <saveFolder>/ungrouped.json: { keys: [...] }.
ipcMain.handle('get-ungrouped', () => {
  const folder = getSaveFolder();
  if (!folder) return { keys: [] };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folder, 'ungrouped.json'), 'utf8'));
    return { keys: Array.isArray(j.keys) ? j.keys : [] };
  } catch {
    return { keys: [] };
  }
});
ipcMain.handle('set-ungrouped', (_e, keys) => {
  const folder = getSaveFolder();
  if (!folder) return { ok: false };
  try {
    fs.writeFileSync(path.join(folder, 'ungrouped.json'),
      JSON.stringify({ keys: Array.isArray(keys) ? keys.map(String) : [] }, null, 2), 'utf8');
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

// Manual image groups (image-view): user-defined groups of captureIds that should
// collapse into one tile (for images not auto-grouped by post URL). Lives as
// <saveFolder>/manual-groups.json: { groups: [ [captureId, …], … ] }.
ipcMain.handle('get-manual-groups', () => {
  const folder = getSaveFolder();
  if (!folder) return { groups: [] };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folder, 'manual-groups.json'), 'utf8'));
    return { groups: Array.isArray(j.groups) ? j.groups : [] };
  } catch {
    return { groups: [] };
  }
});
ipcMain.handle('set-manual-groups', (_e, groups) => {
  const folder = getSaveFolder();
  if (!folder) return { ok: false };
  try {
    const clean = Array.isArray(groups) ? groups.filter((g) => Array.isArray(g) && g.length > 1).map((g) => g.map(String)) : [];
    fs.writeFileSync(path.join(folder, 'manual-groups.json'), JSON.stringify({ groups: clean }, null, 2), 'utf8');
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

// User folders (image-view): named collections of captureIds, with one designated
// default for one-click "add to folder" from a tile's hover overlay. Distinct from
// tags — a folder is an explicit container with a default add-target. Lives as
// <saveFolder>/folders.json: { folders: [ { id, name, items: [captureId,…] } ], defaultId }.
ipcMain.handle('get-folders', () => {
  const folder = getSaveFolder();
  if (!folder) return { folders: [], defaultId: null };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folder, 'folders.json'), 'utf8'));
    const folders = Array.isArray(j.folders) ? j.folders
      .filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string')
      .map((f) => ({ id: f.id, name: f.name, items: Array.isArray(f.items) ? [...new Set(f.items.map(String))] : [] })) : [];
    const defaultId = folders.some((f) => f.id === j.defaultId) ? j.defaultId : null;
    return { folders, defaultId };
  } catch {
    return { folders: [], defaultId: null };
  }
});
ipcMain.handle('set-folders', (_e, data) => {
  const folder = getSaveFolder();
  if (!folder) return { ok: false };
  try {
    const src = (data && Array.isArray(data.folders)) ? data.folders : [];
    const folders = src
      .filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string')
      .map((f) => ({ id: f.id, name: f.name, items: Array.isArray(f.items) ? [...new Set(f.items.map(String))] : [] }));
    const defaultId = folders.some((f) => f.id === (data && data.defaultId)) ? data.defaultId : null;
    fs.writeFileSync(path.join(folder, 'folders.json'), JSON.stringify({ folders, defaultId }, null, 2), 'utf8');
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('open-external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
  }
});

// --- Preferences (language / viewMode / skipDeleteConfirm / sortBy) ---
const PREF_KEYS = ['language', 'viewMode', 'skipDeleteConfirm', 'sortBy', 'mode', 'imageTileSize', 'searchMode', 'theme'];
const VALID_SORTS = ['date-desc', 'date-asc', 'likes-desc', 'reposts-desc', 'replies-desc', 'captured-desc', 'likes-pct'];

ipcMain.handle('get-prefs', () => {
  const cfg = readConfig();
  return {
    language: cfg.language || 'auto',
    viewMode: ['card', 'tile', 'list'].includes(cfg.viewMode) ? cfg.viewMode : 'card',   // display density
    skipDeleteConfirm: !!cfg.skipDeleteConfirm,
    sortBy: VALID_SORTS.includes(cfg.sortBy) ? cfg.sortBy : 'date-desc',
    mode: cfg.mode === 'image' ? 'image' : 'post',   // last-opened top-level tab
    imageTileSize: (Number.isFinite(cfg.imageTileSize) ? cfg.imageTileSize : null),   // image-view tile px
    searchMode: cfg.searchMode === 'fuzzy' ? 'fuzzy' : 'normal',   // 検索方式: 通常 / あいまい
    theme: ['auto', 'light', 'dark'].includes(cfg.theme) ? cfg.theme : 'auto'   // システム / ライト / ダーク
  };
});

ipcMain.handle('set-pref', (_e, key, value) => {
  if (!PREF_KEYS.includes(key)) return { ok: false };
  const cfg = readConfig();
  cfg[key] = value;
  writeConfig(cfg);
  return { ok: true };
});

// --- File helpers (all confined to the save folder) ---
function resolveInFolder(name) {
  const folder = getSaveFolder();
  if (!folder || !name) return null;
  const resolved = path.resolve(path.join(folder, path.basename(name)));
  return resolved.startsWith(path.resolve(folder)) ? resolved : null;
}

// Recover the captureId base from a filename. The argument may be the primary
// image (<base>.<ext>, any viewable ext), a video poster (<base>-poster.<ext>),
// or the video itself. Strip the -poster marker first, then any extension.
const VIEWABLE_EXTS = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'svg', 'mp4', 'webm', 'mov', 'm4v'];
function baseOf(name) {
  return path.basename(name || '').replace(/-poster\.[a-z0-9]+$/i, '').replace(/\.[a-z0-9]+$/i, '');
}

ipcMain.handle('image-data-url', async (_e, image) => {
  const p = resolveInFolder(image);
  if (!p) return null;
  try {
    const buf = await fs.promises.readFile(p);
    return 'data:' + mimeForFile(image) + ';base64,' + buf.toString('base64');
  } catch {
    return null;
  }
});

ipcMain.handle('delete-post', async (_e, image) => {
  const folder = getSaveFolder();
  if (!folder || !image) return { ok: false };
  // The arg may be a screenshot jpg, an illustration of any ext, or a video
  // poster — baseOf() recovers <captureId>. Delete the sidecar, the primary of
  // any viewable ext, the video poster, and original-media files.
  const base = baseOf(image);
  const targets = new Set([`${base}.json`]);
  for (const e of VIEWABLE_EXTS) targets.add(`${base}.${e}`);
  // Exact names from the sidecar (image / video / media), then sweep the disk for
  // <base>-media-* and <base>-poster.* (covers a missing/partial sidecar). The
  // anchors prevent matching a different post whose id is a prefix.
  const jsonPath = resolveInFolder(`${base}.json`);
  let rec = null;
  if (jsonPath) {
    try {
      rec = JSON.parse(await fs.promises.readFile(jsonPath, 'utf8'));
      if (rec.image) targets.add(path.basename(rec.image));
      if (rec.video) targets.add(path.basename(rec.video));
      for (const m of (rec.media || [])) { if (m && m.file) targets.add(path.basename(m.file)); }
    } catch { /* sidecar missing/corrupt — fall back to the disk sweep */ }
  }
  try {
    for (const f of await fs.promises.readdir(folder)) {
      if (f.startsWith(`${base}-media-`) || f.startsWith(`${base}-poster.`)) targets.add(f);
    }
  } catch { /* ignore */ }
  for (const name of targets) {
    const f = resolveInFolder(name);
    if (f) {
      try { await fs.promises.unlink(f); } catch { /* may not exist */ }
    }
  }
  // UIでの明示削除はバックアップ出力先へも伝播（設定時のみ）。投稿フォルダの中の該当ファイルを消す。
  if (rec) {
    const relDir = path.join(monthFolderOf(rec), rec.captureId || base);
    try { await removeFromBackup(relDir, [...targets]); } catch { /* best-effort */ }
  }
  return { ok: true };
});

ipcMain.handle('update-tags', async (_e, image, tags) => {
  const base = baseOf(image);
  const jsonPath = resolveInFolder(`${base}.json`);
  if (!jsonPath) return { ok: false };
  try {
    const rec = JSON.parse(await fs.promises.readFile(jsonPath, 'utf8'));
    rec.tags = Array.isArray(tags) ? tags.map(String) : [];
    rec.updatedAt = new Date().toISOString();        // record was modified in Corpus
    await fs.promises.writeFile(jsonPath, JSON.stringify(rec, null, 2), 'utf8');
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('import-posts', async (_e, posts) => {
  const folder = getSaveFolder();
  if (!folder || !Array.isArray(posts)) return { imported: 0, skipped: 0 };
  fs.mkdirSync(folder, { recursive: true });

  const existing = new Set();
  try {
    for (const f of fs.readdirSync(folder)) {
      if (!f.toLowerCase().endsWith('.json') || f === 'config.json' || f === '.index.json') continue;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8'));
        if (r.url) existing.add(r.url);
      } catch { /* skip */ }
    }
  } catch { /* empty */ }

  const stamp = Date.now();
  let imported = 0, skipped = 0, seq = 0;
  for (const p of posts) {
    if (!p || typeof p.image !== 'string' || !/^data:image\//.test(p.image)) { skipped++; continue; }
    if (p.url && existing.has(p.url)) { skipped++; continue; }
    const captureId = `import-${stamp}-${String(seq++).padStart(4, '0')}`;
    const rec = {
      captureId,
      image: `${captureId}.jpg`,
      url: p.url || null,
      platform: p.platform || null,
      text: p.text || null,
      title: p.title || null,
      displayName: p.displayName || null,
      screenName: p.screenName || null,
      userId: p.userId || null,
      likes: p.likes ?? null,
      reposts: p.reposts ?? null,
      replies: p.replies ?? null,
      bookmarks: p.bookmarks ?? null,
      views: p.views ?? null,
      date: p.date || null,
      capturedAt: p.capturedAt || new Date().toISOString(),
      updatedAt: p.updatedAt || p.capturedAt || new Date().toISOString(),
      eagleName: p.eagleName || null,
      mediaType: p.mediaType || null,
      lang: p.lang || null,
      isReply: p.isReply || null,
      isQuote: p.isQuote || null,
      isThread: p.isThread || null,
      quotedUrl: p.quotedUrl || null,
      hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
      tags: Array.isArray(p.tags) ? p.tags : []
    };
    try {
      fs.writeFileSync(path.join(folder, `${captureId}.jpg`), Buffer.from(p.image.split(',')[1] || '', 'base64'));
      fs.writeFileSync(path.join(folder, `${captureId}.json`), JSON.stringify(rec, null, 2), 'utf8');
      if (p.url) existing.add(p.url);
      imported++;
    } catch {
      skipped++;
    }
  }
  return { imported, skipped };
});

ipcMain.handle('clear-all', async () => {
  const folder = getSaveFolder();
  if (!folder) return { ok: false, count: 0 };
  let count = 0;
  // Keep app metadata (config + migrated tag groups); wipe sidecars + every
  // viewable media type (incl. jfif/avif/svg/video/-poster), mirroring delete-post.
  const CLEAR_RE = new RegExp('\\.(' + VIEWABLE_EXTS.join('|') + '|json)$', 'i');
  try {
    for (const f of fs.readdirSync(folder)) {
      if (f === 'config.json' || f === '.index.json' || f === 'tag-groups.json' || f === 'ungrouped.json' || f === 'manual-groups.json' || f === 'folders.json') continue;
      if (CLEAR_RE.test(f)) {
        try { fs.unlinkSync(path.join(folder, f)); count++; } catch { /* skip */ }
      }
    }
  } catch { /* empty */ }
  return { ok: true, count };
});

ipcMain.handle('export-save', async (_e, filename, bytes) => {
  const res = await dialog.showSaveDialog(win, { defaultPath: filename });
  if (res.canceled || !res.filePath) return { saved: false };
  try {
    await fs.promises.writeFile(res.filePath, Buffer.from(bytes));
    return { saved: true, path: res.filePath };
  } catch (err) {
    return { saved: false, error: err.message };
  }
});

// --- バックアップ / 指定フォルダへの増分エクスポート ---------------------------
// 保存先フォルダ自体をクラウド同期の対象にすると（ライブ書き込み中の同期で）壊れやすい。
// ここでは「安全な吐き出し先」へ増分コピーする。クラウドはその出力先だけを同期すればよい。
//   content 'media' … 表示できる画像/動画ファイルのみ（スクショ＋原寸）
//   content 'meta'  … 上記 + サイドカー .json（config.json は機微なので常に除外）
// 削除は「アプリUIで明示削除したとき」だけ出力先へ伝播（runBackup 自体は消さない＝増分追加）。
const LIBRARY_JSON = ['config.json', '.index.json', 'tag-groups.json', 'ungrouped.json', 'manual-groups.json', 'folders.json'];
// 出力は必ずこのサブフォルダの中に書く。ユーザーがデスクトップ等を選んでも直下に
// 数千ファイルがぶちまけられないようにするための安全策（再発防止）。
const BACKUP_SUBDIR = 'Corpus-backup';
function backupDest(dir) { return path.join(dir, BACKUP_SUBDIR); }

// 出力は「人間が取り出しやすい」形にする: 月別フォルダ(YYYY-MM) + 可読ファイル名。
// 同一投稿の画像/原寸/JSONは同じ「ベース名」を共有し隣接させる。captureId は
// ベース名の末尾6文字として埋め込み、復元時に内部のcaptureIdで正準名へ戻せる。
// captureId（ファイル名のID部）を取り出す: <id>.jpg / <id>.json / <id>-media-N.ext / <id>-poster.ext。
function captureIdOf(name) {
  let b = path.basename(name || '');
  b = b.replace(/-media-\d+\.[A-Za-z0-9]+$/i, '');
  b = b.replace(/-poster\.[A-Za-z0-9]+$/i, '');
  b = b.replace(/\.[A-Za-z0-9]+$/i, '');
  return b;
}
function sanitizeNamePart(s, max) {
  if (s == null) return '';
  let t = String(s).replace(/[\\/:*?"<>|]/g, '').replace(/[ -]/g, '').replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max).trim();
  return t;
}
function recDate(rec) {
  const iso = rec.capturedAt || rec.date || '';
  const d = iso ? new Date(iso) : null;
  return (d && !isNaN(d.getTime())) ? d : null;
}
function monthFolderOf(rec) {
  const d = recDate(rec);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '0000-00';
}
// 例: 2026-04-03_pixiv_作者名_作品タイトル_ab12cd
function friendlyBase(rec, captureId) {
  const d = recDate(rec);
  const ymd = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '0000-00-00';
  const platform = sanitizeNamePart(rec.platform || (rec.source === 'eagle-migration' ? 'library' : ''), 16);
  const author = sanitizeNamePart(rec.displayName || rec.screenName || '', 24);
  const title = sanitizeNamePart(rec.title || rec.text || '', 40);
  const id6 = String(captureId || '').replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'xxxxxx';
  let base = [ymd, platform, author, title].filter(Boolean).join('_').replace(/_+/g, '_');
  if (base.length > 100) base = base.slice(0, 100);
  return `${base}_${id6}`;
}

const BACKUP_DEFAULTS = {
  dir: null,              // 出力先（保存先フォルダの内外と重複しないこと）
  content: 'meta',        // 'media' | 'meta'
  onStart: false,         // 起動時に1回
  interval: false,        // 一定間隔
  intervalHours: 24,
  onChange: false,        // 保存先変更時（デバウンス）
  lastRunAt: null,
  lastResult: null
};
function readBackupConfig() {
  const b = readConfig().backup || {};
  return Object.assign({}, BACKUP_DEFAULTS, b);
}
function writeBackupConfig(patch) {
  const cfg = readConfig();
  cfg.backup = Object.assign({}, BACKUP_DEFAULTS, cfg.backup || {}, patch || {});
  writeConfig(cfg);
  return cfg.backup;
}
function pathIsInside(child, parent) {
  const c = path.resolve(child), p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}
// 出力先が保存先と入れ子/同一だと、出力→watch→再エクスポートのループや破壊が起きる。
function validateBackupDir(dir) {
  if (!dir) return { ok: true };
  const src = getSaveFolder();
  if (src && (pathIsInside(dir, src) || pathIsInside(src, dir))) return { ok: false, error: 'overlap' };
  return { ok: true };
}

let backupRunning = false;
const VIEWABLE_RE = new RegExp('\\.(' + VIEWABLE_EXTS.join('|') + ')$', 'i');
async function runBackup(reason) {
  const b = readBackupConfig();
  const src = getSaveFolder();
  if (!src || !b.dir) return { ok: false, error: 'not-configured' };
  if (!validateBackupDir(b.dir).ok) return { ok: false, error: 'overlap' };
  if (backupRunning) return { ok: false, error: 'busy' };
  backupRunning = true;
  const result = { ok: true, copied: 0, skipped: 0, failed: 0, total: 0, reason: reason || 'manual' };
  try {
    const dest = backupDest(b.dir);                         // 直下ではなく Corpus-backup/ の中へ
    await fs.promises.mkdir(dest, { recursive: true });
    let names = [];
    try { names = await fs.promises.readdir(src); } catch { names = []; }
    // サイドカーから captureId → month(YYYY-MM) を作る（投稿フォルダ名は captureId で管理しやすく）。
    const monthOf = new Map();
    for (const name of names) {
      if (!/\.json$/i.test(name) || LIBRARY_JSON.includes(name)) continue;
      try {
        const rec = JSON.parse(await fs.promises.readFile(path.join(src, name), 'utf8'));
        monthOf.set(rec.captureId || captureIdOf(name), monthFolderOf(rec));
      } catch { /* skip */ }
    }
    const includeJson = b.content === 'meta';
    for (const name of names) {
      if (name === 'config.json' || LIBRARY_JSON.includes(name)) continue;   // 機微/ライブラリjsonは出さない
      const isJson = /\.json$/i.test(name);
      const isViewable = VIEWABLE_RE.test(name);
      if (isJson && !includeJson) continue;
      if (!isJson && !isViewable) continue;                 // 未知ファイルは対象外
      result.total++;
      // <月>/<captureId>/ の中へ。同一captureIdのスクショ・原寸・metaが1フォルダに揃う（セット）。
      const id = captureIdOf(name);
      const relDir = path.join(monthOf.get(id) || '0000-00', id);
      const sp = path.join(src, name);
      const destDir = path.join(dest, relDir);
      const dp = path.join(destDir, name);
      try {
        const sst = await fs.promises.stat(sp);
        if (!sst.isFile()) { result.skipped++; continue; }
        let need = true;
        try {
          const dst = await fs.promises.stat(dp);
          // 同一とみなす: サイズ一致かつ mtime がほぼ一致（コピー時に mtime を写すので冪等）
          if (dst.size === sst.size && Math.abs(dst.mtimeMs - sst.mtimeMs) < 2000) need = false;
        } catch { /* 出力先に無い → コピー */ }
        if (!need) { result.skipped++; continue; }
        await fs.promises.mkdir(destDir, { recursive: true });
        // 原子的に: 一時ファイルへコピー → mtime を元に合わせて → rename（同期クライアントが半端を見ない）
        const tmp = dp + '.tmp-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
        await fs.promises.copyFile(sp, tmp);
        try { await fs.promises.utimes(tmp, sst.atime, sst.mtime); } catch { /* ignore */ }
        await fs.promises.rename(tmp, dp);
        result.copied++;
      } catch {
        result.failed++;
      }
    }
  } catch (err) {
    result.ok = false; result.error = err.message;
  } finally {
    backupRunning = false;
  }
  const summary = { copied: result.copied, skipped: result.skipped, failed: result.failed, total: result.total, reason: result.reason, at: new Date().toISOString() };
  try { writeBackupConfig({ lastRunAt: summary.at, lastResult: summary }); } catch { /* ignore */ }
  if (win && !win.isDestroyed()) win.webContents.send('backup-done', Object.assign({}, result, { at: summary.at }));
  return result;
}

// UIでの明示削除を出力先へ伝播（runBackup は消さない＝こちらだけが削除を行う）。
// relDir = <month>/<投稿フォルダ>。その中の該当ファイルを消し、空なら投稿フォルダを掃除。
async function removeFromBackup(relDir, names) {
  const b = readBackupConfig();
  if (!b.dir || !relDir) return;
  const dest = backupDest(b.dir);
  const folderPath = path.resolve(path.join(dest, relDir));
  if (!folderPath.startsWith(path.resolve(dest))) return;   // 出力先の外には触れない
  for (const name of names) {
    const base = path.basename(name || '');
    if (!base || base === 'config.json') continue;
    try { await fs.promises.unlink(path.join(folderPath, base)); } catch { /* 無ければ無視 */ }
  }
  try { const left = await fs.promises.readdir(folderPath); if (!left.length) await fs.promises.rmdir(folderPath); } catch { /* ignore */ }
}

let backupIntervalTimer = null;
let backupChangeDebounce = null;
function armBackupSchedule() {
  if (backupIntervalTimer) { clearInterval(backupIntervalTimer); backupIntervalTimer = null; }
  const b = readBackupConfig();
  if (!b.dir) return;
  if (b.interval) {
    const ms = Math.max(0.05, Number(b.intervalHours) || 24) * 3600 * 1000;
    backupIntervalTimer = setInterval(() => { runBackup('interval'); }, ms);
  }
  // onChange は watchSaveFolder のコールバックで（長めのデバウンスで）処理。
}

ipcMain.handle('get-backup', () => readBackupConfig());
ipcMain.handle('set-backup', (_e, patch) => {
  patch = patch || {};
  if ('dir' in patch && patch.dir) {
    const v = validateBackupDir(patch.dir);
    if (!v.ok) return { ok: false, error: v.error, backup: readBackupConfig() };
  }
  const backup = writeBackupConfig(patch);
  armBackupSchedule();
  return { ok: true, backup };
});
ipcMain.handle('pick-backup-dir', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
  const dir = res.filePaths[0];
  const v = validateBackupDir(dir);
  if (!v.ok) return { ok: false, error: v.error };
  const backup = writeBackupConfig({ dir });
  armBackupSchedule();
  return { ok: true, backup };
});
ipcMain.handle('run-backup', () => runBackup('manual'));
ipcMain.handle('pick-import-folder', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
  return { ok: true, dir: res.filePaths[0] };
});
// バックアップフォルダ（メタデータ込みエクスポート）から保存先へ復元。
// 既存と captureId / url が重複するものはスキップ。ライブラリjson（フォルダ/タグ等）は対象外。
ipcMain.handle('import-from-folder', async (_e, dir) => {
  const folder = getSaveFolder();
  if (!folder || !dir) return { imported: 0, skipped: 0, error: 'no-folder' };
  fs.mkdirSync(folder, { recursive: true });
  const existingIds = new Set(), existingUrls = new Set();
  try {
    for (const f of await fs.promises.readdir(folder)) {
      if (!/\.json$/i.test(f) || LIBRARY_JSON.includes(f)) continue;
      try {
        const r = JSON.parse(await fs.promises.readFile(path.join(folder, f), 'utf8'));
        if (r.captureId) existingIds.add(r.captureId);
        if (r.url) existingUrls.add(r.url);
      } catch { /* skip */ }
    }
  } catch { /* empty */ }
  // 月別/投稿ごとのサブフォルダを再帰的に走査して .json を集める（フラット構造にも対応）。
  const jsons = [];   // { dir, name }
  async function walk(d, depth) {
    if (depth > 6) return;
    let ents;
    try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (/\.json$/i.test(e.name) && !LIBRARY_JSON.includes(e.name)) jsons.push({ dir: d, name: e.name });
    }
  }
  await walk(dir, 0);
  let imported = 0, skipped = 0;
  for (const jf of jsons) {
    let rec;
    try { rec = JSON.parse(await fs.promises.readFile(path.join(jf.dir, jf.name), 'utf8')); } catch { skipped++; continue; }
    const id = rec.captureId;
    if (!id) { skipped++; continue; }
    if (existingIds.has(id) || (rec.url && existingUrls.has(rec.url))) { skipped++; continue; }
    // 投稿フォルダ内の、この captureId に属するファイル（正準名のまま）を保存先へコピー。
    let sibs = [];
    try { sibs = await fs.promises.readdir(jf.dir); } catch { /* ignore */ }
    try {
      for (const rn of sibs) {
        if (captureIdOf(rn) !== id && !rn.startsWith(id)) continue;
        const full = path.join(jf.dir, rn);
        const st = await fs.promises.stat(full).catch(() => null);
        if (!st || !st.isFile()) continue;
        await fs.promises.copyFile(full, path.join(folder, path.basename(rn)));
      }
      existingIds.add(id); if (rec.url) existingUrls.add(rec.url);
      imported++;
    } catch { skipped++; }
  }
  return { imported, skipped };
});

// 任意の画像ファイルをライブラリ画像として取り込む（ユーザー自前の画像でもOK）。
// source:'drag' を付けるので画像閲覧に出る。Corpusのメディアのみエクスポートの取り込みも兼ねる。
const IMPORTABLE_IMG = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'bmp', 'tiff', 'svg'];
ipcMain.handle('import-images', async () => {
  const folder = getSaveFolder();
  if (!folder) return { imported: 0, skipped: 0, error: 'no-folder' };
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: IMPORTABLE_IMG }]
  });
  if (res.canceled || !res.filePaths || !res.filePaths.length) return { imported: 0, skipped: 0, canceled: true };
  fs.mkdirSync(folder, { recursive: true });
  let imported = 0, skipped = 0, seq = 0;
  const stamp = Date.now();
  for (const fp of res.filePaths) {
    try {
      const ext = (path.extname(fp).slice(1) || 'png').toLowerCase();
      if (!IMPORTABLE_IMG.includes(ext)) { skipped++; continue; }
      const st = await fs.promises.stat(fp);
      if (!st.isFile()) { skipped++; continue; }
      const captureId = `drag-${stamp}-${String(seq++).padStart(4, '0')}`;
      const img = `${captureId}.${ext}`;
      const nowIso = new Date().toISOString();
      const mtimeIso = (st.mtime && !isNaN(st.mtime.getTime())) ? st.mtime.toISOString() : nowIso;
      const rec = {
        captureId, image: img, source: 'drag', url: null, platform: null,
        title: path.basename(fp, path.extname(fp)) || null, text: null,
        displayName: null, screenName: null,
        capturedAt: nowIso, date: mtimeIso, updatedAt: nowIso,
        media: [], tags: [], hashtags: []
      };
      await fs.promises.copyFile(fp, path.join(folder, img));
      await fs.promises.writeFile(path.join(folder, `${captureId}.json`), JSON.stringify(rec, null, 2), 'utf8');
      imported++;
    } catch { skipped++; }
  }
  return { imported, skipped };
});

// --- Window ---
function createWindow(show = true) {
  // Resolve the theme from config up front so the first paint (and the window's
  // backdrop) match it — no flash, and SMOKE captures reflect it. We pass the
  // PREF (auto/light/dark) to the page as a ?theme= query that theme.js reads
  // synchronously during <head>; 'auto' is resolved there via prefers-color-scheme
  // (which follows nativeTheme). For the backdrop we resolve 'auto' here too.
  const cfgTheme = readConfig().theme;
  const theme = ['auto', 'light', 'dark'].includes(cfgTheme) ? cfgTheme : 'auto';
  const dark = theme === 'dark' || (theme === 'auto' && nativeTheme.shouldUseDarkColors);
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    show,
    backgroundColor: dark ? '#0c0e12' : '#f6f7f9',
    title: 'Corpus',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { theme } });
}

// Side-effect-free launch check: skips host registration, hides the window,
// and quits once the renderer has loaded. Run with CORPUS_SMOKE=1.
const SMOKE = process.env.CORPUS_SMOKE === '1';

// Single instance: a second launch focuses the existing window instead of
// opening a duplicate (which would fight over the shared userData/cache).
// Skipped under SMOKE so isolated headless test runs never block each other.
const gotSingleInstanceLock = SMOKE || app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  if (!SMOKE) {
    app.on('second-instance', () => {
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });
  }

  app.whenReady().then(() => {
  // Fresh install (no explicit save folder): make sure the default library dir
  // exists so folder/tag writes don't fail before the first capture. Explicit
  // user-picked folders are left untouched.
  try { if (!readConfig().saveFolder) fs.mkdirSync(defaultLibraryDir(), { recursive: true }); } catch { /* ignore */ }
  if (!SMOKE) ensureHostRegistered();
  registerImageProtocol();
  const startMin = !SMOKE && process.env.CORPUS_START_MINIMIZED === '1';
  createWindow(!SMOKE && !startMin);   // start-minimized → create hidden, then show inactive below
  watchSaveFolder();
  if (!SMOKE) {
    armBackupSchedule();                                  // interval スケジュールを起動
    const bk = readBackupConfig();
    if (bk.dir && bk.onStart) setTimeout(() => runBackup('startup'), 4000);   // 起動直後の負荷を避けて少し遅延
  }

  if (SMOKE) {
    const shot = process.env.CORPUS_SMOKE_SHOT;
    win.webContents.on('console-message', (_e, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
    let done = false;
    const quit = (tag) => { if (done) return; done = true; console.log(tag); app.quit(); };
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.CORPUS_SMOKE_EVAL) {
        try {
          const r = await win.webContents.executeJavaScript(process.env.CORPUS_SMOKE_EVAL);
          console.log('EVAL_RESULT', JSON.stringify(r));
        } catch (e) { console.log('EVAL_ERR', e.message); }
      }
      if (shot) {
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(shot, img.toPNG());
        } catch (err) {
          console.error('capture failed:', err);
        }
      }
      quit('SMOKE_OK');
    }, 900));
    setTimeout(() => quit('SMOKE_TIMEOUT'), 9000);
    return;
  }

  // Start minimized when launched on the user's behalf, WITHOUT stealing focus or
  // flashing the taskbar button: show inactive (no focus → no FlashWindowEx), then
  // minimize and explicitly clear any pending attention flash. (A normal launch
  // opens a focused window.)
  if (startMin && win) {
    win.once('ready-to-show', () => {
      win.showInactive();
      win.minimize();
      win.flashFrame(false);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
