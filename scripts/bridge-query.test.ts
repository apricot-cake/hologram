// The bridge's saved index = the read path for the timeline's "saved" badge (#54).
// Covers the three sources that build the answer (the app's bridge-saved-index.json
// snapshot, loose inbox envelopes newer than it, and the bridge's own journal —
// replacing the .index.json + direct sidecar reads from #5 St6 / #299), the URL
// notation normalization shared with the renderer, and the cache invalidation that
// keeps a long-lived port's answers up to date.
//
// This suite accumulates state in order (each section's writes are the premise for
// the next section), so the declaration order of the tests matters.

import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { buildEnvelope } from '../native-host/inbox.mts';
import { normalizePostRecord } from '../native-host/post-record.mts';
import { postKeyOf } from '../native-host/post-key.mts';

let saveFolder: string;
let configDir: string;
let handleQuery: any;
let noteSaved: any;
let _resetSavedIndex: any;

const ask = (...urls: unknown[]) => handleQuery({ type: 'query', urls }).results;
// The response is {id, media} per post (#334). Sections that only want the captureId read via this.
const askId = (url: string) => ask(url)[url]?.id ?? null;
// The post's saved images = the array of URLs recorded by the library (position matches the media row's seq).
const askMedia = (url: string) => ask(url)[url]?.media ?? null;

// An inbox envelope in the same shape the bridge writes (equivalent to
// writeInboxEvent in native-host/inbox.mts). The eventId (leading epoch) becomes
// the save time that scanRecentInbox reads.
function writeInboxEnvelope(id: string, url: string, media: Array<{ url: string; file: string }> = []) {
  const record = normalizePostRecord({ captureId: id, url, image: `${id}.jpg`, media });
  const envelope = buildEnvelope(record);
  const dir = path.join(saveFolder, '.hologram-inbox', 'new');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(envelope), 'utf8');
}

// The app-side snapshot (configDir/bridge-saved-index.json, the same postKey ->
// captureId shape that lib-saved-index.ts rebuilds from the DB). Set mtime
// explicitly = the index staleness check is entirely a comparison against this
// time, so the test side owns it instead of racing the filesystem clock.
function writeSavedIndex(records: Array<{ captureId: string; url: string; media?: Array<string | null> }>, mtimeMs: number) {
  const entries: Record<string, { id: string; media: Array<string | null> }> = {};
  for (const rec of records) {
    const key = postKeyOf(rec.url);
    if (key) entries[key] = { id: rec.captureId, media: rec.media || [] };
  }
  fs.mkdirSync(configDir, { recursive: true });
  const p = path.join(configDir, 'bridge-saved-index.json');
  fs.writeFileSync(p, JSON.stringify({ format: 'hologram-bridge-saved-index', version: 2, generatedAt: new Date(mtimeMs).toISOString(), entries }), 'utf8');
  fs.utimesSync(p, new Date(mtimeMs), new Date(mtimeMs));
}

const SNAP_MS = 1_700_000_000_000;

