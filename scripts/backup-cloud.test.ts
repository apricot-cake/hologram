// クラウド宛先（app/src/main/lib-backup-cloud.ts）のうち、provider に依らない側。
//
// ここで見る規則は、外すとそのままデータ喪失になるもの。ローカルフォルダのアダプタが
// 正しくやらねばならなかったのと同じ3つだ＝身元ファイルは書いたものが読み戻ること、
// そして list() に出てはいけないこと（ライブラリ側に対応物の無いエントリは、エンジンが
// 消すエントリだ）、ゴミ箱への移動が move であること。もしこれが「もう1回アップロード
// してから消す」になれば、エンジンの一番安い操作が従量課金の回線で一番高い操作に変わる。
//
// provider をメモリ上の木で代用しているのは意図してそうしている。このファイルの主題は
// 相対パスからアイテム id への橋渡しで、そこは Google Drive と OneDrive でまったく同じ
// 部分だからだ。通信路上の形式は backup-cloud-google/microsoft.test.ts が代役の HTTP
// サーバーを相手に固定している。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createCloudDestination, createCloudHttp } from '../app/src/main/lib-backup-cloud';
import type { CloudNode, CloudOps, CloudSource } from '../app/src/main/lib-backup-cloud';
import { IDENTITY_FILE } from '../app/src/main/lib-backup-destination';

interface FakeItem {
  id: string;
  name: string;
  parentId: string | null;
  isFolder: boolean;
  data: Buffer;
  mtimeMs: number;
}

interface FakeCloud extends CloudOps {
  items: Map<string, FakeItem>;
  calls: { uploads: string[]; moves: string[]; removes: string[]; listedFolders: number };
}

function createFakeCloud(): FakeCloud {
  const items = new Map<string, FakeItem>();
  const calls = { uploads: [] as string[], moves: [] as string[], removes: [] as string[], listedFolders: 0 };
  let seq = 0;
  const put = (item: Omit<FakeItem, 'id'>): string => {
    const id = `id-${++seq}`;
    items.set(id, { ...item, id });
    return id;
  };
  const rootId = put({ name: 'root', parentId: null, isFolder: true, data: Buffer.alloc(0), mtimeMs: 0 });

  return {
    items,
    calls,
    kind: 'fake-cloud',
    location: 'fake',
    async ensureRoot() {
      return rootId;
    },
    async children(folderId) {
      calls.listedFolders++;
      const out: CloudNode[] = [];
      for (const item of items.values()) {
        if (item.parentId !== folderId) continue;
        out.push({ id: item.id, name: item.name, isFolder: item.isFolder, size: item.isFolder ? 0 : item.data.length, mtimeMs: item.mtimeMs });
      }
      return out;
    },
    async createFolder(parentId, name) {
      return put({ name, parentId, isFolder: true, data: Buffer.alloc(0), mtimeMs: 0 });
    },
    async upload(target, source: CloudSource, mtimeMs) {
      calls.uploads.push(target.name);
      const data = source.kind === 'file' ? await fs.promises.readFile(source.path) : source.data;
      if (target.existingId) {
        const existing = items.get(target.existingId) as FakeItem;
        items.set(target.existingId, { ...existing, data, mtimeMs: mtimeMs ?? existing.mtimeMs });
        return target.existingId;
      }
      return put({ name: target.name, parentId: target.parentId, isFolder: false, data, mtimeMs: mtimeMs ?? 0 });
    },
    async download(id) {
      return (items.get(id) as FakeItem).data;
    },
    async move(id, _from, to) {
      calls.moves.push(id);
      const item = items.get(id) as FakeItem;
      items.set(id, { ...item, parentId: to.parentId, name: to.name });
    },
    async remove(id) {
      calls.removes.push(id);
      items.delete(id);
    },
  };
}

