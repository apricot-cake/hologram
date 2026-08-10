'use strict';

// クラウドのバックアップ先のうち、どの提供元でも同じになる半分（#909、親は #233）。
//
// BackupDestination は相対パスで話す（'avatars/x.jpg'、'.trash/y.json'）。個人向けドライブの
// API は項目の id で、しかも一度に1フォルダずつ話す。このファイルの中身は全部、その2つを1回だけ
// 橋渡しするために在る。Google Drive と OneDrive の違いが、引き渡す原始的な操作（CloudOps）だけ
// になるように＝そしてエンジンが、自分の中に提供元ごとの分岐を持たないという約束を守れるように
// （#909:「実装するのは既存インターフェースの5対だけ」）。
//
// 橋渡しの実体は、実行ごとに1回、宛先の木を歩いて作る索引。相対パス → 項目の id と、途中の
// フォルダの id。最初に使うときに遅延して作り、以後は使い回す。そうしないと、エンジン自身の手順
// （readIdentity → list → put/move/remove → writeIdentity）が木を丸ごと2回歩くことになるし、
// 宛先のオブジェクトはちょうど1回の実行しか生きないため。宛先へ書くものはほかに無いので、共有の
// キャッシュのように足元で古くなることはあり得ない。
//
// ここに意図して置いていないもの:
//   * 転送層が自前で持つ以上の再試行（#233: メディアのレーンは、失敗したファイルを次のパスが
//     拾うように作ってある＝「ここで凝らない」）。
//   * トークン、それを載せた URL、応答の本体をログへ出すもの。エラーの文言が載せるのは提供元の
//     ステータスとエラーのコードだけ（#237 がそれを監査する）。

import fs from 'node:fs';

import { IDENTITY_FILE, TMP_RE } from './lib-backup-destination.ts';
import type { BackupDestination, DestinationEntry, DestinationIdentity } from './lib-backup-destination.ts';

/** 提供元が報告するとおりの1エントリ。 */
export interface CloudNode {
  readonly id: string;
  readonly name: string;
  readonly isFolder: boolean;
  /** フォルダでは 0。 */
  readonly size: number;
  /** こちらが書いたクライアント側の更新時刻。エポックからのミリ秒。 */
  readonly mtimeMs: number;
}

/** アップロードが運ぶもの。ライブラリのファイルか、手元に持っている数バイト。 */
export type CloudSource = { readonly kind: 'file'; readonly path: string; readonly size: number } | { readonly kind: 'bytes'; readonly data: Buffer };

/**
 * 提供元ごとの原始的な操作。意図して小さくしてある。2通りに間違え得る規則（どのエントリを
 * list() から隠すか、相対パスがどうフォルダの連なりになるか、move が索引に何をするか）は全部、
 * この線より下ではなく上にある。
 */
export interface CloudOps {
  readonly kind: string;
  readonly location: string;
  /** 宛先のルートの id。初回の実行ならフォルダを作る。 */
  ensureRoot(): Promise<string>;
  children(folderId: string): Promise<CloudNode[]>;
  createFolder(parentId: string, name: string): Promise<string>;
  /** アップロードした項目の id を返す（新規でも置き換えでも）。 */
  upload(target: { parentId: string; name: string; existingId: string | null }, source: CloudSource, mtimeMs: number | null): Promise<string>;
  download(id: string): Promise<Buffer>;
  move(id: string, from: { parentId: string }, to: { parentId: string; name: string }): Promise<void>;
  remove(id: string): Promise<void>;
}

interface CloudIndex {
  rootId: string;
  /** 相対パス → そのファイルの id と、提供元がそれについて報告する内容。 */
  files: Map<string, { id: string; size: number; mtimeMs: number }>;
  /** 相対パス → フォルダの id。'' は宛先のルート。 */
  folders: Map<string, string>;
  /** 同一性のファイルの id。list() へ届かないよう分けて持つ。 */
  identityId: string | null;
}

function splitRel(rel: string): { parentRel: string; name: string } {
  const cut = rel.lastIndexOf('/');
  return cut === -1 ? { parentRel: '', name: rel } : { parentRel: rel.slice(0, cut), name: rel.slice(cut + 1) };
}

/**
 * 提供元の原始的な操作を、エンジンが動かす宛先として包む。
 *
 * インスタンス1つが実行1回。キャッシュした索引が有効なのは、このオブジェクトが唯一の書き手で
 * ある間だけで、それはちょうど1回の実行の寿命に等しい。
 */
