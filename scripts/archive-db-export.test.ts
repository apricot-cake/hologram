// Unit tests for the DB-driven export side of the #300 (St7) work in
// app/src/main/lib-archive.ts. Reads back the contents of the ZIP that writeCompleteZip
// produces with JSZip, and checks the post sidecars, the organizational layer,
// tag-parents.json, and the .trash/ placement when includeTrash is set.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { writeCompleteZip } from '../app/src/main/lib-archive';
import { createDbWriter } from '../app/src/main/lib-db-write';
import { makeTagResolver, preparePostStmts, writePost } from '../app/src/main/lib-db-record-writer';
import { packRawPayloads, unpackRawPayload } from '../native-host/raw-payload.mts';

const dirs: string[] = [];
function mkTempDir(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

let handle: any;
let srcFolder: string;
let trashDir: string;
let outPath: string;

beforeEach(() => {
  handle = openDatabase(path.join(mkTempDir('hologram-archive-export-db-'), 'test.db'));
  srcFolder = mkTempDir('hologram-archive-export-lib-');
  trashDir = mkTempDir('hologram-archive-export-trash-');
  outPath = path.join(mkTempDir('hologram-archive-export-out-'), 'export.zip');

  const { sqlite } = handle;
  const stmts = preparePostStmts(sqlite);
  const resolveTagId = makeTagResolver(sqlite);
  writePost(
    stmts,
    resolveTagId,
    {
      captureId: 'cap-1',
      image: 'cap-1.jpg',
      text: 'hello',
      capturedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      capturedVia: 'bulk-bookmark',
      tags: ['character:alice'],
      media: [],
      hashtags: [],
    } as any,
    null,
  );
  fs.writeFileSync(path.join(srcFolder, 'cap-1.jpg'), 'JPEGDATA');

  const dbw = createDbWriter(sqlite);
  dbw.setFolders({ folders: [{ id: 'f1', name: 'Favorites', kind: 'static', items: ['cap-1'] }] });
  dbw.fillTagKindsByName({ 'character:alice': 'character' }, null);

  const characterId = resolveTagId('character');
  const aliceId = resolveTagId('character:alice');
  sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, 1)').run(aliceId, characterId);
});

afterEach(() => {
  handle.sqlite.close();
});

async function loadZip(p: string) {
  return JSZip.loadAsync(await fs.promises.readFile(p));
}

describe('writeCompleteZip: 投稿サイドカーの再生成', () => {
  test('DBの投稿が library/<captureId>.json として書かれる（capturedVia込み）', async () => {
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    const raw = await zip.file('library/cap-1.json')?.async('string');
    const rec = JSON.parse(raw);
    expect(rec.captureId).toBe('cap-1');
    expect(rec.text).toBe('hello');
    expect(rec.capturedVia).toBe('bulk-bookmark');
    expect(rec.tags).toEqual(['character:alice']);
    expect(rec.tagIds).toBeUndefined(); // the DB-internal-only parallel array is stripped
  });

  test('スクリーンショットはディスクからそのままコピーされる', async () => {
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    expect(await zip.file('library/cap-1.jpg')?.async('string')).toBe('JPEGDATA');
  });
});

describe('writeCompleteZip: 組織レイヤーの再生成', () => {
  test('folders.json / tag-types.json がDBから再生成される', async () => {
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    const folders = JSON.parse(await zip.file('library/folders.json')?.async('string'));
    expect(folders.folders.map((f: any) => f.id)).toEqual(['f1']);
    // #810: the ZIP stays keyed by NAME — a tag id means nothing in another library.
    const tagTypes = JSON.parse(await zip.file('library/tag-types.json')?.async('string'));
    expect(tagTypes.types['character:alice']).toBe('character');
  });

  test('poster-favorites.json は退役済み機能なのでエクスポートされない', async () => {
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    expect(zip.file('library/poster-favorites.json')).toBeNull();
  });

  test('tabs.json はタブが無ければ含まれない', async () => {
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    expect(zip.file('library/tabs.json')).toBeNull();
  });
});