const made: string[] = [];
function tempFile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-cloud-'));
  made.push(dir);
  const file = path.join(dir, 'src.bin');
  fs.writeFileSync(file, content);
  return file;
}
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('相対パスとアイテム id の橋渡し', () => {
  test('入れ子のパスは put が中間フォルダごと作る', async () => {
    const cloud = createFakeCloud();
    const dest = createCloudDestination(cloud);
    await dest.put('hologram-inbox/new/a.json', tempFile('{}'), 1_700_000_000_000);
    expect([...(await dest.list()).keys()]).toEqual(['hologram-inbox/new/a.json']);
    // フォルダはフォルダとして存在する。名前にスラッシュを含むファイル1個ではない。
    const names = [...cloud.items.values()].filter((i) => i.isFolder).map((i) => i.name);
    expect(names).toContain('hologram-inbox');
    expect(names).toContain('new');
  });

  test('ゴミ箱への移動は move であって再アップロードではない', async () => {
    const cloud = createFakeCloud();
    const dest = createCloudDestination(cloud);
    const src = tempFile('bytes');
    await dest.put('a.jpg', src, 1_700_000_000_000);
    expect(cloud.calls.uploads).toEqual(['a.jpg']);

    await dest.move('a.jpg', '.trash/a.jpg');
    expect(cloud.calls.moves).toHaveLength(1);
    expect(cloud.calls.uploads).toEqual(['a.jpg']); // 最初の1回のまま
    expect([...(await dest.list()).keys()]).toEqual(['.trash/a.jpg']);

    // …そしてまた外へ戻す。ゴミ箱からの復元がこれにあたる。
    await dest.move('.trash/a.jpg', 'a.jpg');
    expect(cloud.calls.uploads).toEqual(['a.jpg']);
    expect([...(await dest.list()).keys()]).toEqual(['a.jpg']);
  });

  test('宛先に無いものの move は失敗する（別のものを動かさない）', async () => {
    const dest = createCloudDestination(createFakeCloud());
    await expect(dest.move('gone.jpg', '.trash/gone.jpg')).rejects.toThrow(/gone\.jpg/);
  });

  test('put は既存のアイテムを差し替える（同名の二重登録を作らない）', async () => {
    const cloud = createFakeCloud();
    const dest = createCloudDestination(cloud);
    await dest.put('.trash/a.json', tempFile('{"trashedAt":1}'), 1000);
    await dest.put('.trash/a.json', tempFile('{"trashedAt":2}'), 2000);
    const listed = await dest.list();
    expect(listed.size).toBe(1);
    expect(listed.get('.trash/a.json')?.mtimeMs).toBe(2000);
    expect([...cloud.items.values()].filter((i) => !i.isFolder)).toHaveLength(1);
  });

  test('remove は宛先から消し、消えているものの remove は成功として扱う', async () => {
    const cloud = createFakeCloud();
    const dest = createCloudDestination(cloud);
    await dest.put('a.jpg', tempFile('x'), 1000);
    await dest.remove('a.jpg');
    expect([...(await dest.list()).keys()]).toEqual([]);
    await expect(dest.remove('a.jpg')).resolves.toBeUndefined();
    expect(cloud.calls.removes).toHaveLength(1);
  });

  test('一覧は1回の走査で作り、同じ run の中で作り直さない', async () => {
    const cloud = createFakeCloud();
    const dest = createCloudDestination(cloud);
    await dest.put('avatars/a.png', tempFile('x'), 1000);
    const first = cloud.calls.listedFolders;
    await dest.list();
    await dest.list();
    expect(cloud.calls.listedFolders).toBe(first);
  });
});

describe('宛先の身元（libraryId）', () => {
  test('書いたものが読み戻り、list には出ない', async () => {
    const cloud = createFakeCloud();
    const dest = createCloudDestination(cloud);
    expect(await dest.readIdentity()).toBeNull(); // 未設置＝引き取り前
    await dest.writeIdentity({ libraryId: 'lib-a', lastRunAt: '2026-08-05T00:00:00.000Z' });
    await dest.put('a.jpg', tempFile('x'), 1000);
    expect(await dest.readIdentity()).toEqual({ libraryId: 'lib-a', lastRunAt: '2026-08-05T00:00:00.000Z' });
    expect([...(await dest.list()).keys()]).toEqual(['a.jpg']);
    // 2回目の書き込みはファイルを差し替える。2つ目を足すのではない。
    await dest.writeIdentity({ libraryId: 'lib-a', lastRunAt: '2026-08-05T01:00:00.000Z' });
    expect([...cloud.items.values()].filter((i) => i.name === IDENTITY_FILE)).toHaveLength(1);
  });

  test('読めない身元は「不一致」ではなく「未設置」として扱う', async () => {
    const cloud = createFakeCloud();
    const dest = createCloudDestination(cloud);
    await dest.writeIdentity({ libraryId: 'lib-a', lastRunAt: null });
    const stored = [...cloud.items.values()].find((i) => i.name === IDENTITY_FILE) as FakeItem;
    cloud.items.set(stored.id, { ...stored, data: Buffer.from('not json at all') });
    expect(await createCloudDestination(cloud).readIdentity()).toBeNull();
  });

  test('.tmp の残骸は一覧に出ない（途中で落ちた run の置き土産）', async () => {
    const cloud = createFakeCloud();
    const dest = createCloudDestination(cloud);
    await dest.put('a.jpg', tempFile('x'), 1000);
    const root = await cloud.ensureRoot();
    cloud.items.set('leftover', { id: 'leftover', name: 'b.jpg.tmp-123', parentId: root, isFolder: false, data: Buffer.alloc(0), mtimeMs: 0 });
    expect([...(await createCloudDestination(cloud).list()).keys()]).toEqual(['a.jpg']);
  });
});

