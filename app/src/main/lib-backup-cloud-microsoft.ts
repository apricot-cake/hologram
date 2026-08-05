'use strict';

// OneDrive as a backup destination (#909, parent #233).
//
// Only the provider-specific primitives are here; the path-to-id bridge, the
// index and every rule the engine depends on live in lib-backup-cloud.ts.
//
// Facts this file is built on, from the primary sources (2026-08-05):
//   learn.microsoft.com/onedrive/developer/rest-api/concepts/special-folders-appfolder
//     — the app folder is created "when your app makes the first call to the
//       folder using the special folder namespace", and GET /drive/special/
//       approot is listed as one of those calls. So there is nothing to create
//       by hand: asking for the root is what brings it into being.
//   learn.microsoft.com/graph/api/driveitem-put-content
//     — the single-request upload "only supports files up to 250 MB".
//   learn.microsoft.com/graph/api/driveitem-createuploadsession
//     — "Use resumable file transfers for files larger than 10 MiB", each byte
//       range "MUST be a multiple of 320 KiB", an accepted range answers 202
//       with nextExpectedRanges, and the PUTs must NOT carry the Authorization
//       header ("it might result in an HTTP 401").
//   learn.microsoft.com/graph/api/driveitem-move
//     — a move is PATCH with parentReference; the bytes stay where they are.
//   learn.microsoft.com/graph/permissions-reference
//     — Files.ReadWrite.AppFolder is delegated-only and needs no admin consent.
//
// #233's design says 4 MB is where the split upload starts. That number is not
// what either provider documents today (Google splits at 5 MB, Graph supports
// 250 MB in one request and advises a session past 10 MiB), so the thresholds
// here follow the sources and the deviation is recorded on #909.

import fs from 'node:fs';

import { createCloudDestination, createCloudHttp } from './lib-backup-cloud.ts';
import type { BackupDestination } from './lib-backup-destination.ts';
import type { CloudAuth, CloudNode, CloudOps, CloudSource } from './lib-backup-cloud.ts';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const DRIVE = `${GRAPH}/me/drive`;
const BINARY_MIME = 'application/octet-stream';

/** Past this Microsoft advises an upload session, well under the 250 MB cap. */
const SIMPLE_MAX = 10 * 1024 * 1024;
/** Exactly 32 × 320 KiB — the multiple Graph requires, at its recommended size. */
const SESSION_CHUNK = 10 * 1024 * 1024;
const PAGE_SIZE = 200;
const CHILD_FIELDS = 'id,name,size,folder,file,lastModifiedDateTime,fileSystemInfo';

export const MICROSOFT_DESTINATION_KIND = 'onedrive';

function toEpochMs(value: unknown): number {
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) ? at : 0;
}

