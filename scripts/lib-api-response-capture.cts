const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { z } = require('zod');

const CAPTURE_MARKER = 'HOLOGRAM_DEV_API_RESPONSE_CAPTURE_V1';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SESSION_BYTES = 20 * 1024 * 1024;
const MAX_RESPONSES = 200;
const RETENTION_MS = 7 * 86400000;
const MAX_SESSIONS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// 開発用コマンドだけが参照する。URL は再生用に保持し、要求ヘッダーは受け取らない。
function endpointOf(input: string): string | null {
  const u = new URL(input);
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  if (u.hostname === 'cdn.syndication.twimg.com' && u.pathname === '/tweet-result') return 'x-post';
  if (u.hostname === 'www.pixiv.net' && /^\/ajax\/illust\/\d+(?:\/(?:pages|ugoira_meta))?$/.test(u.pathname)) return `pixiv-${u.pathname.split('/').at(-1)?.match(/^\d+$/) ? 'post' : u.pathname.split('/').at(-1)}`;
  if (u.hostname === 'www.pixiv.net' && /^\/ajax\/user\/\d+$/.test(u.pathname)) return 'pixiv-profile';
  if ((u.hostname === 'plc.directory' && /^\/did:plc:[a-zA-Z0-9]+$/.test(u.pathname)) || /\/did\.json$/.test(u.pathname)) return 'bluesky-did';
  if (['public.api.bsky.app', 'bsky.social'].includes(u.hostname) && /^\/xrpc\/(?:com.atproto.identity.resolveHandle|com.atproto.repo.getRecord|com.atproto.server.describeServer|app.bsky.actor.getProfile|app.bsky.feed.getPostThread)$/.test(u.pathname)) return u.pathname.slice(6);
  return null;
}

function captureRoot(env = process.env): string {
  if (!env.LOCALAPPDATA || !path.isAbsolute(env.LOCALAPPDATA)) throw new Error('LOCALAPPDATA の絶対パスが必要です');
  const root = path.join(env.LOCALAPPDATA, 'Hologram', 'verification', 'api-responses');
  const repo = path.resolve(__dirname, '..');
  if (!path.relative(repo, root).startsWith('..')) throw new Error('応答をリポジトリ内へ保存できません');
  return root;
}

function assertDirectory(directory: string): void {
  assertNoLinks(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertNoLinks(directory);
}

function assertNoLinks(directory: string): void {
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('収集先のリンクは使用できません');
    if (path.dirname(current) === current) break;
  }
}

function pruneSessions(root: string, now = Date.now()): void {
  assertDirectory(root);
  const owned: { directory: string; createdAt: number }[] = [];
  for (const name of fs.readdirSync(root)) {
    if (!UUID.test(name)) continue;
    const directory = path.resolve(root, name);
    if (path.dirname(directory) !== path.resolve(root) || !fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) continue;
    const summaryFile = path.join(directory, 'summary.json');
    if (!fs.existsSync(summaryFile) || fs.lstatSync(summaryFile).isSymbolicLink() || fs.statSync(summaryFile).size > 65536) continue;
    let summary: { format?: string; createdAt?: string };
    try {
      summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
    } catch {
      continue;
    }
    const createdAt = Date.parse(summary.createdAt || '');
    if (summary.format === CAPTURE_MARKER && Number.isFinite(createdAt)) owned.push({ directory, createdAt });
  }
  owned.sort((a, b) => b.createdAt - a.createdAt);
  for (const [index, item] of owned.entries()) {
    if (now - item.createdAt > RETENTION_MS || index >= MAX_SESSIONS - 1) {
      // UUID と所有マーカーを確認した root の直下だけを削除する。
      if (path.dirname(path.resolve(item.directory)) !== path.resolve(root)) throw new Error('収集先の外は削除できません');
      fs.rmSync(item.directory, { recursive: true });
    }
  }
}

function summarizeRecord(record): any {
  return { platform: record.platform, metaError: record.metaError || null, acquisitionIssues: record.acquisitionIssues || [], hasText: !!record.text, hasAvatar: !!record.avatar, mediaCount: record.media.length };
}

