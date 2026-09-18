// URLごとの取得結果と再開時刻をライブラリに残す。fetch はDBを書き換えない。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { configDir } = require('../native-host/paths.mts');
const { postKeyOf } = require('../native-host/post-key.mts');
const { fetchPostMetadata, parsePostUrl } = require('../extension/utils/extractor/index.ts');
const { writeFileAtomicSync } = require('../app/src/main/lib-atomic.ts');

function atomic(file, value) {
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileAtomicSync(file, JSON.stringify(value, null, 2), { fsync: true });
      return;
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 10) throw error;
      // Windowsで読み取り中のファイルを置き換えられない場合だけ再試行する。
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

function retryAt(header, attempts, now = Date.now()) {
  if (header) {
    const seconds = Number(header);
    const date = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(header);
    if (Number.isFinite(date) && date > now) return date;
  }
  return now + Math.min(3600000, 60000 * 2 ** Math.min(attempts - 1, 6));
}

function apiSucceeded(result) {
  return !!result && !result.metaError && (result.text != null || result.title != null || result.likes != null || result.media?.length > 0);
}

function summary(state) {
  const counts = {};
  for (const entry of state.entries) counts[entry.status] = (counts[entry.status] || 0) + 1;
  return { total: state.entries.length, counts, sites: state.sites };
}

