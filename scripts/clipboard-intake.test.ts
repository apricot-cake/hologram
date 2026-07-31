// クリップボード取込（#85）＝Ctrl+V で貼った画像がライブラリのレコードになる経路。
//
// **実クリップボードは一切触らない**＝`electron` を差し替えて `clipboard` を注入する。
// 本物を読むテストは、走らせた人の手元のコピー内容とCI・並行セッションに結果が左右される
// ＝「緑だったのはたまたま画像がコピーされていたから」と区別が付かなくなる。偽物にするのは
// `clipboard.availableFormats()` / `readImage()` の2つだけで、保存先への書き込み・DB への
// 書き込み・カード実寸の計測は製品コードがそのまま走る（テンポラリの保存先とテンポラリの
// `hologram.db` を本当に作る）。
//
// #85 の受け入れ条件をそのまま並べてある:
//   ①入力欄にフォーカスがある Ctrl+V が通常の貼り付けとして通る（取込が発火しない）
//   ②画像を持たないクリップボードがエラーでなくトーストで終わる
//   ③貼った画像が一覧へ出る
//
// ③の「一覧へ出る」をここでは `posts-changed` の送信で見る＝アプリ内書き込みは取込キューの
// イベントを残さないので、レンダラへ知らせる線はこの1本しかない（削除・ipc-trash.ts と同じ）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { IpcContext } from '../app/src/main/ipc-context';

type Handler = (event: unknown, ...args: any[]) => any;

const stub = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: any[]) => any>(),
  // クリップボードの代役。`formats` が「画像を持っているか」の答え、`png` が readImage() の
  // 中身、`throws` は読み取り自体が失敗する状況（他アプリが掴んだまま等）。
  clip: { formats: [] as string[], png: null as Buffer | null, throws: false },
  // トーストの受け皿。vi.mock のファクトリは巻き上げられるので、hoisted な束縛でないと掴めない。
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

// --- 実寸が測れる本物の PNG ------------------------------------------------
// `fillCardDims` がヘッダを読むので、中身のあるバイト列でないと「測れなかった」と区別が
// 付かない。CRC は自前で計算する（`zlib.crc32` はまだ新しい API で、ここが黙って 0 を
// 書くと PNG として壊れる）。
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