beforeAll(async () => {
  configDir = process.env.HOLOGRAM_CONFIG_DIR as string;
  saveFolder = path.join(configDir, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(saveFolder, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

  ({ handleQuery, noteSaved, _resetSavedIndex } = await import('../native-host/bridge.cts'));

  writeSavedIndex([{ captureId: '1700000000000-aa', url: 'https://x.com/someone/status/111' }], SNAP_MS);
  _resetSavedIndex();
});

describe('1. スナップショットが答える（持っている投稿だけ）', () => {
  test('ヒットしたら captureId を返す', () => {
    expect(askId('https://x.com/someone/status/111')).toBe('1700000000000-aa');
  });

  test('未保存の投稿は null', () => {
    expect(askId('https://x.com/someone/status/999')).toBeNull();
  });
});

// The single implementation of the same rule as the renderer
describe('2. URL の表記ゆれを正規化する', () => {
  test('twitter.com＋クエリ文字列でも同じ投稿', () => {
    const u = 'https://twitter.com/other_handle/status/111?s=20';
    expect(askId(u)).toBe('1700000000000-aa');
  });

  test('/photo/N のパーマリンクも同じ投稿', () => {
    const u = 'https://x.com/someone/status/111/photo/1';
    expect(askId(u)).toBe('1700000000000-aa');
  });

  test('プロフィール URL は投稿ではない', () => {
    expect(askId('https://x.com/someone')).toBeNull();
  });

  test('解釈できない URL は投稿ではない', () => {
    expect(askId('not a url')).toBeNull();
  });
});

// Something saved while the app was closed. Folding it into bridge-saved-index.json
// requires the desktop app to be running, but the badge must not wait for that.
describe('3. スナップショットより新しい loose inbox エンベロープ', () => {
  test('言語接頭辞つき URL でも見つかる', () => {
    writeInboxEnvelope(`${SNAP_MS + 5000}-bb`, 'https://www.pixiv.net/artworks/4242');
    _resetSavedIndex();

    expect(askId('https://www.pixiv.net/en/artworks/4242')).toBe(`${SNAP_MS + 5000}-bb`);
  });
});

// noteSaved is what handleSave/handleSaveDragged calls once it finishes writing the inbox envelope
describe('4. ジャーナル＝このプロセスが保存した直後', () => {
  const url = 'https://bsky.app/profile/alice.test/post/3kzz';

  test('保存直後から即答できる（メモリ上の対応表）', () => {
    noteSaved(url, '1700000009999-cc');

    expect(askId(url)).toBe('1700000009999-cc');
  });

  test('再起動後も bridge-journal.jsonl 経由で同じ答えに届く', () => {
    _resetSavedIndex(); // equivalent to a new process (a new port)

    expect(askId(url)).toBe('1700000009999-cc');
  });

  test('ジャーナルは configDir に書かれる', () => {
    expect(fs.existsSync(path.join(configDir, 'bridge-journal.jsonl'))).toBe(true);
  });
});

// Rewrite the snapshot with an mtime after the journal line's timestamp = that line
// becomes redundant. It should still answer "saved", now grounded in the snapshot itself.
describe('5. スナップショットが追いついたジャーナル行は捨てられる', () => {
  test('追いついた後も保存済みと答える', () => {
    const url = 'https://bsky.app/profile/alice.test/post/3kzz';
    writeSavedIndex(
      [
        { captureId: '1700000000000-aa', url: 'https://x.com/someone/status/111' },
        { captureId: '1700000009999-cc', url },
      ],
      Date.now() + 60_000,
    );
    _resetSavedIndex();

    expect(askId(url)).toBe('1700000009999-cc');
  });
});

// Don't call _resetSavedIndex here = this is the invalidation path, not building
// from a cold state (a single port stays alive for the life of one feed)
describe('6. キャッシュはスナップショットの mtime に追従する', () => {
  const url = 'https://misskey.io/notes/9newnote';

  test('アプリが書く前は未知', () => {
    expect(askId(url)).toBeNull();
  });

  test('スナップショットを書き直すとキャッシュが無効になる', () => {
    writeSavedIndex(
      [
        { captureId: '1700000000000-aa', url: 'https://x.com/someone/status/111' },
        { captureId: '1700000011111-dd', url },
      ],
      Date.now() + 120_000,
    );

    expect(askId(url)).toBe('1700000011111-dd');
  });
});

describe('7. バッチの上限と、混ざったゴミの扱い', () => {
  test('300 件で打ち切る', () => {
    const many = Array.from({ length: 400 }, (_, i) => `https://x.com/u/status/${900000 + i}`);
    expect(Object.keys(handleQuery({ type: 'query', urls: [...many, null, 42, ''] }).results)).toHaveLength(300);
  });

  test('空のバッチは拒否せず答える', () => {
    expect(Object.keys(handleQuery({ type: 'query', urls: [] }).results)).toHaveLength(0);
  });

  test('壊れたメッセージも throw せず答える', () => {
    expect(Object.keys(handleQuery({ type: 'query' }).results)).toHaveLength(0);
  });
});

describe('8. 保存フォルダ・スナップショットが無い', () => {
  // bridge-saved-index.json lives in configDir and doesn't depend on saveFolder
  // existing (per the #299 design = a DB-derived, rebuildable snapshot is written
  // to configDir, unlike an in-saveFolder snapshot such as .index.json), so
  // records the app wrote just before this survive even if saveFolder disappears.
  test('保存フォルダが消えていても throw せず答える', () => {
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: path.join(configDir, 'gone') }));
    _resetSavedIndex();

    expect(askId('https://x.com/someone/status/111')).toBe('1700000000000-aa');
  });

  test('スナップショット自体が無ければ throw せず「保存されていない」と答える', () => {
    fs.rmSync(path.join(configDir, 'bridge-saved-index.json'), { force: true });
    fs.rmSync(path.join(configDir, 'bridge-journal.jsonl'), { force: true });
    _resetSavedIndex();

    expect(askId('https://x.com/someone/status/111')).toBeNull();
  });
});