async function main() {
  const command = process.argv[2] || 'status';
  const folder = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8')).saveFolder;
  if (!folder) throw Error('保存先が設定されていません');
  const root = path.join(folder, '.hologram-metadata-backfill');
  fs.mkdirSync(path.join(root, 'results'), { recursive: true });
  const stateFile = path.join(root, 'progress.json');
  let state: any;
  if (fs.existsSync(stateFile)) {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (state.folder !== folder || state.version !== 1) throw Error('進捗の保存先または形式が違います');
  } else {
    const db = new DatabaseSync(path.join(folder, 'hologram.db'), { readOnly: true });
    const rows = db.prepare("SELECT captureId,url,platform,source,text,displayName FROM posts WHERE isContext=0 AND trashedAt IS NULL AND url IS NOT NULL AND (source='eagle-migration' OR text IS NULL OR displayName IS NULL)").all();
    db.close();
    const groups = new Map<string, any>();
    const unsupported: any[] = [];
    for (const row of rows) {
      const parsed = parsePostUrl(row.url),
        key = postKeyOf(row.url);
      if (!parsed || !key) {
        unsupported.push(row);
        continue;
      }
      if (!groups.has(key)) groups.set(key, { key, url: row.url, platform: parsed.platform, ids: [], author: row.displayName, status: 'pending', attempts: 0 });
      groups.get(key).ids.push(row.captureId);
    }
    state = { version: 1, folder, createdAt: new Date().toISOString(), entries: [...groups.values()], unsupported, sites: {} };
    atomic(stateFile, state);
  }
  const resultFile = (entry) => path.join(root, 'results', crypto.createHash('sha256').update(entry.key).digest('hex') + '.json');
  const checkpoint = () => {
    state.updatedAt = new Date().toISOString();
    atomic(stateFile, state);
    atomic(path.join(root, 'needs-review.json'), { failed: state.entries.filter((e) => e.status === 'failed' || e.status === 'retry'), unsupported: state.unsupported });
  };
  if (command === 'status' || command === 'plan') {
    console.log(JSON.stringify({ root, ...summary(state) }));
    return;
  }
  if (command !== 'fetch') throw Error('使用方法: node scripts/resume-metadata.cts plan|fetch|status');
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
  const nativeFetch = globalThis.fetch;
  let current: any = null;
  let active: AbortController | null = null;
  let stopping = false;
  process.once('SIGINT', () => {
    stopping = true;
  });
  process.once('SIGTERM', () => {
    stopping = true;
  });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  globalThis.fetch = async (url, opts: RequestInit = {}) => {
    if (!current || !active) throw Error('取得コンテキストがありません');
    const site = (state.sites[current.platform] ||= { nextAt: 0, rateLimits: 0 });
    if (site.nextAt > Date.now()) throw Error('rate-limited');
    const response = await nativeFetch(url, { ...opts, signal: AbortSignal.any([active.signal, ...(opts.signal ? [opts.signal] : []), AbortSignal.timeout(15000)]) });
    current.http = response.status;
    if (response.status === 429) {
      site.rateLimits++;
      site.nextAt = retryAt(response.headers.get('retry-after'), site.rateLimits);
      current.reason = 'rateLimited';
      checkpoint();
      throw Error('rate-limited');
    }
    if (response.status === 404 || response.status === 410) current.reason = 'unavailable';
    else if (response.status === 401 || response.status === 403) current.reason = 'accessDenied';
    else if (response.status >= 500) current.reason = 'serverError';
    if (current.platform === 'x' && response.ok) {
      const data = await response
        .clone()
        .json()
        .catch(() => null);
      if (data?.__typename === 'TweetTombstone') {
        const message = data.tombstone?.text?.text || '';
        current.reason = /limits who can view/i.test(message) ? 'protected' : /deleted/i.test(message) ? 'deleted' : /age[ -]?restricted/i.test(message) ? 'ageRestricted' : 'unknownRestriction';
      }
    }
    return response;
  };
  let processed = 0;
  try {
    for (const entry of state.entries) {
      if (stopping || processed >= limit) break;
      if (entry.status === 'applied' || entry.status === 'failed') continue;
      if (fs.existsSync(resultFile(entry))) {
        const cached = JSON.parse(fs.readFileSync(resultFile(entry), 'utf8'));
        if (apiSucceeded(cached.result) && cached.reason !== 'rateLimited') {
          entry.status = 'fetched';
          continue;
        }
        fs.renameSync(resultFile(entry), resultFile(entry) + '.invalid-' + Date.now());
      }
      const site = (state.sites[entry.platform] ||= { nextAt: 0, rateLimits: 0 });
      if (site.nextAt > Date.now()) continue;
      if (entry.nextAt > Date.now()) continue;
      if (site.lastCompletedAt) await sleep(Math.max(0, site.lastCompletedAt + 2000 - Date.now()));
      entry.status = 'fetching';
      entry.attempts++;
      delete entry.reason;
      checkpoint();
      current = entry;
      active = new AbortController();
      let result: any;
      try {
        result = await fetchPostMetadata(entry.url);
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error);
      } finally {
        active.abort();
      }
      if (result) atomic(resultFile(entry), { fetchedAt: new Date().toISOString(), result, reason: entry.reason });
      if (result && apiSucceeded(result) && entry.reason !== 'rateLimited') {
        entry.status = 'fetched';
        entry.author = result.displayName || entry.author;
        delete entry.reason;
      } else {
        entry.reason ||= result?.metaError || 'unknown';
        const retry = ['rateLimited', 'fetchFailed', 'serverError'].includes(entry.reason);
        entry.status = retry && entry.attempts < 4 ? 'retry' : 'failed';
        if (entry.status === 'retry') entry.nextAt = Math.max(site.nextAt, retryAt(null, entry.attempts));
        // 失敗応答も別ファイルに残し、再取得時だけ置き換える。
        if (fs.existsSync(resultFile(entry))) fs.renameSync(resultFile(entry), resultFile(entry) + '.failed-' + entry.attempts);
      }
      site.lastCompletedAt = Date.now();
      checkpoint();
      processed++;
      console.log(JSON.stringify({ processed, url: entry.url, status: entry.status, reason: entry.reason, ...summary(state).counts }));
      // biome-ignore lint/plugin: APIへの負荷を抑えるため投稿間を2秒空ける。
      await sleep(2000);
    }
  } finally {
    globalThis.fetch = nativeFetch;
    checkpoint();
  }
  console.log(JSON.stringify({ root, ...summary(state) }));
}

module.exports = { retryAt, apiSucceeded };
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
