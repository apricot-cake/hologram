'use strict';

// バックアップ先としての Google Drive（#909、親は #233）。
//
// ここにあるのは提供元固有の原始的な操作だけ。パスから id への橋渡し、索引、エンジンが頼る規則は
// すべて lib-backup-cloud.ts にある。
//
// このファイルが拠って立つ事実。一次情報から（2026-08-05）:
//   developers.google.com/workspace/drive/api/guides/manage-uploads
//     ＝ simple と multipart のアップロードは "limited to 5 MB or less"。それより大きな
//       ファイルは resumable で、そのチャンクは "multiples of 256 KB … except the final chunk"
//       でなければならない。終わっていないチャンクには 308 が返り、セッションの URI は
//       Location ヘッダで返る。
//   developers.google.com/workspace/drive/api/guides/search-files
//     ＝ files.list は q / fields / pageToken を取る。drive.file の下では、一覧が既にこの
//       アプリが作ったファイルへ限定されている。だから絞り込み無しの1回の走査で全体像を
//       組み立てられる。
//   developers.google.com/workspace/drive/api/guides/folder
//     ＝ フォルダとは mimeType が application/vnd.google-apps.folder のファイルであり、移動は
//       addParents と removeParents を付けた files.update（バイトは動かない。それが #233 が
//       ゴミ箱への移動に求めていること）。
//   developers.google.com/workspace/drive/api/reference/rest/v3/files
//     ＝ modifiedTime は書き込める（"setting modifiedTime also updates modifiedByMeTime"）し、
//       files.delete は "permanently deletes a file … without moving it to the trash"。
//
// はっきり言っておく価値のある帰結が2つ:
//   * Drive にパスでの照会は無い。ここの操作はすべて id で行い、その id は共有の半分が歩く
//     あの1回の一覧から来る。
//   * files.delete は完全な削除だが、OneDrive の DELETE はごみ箱に着地する。#233 は挙動を
//     1つに揃えるためのサービスごとの作業ではなく「各サービスの標準の削除 API」を求めたので、
//     この2つは意図して違う＝そして、間引いたデータベースの世代を利用者のゴミ箱へ1か月黙って
//     置きっぱなしにしない方が、Drive の挙動。

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

/** これを超えると1回のリクエストでは許されない。下回れば1回で足りる。 */
const MULTIPART_MAX = 5 * 1024 * 1024;
/** 32 × 256 KB＝Google の 256KB の倍数という規則に、余裕を持って収まる。 */
const RESUMABLE_CHUNK = 8 * 1024 * 1024;
/** Drive 自身の最大のページの大きさ。大きなライブラリでの往復が減る。 */
const PAGE_SIZE = 1000;

export const GOOGLE_DESTINATION_KIND = 'google-drive';

/** Drive のクエリの項へ入れる値をエスケープする（単引用符の文字列。RFC 風）。 */
function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function toEpochMs(value: unknown): number {
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) ? at : 0;
}

/** ファイル全体をメモリに抱えずに、その一切れを読む。 */
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
    // 更新のときメタデータが載せるのは時刻だけ。`name` は変わらないし、`parents` は本体からは
    // 設定できない（移動は addParents / removeParents で、それが下の `move`）。
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
        // ゼロバイトのファイルも確定させる必要があり、それに対して Drive が受け付ける形が
        // `bytes */0`。
        headers: { 'content-range': total === 0 ? 'bytes */0' : `bytes ${offset}-${offset + chunk.length - 1}/${total}` },
        body: chunk,
        accept: [308],
      });
      if (res.status === 308) {
        // Range ヘッダが名指しするのはサーバーが実際に持っているもので、それは今こちらが送った
        // ものと一致するとは限らない＝自前の数え上げではなく、そこから再開する。
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
      // ローカルのアダプタが使うのと同じフォルダ名を、マイドライブのルートに置く。隠しの
      // appDataFolder の領域ではない。利用者が見ることも手で取り出すこともできないバックアップ
      // は、このアプリ無しでは復元できないバックアップだから。
      const found = await listFiles(`mimeType = ${quote(FOLDER_MIME)} and name = ${quote(BACKUP_SUBDIR)} and ${quote('root')} in parents and trashed = false`);
      if (found.length) {
        // Drive では同名のフォルダが2つあってよい。同じライブラリをバックアップする2台の
        // マシンがどちらを指すかで一致するよう、決定的に選ぶ。
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