describe('転送（リトライと token の扱い）', () => {
  const okResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });

  test('429 は Retry-After に従って1度だけ待ち、その後成功する', async () => {
    const seen: Array<string | null> = [];
    let calls = 0;
    const request = createCloudHttp('Fake', {
      accessToken: async () => 'tok',
      retryBaseMs: 1,
      fetch: (async (_url: string, init: RequestInit) => {
        seen.push(new Headers(init.headers).get('authorization'));
        calls++;
        return calls === 1 ? new Response('{"error":{"code":"rateLimitExceeded"}}', { status: 429, headers: { 'retry-after': '0' } }) : okResponse();
      }) as unknown as typeof globalThis.fetch,
    });
    expect((await request({ url: 'https://example.test/x' })).status).toBe(200);
    expect(calls).toBe(2);
    expect(seen).toEqual(['Bearer tok', 'Bearer tok']);
  });

  test('401 は1度だけ強制リフレッシュして再試行する（無限には回らない）', async () => {
    const forced: boolean[] = [];
    let calls = 0;
    const request = createCloudHttp('Fake', {
      accessToken: async (force = false) => {
        forced.push(force);
        return force ? 'fresh' : 'stale';
      },
      retryBaseMs: 1,
      fetch: (async () => {
        calls++;
        return new Response('{"error":{"code":"InvalidAuthenticationToken"}}', { status: 401 });
      }) as unknown as typeof globalThis.fetch,
    });
    await expect(request({ url: 'https://example.test/x' })).rejects.toThrow(/401/);
    expect(calls).toBe(2);
    expect(forced).toEqual([false, true]);
  });

  test('エラーには provider のコードだけが乗る（本文もトークンも乗せない）', async () => {
    const request = createCloudHttp('Fake', {
      accessToken: async () => 'super-secret-token',
      retryBaseMs: 1,
      fetch: (async () => new Response('{"error":{"code":"itemNotFound","message":"the token super-secret-token cannot see /x"}}', { status: 404 })) as unknown as typeof globalThis.fetch,
    });
    const err = await request({ url: 'https://example.test/x' }).catch((e: Error) => e);
    expect(String(err)).toContain('itemNotFound');
    expect(String(err)).not.toContain('super-secret-token');
    expect(String(err)).not.toContain('cannot see');
  });

  test('accept に挙げた状態は失敗にしない（分割アップロードの 308/202）', async () => {
    const request = createCloudHttp('Fake', {
      accessToken: async () => 'tok',
      retryBaseMs: 1,
      fetch: (async () => new Response('', { status: 308, headers: { range: 'bytes=0-99' } })) as unknown as typeof globalThis.fetch,
    });
    expect((await request({ url: 'https://example.test/x', accept: [308] })).status).toBe(308);
  });

  test('anonymous な要求は Authorization を付けない（OneDrive のセッション URL）', async () => {
    let header: string | null = 'unset';
    const request = createCloudHttp('Fake', {
      accessToken: async () => 'tok',
      fetch: (async (_url: string, init: RequestInit) => {
        header = new Headers(init.headers).get('authorization');
        return okResponse();
      }) as unknown as typeof globalThis.fetch,
    });
    await request({ url: 'https://example.test/session', anonymous: true });
    expect(header).toBeNull();
  });
});
