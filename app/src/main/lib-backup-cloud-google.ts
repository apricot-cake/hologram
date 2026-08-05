'use strict';

// Google Drive as a backup destination (#909, parent #233).
//
// Only the provider-specific primitives are here; the path-to-id bridge, the
// index and every rule the engine depends on live in lib-backup-cloud.ts.
//
// Facts this file is built on, from the primary sources (2026-08-05):
//   developers.google.com/workspace/drive/api/guides/manage-uploads
//     — simple and multipart uploads are "limited to 5 MB or less"; resumable
//       is for larger files, its chunks must be "multiples of 256 KB … except
//       the final chunk", an unfinished chunk answers 308 and the session URI
//       comes back in the Location header.
//   developers.google.com/workspace/drive/api/guides/search-files
//     — files.list takes q / fields / pageToken; under drive.file the listing
//       is already restricted to files this app created, which is why one
//       unfiltered pass can build the whole picture.
//   developers.google.com/workspace/drive/api/guides/folder
//     — a folder is a file with mimeType application/vnd.google-apps.folder,
//       and a move is files.update with addParents + removeParents (the bytes
//       do not move, which is what #233 requires of a trash move).
//   developers.google.com/workspace/drive/api/reference/rest/v3/files
//     — modifiedTime is writable ("setting modifiedTime also updates
//       modifiedByMeTime"), and files.delete "permanently deletes a file …
//       without moving it to the trash".
//
// Two consequences worth stating out loud:
//   * Drive has no path lookup. Every operation here is by id, and the ids
//     come from the one listing the shared half walks.
//   * files.delete is permanent, while OneDrive's DELETE lands in a recycle
//     bin. #233 asked for "each service's standard delete API" rather than
//     per-service work to force one behaviour, so the two differ on purpose —
//     and Drive's behaviour is the one that does not silently park every
//     thinned database generation in the user's trash for a month.

import fs from 'node:fs';
import crypto from 'node:crypto';

import { BACKUP_SUBDIR } from './lib-backup-destination.ts';
import { createCloudDestination, createCloudHttp } from './lib-backup-cloud.ts';
import type { BackupDestination } from './lib-backup-destination.ts';
import type { CloudAuth, CloudNode, CloudOps, CloudSource } from './lib-backup-cloud.ts';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const BINARY_MIME = 'application/octet-stream';

/** Above this a single request is not allowed; below it one request is enough. */
const MULTIPART_MAX = 5 * 1024 * 1024;
/** 32 × 256 KB — inside Google's multiple-of-256KB rule with room to spare. */
const RESUMABLE_CHUNK = 8 * 1024 * 1024;
/** Drive's own maximum page size; fewer round trips for a large library. */
const PAGE_SIZE = 1000;

export const GOOGLE_DESTINATION_KIND = 'google-drive';

/** Escapes a value for a Drive query term (single-quoted strings, RFC-ish). */
function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

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

