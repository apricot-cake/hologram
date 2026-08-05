// The Google Drive destination against a stand-in Drive API
// (app/src/main/lib-backup-cloud-google.ts).
//
// #909 cannot reach a real account — registering an OAuth client is the user's
// own step — so what this suite fixes is the WIRE SHAPE: the request a real
// Drive would have to answer. The stand-in is strict about the parts that are
// easy to get subtly wrong and impossible to notice later:
//
//   * it refuses an upload whose multipart body it cannot parse, so "the
//     metadata and the bytes went up as one RFC 2387 request" is a pass/fail
//     rather than an assumption;
//   * it pages files.list at two entries, so a library bigger than one page
//     cannot quietly come back half-listed (which would read as "the
//     destination lost those files" and prune them);
//   * it counts transferred bytes per file, which is how "a trash move is a
//     move" is checked here rather than trusted.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { MULTIPART_MAX, createGoogleDriveDestination } from '../app/src/main/lib-backup-cloud-google';
import { BACKUP_SUBDIR, IDENTITY_FILE } from '../app/src/main/lib-backup-destination';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

interface DriveItem {
  id: string;
  name: string;
  parentId: string;
  isFolder: boolean;
  data: Buffer;
  modifiedTime: string;
  trashed: boolean;
}

interface FakeDrive {
  base: string;
  close(): void;
  items: Map<string, DriveItem>;
  /** Bytes that actually crossed the wire, per file name. */
  transferred: Map<string, number>;
  /** Every (method, pathname) the adapter asked for, in order. */
  calls: string[];
  /** Content-Range values seen on resumable chunks. */
  ranges: string[];
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/** Splits an RFC 2387 body into its parts' bodies (headers dropped). */
function multipartParts(body: Buffer, boundary: string): Buffer[] {
  const sep = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let at = body.indexOf(sep);
  while (at !== -1) {
    const start = at + sep.length;
    const next = body.indexOf(sep, start);
    if (next === -1) break;
    const chunk = body.subarray(start, next);
    const headEnd = chunk.indexOf('\r\n\r\n');
    if (headEnd !== -1) parts.push(chunk.subarray(headEnd + 4, chunk.length - 2));
    at = next;
  }
  return parts;
}

const running: FakeDrive[] = [];
const made: string[] = [];
afterEach(() => {
  for (const drive of running.splice(0)) drive.close();
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempFile(content: Buffer | string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-gdrive-'));
  made.push(dir);
  const file = path.join(dir, 'src.bin');
  fs.writeFileSync(file, content);
  return file;
}

async function startFakeDrive(): Promise<FakeDrive> {
  const items = new Map<string, DriveItem>();
  const sessions = new Map<string, { id: string; chunks: Buffer[] }>();
  const state: FakeDrive = { base: '', close: () => server.close(), items, transferred: new Map(), calls: [], ranges: [] };
  let seq = 0;
  const nextId = () => `f${++seq}`;
  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const meta = (item: DriveItem) => ({
    id: item.id,
    name: item.name,
    mimeType: item.isFolder ? FOLDER_MIME : 'application/octet-stream',
    size: item.isFolder ? undefined : String(item.data.length),
    modifiedTime: item.modifiedTime,
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    state.calls.push(`${req.method} ${url.pathname}`);
    if (!(req.headers.authorization || '').startsWith('Bearer ')) return json(res, 401, { error: { code: 401, status: 'UNAUTHENTICATED' } });

    // --- files.list -------------------------------------------------------
    if (req.method === 'GET' && url.pathname === '/drive/v3/files') {
      const q = url.searchParams.get('q') || '';
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\(.)/g, '$1');
      const foldersOnly = q.includes(FOLDER_MIME);
      const all = [...items.values()].filter((i) => !i.trashed && (!parent || i.parentId === parent) && (!name || i.name === name) && (!foldersOnly || i.isFolder));
      // Two per page, so the adapter's pageToken loop is exercised every time.
      const from = Number(url.searchParams.get('pageToken') || '0');
      const page = all.slice(from, from + 2);
      const nextPageToken = from + 2 < all.length ? String(from + 2) : undefined;
      return json(res, 200, { files: page.map(meta), nextPageToken });
    }

    // --- files.create (metadata only: a folder) ---------------------------
    if (req.method === 'POST' && url.pathname === '/drive/v3/files') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const id = nextId();
      items.set(id, { id, name: body.name, parentId: (body.parents || [])[0] || 'root', isFolder: body.mimeType === FOLDER_MIME, data: Buffer.alloc(0), modifiedTime: body.modifiedTime || '', trashed: false });
      return json(res, 200, { id });
    }

    // --- uploads ----------------------------------------------------------
    if (url.pathname === '/upload/drive/v3/files' || url.pathname.startsWith('/upload/drive/v3/files/')) {
      const existingId = url.pathname.startsWith('/upload/drive/v3/files/') ? url.pathname.slice('/upload/drive/v3/files/'.length) : null;
      const body = await readBody(req);
      if (url.searchParams.get('uploadType') === 'resumable') {
        const session = `s${++seq}`;
        const metadata = JSON.parse(body.toString('utf8') || '{}');
        const id = existingId ?? nextId();
        if (!existingId) items.set(id, { id, name: metadata.name, parentId: (metadata.parents || [])[0] || 'root', isFolder: false, data: Buffer.alloc(0), modifiedTime: metadata.modifiedTime || '', trashed: false });
        else items.set(id, { ...(items.get(id) as DriveItem), modifiedTime: metadata.modifiedTime || (items.get(id) as DriveItem).modifiedTime });
        sessions.set(session, { id, chunks: [] });
        res.writeHead(200, { location: `${state.base}/upload/session/${session}`, 'content-type': 'application/json' });
        return res.end('{}');
      }
      const boundary = /boundary=(.+)$/.exec(req.headers['content-type'] || '')?.[1];
      if (!boundary) return json(res, 400, { error: { code: 400, status: 'INVALID_ARGUMENT' } });
      const parts = multipartParts(body, boundary);
      if (parts.length !== 2) return json(res, 400, { error: { code: 400, status: 'INVALID_ARGUMENT' } });
      const metadata = JSON.parse(parts[0].toString('utf8'));
      const data = parts[1];
      const id = existingId ?? nextId();
      const previous = items.get(id);
      items.set(id, {
        id,
        name: metadata.name ?? previous?.name ?? '',
        parentId: (metadata.parents || [])[0] ?? previous?.parentId ?? 'root',
        isFolder: false,
        data,
        modifiedTime: metadata.modifiedTime ?? previous?.modifiedTime ?? '',
        trashed: false,
      });
      const item = items.get(id) as DriveItem;
      state.transferred.set(item.name, (state.transferred.get(item.name) || 0) + data.length);
      return json(res, 200, { id });
    }

    if (req.method === 'PUT' && url.pathname.startsWith('/upload/session/')) {
      const session = sessions.get(url.pathname.slice('/upload/session/'.length));
      if (!session) return json(res, 404, { error: { code: 404, status: 'NOT_FOUND' } });
      const range = String(req.headers['content-range'] || '');
      state.ranges.push(range);
      const chunk = await readBody(req);
      session.chunks.push(chunk);
      const total = Number(range.slice(range.lastIndexOf('/') + 1));
      const have = session.chunks.reduce((n, c) => n + c.length, 0);
      const item = items.get(session.id) as DriveItem;
      state.transferred.set(item.name, (state.transferred.get(item.name) || 0) + chunk.length);
      if (have < total) {
        res.writeHead(308, { range: `bytes=0-${have - 1}` });
        return res.end();
      }
      items.set(session.id, { ...item, data: Buffer.concat(session.chunks) });
      return json(res, 200, { id: session.id });
    }

    // --- per-file operations ---------------------------------------------
    if (url.pathname.startsWith('/drive/v3/files/')) {
      const id = decodeURIComponent(url.pathname.slice('/drive/v3/files/'.length));
      const item = items.get(id);
      if (!item) return json(res, 404, { error: { code: 404, status: 'NOT_FOUND' } });
      if (req.method === 'GET' && url.searchParams.get('alt') === 'media') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        return res.end(item.data);
      }
      if (req.method === 'PATCH') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const addParents = url.searchParams.get('addParents');
        items.set(id, { ...item, name: body.name ?? item.name, parentId: addParents ?? item.parentId });
        return json(res, 200, { id });
      }
      if (req.method === 'DELETE') {
        items.delete(id);
        res.writeHead(204);
        return res.end();
      }
    }
    return json(res, 404, { error: { code: 404, status: 'NOT_FOUND' } });
  });

  items.set('root', { id: 'root', name: 'My Drive', parentId: '', isFolder: true, data: Buffer.alloc(0), modifiedTime: '', trashed: false });
  await new Promise<void>((resolve) => server.listen({ host: '127.0.0.1', port: 0 }, () => resolve()));
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  running.push(state);
  return state;
}

