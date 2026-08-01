// Unit tests for the DB-driven import side (importCompleteZipToDb) of the #300 (St7)
// work in app/src/main/lib-archive.ts. Covers full lossless import into an empty DB,
// merging into a non-empty DB, idempotency of double imports, filesystem restore of
// .trash/, and import compatibility with legacy (pre-#300) ZIPs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { importCompleteZipToDb, writeCompleteZip } from '../app/src/main/lib-archive';
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
let destFolder: string;

beforeEach(() => {
  handle = openDatabase(path.join(mkTempDir('hologram-archive-import-db-'), 'test.db'));
  destFolder = mkTempDir('hologram-archive-import-dest-');
});

afterEach(() => {
  handle.sqlite.close();
});

// importCompleteZipToDb takes a PATH now (#485 — main opens it with yauzl), so the
// fixtures are written to disk. JSZip stays on the WRITING side only: it is the
// quickest way to assemble an arbitrary archive, and yauzl is what reads it back.
let seq = 0;
function zipFileOf(buf: Buffer) {
  const p = path.join(mkTempDir('hologram-archive-import-zip-'), `fixture-${seq++}.zip`);
  fs.writeFileSync(p, buf);
  return p;
}
async function buildZip(entries: Record<string, string>) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return zipFileOf(Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })));
}

describe('importCompleteZipToDb: 空DBへの完全インポート', () => {
  test('投稿サイドカーがDBへ書かれ、ディスクへは書かれない', async () => {
    const zipPath = await buildZip({
      'library/cap-1.json': JSON.stringify({ captureId: 'cap-1', text: 'hello', tags: ['a'], capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }),
      'library/cap-1.jpg': 'JPEGDATA',
    });
    const res = await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    expect(res.ok).toBe(true);
    expect(res.imported).toBe(2); // post + binary
    const row = handle.sqlite.prepare('SELECT text FROM posts WHERE captureId = ?').get('cap-1');
    expect(row.text).toBe('hello');
    expect(fs.existsSync(path.join(destFolder, 'cap-1.json'))).toBe(false); // the sidecar is not left on disk
    expect(fs.existsSync(path.join(destFolder, 'cap-1.jpg'))).toBe(true); // the binary stays on disk
  });

  test('folders.json / tag-types.json がDBへ反映される', async () => {
    const zipPath = await buildZip({
      'library/folders.json': JSON.stringify({ folders: [{ id: 'f1', name: 'X', kind: 'static', items: [] }] }),
      'library/tag-types.json': JSON.stringify({ types: { a: 'character' } }),
    });
    await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    const dbw = createDbWriter(handle.sqlite);
    expect(dbw.getFolders().folders.map((f: any) => f.id)).toEqual(['f1']);
    expect(dbw.getTagTypes().types.a).toBe('character');
  });

  test('tag-parents.json がDBへ反映される（importTagParents経由）', async () => {
    const zipPath = await buildZip({
      'library/tag-parents.json': JSON.stringify({
        tags: [
          { ref: 1, name: 'character' },
          { ref: 2, name: 'alice' },
        ],
        parents: [{ tagRef: 2, parentRef: 1, isDisplay: true }],
      }),
    });
    await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    const { sqlite } = handle;
    const aliceId = sqlite.prepare('SELECT id FROM tags WHERE name = ?').get('alice').id;
    const characterId = sqlite.prepare('SELECT id FROM tags WHERE name = ?').get('character').id;
    const edge = sqlite.prepare('SELECT * FROM tag_parents WHERE tagId = ?').get(aliceId);
    expect(edge.parentTagId).toBe(characterId);
    expect(edge.isDisplay).toBe(1);
  });

  test('tabs.json はインポートしない', async () => {
    const zipPath = await buildZip({ 'library/tabs.json': JSON.stringify({ tabs: [{ id: 't1', pinned: false, title: 'x', state: {} }], activeTabId: 't1' }) });
    await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    expect(createDbWriter(handle.sqlite).getTabs()).toBeNull();
  });

  test('poster-favorites.json（旧形式のみ）はDBテーブルが無いため無視される', async () => {
    const zipPath = await buildZip({ 'library/poster-favorites.json': JSON.stringify({ keys: ['a'] }) });
    const res = await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    expect(res.ok).toBe(true); // does not error, just gets silently ignored
  });
});