function createGoogleDriveOps(auth: CloudAuth): CloudOps {
  const request = createCloudHttp('Google Drive', auth);

  const json = async (res: Response): Promise<Record<string, unknown>> => (await res.json()) as Record<string, unknown>;

  async function listFiles(query: string): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    let pageToken = '';
    do {
      const url = new URL(`${API}/files`);
      url.searchParams.set('q', query);
      url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,modifiedTime)');
      url.searchParams.set('pageSize', String(PAGE_SIZE));
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const body = await json(await request({ url: url.toString() }));
      for (const file of (body.files as Array<Record<string, unknown>>) ?? []) out.push(file);
      pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : '';
    } while (pageToken);
    return out;
  }

  async function multipartUpload(target: { parentId: string; name: string; existingId: string | null }, source: CloudSource, mtimeMs: number | null): Promise<string> {
    // On an update the metadata carries the timestamp and nothing else: `name`
    // is unchanged and `parents` is not settable through the body (a move is
    // addParents/removeParents, which is `move` below).
    const metadata: Record<string, unknown> = target.existingId ? {} : { name: target.name, parents: [target.parentId] };
    if (typeof mtimeMs === 'number') metadata.modifiedTime = new Date(mtimeMs).toISOString();
    const boundary = `hologram-${crypto.randomBytes(16).toString('hex')}`;
    const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${BINARY_MIME}\r\n\r\n`, 'utf8');
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const data = source.kind === 'file' ? await fs.promises.readFile(source.path) : source.data;
    const res = await request({
      url: target.existingId ? `${UPLOAD}/files/${encodeURIComponent(target.existingId)}?uploadType=multipart&fields=id` : `${UPLOAD}/files?uploadType=multipart&fields=id`,
      method: target.existingId ? 'PATCH' : 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body: Buffer.concat([head, data, tail]),
    });
    return String((await json(res)).id ?? '');
  }

  async function resumableUpload(target: { parentId: string; name: string; existingId: string | null }, source: CloudSource, mtimeMs: number | null): Promise<string> {
    const metadata: Record<string, unknown> = target.existingId ? {} : { name: target.name, parents: [target.parentId] };
    if (typeof mtimeMs === 'number') metadata.modifiedTime = new Date(mtimeMs).toISOString();
    const total = source.kind === 'file' ? source.size : source.data.length;
    const start = await request({
      url: target.existingId ? `${UPLOAD}/files/${encodeURIComponent(target.existingId)}?uploadType=resumable&fields=id` : `${UPLOAD}/files?uploadType=resumable&fields=id`,
      method: target.existingId ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': BINARY_MIME, 'x-upload-content-length': String(total) },
      body: Buffer.from(JSON.stringify(metadata), 'utf8'),
    });
    await start.text();
    const session = start.headers.get('location');
    if (!session) throw new Error('Google Drive did not open an upload session');

    let offset = 0;
    for (;;) {
      const length = Math.min(RESUMABLE_CHUNK, total - offset);
      const chunk = source.kind === 'file' ? await readSlice(source.path, offset, length) : source.data.subarray(offset, offset + length);
      const res = await request({
        url: session,
        method: 'PUT',
        // A zero-byte file still has to be committed, and `bytes */0` is the
        // shape Drive accepts for it.
        headers: { 'content-range': total === 0 ? 'bytes */0' : `bytes ${offset}-${offset + chunk.length - 1}/${total}` },
        body: chunk,
        accept: [308],
      });
      if (res.status === 308) {
        // The Range header names what the server actually holds, which is not
        // always what we just sent — resume from there rather than from our
        // own count.
        const range = res.headers.get('range');
        await res.text();
        const end = range ? Number(range.slice(range.lastIndexOf('-') + 1)) : Number.NaN;
        offset = Number.isFinite(end) ? end + 1 : offset + chunk.length;
        continue;
      }
      return String((await json(res)).id ?? '');
    }
  }

  return {
    kind: GOOGLE_DESTINATION_KIND,
    location: `Google Drive / ${BACKUP_SUBDIR}`,
    async ensureRoot() {
      // The same folder name the local adapter uses, in My Drive's root. NOT
      // the hidden appDataFolder space: a backup the user cannot see or copy
      // out by hand is not a backup they can restore from without this app.
      const found = await listFiles(`mimeType = ${quote(FOLDER_MIME)} and name = ${quote(BACKUP_SUBDIR)} and ${quote('root')} in parents and trashed = false`);
      if (found.length) {
        // Two folders of the same name are legal in Drive. Pick deterministically
        // so two machines backing up the same library agree on which one.
        return String(found.map((f) => String(f.id)).sort()[0]);
      }
      const res = await request({
        url: `${API}/files?fields=id`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: BACKUP_SUBDIR, mimeType: FOLDER_MIME, parents: ['root'] }),
      });
      return String((await json(res)).id ?? '');
    },
    async children(folderId) {
      return listFiles(`${quote(folderId)} in parents and trashed = false`).then((files) =>
        files.map<CloudNode>((f) => ({
          id: String(f.id),
          name: String(f.name ?? ''),
          isFolder: f.mimeType === FOLDER_MIME,
          size: Number(f.size) || 0,
          mtimeMs: toEpochMs(f.modifiedTime),
        })),
      );
    },
    async createFolder(parentId, name) {
      const res = await request({
        url: `${API}/files?fields=id`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
      });
      return String((await json(res)).id ?? '');
    },
    async upload(target, source, mtimeMs) {
      const size = source.kind === 'file' ? source.size : source.data.length;
      return size > MULTIPART_MAX ? resumableUpload(target, source, mtimeMs) : multipartUpload(target, source, mtimeMs);
    },
    async download(id) {
      const res = await request({ url: `${API}/files/${encodeURIComponent(id)}?alt=media` });
      return Buffer.from(await res.arrayBuffer());
    },
    async move(id, from, to) {
      const url = new URL(`${API}/files/${encodeURIComponent(id)}`);
      url.searchParams.set('addParents', to.parentId);
      url.searchParams.set('removeParents', from.parentId);
      url.searchParams.set('fields', 'id');
      const res = await request({ url: url.toString(), method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: to.name }) });
      await res.text();
    },
    async remove(id) {
      const res = await request({ url: `${API}/files/${encodeURIComponent(id)}`, method: 'DELETE' });
      await res.text();
    },
  };
}

function createGoogleDriveDestination(auth: CloudAuth): BackupDestination {
  return createCloudDestination(createGoogleDriveOps(auth));
}

export { MULTIPART_MAX, RESUMABLE_CHUNK, createGoogleDriveDestination, createGoogleDriveOps };