describe('writeCompleteZip: tag-parents.json', () => {
  test('親エッジを持つタグだけを ref 付きで書き出す', async () => {
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    const tagParents = JSON.parse(await zip.file('library/tag-parents.json')?.async('string'));
    expect(tagParents.tags.map((t: any) => t.name).sort()).toEqual(['character', 'character:alice']);
    expect(tagParents.parents).toHaveLength(1);
    expect(tagParents.parents[0].isDisplay).toBe(true);
  });

  test('親子関係が1つも無ければ tag-parents.json 自体を含めない', async () => {
    const { sqlite } = handle;
    sqlite.prepare('DELETE FROM tag_parents').run();
    await writeCompleteZip(sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    expect(zip.file('library/tag-parents.json')).toBeNull();
  });
});

// #292: the complete ZIP bundles the raw payload by default (once a post is deleted the
// raw payload can never be re-fetched = a ZIP that drops it isn't "complete"). The
// manifest records the format and a privacy note.
describe('writeCompleteZip: 取得原本（#292）', () => {
  const body = '{"text":"hello","unknown_future_field":42}';

  function seedRaw() {
    const { sqlite } = handle;
    writePost(preparePostStmts(sqlite), makeTagResolver(sqlite), {
      captureId: 'cap-raw',
      image: 'cap-raw.jpg',
      capturedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      raw: packRawPayloads([{ sourceKind: 'api:x/tweet-result', contentType: 'application/json', body }]),
    } as any);
  }

  test('サイドカーの raw[] に原本が入り、本文がそのまま取り出せる', async () => {
    seedRaw();
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    const rec = JSON.parse(await zip.file('library/cap-raw.json')?.async('string'));
    expect(rec.raw).toHaveLength(1);
    expect(rec.raw[0].sourceKind).toBe('api:x/tweet-result');
    expect(unpackRawPayload({ encoding: rec.raw[0].encoding, sha256: rec.raw[0].sha256, payload: Buffer.from(rec.raw[0].payloadBase64, 'base64') })).toBe(body);
  });

  // A record with no raw payload (saved before this layer existed) doesn't change the sidecar shape
  test('原本の無い投稿のサイドカーには raw を足さない', async () => {
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    expect(JSON.parse(await zip.file('library/cap-1.json')?.async('string')).raw).toBeUndefined();
  });

  test('マニフェストが件数・形式・プライバシー注意を書く', async () => {
    seedRaw();
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    const manifest = JSON.parse(await zip.file('hologram-export.json')?.async('string'));
    expect(manifest.rawPayloads.count).toBe(1);
    expect(manifest.rawPayloads.format).toContain('gzip');
    expect(manifest.rawPayloads.privacy).toContain('第三者');
  });
});

describe('writeCompleteZip: includeTrash', () => {
  test('既定（includeTrash未指定）では .trash/ を同梱しない', async () => {
    fs.writeFileSync(path.join(trashDir, 'cap-2.json'), JSON.stringify({ captureId: 'cap-2' }));
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    expect(zip.file('.trash/cap-2.json')).toBeNull();
  });

  test('includeTrash:true で .trash/ 配下がプレフィックス付きで同梱される', async () => {
    fs.writeFileSync(path.join(trashDir, 'cap-2.json'), JSON.stringify({ captureId: 'cap-2' }));
    fs.writeFileSync(path.join(trashDir, 'cap-2.jpg'), 'TRASHED');
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, { includeTrash: true });
    const zip = await loadZip(outPath);
    expect(await zip.file('.trash/cap-2.json')?.async('string')).toContain('cap-2');
    expect(await zip.file('.trash/cap-2.jpg')?.async('string')).toBe('TRASHED');
    // trash contents don't leak into the library/ side
    expect(zip.file('library/cap-2.json')).toBeNull();
  });

  test('マニフェストの includesTrash がオプション値を反映する', async () => {
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, { includeTrash: true });
    const zip = await loadZip(outPath);
    const manifest = JSON.parse(await zip.file('hologram-export.json')?.async('string'));
    expect(manifest.includesTrash).toBe(true);
    expect(manifest.version).toBe(2);
    expect(manifest.source).toBe('db');
  });
});