// #334: The badge's question is per-image, not per-post = "is this particular
// picture already in the library". It's ordinary for only one image of a
// multi-image post to be saved, so the response must be able to answer down to
// the images that post's record holds.
describe('9. 保存済みの絵を投稿ごとに答える', () => {
  const url = 'https://x.com/multi/status/1234';
  const A = 'https://pbs.twimg.com/media/AAA?format=jpg&name=orig';
  const B = 'https://pbs.twimg.com/media/BBB?format=jpg&name=orig';

  beforeAll(() => {
    // Section 8 left saveFolder deleted, so restore it (reading the inbox needs it)
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));
  });

  test('スナップショットが持つ絵をそのまま返す', () => {
    // Place the snapshot "before now" = so the noteSaved journal line that follows
    // isn't discarded as "already folded into the snapshot" (the rule from section 5).
    writeSavedIndex([{ captureId: '1700000020000-e1', url, media: [A] }], Date.now() - 60_000);
    _resetSavedIndex();

    expect(askId(url)).toBe('1700000020000-e1');
    expect(askMedia(url)).toEqual([A]);
  });

  // Saving a second image becomes a separate record (not appended to the first),
  // so a post's images end up scattered across records. Reading only one shows the
  // save button on an image that's already saved.
  test('同じ投稿の2つ目のレコードの絵が合流する', () => {
    noteSaved(url, '1700000021000-e2', [{ url: B, file: 'x.jpg' }]);

    expect(askMedia(url)).toEqual([A, B]);
  });

  test('同じ絵を2度保存しても並びは増えない', () => {
    noteSaved(url, '1700000022000-e3', [{ url: A, file: 'y.jpg' }]);

    expect(askMedia(url)).toEqual([A, B]);
  });

  test('再構築後も（ジャーナル経由で）同じ答えに届く', () => {
    _resetSavedIndex();

    expect(askMedia(url)).toEqual([A, B]);
  });

  test('アプリを閉じている間に保存した投稿は inbox エンベロープが絵を運ぶ', () => {
    const other = 'https://x.com/multi/status/5678';
    writeInboxEnvelope(`${Date.now() + 240_000}-e4`, other, [{ url: B, file: 'z.jpg' }]);
    _resetSavedIndex();

    expect(askMedia(other)).toEqual([B]);
  });

  // Not knowing the images (a text-only post, an intake where every download
  // failed, a snapshot written before #334) is not the same as "no images saved".
  // An empty list = "saved, granularity unknown", and the caller should treat it
  // as the whole post.
  test('絵を持たないレコードは空の一覧（未保存ではない）', () => {
    const textOnly = 'https://x.com/plain/status/77';
    writeSavedIndex([{ captureId: '1700000023000-e5', url: textOnly }], Date.now() + 300_000);
    _resetSavedIndex();

    expect(askId(textOnly)).toBe('1700000023000-e5');
    expect(askMedia(textOnly)).toEqual([]);
  });

  test('v1 のスナップショット（captureId だけの文字列）も読める', () => {
    const legacy = 'https://x.com/legacy/status/88';
    const key = postKeyOf(legacy) as string;
    const p = path.join(configDir, 'bridge-saved-index.json');
    const mtime = new Date(Date.now() + 360_000);
    fs.writeFileSync(p, JSON.stringify({ format: 'hologram-bridge-saved-index', version: 1, generatedAt: mtime.toISOString(), entries: { [key]: '1700000024000-e6' } }), 'utf8');
    fs.utimesSync(p, mtime, mtime);
    _resetSavedIndex();

    expect(askId(legacy)).toBe('1700000024000-e6');
    expect(askMedia(legacy)).toEqual([]);
  });
});