function createCloudDestination(ops: CloudOps): BackupDestination {
  let building: Promise<CloudIndex> | null = null;

  async function walk(): Promise<CloudIndex> {
    const rootId = await ops.ensureRoot();
    const index: CloudIndex = { rootId, files: new Map(), folders: new Map([['', rootId]]), identityId: null };
    const queue: Array<{ rel: string; id: string }> = [{ rel: '', id: rootId }];
    while (queue.length) {
      const dir = queue.shift() as { rel: string; id: string };
      for (const node of await ops.children(dir.id)) {
        // 中断された実行が残した書きかけのアップロード。ローカルのアダプタが自分の .tmp の
        // 残り物を飛ばすのと同じ。
        if (TMP_RE.test(node.name)) continue;
        const rel = dir.rel ? `${dir.rel}/${node.name}` : node.name;
        if (node.isFolder) {
          index.folders.set(rel, node.id);
          queue.push({ rel, id: node.id });
          continue;
        }
        // 宛先自身の帳簿。readIdentity() 越しには届き、list() 越しには決して届かない。エンジン
        // は、ライブラリ側に対応するものが無い宛先のエントリを消すし、これにはそもそも対応する
        // ものが無いはずだから（#176）。
        if (!dir.rel && node.name === IDENTITY_FILE) {
          index.identityId = node.id;
          continue;
        }
        index.files.set(rel, { id: node.id, size: node.size, mtimeMs: node.mtimeMs });
      }
    }
    return index;
  }

  function ensureIndex(): Promise<CloudIndex> {
    if (!building) building = walk();
    return building;
  }

  /** 相対パスに対するフォルダの id。新しければ連なりごと作る。 */
  async function ensureFolder(index: CloudIndex, rel: string): Promise<string> {
    const known = index.folders.get(rel);
    if (known) return known;
    const { parentRel, name } = splitRel(rel);
    const parentId = await ensureFolder(index, parentRel);
    const id = await ops.createFolder(parentId, name);
    index.folders.set(rel, id);
    return id;
  }

  return {
    kind: ops.kind,
    location: ops.location,
    async list() {
      const index = await ensureIndex();
      const out = new Map<string, DestinationEntry>();
      for (const [rel, f] of index.files) out.set(rel, { size: f.size, mtimeMs: f.mtimeMs });
      return out;
    },
    async put(rel, srcFile, mtimeMs) {
      const index = await ensureIndex();
      const { parentRel, name } = splitRel(rel);
      const parentId = await ensureFolder(index, parentRel);
      const stat = await fs.promises.stat(srcFile);
      const stamp = Math.floor(typeof mtimeMs === 'number' ? mtimeMs : stat.mtimeMs);
      const existingId = index.files.get(rel)?.id ?? null;
      const id = await ops.upload({ parentId, name, existingId }, { kind: 'file', path: srcFile, size: stat.size }, stamp);
      index.files.set(rel, { id, size: stat.size, mtimeMs: stamp });
    },
    async move(fromRel, toRel) {
      const index = await ensureIndex();
      const entry = index.files.get(fromRel);
      // これは「もう済んでいる」ではない。エンジンが move を計画するのは、list() で今しがた
      // 見たエントリに対してだけなので、見つからないのはこちらの見立てと宛先が食い違ったと
      // いうこと。間違った項目を動かすのは、失敗するより悪い（次のパスがファイルをコピーし、
      // 古くなった名前を刈る）。
      if (!entry) throw new Error(`nothing at ${fromRel} to move`);
      const fromParentId = await ensureFolder(index, splitRel(fromRel).parentRel);
      const { parentRel, name } = splitRel(toRel);
      const toParentId = await ensureFolder(index, parentRel);
      await ops.move(entry.id, { parentId: fromParentId }, { parentId: toParentId, name });
      index.files.delete(fromRel);
      index.files.set(toRel, entry);
    },
    async remove(rel) {
      const index = await ensureIndex();
      const entry = index.files.get(rel);
      if (!entry) return; // もう無い＝エンジンはこれを済みとして扱う
      await ops.remove(entry.id);
      index.files.delete(rel);
    },
    async readIdentity() {
      const index = await ensureIndex();
      if (!index.identityId) return null;
      try {
        const parsed = JSON.parse((await ops.download(index.identityId)).toString('utf8'));
        const libraryId = parsed?.libraryId;
        // ローカルのアダプタと同じ読み方。意味の取れない同一性は「誰のものでもない」であって、
        //「誰か別のもの」ではない。1バイトの破損を理由に以後のすべての実行を断る方が、大きな
        // 失敗になる。
        if (typeof libraryId !== 'string' || !libraryId) return null;
        return { libraryId, lastRunAt: typeof parsed.lastRunAt === 'string' ? parsed.lastRunAt : null };
      } catch {
        return null;
      }
    },
    async writeIdentity(identity: DestinationIdentity) {
      const index = await ensureIndex();
      const data = Buffer.from(`${JSON.stringify(identity, null, 2)}\n`, 'utf8');
      index.identityId = await ops.upload({ parentId: index.rootId, name: IDENTITY_FILE, existingId: index.identityId }, { kind: 'bytes', data }, null);
    },
  };
}

// --- どちらの提供元も共有する転送層 ---------------------------------------
//
// トークンはこのファイルまで来て、ここで止まる。金庫が accessToken() を渡すだけで、それを外へ
// 返すものは何も無い（#233 の 2/7 の項目2＝トークンはメインプロセスから出ないし、以下のどこにも
// それをメッセージやログへ書くものは無い）。

