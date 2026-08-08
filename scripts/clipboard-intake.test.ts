// Clipboard intake (#85) = the path where an image pasted with Ctrl+V becomes a library record.
//
// **Never touches the real clipboard** = swaps out `electron` and injects `clipboard`. A test
// that reads the real clipboard would have its result depend on whatever's copied on the
// runner's machine, plus CI and concurrent sessions = you couldn't tell "it passed" apart from
// "it passed because an image happened to be copied". Only `clipboard.availableFormats()` /
// `readImage()` are faked; writing to the save folder, writing to the DB, and measuring the
// card's actual dimensions all run the real product code (it genuinely creates a temp save
// folder and a temp `hologram.db`).
//
// #85's acceptance criteria are laid out here as-is:
//   1. Ctrl+V while an input field is focused passes through as a normal paste (intake doesn't fire)
//   2. A clipboard with no image ends in a toast, not an error
//   3. The pasted image shows up in the list
//
// #3's "shows up in the list" is checked here via the `posts-changed` send = in-app writes
// don't leave an event in the intake queue, so this is the only line that notifies the
// renderer (same as deletion / ipc-trash.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { IpcContext } from '../app/src/main/ipc-context';

type Handler = (event: unknown, ...args: any[]) => any;

const stub = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: any[]) => any>(),
  // Clipboard stand-in. `formats` answers "does it have an image", `png` is readImage()'s
  // contents, `throws` simulates the read itself failing (e.g. another app still holding it).
  clip: { formats: [] as string[], png: null as Buffer | null, throws: false },
  // Toast collector. vi.mock's factory is hoisted, so only a hoisted binding can be captured by it.
  toasts: [] as string[],
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      stub.handlers.set(channel, handler);
    },
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true }),
    showSaveDialog: async () => ({ canceled: true }),
  },
  clipboard: {
    availableFormats: () => stub.clip.formats,
    readImage: () => {
      if (stub.clip.throws) throw new Error('clipboard busy');
      return { isEmpty: () => !stub.clip.png, toPNG: () => stub.clip.png as Buffer };
    },
  },
  app: { getVersion: () => '0.0.0-test' },
}));

vi.mock('sonner', () => ({
  toast: (msg: string) => {
    stub.toasts.push(String(msg));
  },
}));

import { openDatabase } from '../app/src/main/lib-db';
import { register as registerTransferIpc } from '../app/src/main/ipc-transfer';

// --- A real PNG whose dimensions can actually be measured ------------------------------------------------
// `fillCardDims` reads the header, so it needs a byte sequence with real content — otherwise you
// can't tell it apart from "measurement failed". CRC is computed by hand (`zlib.crc32` is still
// a newer API, and silently writing 0 here would produce a broken PNG).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function makePng(w: number, h: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const raw = Buffer.alloc(h * (1 + w * 3), 0x40);
  for (let y = 0; y < h; y++) raw[y * (1 + w * 3)] = 0; // filter: none
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

// --- Save folder and DB (real) --------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-clip-'));
const folder = path.join(dir, 'library');
fs.mkdirSync(folder, { recursive: true });
const { sqlite } = openDatabase(path.join(dir, 'test.db'));

let saveFolder: string | null = folder;
const sent: Array<{ channel: string; payload: unknown }> = [];

const ctx = {
  getSaveFolder: () => saveFolder,
  getTrashDir: () => null,
  getLibraryStatus: () => ({ missing: false, path: saveFolder }),
  ensurePostsSynced: () => (saveFolder ? { db: null, sqlite } : null),
  send: (channel: string, payload: unknown) => {
    sent.push({ channel, payload });
  },
  getWin: () => null,
} as unknown as IpcContext;

registerTransferIpc(ctx);

const importClipboard = (title?: unknown) => stub.handlers.get('import-clipboard')?.(null, title);
const rows = () => sqlite.prepare('SELECT captureId, source, url, title, image, video, file, assetClass, mediaType, date, capturedAt, shotW, shotH FROM posts').all() as any[];