// #158: Notice for a post whose actual file remains in the trash. Comes back in a
// map separate from the saved answer = the results side stays null (the badge must
// not light up) while it's carried in the trashed side. The snapshots the sections
// up to here have written have no trashed field, and that state reproduces "the
// app before #158" (the first test pins that down).
describe('10. ゴミ箱の告知', () => {
  const TRASHED = 'https://x.com/gone/status/501';
  const LIVE_AND_TRASHED = 'https://x.com/both/status/502';
  const askTrashed = (url: string) => handleQuery({ type: 'query', urls: [url] }).trashed?.[url] ?? null;

  // Write it explicitly = add a trashed map to the snapshot. Place mtime in the
  // future using the same method as the other sections, to reliably invalidate the cache.
  function writeIndexWithTrash(entries: Record<string, unknown>, trashed: Record<string, unknown>, offsetMs: number) {
    const p = path.join(configDir, 'bridge-saved-index.json');
    const mtime = new Date(Date.now() + offsetMs);
    fs.writeFileSync(p, JSON.stringify({ format: 'hologram-bridge-saved-index', version: 4, generatedAt: mtime.toISOString(), entries, trashed }), 'utf8');
    fs.utimesSync(p, mtime, mtime);
    _resetSavedIndex();
  }

  test('trashed マップを持たないスナップショットは「ゴミ箱に何も無い」と読む', () => {
    expect(handleQuery({ type: 'query', urls: ['https://x.com/legacy/status/88'] }).trashed).toEqual({});
  });

  test('ゴミ箱の投稿は results が null・trashed に削除日つきで載る', () => {
    writeIndexWithTrash({}, { [postKeyOf(TRASHED) as string]: { id: 'cap-gone', deletedAt: '2026-07-01T09:00:00Z' } }, 420_000);

    expect(askId(TRASHED)).toBeNull();
    expect(askTrashed(TRASHED)).toEqual({ id: 'cap-gone', deletedAt: '2026-07-01T09:00:00Z' });
  });

  // If a live record exists in the library, that's the answer. The app-side
  // builder drops it from trashed by the same rule, but the bridge side has
  // **sources the snapshot can't know about** (the journal and catching up on the
  // loose inbox), so this must be applied here too or it gets missed.
  test('保存済みが勝つ＝同じ投稿が両方に載っていても trashed には出さない', () => {
    const key = postKeyOf(LIVE_AND_TRASHED) as string;
    writeIndexWithTrash({ [key]: { id: 'cap-live', media: [] } }, { [key]: { id: 'cap-old', deletedAt: '2026-07-01T09:00:00Z' } }, 480_000);

    expect(askId(LIVE_AND_TRASHED)).toBe('cap-live');
    expect(askTrashed(LIVE_AND_TRASHED)).toBeNull();
  });

  // Via the journal (the bridge itself saved it while the app was closed) = the
  // snapshot's trashed entry doesn't know about that save. Once the saved answer
  // is added afterward, the notice disappears.
  test('スナップショット後にブリッジが保存した投稿の告知も消える', () => {
    const url = 'https://x.com/resaved/status/503';
    writeIndexWithTrash({}, { [postKeyOf(url) as string]: { id: 'cap-old', deletedAt: '2026-07-01T09:00:00Z' } }, 540_000);
    expect(askTrashed(url)).toEqual({ id: 'cap-old', deletedAt: '2026-07-01T09:00:00Z' });

    noteSaved(url, '1700000030000-f1', []);

    expect(askId(url)).toBe('1700000030000-f1');
    expect(askTrashed(url)).toBeNull();
  });

  // The snapshot wasn't written by this process = if a malformed value rides
  // straight through into the response, the extension side that renders the date
  // crashes. Pass it through type validation when reading.
  test('壊れたゴミ箱エントリは型を通してから載る', () => {
    const bad = 'https://x.com/bad/status/504';
    const worse = 'https://x.com/worse/status/505';
    writeIndexWithTrash(
      {},
      {
        [postKeyOf(bad) as string]: { id: 42, deletedAt: { nope: true } },
        [postKeyOf(worse) as string]: 'not an object',
      },
      600_000,
    );

    expect(askTrashed(bad)).toEqual({ id: '', deletedAt: null });
    expect(askTrashed(worse)).toBeNull();
  });

  test('空のバッチ・壊れたメッセージでも trashed は空で返る', () => {
    expect(handleQuery({ type: 'query', urls: [] }).trashed).toEqual({});
    expect(handleQuery({ type: 'query' }).trashed).toEqual({});
  });
});