export interface CloudAuth {
  /**
   * 今この瞬間に有効なトークン。`force` は 401 への答え＝手元のトークンが弾かれたので、期限切れ
   * に見えなくても取り直す。
   */
  accessToken(force?: boolean): Promise<string>;
  /** テストのスイートが偽の API を立てられるよう注入する。既定はグローバルの fetch。 */
  fetch?: typeof globalThis.fetch;
  /** 再試行の間の基準の待ち時間（スイートはこれを縮める）。 */
  retryBaseMs?: number;
}

export interface CloudRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string | Buffer | null;
  /** 失敗ではなく答えとして扱うステータス（308、202、404…）。 */
  readonly accept?: readonly number[];
  /**
   * Authorization ヘッダを送らない。OneDrive のアップロードセッションの URL に必要で、あれは
   * ヘッダを載せたリクエストに 401 を返す。
   */
  readonly anonymous?: boolean;
}

const MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_BASE_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 提供元が Retry-After（秒数か HTTP-date）を送ってきたら、それに従う。 */
function retryDelayMs(res: Response | null, attempt: number, base: number): number {
  const header = res?.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 0), 60_000);
  }
  return base * 2 ** attempt;
}

/**
 * 提供元自身のエラーコードだけを取り出す。ほかは取らない。どちらの提供元も
 * `{ error: { code, message } }` で答える（Google は数値のコードと `status` を足す）。message は
 * リクエストの中身を引用し得るので、ログや設定ファイルへ行き着く Error には載せない。
 */
function errorCode(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: unknown; error_description?: unknown };
    const err = body.error;
    if (typeof err === 'string') return err;
    const detail = (err ?? {}) as { code?: unknown; status?: unknown; errors?: Array<{ reason?: unknown }> };
    if (typeof detail.status === 'string') return detail.status;
    if (typeof detail.code === 'string') return detail.code;
    const reason = detail.errors?.[0]?.reason;
    if (typeof reason === 'string') return reason;
  } catch {
    /* JSON ではない＝ステータスだけで済ませるしかない */
  }
  return '';
}

export class CloudApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(kind: string, status: number, code: string) {
    super(`${kind} API ${status}${code ? ` (${code})` : ''}`);
    this.name = 'CloudApiError';
    this.status = status;
    this.code = code;
  }
}

/** ステータスの段で再試行できるもの。流量制限と、提供元の調子が悪いとき。 */
const isTransient = (status: number) => status === 429 || (status >= 500 && status < 600);

/**
 * 認可付きのリクエスト1回。バックアップの実行にとって割に合う程度の、わずかな再試行を伴う。
 * それを超えるものは、意図して次の実行の仕事にしてある（#233）。
 */
function createCloudHttp(kind: string, auth: CloudAuth) {
  const doFetch = auth.fetch ?? globalThis.fetch;
  const base = auth.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;

  return async function request(req: CloudRequest): Promise<Response> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        const headers: Record<string, string> = { ...(req.headers ?? {}) };
        if (!req.anonymous) headers.authorization = `Bearer ${await auth.accessToken(refreshed)}`;
        // コピーではなくキャストする。メインプロセスのプロジェクトは fetch の型を undici から
        // 取り（そこでは Buffer が正当な body）、テストのプロジェクトはレンダラーの DOM の型を
        // 写している（そこでは正当ではない）。厳しい方に合わせて全チャンクを新しいビューへ
        // コピーすると、アップロードが触れるメモリが倍になる。
        const init = { method: req.method ?? 'GET', headers, body: req.body ?? null } as unknown as Parameters<typeof globalThis.fetch>[1];
        res = await doFetch(req.url, init);
      } catch (err) {
        // ネットワークが無い、DNS、アップロード途中で切れたソケット。5xx と同じ扱い＝2回ほど
        // 試し直し、その後は実行に記録させる。
        if (attempt + 1 >= MAX_ATTEMPTS) throw err;
        await sleep(retryDelayMs(null, attempt, base));
        continue;
      }
      if (res.ok || req.accept?.includes(res.status)) return res;
      // 弾かれたトークンに対して、強制的な取り直しはちょうど1回だけやる価値がある。実行を
      // 始めてから許可が入れ替わったのかもしれない。2回目の 401 は本物。
      if (res.status === 401 && !req.anonymous && !refreshed) {
        refreshed = true;
        await res.text();
        continue;
      }
      if (isTransient(res.status) && attempt + 1 < MAX_ATTEMPTS) {
        const wait = retryDelayMs(res, attempt, base);
        await res.text();
        await sleep(wait);
        continue;
      }
      throw new CloudApiError(kind, res.status, errorCode(await res.text().catch(() => '')));
    }
  };
}

export type CloudHttp = ReturnType<typeof createCloudHttp>;

export { createCloudDestination, createCloudHttp, splitRel };