/** Reads one slice of a file without holding the whole thing in memory. */
async function readSlice(path: string, offset: number, length: number): Promise<Buffer> {
  const handle = await fs.promises.open(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function createOneDriveOps(auth: CloudAuth): CloudOps {
  const request = createCloudHttp('OneDrive', auth);
  const json = async (res: Response): Promise<Record<string, unknown>> => (await res.json()) as Record<string, unknown>;
  const item = (id: string) => `${DRIVE}/items/${encodeURIComponent(id)}`;
  /** The `{parent-id}:/{name}:` form, which addresses a child that may not exist yet. */
  const childPath = (parentId: string, name: string) => `${item(parentId)}:/${encodeURIComponent(name)}:`;

  /** PATCHes the client-side timestamp a restore is supposed to bring back. */
  async function stampMtime(id: string, mtimeMs: number | null): Promise<void> {
    if (typeof mtimeMs !== 'number') return;
    const res = await request({
      url: item(id),
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileSystemInfo: { lastModifiedDateTime: new Date(mtimeMs).toISOString() } }),
    });
    await res.text();
  }

  async function simpleUpload(target: { parentId: string; name: string; existingId: string | null }, source: CloudSource, mtimeMs: number | null): Promise<string> {
    const data = source.kind === 'file' ? await fs.promises.readFile(source.path) : source.data;
    const url = target.existingId ? `${item(target.existingId)}/content` : `${childPath(target.parentId, target.name)}/content?%40microsoft.graph.conflictBehavior=replace`;
    const res = await request({ url, method: 'PUT', headers: { 'content-type': BINARY_MIME }, body: data });
    const id = String((await json(res)).id ?? '');
    // Two requests rather than one: PUT /content carries bytes only, so the
    // timestamp has to follow. Only the trash sidecars are ever compared by
    // mtime (everything else the library holds is write-once), and a run that
    // dies between the two just re-copies that one file next time.
    await stampMtime(id, mtimeMs);
    return id;
  }

  async function sessionUpload(target: { parentId: string; name: string; existingId: string | null }, source: CloudSource, mtimeMs: number | null): Promise<string> {
    const properties: Record<string, unknown> = { '@microsoft.graph.conflictBehavior': 'replace', name: target.name };
    // Unlike the simple path, a session takes the timestamp up front — the
    // item is created from these properties when the last range lands.
    if (typeof mtimeMs === 'number') properties.fileSystemInfo = { lastModifiedDateTime: new Date(mtimeMs).toISOString() };
    const opened = await request({
      url: target.existingId ? `${item(target.existingId)}/createUploadSession` : `${childPath(target.parentId, target.name)}/createUploadSession`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item: properties }),
    });
    const uploadUrl = String((await json(opened)).uploadUrl ?? '');
    if (!uploadUrl) throw new Error('OneDrive did not open an upload session');

    // Only reached above SIMPLE_MAX, so there is always at least one range.
    const total = source.kind === 'file' ? source.size : source.data.length;
    let offset = 0;
    for (;;) {
      const length = Math.min(SESSION_CHUNK, total - offset);
      const chunk = source.kind === 'file' ? await readSlice(source.path, offset, length) : source.data.subarray(offset, offset + length);
      const res = await request({
        url: uploadUrl,
        method: 'PUT',
        headers: { 'content-range': `bytes ${offset}-${offset + chunk.length - 1}/${total}` },
        body: chunk,
        // The session URL is pre-authorized; sending our bearer token to it is
        // documented to fail with 401.
        anonymous: true,
        accept: [202],
      });
      if (res.status === 202) {
        // nextExpectedRanges is where the service actually wants the next byte,
        // which after a retried range is not always where we think we are.
        const body = await json(res);
        const next = (body.nextExpectedRanges as string[] | undefined)?.[0];
        const from = next ? Number(next.split('-')[0]) : Number.NaN;
        offset = Number.isFinite(from) ? from : offset + chunk.length;
        continue;
      }
      return String((await json(res)).id ?? '');
    }
  }

  async function listChildren(folderId: string): Promise<CloudNode[]> {
    const out: CloudNode[] = [];
    let url = `${item(folderId)}/children?%24top=${PAGE_SIZE}&%24select=${encodeURIComponent(CHILD_FIELDS)}`;
    while (url) {
      const body = await json(await request({ url }));
      for (const node of (body.value as Array<Record<string, unknown>>) ?? []) {
        const fileSystemInfo = node.fileSystemInfo as { lastModifiedDateTime?: unknown } | undefined;
        out.push({
          id: String(node.id),
          name: String(node.name ?? ''),
          isFolder: Boolean(node.folder),
          size: Number(node.size) || 0,
          // The client-side stamp first: it is the library's own timestamp,
          // where lastModifiedDateTime is merely when we uploaded.
          mtimeMs: toEpochMs(fileSystemInfo?.lastModifiedDateTime) || toEpochMs(node.lastModifiedDateTime),
        });
      }
      url = typeof body['@odata.nextLink'] === 'string' ? (body['@odata.nextLink'] as string) : '';
    }
    return out;
  }

  return {
    kind: MICROSOFT_DESTINATION_KIND,
    location: 'OneDrive / app folder',
    async ensureRoot() {
      // This request is also what creates the app folder on a first connection.
      const res = await request({ url: `${DRIVE}/special/approot?%24select=id` });
      return String((await json(res)).id ?? '');
    },
    children: listChildren,
    async createFolder(parentId, name) {
      const res = await request({
        url: `${item(parentId)}/children`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 'fail' rather than 'replace': replacing a folder would take its
        // contents with it, and a name collision here means another run got
        // there first, which is not a reason to delete anything.
        body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
        accept: [409],
      });
      if (res.status !== 409) return String((await json(res)).id ?? '');
      await res.text();
      const found = (await listChildren(parentId)).find((node) => node.isFolder && node.name === name);
      if (!found) throw new Error(`OneDrive refused to create ${name} and does not report it`);
      return found.id;
    },
    async upload(target, source, mtimeMs) {
      const size = source.kind === 'file' ? source.size : source.data.length;
      return size > SIMPLE_MAX ? sessionUpload(target, source, mtimeMs) : simpleUpload(target, source, mtimeMs);
    },
    async download(id) {
      const res = await request({ url: `${item(id)}/content` });
      return Buffer.from(await res.arrayBuffer());
    },
    async move(id, _from, to) {
      const res = await request({
        url: item(id),
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentReference: { id: to.parentId }, name: to.name }),
      });
      await res.text();
    },
    async remove(id) {
      const res = await request({ url: item(id), method: 'DELETE' });
      await res.text();
    },
  };
}

function createOneDriveDestination(auth: CloudAuth): BackupDestination {
  return createCloudDestination(createOneDriveOps(auth));
}

export { SESSION_CHUNK, SIMPLE_MAX, createOneDriveDestination, createOneDriveOps };
