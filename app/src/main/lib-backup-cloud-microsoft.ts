'use strict';

// バックアップ先としての OneDrive（#909、親は #233）。
//
// ここにあるのは提供元固有の原始的な操作だけ。パスから id への橋渡し、索引、エンジンが頼る規則は
// すべて lib-backup-cloud.ts にある。
//
// このファイルが拠って立つ事実。一次情報から（2026-08-05）:
//   learn.microsoft.com/onedrive/developer/rest-api/concepts/special-folders-appfolder
//     ＝ アプリのフォルダは "when your app makes the first call to the folder using the
//       special folder namespace" に作られ、GET /drive/special/approot はその呼び出しの1つと
//       して挙がっている。だから手で作るものは何も無い。ルートを尋ねること自体がそれを
//       生じさせる。
//   learn.microsoft.com/graph/api/driveitem-put-content
//     ＝ 1リクエストのアップロードは "only supports files up to 250 MB"。
//   learn.microsoft.com/graph/api/driveitem-createuploadsession
//     ＝ "Use resumable file transfers for files larger than 10 MiB"。各バイト範囲は
//       "MUST be a multiple of 320 KiB"。受け付けられた範囲には nextExpectedRanges 付きの 202 が
//       返り、PUT は Authorization ヘッダを載せてはいけない（"it might result in an HTTP 401"）。
//   learn.microsoft.com/graph/api/driveitem-move
//     ＝ 移動は parentReference を付けた PATCH。バイトはその場に留まる。
//   learn.microsoft.com/graph/permissions-reference
//     ＝ Files.ReadWrite.AppFolder は委任のみで、管理者の同意は要らない。
//
// #233 の設計は、分割アップロードの開始点を 4 MB としている。その数値は今日どちらの提供元が記して
// いるものとも違う（Google は 5 MB で分けるし、Graph は1リクエストで 250 MB まで対応し、10 MiB を
// 超えたらセッションを勧める）ので、ここのしきい値は一次情報に従い、その逸脱は #909 に記録して
// ある。

import fs from 'node:fs';

import { createCloudDestination, createCloudHttp } from './lib-backup-cloud.ts';
import type { BackupDestination } from './lib-backup-destination.ts';
import type { CloudAuth, CloudNode, CloudOps, CloudSource } from './lib-backup-cloud.ts';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const DRIVE = `${GRAPH}/me/drive`;
const BINARY_MIME = 'application/octet-stream';

/** これを超えると Microsoft はアップロードセッションを勧める。250 MB の上限には十分届かない。 */
const SIMPLE_MAX = 10 * 1024 * 1024;
/** ちょうど 32 × 320 KiB＝Graph が要求する倍数を、その推奨の大きさで満たす。 */
const SESSION_CHUNK = 10 * 1024 * 1024;
const PAGE_SIZE = 200;
const CHILD_FIELDS = 'id,name,size,folder,file,lastModifiedDateTime,fileSystemInfo';

export const MICROSOFT_DESTINATION_KIND = 'onedrive';

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

function createOneDriveOps(auth: CloudAuth): CloudOps {
  const request = createCloudHttp('OneDrive', auth);
  const json = async (res: Response): Promise<Record<string, unknown>> => (await res.json()) as Record<string, unknown>;
  const item = (id: string) => `${DRIVE}/items/${encodeURIComponent(id)}`;
  /** `{parent-id}:/{name}:` の形。まだ存在しないかもしれない子を指せる。 */
  const childPath = (parentId: string, name: string) => `${item(parentId)}:/${encodeURIComponent(name)}:`;

  /** 復元が取り戻すべきクライアント側の時刻を PATCH する。 */
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
    // 1回ではなく2回のリクエストになる。PUT /content はバイトしか運ばないので、時刻は後から
    // 付ける。mtime で突き合わせられるのはゴミ箱のサイドカーだけ（ライブラリが持つそれ以外は
    // 一度書いたら終わり）だし、2回の間で死んだ実行は、次回そのファイル1つを写し直すだけ。
    await stampMtime(id, mtimeMs);
    return id;
  }

  async function sessionUpload(target: { parentId: string; name: string; existingId: string | null }, source: CloudSource, mtimeMs: number | null): Promise<string> {
    const properties: Record<string, unknown> = { '@microsoft.graph.conflictBehavior': 'replace', name: target.name };
    // 単純な経路と違い、セッションは時刻を先に受け取る＝最後の範囲が着地したとき、これらの
    // プロパティから項目が作られる。
    if (typeof mtimeMs === 'number') properties.fileSystemInfo = { lastModifiedDateTime: new Date(mtimeMs).toISOString() };
    const opened = await request({
      url: target.existingId ? `${item(target.existingId)}/createUploadSession` : `${childPath(target.parentId, target.name)}/createUploadSession`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item: properties }),
    });
    const uploadUrl = String((await json(opened)).uploadUrl ?? '');
    if (!uploadUrl) throw new Error('OneDrive did not open an upload session');

    // ここへ来るのは SIMPLE_MAX を超えたときだけなので、範囲は必ず1つ以上ある。
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
        // セッションの URL は事前に認可されている。そこへこちらの bearer トークンを送ると
        // 401 で失敗する、とドキュメントに書かれている。
        anonymous: true,
        accept: [202],
      });
      if (res.status === 202) {
        // nextExpectedRanges は、サービスが実際に次のバイトを求めている位置であり、再試行した
        // 範囲の後では、こちらが思っている位置と一致するとは限らない。
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
          // クライアント側の刻印を先に見る。あれがライブラリ自身の時刻で、
          // lastModifiedDateTime はこちらがアップロードした時刻でしかない。
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
      // 初回の接続でアプリのフォルダを作るのも、このリクエスト。
      const res = await request({ url: `${DRIVE}/special/approot?%24select=id` });
      return String((await json(res)).id ?? '');
    },
    children: listChildren,
    async createFolder(parentId, name) {
      const res = await request({
        url: `${item(parentId)}/children`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 'replace' ではなく 'fail'。フォルダを置き換えると中身も一緒に持って行かれるし、
        // ここでの名前の衝突は別の実行が先に着いたという意味であって、何かを消す理由ではない。
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