function resetLibrary() {
  saveFolder = folder;
  stub.clip.formats = [];
  stub.clip.png = null;
  stub.clip.throws = false;
  stub.toasts.length = 0;
  sent.length = 0;
  sqlite.exec('DELETE FROM posts');
  for (const f of fs.readdirSync(folder)) fs.rmSync(path.join(folder, f), { recursive: true, force: true });
}

afterAll(() => {
  sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('main: import-clipboard', () => {
  beforeEach(resetLibrary);

  test('画像を貼るとファイルとレコードが1件ずつ増え、posts-changed が飛ぶ', async () => {
    stub.clip.formats = ['image/png', 'text/html'];
    stub.clip.png = makePng(24, 12);

    const before = Date.now();
    const res = await importClipboard('クリップボード 2026/7/30 12:34');
    expect(res).toEqual({ imported: 1 });

    const all = rows();
    expect(all).toHaveLength(1);
    const rec = all[0];
    // The captureId prefix, extension, and saved file name follow #85's design (clip-..., PNG fixed).
    expect(rec.captureId).toMatch(/^clip-\d+-\d{4}$/);
    expect(rec.image).toBe(`${rec.captureId}.png`);
    expect(rec.video).toBeNull();
    expect(fs.existsSync(path.join(folder, rec.image))).toBe(true);
    expect(rec.source).toBe('clipboard');
    expect(rec.mediaType).toBe('image');
    // url staying unset is the condition that keeps it classified as an "imported image" (kind is derived from whether url is present).
    expect(rec.url).toBeNull();
    expect(rec.title).toBe('クリップボード 2026/7/30 12:34');
    // The moment it's pasted is the date = there's no original date to carry over.
    expect(new Date(rec.date).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(new Date(rec.capturedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    // The dimensions used to reserve card height are "measured at write time" = there's no later re-measuring scan anymore.
    expect(rec.shotW).toBe(24);
    expect(rec.shotH).toBe(12);
    expect(sent).toEqual([{ channel: 'posts-changed', payload: null }]);
  });

  test('画像を持たないクリップボードは empty＝エラーではない', async () => {
    stub.clip.formats = ['text/plain'];

    expect(await importClipboard('t')).toEqual({ imported: 0, empty: true });
    expect(rows()).toHaveLength(0);
    expect(fs.readdirSync(folder)).toHaveLength(0);
    // Don't force the list to be rebuilt when nothing happened.
    expect(sent).toHaveLength(0);
  });

  test('image/* を名乗るのに中身が空でも empty で終わる', async () => {
    stub.clip.formats = ['image/png'];

    expect(await importClipboard('t')).toEqual({ imported: 0, empty: true });
    expect(rows()).toHaveLength(0);
  });

  test('クリップボードの読み取りが失敗しても例外を投げない', async () => {
    stub.clip.formats = ['image/png'];
    stub.clip.throws = true;

    expect(await importClipboard('t')).toEqual({ imported: 0, empty: true });
    expect(rows()).toHaveLength(0);
  });

  test('見出しが空なら title は null（空文字のカードを作らない）', async () => {
    stub.clip.formats = ['image/png'];
    stub.clip.png = makePng(8, 8);

    await importClipboard('   ');
    expect(rows()[0].title).toBeNull();
  });

  test('保存先が無ければ書かずに no-folder', async () => {
    saveFolder = null;
    stub.clip.formats = ['image/png'];
    stub.clip.png = makePng(8, 8);

    expect(await importClipboard('t')).toEqual({ imported: 0, error: 'no-folder' });
    expect(rows()).toHaveLength(0);
  });

  test('続けて貼っても captureId がぶつからない', async () => {
    stub.clip.formats = ['image/png'];
    stub.clip.png = makePng(8, 8);
    await importClipboard('a');
    await importClipboard('b');

    expect(new Set(rows().map((r) => r.captureId)).size).toBe(2);
    expect(fs.readdirSync(folder)).toHaveLength(2);
  });
});

// Shared helper for local intake (shared with #84). Pins down here that the record shape
// doesn't drift between different entry points as they get added.
describe('main: 共通ヘルパ（lib-local-intake）', () => {
  beforeEach(resetLibrary);

  test('監視フォルダ／ドロップが乗る形＝ファイルのコピー＋元の日付を date に持てる', async () => {
    const { importLocalFile } = await import('../app/src/main/lib-local-intake');
    const src = path.join(dir, 'source.png');
    fs.writeFileSync(src, makePng(16, 32));

    const out = await importLocalFile({
      folder,
      sqlite,
      source: 'watch',
      idPrefix: 'watch',
      ext: 'png',
      srcPath: src,
      title: 'source',
      date: '2020-01-02T03:04:05.000Z',
    });

    expect(out.captureId).toMatch(/^watch-/);
    const rec = rows()[0];
    expect(rec.source).toBe('watch');
    expect(rec.date).toBe('2020-01-02T03:04:05.000Z');
    expect(rec.url).toBeNull();
    expect(rec.shotW).toBe(16);
    expect(fs.existsSync(path.join(folder, out.file))).toBe(true);
    fs.rmSync(src, { force: true });
  });

  test('動画の拡張子は video 側に入る（image を動画ファイル名で埋めない）', async () => {
    const { buildLocalRecord } = await import('../app/src/main/lib-local-intake');
    const rec = buildLocalRecord({ captureId: 'watch-1-0000', file: 'watch-1-0000.mp4', ext: 'mp4', source: 'watch', title: null });

    expect(rec.mediaType).toBe('video');
    expect(rec.video).toBe('watch-1-0000.mp4');
    expect(rec.image).toBeNull();
  });

  test('バイト列もファイルも渡されない呼び出しは断り、何も残さない', async () => {
    const { importLocalFile } = await import('../app/src/main/lib-local-intake');
    await expect(importLocalFile({ folder, sqlite, source: 'watch', idPrefix: 'watch', ext: 'png', title: null })).rejects.toThrow();
    expect(rows()).toHaveLength(0);
    expect(fs.readdirSync(folder)).toHaveLength(0);
  });

  // #236: the assetClass branch every door shares — IMPORTABLE_MEDIA decides
  // 'media' (unchanged pre-#236 shape) vs 'file' (posts.file filled, image/
  // video/mediaType all null). Fixed here so it can't silently drift per door.
  test('IMPORTABLE_MEDIA 外の拡張子は assetClass:file＝file 列に入り image/video/mediaType は null', async () => {
    const { buildLocalRecord } = await import('../app/src/main/lib-local-intake');
    const rec = buildLocalRecord({ captureId: 'drag-1-0000', file: 'drag-1-0000.pdf', ext: 'pdf', source: 'drag', title: 'report' });

    expect(rec.assetClass).toBe('file');
    expect(rec.file).toBe('drag-1-0000.pdf');
    expect(rec.image).toBeNull();
    expect(rec.video).toBeNull();
    expect(rec.mediaType).toBeNull();
  });

  test('IMPORTABLE_MEDIA 内の拡張子は assetClass:media のまま＝file 列は null', async () => {
    const { buildLocalRecord } = await import('../app/src/main/lib-local-intake');
    const rec = buildLocalRecord({ captureId: 'drag-1-0000', file: 'drag-1-0000.png', ext: 'png', source: 'drag', title: null });

    expect(rec.assetClass).toBe('media');
    expect(rec.file).toBeNull();
    expect(rec.image).toBe('drag-1-0000.png');
  });

  test('収蔵ファイル（PDF）は importLocalFile を通しても assetClass:file で DB に残る', async () => {
    const { importLocalFile } = await import('../app/src/main/lib-local-intake');
    const src = path.join(dir, 'doc.pdf');
    fs.writeFileSync(src, Buffer.from('%PDF-1.4\n%fake'));

    const out = await importLocalFile({ folder, sqlite, source: 'drag', idPrefix: 'drag', ext: 'pdf', srcPath: src, title: 'doc' });

    const rec = rows()[0];
    expect(rec.assetClass).toBe('file');
    expect(rec.file).toBe(out.file);
    expect(rec.image).toBeNull();
    expect(rec.video).toBeNull();
    // A non-image file has nothing fillCardDims can measure — the 0/0 sentinel,
    // same as an unsizable video (lib-card-dims.ts's fillCardDims).
    expect(rec.shotW).toBe(0);
    expect(rec.shotH).toBe(0);
    fs.rmSync(src, { force: true });
  });
});

// A local-intake record is treated as "artwork" = not a screenshot. Right now with PNG fixed,
// it's excluded by the extension check alone, but being on that check list is itself the
// declaration of this classification, so it's pinned down here.
describe('renderer: 取り込んだ画像はスクショ扱いにならない', () => {
  test('clipboard は drag / eagle-migration と同じ側', async () => {
    const { isScreenshot } = await import('../app/src/renderer/src/services/records');

    expect(isScreenshot({ image: 'clip-1-0000.jpg', source: 'clipboard' } as any)).toBe(false);
    expect(isScreenshot({ image: 'clip-1-0000.png', source: 'clipboard' } as any)).toBe(false);
    // A real capture that came in via the extension behaves as before.
    expect(isScreenshot({ image: 'x-1.jpg', source: 'extension' } as any)).toBe(true);
  });
});

// #85's most important guard. Ctrl+V is the key for paste, and there are only limited cases
// where intake is allowed to hijack it. The renderer side is written as a pure check, so jsdom
// isn't needed (all 3 places that look at document go through `typeof document === 'undefined'`).
// Only the places that do look at document get a minimal stub to verify (the "trash" case below).
describe('renderer: Ctrl+V の判定', () => {
  const calls: string[] = [];
  let answer: any = { imported: 1 };

  beforeEach(() => {
    calls.length = 0;
    answer = { imported: 1 };
    stub.toasts.length = 0;
    (globalThis as any).window = {
      hologram: {
        getPrefs: async () => ({ language: 'ja' }),
        importClipboard: async (title: string) => {
          calls.push(title);
          return answer;
        },
      },
    };
    vi.resetModules();
  });

  afterEach(() => {
    (globalThis as any).window = undefined;
  });

  type IntakeModule = typeof import('../app/src/renderer/src/services/clipboard-intake');
  const freshIntake = async (): Promise<IntakeModule> => {
    const i18n = await import('../app/src/renderer/src/_shared/i18n');
    await i18n.initI18n();
    return import('../app/src/renderer/src/services/clipboard-intake');
  };

  const key = (init: Partial<KeyboardEvent> & { key: string }) => {
    let prevented = false;
    return {
      ev: { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: null, preventDefault: () => void (prevented = true), ...init } as unknown as KeyboardEvent,
      wasPrevented: () => prevented,
    };
  };

  // The handler is synchronous, and intake is a Promise it doesn't await = check after letting a microtask cycle pass.
  // 0ms is a yield to the event loop, not a timed wait: it flushes the already-queued microtasks
  // and cannot be "too short" on a slow machine, since nothing here waits on real elapsed time.
  // biome-ignore lint/plugin: 0ms = yield one macrotask, not a timed wait
  const settle = () => new Promise((r) => setTimeout(r, 0));

  test('Ctrl+V で取り込む＝見出しに日時が入る', async () => {
    const intake = await freshIntake();
    const k = key({ key: 'v', ctrlKey: true });
    intake.handleShortcutClipboardKey(k.ev);
    await settle();

    expect(k.wasPrevented()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^クリップボード .+/);
    expect(stub.toasts).toEqual(['クリップボードから取り込みました']);
  });

  test('大文字で届いても同じ（Caps Lock）', async () => {
    const intake = await freshIntake();
    intake.handleShortcutClipboardKey(key({ key: 'V', ctrlKey: true }).ev);
    await settle();
    expect(calls).toHaveLength(1);
  });

  // This is the core of the Issue = don't hijack paste in an input field.
  test('INPUT にフォーカスがある間は発火しない', async () => {
    const intake = await freshIntake();
    const k = key({ key: 'v', ctrlKey: true, target: { tagName: 'INPUT' } as any });
    intake.handleShortcutClipboardKey(k.ev);
    await settle();
    expect(calls).toHaveLength(0);
    // preventDefault isn't called = the default paste runs as-is.
    expect(k.wasPrevented()).toBe(false);
  });

  test('TEXTAREA も同じ', async () => {
    const intake = await freshIntake();
    const k = key({ key: 'v', ctrlKey: true, target: { tagName: 'TEXTAREA' } as any });
    intake.handleShortcutClipboardKey(k.ev);
    await settle();
    expect(calls).toHaveLength(0);
    expect(k.wasPrevented()).toBe(false);
  });

  test('contentEditable も同じ', async () => {
    const intake = await freshIntake();
    const k = key({ key: 'v', ctrlKey: true, target: { tagName: 'DIV', isContentEditable: true } as any });
    intake.handleShortcutClipboardKey(k.ev);
    await settle();
    expect(calls).toHaveLength(0);
    expect(k.wasPrevented()).toBe(false);
  });

  test('Ctrl+Shift+V（書式なし貼り付け）には手を出さない', async () => {
    const intake = await freshIntake();
    const k = key({ key: 'v', ctrlKey: true, shiftKey: true });
    intake.handleShortcutClipboardKey(k.ev);
    await settle();
    expect(calls).toHaveLength(0);
    expect(k.wasPrevented()).toBe(false);
  });

  test('Alt が乗っていたら無視する', async () => {
    const intake = await freshIntake();
    intake.handleShortcutClipboardKey(key({ key: 'v', ctrlKey: true, altKey: true }).ev);
    await settle();
    expect(calls).toHaveLength(0);
  });

  test('修飾なしの V はただの文字', async () => {
    const intake = await freshIntake();
    intake.handleShortcutClipboardKey(key({ key: 'v' }).ev);
    await settle();
    expect(calls).toHaveLength(0);
  });

  test('クイックビューが出ている間は発火しない', async () => {
    const intake = await freshIntake();
    const lightbox = await import('../app/src/renderer/src/services/lightbox');
    lightbox.open({ src: 'asset://a.png' } as any);
    const k = key({ key: 'v', ctrlKey: true });
    intake.handleShortcutClipboardKey(k.ev);
    await settle();
    expect(calls).toHaveLength(0);
    expect(k.wasPrevented()).toBe(false);
    lightbox.close();
  });

  // Trash (#268) is the only destination that "disables new saves" = paste does nothing there.
  // What's checked is the store's browseMode (peeking at the body class was dropped in P2-13),
  // so this runs the real module and verifies the check, just like the other guards.
  test('ゴミ箱を開いている間は発火しない', async () => {
    const intake = await freshIntake();
    const store = await import('../app/src/renderer/src/services/store');
    store.store.setState({ browseMode: 'trash' });
    try {
      const k = key({ key: 'v', ctrlKey: true });
      intake.handleShortcutClipboardKey(k.ev);
      await settle();
      expect(calls).toHaveLength(0);
      expect(k.wasPrevented()).toBe(false);
      // Going back to the library resumes intake as before = what blocks it is the destination, not a lock.
      store.store.setState({ browseMode: 'posts' });
      intake.handleShortcutClipboardKey(key({ key: 'v', ctrlKey: true }).ev);
      await settle();
      expect(calls).toHaveLength(1);
    } finally {
      store.store.setState({ browseMode: 'posts' });
    }
  });

  test('コマンドパレットが開いている間は発火しない', async () => {
    const intake = await freshIntake();
    const palette = await import('../app/src/renderer/src/services/command-registry');
    palette.open();
    intake.handleShortcutClipboardKey(key({ key: 'v', ctrlKey: true }).ev);
    await settle();
    expect(calls).toHaveLength(0);
    palette.close();
  });

  test('画像が無いときはエラーでなく案内のトースト', async () => {
    answer = { imported: 0, empty: true };
    const intake = await freshIntake();
    await intake.importFromClipboard();
    expect(stub.toasts).toEqual(['クリップボードに画像がありません']);
  });

  test('取込に失敗したときだけ失敗のトースト', async () => {
    answer = { imported: 0, error: 'no-folder' };
    const intake = await freshIntake();
    await intake.importFromClipboard();
    expect(stub.toasts).toEqual(['インポートに失敗しました']);
  });
});