/** Sends googleapis.com traffic to the stand-in, path and query intact. */
function routed(drive: FakeDrive): typeof globalThis.fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    return globalThis.fetch(`${drive.base}${url.pathname}${url.search}`, init);
  }) as typeof globalThis.fetch;
}

const destinationFor = (drive: FakeDrive) => createGoogleDriveDestination({ accessToken: async () => 'token', fetch: routed(drive), retryBaseMs: 1 });
const named = (drive: FakeDrive, name: string) => [...drive.items.values()].find((i) => i.name === name);

describe('Google Drive 宛先', () => {
  test('初回は My Drive 直下に Hologram-backup を作り、2回目は作り直さない', async () => {
    const drive = await startFakeDrive();
    await destinationFor(drive).list();
    const roots = [...drive.items.values()].filter((i) => i.isFolder && i.name === BACKUP_SUBDIR);
    expect(roots).toHaveLength(1);
    expect(roots[0].parentId).toBe('root');
    await destinationFor(drive).list();
    expect([...drive.items.values()].filter((i) => i.isFolder && i.name === BACKUP_SUBDIR)).toHaveLength(1);
  });

  test('小さいファイルは1リクエストで上がり、mtime も一緒に届く', async () => {
    const drive = await startFakeDrive();
    const dest = destinationFor(drive);
    const mtime = Date.parse('2026-08-05T10:00:00.000Z');
    await dest.put('a.jpg', tempFile('hello'), mtime);
    const stored = named(drive, 'a.jpg') as DriveItem;
    expect(stored.data.toString('utf8')).toBe('hello');
    expect(Date.parse(stored.modifiedTime)).toBe(mtime);
    expect(drive.calls.filter((c) => c.startsWith('POST /upload'))).toHaveLength(1);
    expect((await destinationFor(drive).list()).get('a.jpg')).toEqual({ size: 5, mtimeMs: mtime });
  });

  test('5MB を超えるファイルは分割セッションで上がり、バイト列は欠けない', async () => {
    const drive = await startFakeDrive();
    const dest = destinationFor(drive);
    const size = MULTIPART_MAX + 4 * 1024 * 1024; // 2 chunks at an 8MiB chunk size
    const body = Buffer.alloc(size, 7);
    body.write('tail', size - 4);
    await dest.put('big.mp4', tempFile(body), 1_700_000_000_000);
    expect(drive.ranges).toHaveLength(2);
    expect(drive.ranges[0]).toMatch(/^bytes 0-\d+\/\d+$/);
    const stored = named(drive, 'big.mp4') as DriveItem;
    expect(stored.data.length).toBe(size);
    expect(stored.data.subarray(size - 4).toString('utf8')).toBe('tail');
  });

  test('ゴミ箱への移動は addParents/removeParents で、バイト列は再送されない', async () => {
    const drive = await startFakeDrive();
    const dest = destinationFor(drive);
    await dest.put('a.jpg', tempFile('bytes'), 1000);
    const before = drive.transferred.get('a.jpg');
    await dest.move('a.jpg', '.trash/a.jpg');
    expect(drive.transferred.get('a.jpg')).toBe(before);
    const trash = named(drive, '.trash') as DriveItem;
    expect(trash.isFolder).toBe(true);
    expect((named(drive, 'a.jpg') as DriveItem).parentId).toBe(trash.id);
    expect([...(await destinationFor(drive).list()).keys()]).toEqual(['.trash/a.jpg']);
  });

  test('remove は標準の削除 API（Drive では完全削除）を使う', async () => {
    const drive = await startFakeDrive();
    const dest = destinationFor(drive);
    await dest.put('a.jpg', tempFile('x'), 1000);
    await dest.remove('a.jpg');
    expect(drive.calls.some((c) => c.startsWith('DELETE /drive/v3/files/'))).toBe(true);
    expect(named(drive, 'a.jpg')).toBeUndefined();
  });

  test('身元ファイルは往復し、list には出ない', async () => {
    const drive = await startFakeDrive();
    const dest = destinationFor(drive);
    await dest.writeIdentity({ libraryId: 'lib-a', lastRunAt: null });
    await dest.put('a.jpg', tempFile('x'), 1000);
    const fresh = destinationFor(drive);
    expect(await fresh.readIdentity()).toEqual({ libraryId: 'lib-a', lastRunAt: null });
    expect([...(await fresh.list()).keys()]).toEqual(['a.jpg']);
    expect(named(drive, IDENTITY_FILE)).toBeTruthy();
  });

  test('1ページに収まらない宛先も全件読める（ページングで取りこぼさない）', async () => {
    const drive = await startFakeDrive();
    const dest = destinationFor(drive);
    for (const name of ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg']) await dest.put(name, tempFile(name), 1000);
    expect([...(await destinationFor(drive).list()).keys()].sort()).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg']);
  });
});