// --- 保存先と DB（本物）--------------------------------------------------
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
const rows = () => sqlite.prepare('SELECT captureId, source, url, title, image, video, mediaType, date, capturedAt, shotW, shotH FROM posts').all() as any[];

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
    // captureId の接頭辞・拡張子・保存ファイル名は #85 の設計どおり（clip-…・PNG 固定）。
    expect(rec.captureId).toMatch(/^clip-\d+-\d{4}$/);
    expect(rec.image).toBe(`${rec.captureId}.png`);
    expect(rec.video).toBeNull();
    expect(fs.existsSync(path.join(folder, rec.image))).toBe(true);
    expect(rec.source).toBe('clipboard');
    expect(rec.mediaType).toBe('image');
    // url が立たないことが「取り込み画像」であり続ける条件（kind は url の有無から導出される）。
    expect(rec.url).toBeNull();
    expect(rec.title).toBe('クリップボード 2026/7/30 12:34');
    // 貼った瞬間が date＝持ち込める元の日付が無い。
    expect(new Date(rec.date).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(new Date(rec.capturedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    // カード高さの確保に使う実寸は「書いた時に測る」＝あとから測り直す走査はもう無い。
    expect(rec.shotW).toBe(24);
    expect(rec.shotH).toBe(12);
    expect(sent).toEqual([{ channel: 'posts-changed', payload: null }]);
  });

  test('画像を持たないクリップボードは empty＝エラーではない', async () => {
    stub.clip.formats = ['text/plain'];

    expect(await importClipboard('t')).toEqual({ imported: 0, empty: true });
    expect(rows()).toHaveLength(0);
    expect(fs.readdirSync(folder)).toHaveLength(0);
    // 何も起きていないのに一覧を作り直させない。
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

// ローカル取込の共通ヘルパ（#84 と共有）。別の入口が乗る時にレコードの形が入口ごとに
// ずれないことをここで固定する。
describe('main: 共通ヘルパ（lib-local-intake）', () => {
  beforeEach(resetLibrary);

  test('監視フォルダ／ドロップが乗る形＝ファイルのコピー＋元の日付を date に持てる', async () => {
    const { importLocalImage } = await import('../app/src/main/lib-local-intake');
    const src = path.join(dir, 'source.png');
    fs.writeFileSync(src, makePng(16, 32));

    const out = await importLocalImage({
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
    const { importLocalImage } = await import('../app/src/main/lib-local-intake');
    await expect(importLocalImage({ folder, sqlite, source: 'watch', idPrefix: 'watch', ext: 'png', title: null })).rejects.toThrow();
    expect(rows()).toHaveLength(0);
    expect(fs.readdirSync(folder)).toHaveLength(0);
  });
});

// ローカル取込のレコードは「作画」扱い＝スクショではない。PNG 固定の今は拡張子の判定だけで
// 除外されるが、判定リストに載っていること自体がこの区分の宣言なので固定しておく。
describe('renderer: 取り込んだ画像はスクショ扱いにならない', () => {
  test('clipboard は drag / eagle-migration と同じ側', async () => {
    const { isScreenshot } = await import('../app/src/renderer/src/services/records');

    expect(isScreenshot({ image: 'clip-1-0000.jpg', source: 'clipboard' } as any)).toBe(false);
    expect(isScreenshot({ image: 'clip-1-0000.png', source: 'clipboard' } as any)).toBe(false);
    // 拡張から入った本物のキャプチャは今までどおり。
    expect(isScreenshot({ image: 'x-1.jpg', source: 'extension' } as any)).toBe(true);
  });
});

// #85 の最重要ガード。Ctrl+V は貼り付けのキーであって、取込が横取りしてよい場面は限られる。
// レンダラ側は純判定として書いてあるので jsdom は要らない（document を見る3か所は
// どれも `typeof document === 'undefined'` を通る）。document を見る側だけは最小の
// スタブを置いて確かめる（下の「ゴミ箱」）。
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

  // ハンドラは同期で、取込は待たない Promise＝マイクロタスクを1周させてから見る。
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

  // ここが本 Issue の核＝入力欄の貼り付けを横取りしない。
  test('INPUT にフォーカスがある間は発火しない', async () => {
    const intake = await freshIntake();
    const k = key({ key: 'v', ctrlKey: true, target: { tagName: 'INPUT' } as any });
    intake.handleShortcutClipboardKey(k.ev);
    await settle();
    expect(calls).toHaveLength(0);
    // preventDefault を呼ばない＝既定の貼り付けがそのまま走る。
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

  // ゴミ箱（#268）は「新規保存を無効」にする唯一の行き先＝貼り付けはそこでは何もしない。
  // 見ているのは store の browseMode（P2⑬で body クラスの覗き見をやめた）ので、他の
  // ガードと同じく本物のモジュールを動かして判定を確かめる。
  test('ゴミ箱を開いている間は発火しない', async () => {
    const intake = await freshIntake();
    const store = await import('../app/src/renderer/src/services/store');
    store.set('browseMode', 'trash');
    try {
      const k = key({ key: 'v', ctrlKey: true });
      intake.handleShortcutClipboardKey(k.ev);
      await settle();
      expect(calls).toHaveLength(0);
      expect(k.wasPrevented()).toBe(false);
      // ライブラリへ戻れば元どおり取り込む＝止めているのは行き先であって鍵ではない。
      store.set('browseMode', 'posts');
      intake.handleShortcutClipboardKey(key({ key: 'v', ctrlKey: true }).ev);
      await settle();
      expect(calls).toHaveLength(1);
    } finally {
      store.set('browseMode', 'posts');
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