function createCaptureSession(options: { urls: string[]; seconds: number }, env = process.env) {
  const root = captureRoot(env);
  pruneSessions(root);
  const id = crypto.randomUUID();
  const directory = path.join(root, id);
  assertDirectory(directory);
  const capture: any = { format: CAPTURE_MARKER, createdAt: new Date().toISOString(), limits: { maxResponseBytes: MAX_RESPONSE_BYTES, maxSessionBytes: MAX_SESSION_BYTES, maxResponses: MAX_RESPONSES, seconds: options.seconds }, limited: false, responses: [], posts: [] };
  const expiresAt = Date.now() + options.seconds * 1000;
  let bytes = 0;
  function summary() {
    return { format: CAPTURE_MARKER, createdAt: capture.createdAt, session: id, responseCount: capture.responses.length, posts: capture.posts.map((post) => post.result), limited: capture.limited };
  }
  function persist() {
    const file = path.join(directory, 'capture.json');
    const temp = path.join(directory, 'capture.tmp');
    fs.writeFileSync(temp, JSON.stringify(capture), { mode: 0o600 });
    fs.renameSync(temp, file);
    fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary()), { mode: 0o600 });
  }
  persist();
  return {
    id,
    expiresAt,
    capture,
    addResponse(input: { url: string; status: number | null; body: string | null; outcome: string }) {
      const endpoint = endpointOf(input.url);
      if (!endpoint) throw new Error('対応する投稿API以外は採取できません');
      // 呼び出し元の余分なヘッダー等を保存しない。
      const entry = { url: input.url, endpoint, status: input.status, body: input.body, outcome: input.outcome };
      const size = Buffer.byteLength(JSON.stringify(entry));
      if (Date.now() > expiresAt || capture.responses.length >= MAX_RESPONSES || Buffer.byteLength(input.body || '') > MAX_RESPONSE_BYTES || bytes + size > MAX_SESSION_BYTES - 65536) {
        capture.limited = true;
        return false;
      }
      capture.responses.push(entry);
      bytes += size;
      return true;
    },
    addPost(url: string, record) {
      capture.posts.push({ url, result: summarizeRecord(record) });
      persist();
    },
    finish() {
      persist();
      return summary();
    },
  };
}

const CaptureSchema = z.object({
  format: z.literal(CAPTURE_MARKER),
  createdAt: z.string(),
  limited: z.boolean(),
  responses: z.array(z.object({ url: z.string().url(), endpoint: z.string(), status: z.number().int().min(200).max(599).nullable(), body: z.string().nullable(), outcome: z.enum(['response', 'transport', 'oversize']) })).max(MAX_RESPONSES),
  posts: z.array(z.object({ url: z.string().url(), result: z.unknown() })).max(20),
});
function readSession(id: string, env = process.env) {
  if (!UUID.test(id)) throw new Error('収集セッションのUUIDが必要です');
  const root = captureRoot(env);
  const directory = path.join(root, id);
  assertDirectory(root);
  if (!fs.existsSync(directory)) throw new Error('収集セッションが見つからないか保存先が不正です');
  assertNoLinks(directory);
  const file = path.join(directory, 'capture.json');
  if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > MAX_SESSION_BYTES) throw new Error('応答ファイルの上限または保存先が不正です');
  const capture = CaptureSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  for (const response of capture.responses) if (!endpointOf(response.url) || Buffer.byteLength(response.body || '') > MAX_RESPONSE_BYTES) throw new Error('収集した応答の契約が不正です');
  return capture;
}

async function replayCapture(capture, fetchPostMetadata) {
  const original = globalThis.fetch;
  const positions = new Map<string, number>();
  let unmatchedRequests = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    const matching = capture.responses.filter((entry) => entry.url === url);
    const index = positions.get(url) || 0;
    positions.set(url, index + 1);
    const entry = matching[index];
    if (!entry) {
      unmatchedRequests++;
      throw new Error('収集にないAPI要求です');
    }
    if (entry.outcome !== 'response') throw new Error('収集時のAPI取得失敗です');
    return new Response([204, 205, 304].includes(entry.status) ? null : entry.body, { status: entry.status });
  };
  try {
    const posts: any[] = [];
    for (const post of capture.posts) {
      const result = summarizeRecord(await fetchPostMetadata(post.url, {}));
      posts.push({ ...result, changed: JSON.stringify(result) !== JSON.stringify(post.result) });
    }
    return { posts, unmatchedRequests, limited: capture.limited };
  } finally {
    globalThis.fetch = original;
  }
}

module.exports = { CAPTURE_MARKER, MAX_RESPONSE_BYTES, MAX_SESSION_BYTES, MAX_RESPONSES, RETENTION_MS, MAX_SESSIONS, endpointOf, captureRoot, pruneSessions, createCaptureSession, summarizeRecord, readSession, replayCapture };