describe('importCompleteZipToDb: 非空DBへはマージ（置換ではない）', () => {
  test('既存の投稿を上書きしない（skip-if-exists と同じ契約）', async () => {
    const { sqlite } = handle;
    const stmts = preparePostStmts(sqlite);
    const resolveTagId = makeTagResolver(sqlite);
    writePost(stmts, resolveTagId, { captureId: 'cap-1', text: 'ORIGINAL', capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', media: [], tags: [], hashtags: [] } as any, null);

    const zipPath = await buildZip({ 'library/cap-1.json': JSON.stringify({ captureId: 'cap-1', text: 'INCOMING', capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }) });
    const res = await importCompleteZipToDb(sqlite, zipPath, destFolder);
    expect(res.skipped).toBe(1);
    expect(sqlite.prepare('SELECT text FROM posts WHERE captureId = ?').get('cap-1').text).toBe('ORIGINAL');
  });

  test('既存フォルダは、着信フォルダとの id 和集合になる（丸ごと置換されない）', async () => {
    const dbw = createDbWriter(handle.sqlite);
    dbw.setFolders({ folders: [{ id: 'local', name: 'Local', kind: 'static', items: [] }] });

    const zipPath = await buildZip({ 'library/folders.json': JSON.stringify({ folders: [{ id: 'incoming', name: 'Incoming', kind: 'static', items: [] }] }) });
    await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);

    const ids = createDbWriter(handle.sqlite)
      .getFolders()
      .folders.map((f: any) => f.id)
      .sort();
    expect(ids).toEqual(['incoming', 'local']);
  });
});

describe('importCompleteZipToDb: 冪等性', () => {
  test('同じZIPを2回インポートしても重複しない', async () => {
    const zipPath = await buildZip({
      'library/cap-1.json': JSON.stringify({ captureId: 'cap-1', text: 'hello', tags: ['a'], capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }),
    });
    const first = await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    const second = await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    expect(first.imported).toBe(1);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
    expect(handle.sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get().n).toBe(1);
  });
});

describe('importCompleteZipToDb: .trash/ の復元', () => {
  test('.trash/ 配下はファイルシステムへ復元され、DBのpostsには書かれない', async () => {
    // The manifest is what marks this a complete export (#485 moved that test into
    // main); a real includeTrash export always carries one alongside .trash/.
    const zipPath = await buildZip({ 'hologram-export.json': '{"app":"Hologram","kind":"complete"}', '.trash/cap-9.json': JSON.stringify({ captureId: 'cap-9' }), '.trash/cap-9.jpg': 'TRASHED' });
    const res = await importCompleteZipToDb(handle.sqlite, zipPath, destFolder);
    expect(res.imported).toBe(2);
    expect(fs.readFileSync(path.join(destFolder, '.trash', 'cap-9.json'), 'utf8')).toContain('cap-9');
    expect(fs.readFileSync(path.join(destFolder, '.trash', 'cap-9.jpg'), 'utf8')).toBe('TRASHED');
    expect(handle.sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get().n).toBe(0);
  });
});

describe('importCompleteZipToDb: 旧形式（#300以前）ZIPとの互換', () => {
  test('#300以前の writeCompleteZip が書いたZIP（tag-parents.json/.trashを含まない）も特別扱い無しでインポートできる', async () => {
    // Equivalent to pre-#300: set up a separate DB as the sidecar-generating source, and
    // use the ZIP that DB produces via writeCompleteZip as a stand-in for a "pre-#300
    // export" (the real legacy format is unchanged in that library/<id>.json is still a
    // PostRecordShape — module comment).
    const oldHandle = openDatabase(path.join(mkTempDir('hologram-archive-import-old-db-'), 'test.db'));
    const oldSrc = mkTempDir('hologram-archive-import-old-lib-');
    const oldTrash = mkTempDir('hologram-archive-import-old-trash-');
    const oldOut = path.join(mkTempDir('hologram-archive-import-old-out-'), 'export.zip');
    const stmts = preparePostStmts(oldHandle.sqlite);
    const resolveTagId = makeTagResolver(oldHandle.sqlite);
    writePost(stmts, resolveTagId, { captureId: 'legacy-1', text: 'from an older export', capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', media: [], tags: [], hashtags: [] } as any, null);
    await writeCompleteZip(oldHandle.sqlite, oldSrc, oldTrash, oldOut, {});
    oldHandle.sqlite.close();

    const res = await importCompleteZipToDb(handle.sqlite, oldOut, destFolder);
    expect(res.ok).toBe(true);
    expect(handle.sqlite.prepare('SELECT text FROM posts WHERE captureId = ?').get('legacy-1').text).toBe('from an older export');
  });
});

// #292: the raw payload survives a round trip across a ZIP = even when moving the
// library to a different machine, the side that can't be re-fetched (the raw payload)
// doesn't get left behind.
describe('importCompleteZipToDb: 取得原本（#292）の往復', () => {
  const body = '{"text":"hello","unknown_future_field":42}';

  test('書き出した原本がそのまま取り込まれ、本文まで復元できる', async () => {
    const srcHandle = openDatabase(path.join(mkTempDir('hologram-archive-raw-src-db-'), 'test.db'));
    const srcLib = mkTempDir('hologram-archive-raw-src-lib-');
    const out = path.join(mkTempDir('hologram-archive-raw-out-'), 'export.zip');
    writePost(preparePostStmts(srcHandle.sqlite), makeTagResolver(srcHandle.sqlite), {
      captureId: 'cap-raw',
      capturedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      raw: packRawPayloads([{ sourceKind: 'api:x/tweet-result', contentType: 'application/json', body }]),
    } as any);
    await writeCompleteZip(srcHandle.sqlite, srcLib, null, out, {});
    srcHandle.sqlite.close();

    await importCompleteZipToDb(handle.sqlite, out, destFolder);

    const row = handle.sqlite.prepare('SELECT sourceKind, contentType, encoding, sha256, byteLength, payload FROM raw_payloads WHERE postId = ?').get('cap-raw');
    expect({ sourceKind: row.sourceKind, contentType: row.contentType, byteLength: row.byteLength }).toEqual({ sourceKind: 'api:x/tweet-result', contentType: 'application/json', byteLength: Buffer.byteLength(body, 'utf8') });
    expect(unpackRawPayload(row)).toBe(body);
  });

  // Raw payloads are append-only = importing the same ZIP twice doesn't add more (checks
  // that both the post side's skip-if-exists and the unique constraint are in effect)
  test('同じ ZIP の二度目のインポートで原本が二重にならない', async () => {
    const srcHandle = openDatabase(path.join(mkTempDir('hologram-archive-raw2-src-db-'), 'test.db'));
    const srcLib = mkTempDir('hologram-archive-raw2-src-lib-');
    const out = path.join(mkTempDir('hologram-archive-raw2-out-'), 'export.zip');
    writePost(preparePostStmts(srcHandle.sqlite), makeTagResolver(srcHandle.sqlite), {
      captureId: 'cap-raw2',
      capturedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      raw: packRawPayloads([{ sourceKind: 'api:x/tweet-result', body }]),
    } as any);
    await writeCompleteZip(srcHandle.sqlite, srcLib, null, out, {});
    srcHandle.sqlite.close();

    await importCompleteZipToDb(handle.sqlite, out, destFolder);
    await importCompleteZipToDb(handle.sqlite, out, destFolder);

    expect(handle.sqlite.prepare('SELECT COUNT(*) AS n FROM raw_payloads WHERE postId = ?').get('cap-raw2').n).toBe(1);
  });
});
