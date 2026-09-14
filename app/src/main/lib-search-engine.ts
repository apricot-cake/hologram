import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rename } from 'node:fs/promises';
import net from 'node:net';
import { Meilisearch, type Index } from 'meilisearch';
import { normalizeSearchText, originalSearchRange } from './lib-search-normalization.ts';

export interface SearchDocument {
  id: string;
  fields: Record<string, string>;
}
export interface SearchHit {
  postId: string;
  rank: number;
  field?: string;
  snippetText?: string;
  matchStart?: number;
  matchEnd?: number;
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// SQLiteから再構築できる索引。プロセス・接続先・鍵をアプリ自身が所有する。
export class SearchEngine {
  private child?: ChildProcess;
  private client?: Promise<Meilisearch>;
  private queue: Promise<unknown> = Promise.resolve();
  private signatures = new Map<string, Map<string, string>>();
  constructor(
    private binary: string,
    private dbPath: string,
  ) {}

  async stop() {
    const child = this.child;
    this.child = undefined;
    this.client = undefined;
    this.signatures.clear();
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.kill();
      });
    }
  }

  private async start(): Promise<Meilisearch> {
    await mkdir(this.dbPath, { recursive: true });
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const value = (server.address() as net.AddressInfo).port;
        server.close(() => resolve(value));
      });
    });
    const apiKey = randomBytes(32).toString('hex');
    const child = spawn(this.binary, ['--db-path', this.dbPath, '--http-addr', `127.0.0.1:${port}`, '--no-analytics', '--env', 'production'], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, MEILI_MASTER_KEY: apiKey },
    });
    this.child = child;
    let failure: Error | undefined;
    let log = '';
    child.stderr?.on('data', (chunk) => {
      log = (log + chunk).slice(-2000);
    });
    child.once('error', (error) => {
      failure = error;
    });
    child.once('exit', () => {
      failure = new Error(`検索エンジンが終了しました。${log}`);
      if (this.child === child) {
        this.client = undefined;
        this.signatures.clear();
      }
    });
    const client = new Meilisearch({ host: `http://127.0.0.1:${port}`, apiKey, timeout: 10000 });
    for (let n = 0; n < 200; n++) {
      if (failure) throw failure;
      try {
        await client.health();
        return client;
      } catch {
        await pause(100);
      }
    }
    child.kill();
    throw new Error('検索エンジンを起動できませんでした。');
  }

  private async connect(): Promise<Meilisearch> {
    try {
      return await this.start();
    } catch (error) {
      if (!/MDB_CORRUPTED|MDB_INVALID|invalid database|database.*corrupt/i.test(String(error))) throw error;
      await this.stop();
      // 壊れた索引は診断用に残し、新しい索引を正本から構築する。
      await rename(this.dbPath, `${this.dbPath}.damaged-${Date.now()}`);
      return this.start();
    }
  }

  private async wait(client: Meilisearch, task: { taskUid: number }) {
    const result = await client.tasks.waitForTask(task.taskUid, { timeout: 120000, interval: 50 });
    if (result.status !== 'succeeded') throw new Error(result.error?.message || '検索索引を更新できませんでした。');
  }

  private async sync(client: Meilisearch, name: string, kind: string, documents: SearchDocument[]): Promise<Index> {
    const index = client.index(name);
    let previous = this.signatures.get(name);
    if (!previous) {
      // 起動後の初回はDBの正本から作り直す。中断した更新を引き継がない。
      try {
        await client.getIndex(name);
      } catch (error) {
        if (error.cause?.code !== 'index_not_found') throw error;
        await this.wait(client, await client.createIndex(name, { primaryKey: 'id' }));
      }
      await this.wait(client, await index.deleteAllDocuments());
      const fields = kind === 'candidates' ? ['title', 'screenName', 'keywords'] : ['tag', 'hashtag', 'title', 'seriesTitle', 'eagleName', 'displayName', 'screenName', 'text', 'alt', 'quoted', 'quotedScreenName', 'linkCard', 'poll'];
      await this.wait(
        client,
        await index.updateSettings({
          searchableAttributes: fields.map((field) => `fields.${field}`),
          displayedAttributes: ['id', 'fields'],
          pagination: { maxTotalHits: 10000000 },
          typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 }, disableOnNumbers: true, disableOnAttributes: ['fields.screenName', 'fields.quotedScreenName'] },
          rankingRules: ['words', 'typo', 'proximity', 'exactness', 'attribute', 'sort'],
          prefixSearch: 'indexingTime',
          localizedAttributes: [],
        }),
      );
      previous = new Map();
      this.signatures.set(name, previous);
    }
    const next = new Map(documents.map((d) => [d.id, hash(JSON.stringify(d))]));
    const changed = documents.filter((d) => previous.get(d.id) !== next.get(d.id));
    const removed = [...previous.keys()].filter((id) => !next.has(id));
    for (let offset = 0; offset < changed.length; offset += 1000) {
      await this.wait(
        client,
        await index.addDocuments(
          changed.slice(offset, offset + 1000).map((document) => ({
            id: document.id,
            fields: Object.fromEntries(Object.entries(document.fields).map(([field, text]) => [field, normalizeSearchText(text)])),
          })),
        ),
      );
    }
    if (removed.length) await this.wait(client, await index.deleteDocuments(removed));
    this.signatures.set(name, next);
    return index;
  }

  search(library: string, kind: string, documents: SearchDocument[], query: string, limit = documents.length): Promise<SearchHit[]> {
    const work = async () => {
      this.client ??= this.connect().catch((error) => {
        this.client = undefined;
        throw error;
      });
      const client = await this.client;
      this.client ??= Promise.resolve(client);
      const index = await this.sync(client, `library_${hash(library).slice(0, 24)}_${kind}`, kind, documents);
      const originals = new Map(documents.map((document) => [document.id, document.fields]));
      const results: SearchHit[] = [];
      const cap = Math.min(limit, documents.length);
      while (results.length < cap) {
        const response = await index.search<{ id: string; fields: Record<string, string> }>(normalizeSearchText(query), { offset: results.length, limit: Math.min(1000, cap - results.length), matchingStrategy: 'all', showMatchesPosition: true });
        for (const hit of response.hits) {
          const entry = Object.entries(hit._matchesPosition || {}).find(([, positions]) => Array.isArray(positions) && positions.length);
          const field = entry?.[0].replace(/^fields\./, '');
          const position = entry?.[1]?.[0];
          const source = (field ? originals.get(hit.id)?.[field] : '') || '';
          const { start, end } = position ? originalSearchRange(source, position.start, position.length) : { start: -1, end: -1 };
          const from = Math.max(0, start - 40);
          const to = Math.max(end, 0) + 80;
          const prefix = from ? '…' : '';
          const snippetText = source ? prefix + source.slice(from, to) + (to < source.length ? '…' : '') : undefined;
          results.push({ postId: hit.id, rank: results.length, field: field === 'quotedScreenName' ? 'quoted' : field, snippetText, matchStart: start < 0 ? -1 : prefix.length + start - from, matchEnd: end < 0 ? -1 : prefix.length + end - from });
        }
        if (response.hits.length < Math.min(1000, cap - (results.length - response.hits.length))) break;
      }
      return results;
    };
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }
}
