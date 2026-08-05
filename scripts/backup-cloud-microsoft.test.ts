// The OneDrive destination against a stand-in Microsoft Graph
// (app/src/main/lib-backup-cloud-microsoft.ts).
//
// Same purpose as the Google suite: #909 cannot reach a real account, so what
// is fixed here is the request shape a real Graph would have to answer. Two of
// Graph's rules are enforced by the stand-in rather than assumed, because both
// fail in ways that only show up against the real service:
//
//   * an upload session's PUT must NOT carry the Authorization header — the
//     docs say sending it "might result in an HTTP 401", so the stand-in
//     answers 401 when it sees one;
//   * every byte range must be a multiple of 320 KiB except the last, which is
//     the rule whose violation "can result in large file transfers failing
//     after the last byte range is uploaded" — i.e. silently, at the end.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { SIMPLE_MAX, createOneDriveDestination } from '../app/src/main/lib-backup-cloud-microsoft';
import { IDENTITY_FILE } from '../app/src/main/lib-backup-destination';

const RANGE_MULTIPLE = 320 * 1024;

interface GraphItem {
  id: string;
  name: string;
  parentId: string;
  isFolder: boolean;
  data: Buffer;
  lastModifiedDateTime: string;
}

interface FakeGraph {
  base: string;
  close(): void;
  items: Map<string, GraphItem>;
  transferred: Map<string, number>;
  calls: string[];
  /** Set when a session PUT arrived with a bearer token (a documented no). */
  sessionSawAuthorization: boolean;
  /** Byte-range sizes seen on session PUTs. */
  chunkSizes: number[];
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const running: FakeGraph[] = [];
const made: string[] = [];
afterEach(() => {
  for (const graph of running.splice(0)) graph.close();
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempFile(content: Buffer | string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-onedrive-'));
  made.push(dir);
  const file = path.join(dir, 'src.bin');
  fs.writeFileSync(file, content);
  return file;
}

const ITEMS = '/v1.0/me/drive/items/';

async function startFakeGraph(): Promise<FakeGraph> {
  const items = new Map<string, GraphItem>();
  const sessions = new Map<string, { id: string; chunks: Buffer[] }>();
  const state: FakeGraph = { base: '', close: () => server.close(), items, transferred: new Map(), calls: [], sessionSawAuthorization: false, chunkSizes: [] };
  let seq = 0;
  const nextId = () => `i${++seq}`;
  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const meta = (item: GraphItem) => (item.isFolder ? { id: item.id, name: item.name, folder: { childCount: 0 } } : { id: item.id, name: item.name, size: item.data.length, file: {}, lastModifiedDateTime: item.lastModifiedDateTime, fileSystemInfo: { lastModifiedDateTime: item.lastModifiedDateTime } });
  const upsert = (parentId: string, name: string, data: Buffer, existingId: string | null): GraphItem => {
    const id = existingId ?? [...items.values()].find((i) => i.parentId === parentId && i.name === name)?.id ?? nextId();
    const previous = items.get(id);
    const item: GraphItem = { id, name: previous?.name ?? name, parentId: previous?.parentId ?? parentId, isFolder: false, data, lastModifiedDateTime: previous?.lastModifiedDateTime ?? '' };
    items.set(id, item);
    state.transferred.set(item.name, (state.transferred.get(item.name) || 0) + data.length);
    return item;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    state.calls.push(`${req.method} ${url.pathname}`);
    const authorized = (req.headers.authorization || '').startsWith('Bearer ');

    // --- the pre-authorized upload session URL ---------------------------
    if (url.pathname.startsWith('/uploadsession/')) {
      if (authorized) {
        state.sessionSawAuthorization = true;
        return json(res, 401, { error: { code: 'InvalidAuthenticationToken' } });
      }
      const session = sessions.get(url.pathname.slice('/uploadsession/'.length));
      if (!session) return json(res, 404, { error: { code: 'itemNotFound' } });
      const range = String(req.headers['content-range'] || '');
      const chunk = await readBody(req);
      const total = Number(range.slice(range.lastIndexOf('/') + 1));
      const have = session.chunks.reduce((n, c) => n + c.length, 0) + chunk.length;
      // "each byte range MUST be a multiple of 320 KiB" — except the last.
      if (have < total && chunk.length % RANGE_MULTIPLE !== 0) return json(res, 400, { error: { code: 'invalidRange' } });
      state.chunkSizes.push(chunk.length);
      session.chunks.push(chunk);
      const item = items.get(session.id) as GraphItem;
      state.transferred.set(item.name, (state.transferred.get(item.name) || 0) + chunk.length);
      if (have < total) return json(res, 202, { nextExpectedRanges: [`${have}-`] });
      items.set(session.id, { ...item, data: Buffer.concat(session.chunks) });
      return json(res, 201, meta(items.get(session.id) as GraphItem));
    }

    if (!authorized) return json(res, 401, { error: { code: 'InvalidAuthenticationToken' } });

    // The app folder comes into being on this call (that is the documented way).
    if (req.method === 'GET' && url.pathname === '/v1.0/me/drive/special/approot') {
      if (!items.has('approot')) items.set('approot', { id: 'approot', name: 'Hologram', parentId: '', isFolder: true, data: Buffer.alloc(0), lastModifiedDateTime: '' });
      return json(res, 200, { id: 'approot' });
    }

    if (url.pathname.startsWith(ITEMS)) {
      const rest = url.pathname.slice(ITEMS.length);
      const byPath = /^([^/:]+):\/(.+?):\/(content|createUploadSession)$/.exec(rest);
      const byId = /^([^/:]+)\/(content|children|createUploadSession)$/.exec(rest);
      const parentId = byPath?.[1] ?? '';
      const name = byPath ? decodeURIComponent(byPath[2]) : '';
      const op = byPath?.[3] ?? byId?.[2] ?? '';
      const id = byId?.[1] ?? rest;

      if (op === 'content' && req.method === 'PUT') {
        const data = await readBody(req);
        const item = byPath ? upsert(parentId, name, data, null) : upsert('', '', data, id);
        return json(res, 201, meta(item));
      }
      if (op === 'content' && req.method === 'GET') {
        const item = items.get(id);
        if (!item) return json(res, 404, { error: { code: 'itemNotFound' } });
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        return res.end(item.data);
      }
      if (op === 'createUploadSession' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const properties = body.item || {};
        const target = byPath ? upsert(parentId, name, Buffer.alloc(0), null) : (items.get(id) as GraphItem);
        items.set(target.id, { ...target, lastModifiedDateTime: properties.fileSystemInfo?.lastModifiedDateTime ?? target.lastModifiedDateTime });
        const session = `s${++seq}`;
        sessions.set(session, { id: target.id, chunks: [] });
        return json(res, 200, { uploadUrl: `${state.base}/uploadsession/${session}`, expirationDateTime: '2026-08-06T00:00:00Z' });
      }
      if (op === 'children' && req.method === 'GET') {
        const all = [...items.values()].filter((i) => i.parentId === id);
        const from = Number(url.searchParams.get('skip') || '0');
        const page = all.slice(from, from + 2);
        const body: Record<string, unknown> = { value: page.map(meta) };
        // Two per page, so the @odata.nextLink loop is exercised every time.
        if (from + 2 < all.length) body['@odata.nextLink'] = `${state.base}${url.pathname}?skip=${from + 2}`;
        return json(res, 200, body);
      }
      if (op === 'children' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        if ([...items.values()].some((i) => i.parentId === id && i.name === body.name)) return json(res, 409, { error: { code: 'nameAlreadyExists' } });
        const folderId = nextId();
        items.set(folderId, { id: folderId, name: body.name, parentId: id, isFolder: true, data: Buffer.alloc(0), lastModifiedDateTime: '' });
        return json(res, 201, { id: folderId });
      }
      if (req.method === 'PATCH') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const item = items.get(id);
        if (!item) return json(res, 404, { error: { code: 'itemNotFound' } });
        items.set(id, {
          ...item,
          name: body.name ?? item.name,
          parentId: body.parentReference?.id ?? item.parentId,
          lastModifiedDateTime: body.fileSystemInfo?.lastModifiedDateTime ?? item.lastModifiedDateTime,
        });
        return json(res, 200, meta(items.get(id) as GraphItem));
      }
      if (req.method === 'DELETE') {
        items.delete(id);
        res.writeHead(204);
        return res.end();
      }
    }
    return json(res, 404, { error: { code: 'itemNotFound' } });
  });

  await new Promise<void>((resolve) => server.listen({ host: '127.0.0.1', port: 0 }, () => resolve()));
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  running.push(state);
  return state;
}

/** Sends graph.microsoft.com traffic to the stand-in, path and query intact. */
function routed(graph: FakeGraph): typeof globalThis.fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    return globalThis.fetch(`${graph.base}${url.pathname}${url.search}`, init);
  }) as typeof globalThis.fetch;
}

const destinationFor = (graph: FakeGraph) => createOneDriveDestination({ accessToken: async () => 'token', fetch: routed(graph), retryBaseMs: 1 });
const named = (graph: FakeGraph, name: string) => [...graph.items.values()].find((i) => i.name === name);

describe('OneDrive 宛先', () => {
  test('宛先はアプリ フォルダそのもの（余計な入れ物を作らない）', async () => {
    const graph = await startFakeGraph();
    await destinationFor(graph).put('a.jpg', tempFile('x'), 1000);
    expect(graph.calls).toContain('GET /v1.0/me/drive/special/approot');
    expect((named(graph, 'a.jpg') as GraphItem).parentId).toBe('approot');
    expect([...graph.items.values()].filter((i) => i.isFolder)).toHaveLength(1); // approot itself
  });

  test('小さいファイルは content で上げ、mtime を後追いで書き込む', async () => {
    const graph = await startFakeGraph();
    const mtime = Date.parse('2026-08-05T10:00:00.000Z');
    await destinationFor(graph).put('a.jpg', tempFile('hello'), mtime);
    const stored = named(graph, 'a.jpg') as GraphItem;
    expect(stored.data.toString('utf8')).toBe('hello');
    expect(Date.parse(stored.lastModifiedDateTime)).toBe(mtime);
    expect(graph.calls.some((c) => c.startsWith('POST') && c.includes('createUploadSession'))).toBe(false);
    expect((await destinationFor(graph).list()).get('a.jpg')).toEqual({ size: 5, mtimeMs: mtime });
  });

  test('10MiB を超えるファイルはアップロードセッションで、トークンを付けずに送る', async () => {
    const graph = await startFakeGraph();
    const size = SIMPLE_MAX + 1024 * 1024;
    const body = Buffer.alloc(size, 3);
    body.write('tail', size - 4);
    const mtime = Date.parse('2026-08-05T11:00:00.000Z');
    await destinationFor(graph).put('big.mp4', tempFile(body), mtime);
    expect(graph.sessionSawAuthorization).toBe(false);
    expect(graph.chunkSizes).toEqual([SIMPLE_MAX, 1024 * 1024]);
    const stored = named(graph, 'big.mp4') as GraphItem;
    expect(stored.data.length).toBe(size);
    expect(stored.data.subarray(size - 4).toString('utf8')).toBe('tail');
    // The session carried the timestamp up front, so no PATCH was needed.
    expect(Date.parse(stored.lastModifiedDateTime)).toBe(mtime);
  });

  test('ゴミ箱への移動は parentReference の PATCH で、バイト列は再送されない', async () => {
    const graph = await startFakeGraph();
    const dest = destinationFor(graph);
    await dest.put('a.jpg', tempFile('bytes'), 1000);
    const before = graph.transferred.get('a.jpg');
    await dest.move('a.jpg', '.trash/a.jpg');
    expect(graph.transferred.get('a.jpg')).toBe(before);
    const trash = named(graph, '.trash') as GraphItem;
    expect(trash.isFolder).toBe(true);
    expect((named(graph, 'a.jpg') as GraphItem).parentId).toBe(trash.id);
    expect([...(await destinationFor(graph).list()).keys()]).toEqual(['.trash/a.jpg']);
  });

  test('remove は標準の削除 API（OneDrive ではゴミ箱行き）を使う', async () => {
    const graph = await startFakeGraph();
    const dest = destinationFor(graph);
    await dest.put('a.jpg', tempFile('x'), 1000);
    await dest.remove('a.jpg');
    expect(graph.calls.some((c) => c.startsWith('DELETE /v1.0/me/drive/items/'))).toBe(true);
    expect(named(graph, 'a.jpg')).toBeUndefined();
  });

  test('身元ファイルは往復し、list には出ない', async () => {
    const graph = await startFakeGraph();
    const dest = destinationFor(graph);
    await dest.writeIdentity({ libraryId: 'lib-a', lastRunAt: null });
    await dest.put('a.jpg', tempFile('x'), 1000);
    const fresh = destinationFor(graph);
    expect(await fresh.readIdentity()).toEqual({ libraryId: 'lib-a', lastRunAt: null });
    expect([...(await fresh.list()).keys()]).toEqual(['a.jpg']);
    expect(named(graph, IDENTITY_FILE)).toBeTruthy();
  });

  test('1ページに収まらない宛先も全件読める（ページングで取りこぼさない）', async () => {
    const graph = await startFakeGraph();
    const dest = destinationFor(graph);
    for (const name of ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg']) await dest.put(name, tempFile(name), 1000);
    expect([...(await destinationFor(graph).list()).keys()].sort()).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg']);
  });
});
