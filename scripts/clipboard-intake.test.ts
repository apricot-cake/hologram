// クリップボード取り込み (#85)＝Ctrl+V で貼った画像がライブラリのレコードになる経路。
//
// 実物のクリップボードには一切触らない＝`electron` を差し替えて `clipboard` を注入する。
// 実物を読むテストは、実行機で何がコピーされているかに結果が左右される。CI や同時実行
// セッションも絡むので、「通った」と「たまたま画像がコピーされていたから通った」を
// 区別できない。偽物にするのは `clipboard.availableFormats()` と `readImage()` だけ。
// 保存フォルダへの書き込み、DB への書き込み、カードの実寸の計測はすべて製品コードを
// そのまま動かす（一時的な保存フォルダと一時的な `hologram.db` を本当に作る）。
//
// #85 の受け入れ条件をそのまま並べる:
//   1. 入力欄にフォーカスがある間の Ctrl+V は通常の貼り付けとして素通しする（取り込みは発火しない）
//   2. 画像を持たないクリップボードはエラーではなくトーストで終わる
//   3. 貼った画像が一覧に出る
//
// 3 の「一覧に出る」は、ここでは `posts-changed` の送信で確かめる。アプリ内の書き込みは
// 取込キューにイベントを残さないので、レンダラーへ知らせる線はこれ1本だけ（削除・
// ipc-trash.ts と同じ）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { IpcContext } from '../app/src/main/ipc-context';

type Handler = (event: unknown, ...args: any[]) => any;

const stub = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: any[]) => any>(),
  // クリップボードの代役。`formats` が「画像を持っているか」に答え、`png` が readImage()
  // の中身、`throws` は読み取り自体の失敗（他のアプリが掴んだままのときなど）を模す。
  clip: { formats: [] as string[], png: null as Buffer | null, throws: false },
  // トーストの収集先。vi.mock のファクトリは巻き上げられるので、巻き上げた束縛しか捕まえられない。
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

// --- 実際に寸法を測れる本物の PNG ------------------------------------------------
// `fillCardDims` はヘッダを読むので、中身のあるバイト列が要る。そうでないと「計測に
// 失敗した」と区別できない。CRC は手で計算する（`zlib.crc32` はまだ新しい API で、
// ここに黙って 0 を書くと壊れた PNG になる）。
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
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 2; // カラータイプ: トゥルーカラー RGB
  const raw = Buffer.alloc(h * (1 + w * 3), 0x40);
  for (let y = 0; y < h; y++) raw[y * (1 + w * 3)] = 0; // フィルタ: なし
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

// --- 保存フォルダと DB（本物） --------------------------------------------------
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
    // captureId の接頭辞・拡張子・保存名は #85 の設計どおり（clip-... で PNG 固定）。
    expect(rec.captureId).toMatch(/^clip-\d+-\d{4}$/);
    expect(rec.image).toBe(`items/${rec.captureId}/${rec.captureId}.png`);
    expect(rec.video).toBeNull();
    expect(fs.existsSync(path.join(folder, rec.image))).toBe(true);
    expect(rec.source).toBe('clipboard');
    expect(rec.mediaType).toBe('image');
    // url が空のままであることが「取り込み画像」に分類され続ける条件（種別は url の有無から導く）。
    expect(rec.url).toBeNull();
    expect(rec.title).toBe('クリップボード 2026/7/30 12:34');
    // 貼った瞬間が date になる＝引き継ぐ元の日付が無い。
    expect(new Date(rec.date).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(new Date(rec.capturedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    // カードの高さを確保するための寸法は「書き込み時に測る」＝後から測り直す走査はもう無い。
    expect(rec.shotW).toBe(24);
    expect(rec.shotH).toBe(12);
    expect(sent).toEqual([{ channel: 'posts-changed', payload: null }]);
  });

  test('画像を持たないクリップボードは empty＝エラーではない', async () => {
    stub.clip.formats = ['text/plain'];

    expect(await importClipboard('t')).toEqual({ imported: 0, empty: true });
    expect(rows()).toHaveLength(0);
    expect(fs.readdirSync(folder)).toHaveLength(0);
    // 何も起きていないのに一覧を組み直させない。
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
    expect(fs.readdirSync(path.join(folder, 'items'))).toHaveLength(2);
  });
});

// ローカル取り込みの共通ヘルパ（#84 と共用）。入口が増えても、入口ごとにレコードの形が
// ずれないことをここで固定する。
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

  // #236: どの入口でも共通の assetClass の分岐。IMPORTABLE_MEDIA が
  // 'media'（#236 以前と変わらない形）と 'file'（posts.file を埋め、image /
  // video / mediaType はすべて null）を決める。入口ごとに黙ってずれないよう、ここで固定する。
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
    // 画像でないファイルには fillCardDims が測れるものが無い。寸法の取れない動画と同じく
    // 0/0 の番兵になる（lib-card-dims.ts の fillCardDims）。
    expect(rec.shotW).toBe(0);
    expect(rec.shotH).toBe(0);
    fs.rmSync(src, { force: true });
  });
});

// ローカル取り込みのレコードは「作品」扱い＝スクショではない。今は PNG 固定なので
// 拡張子の判定だけで除外されるが、その判定の一覧に載っていること自体がこの分類の宣言
// なので、ここで固定する。
describe('renderer: 取り込んだ画像はスクショ扱いにならない', () => {
  test('clipboard は drag / eagle-migration と同じ側', async () => {
    const { isScreenshot } = await import('../app/src/renderer/src/services/records');

    expect(isScreenshot({ image: 'clip-1-0000.jpg', source: 'clipboard' } as any)).toBe(false);
    expect(isScreenshot({ image: 'clip-1-0000.png', source: 'clipboard' } as any)).toBe(false);
    // 拡張機能から来た本物のキャプチャは今までどおり。
    expect(isScreenshot({ image: 'x-1.jpg', source: 'extension' } as any)).toBe(true);
  });
});

// #85 で一番大事な防ぎ。Ctrl+V は貼り付けのキーで、取り込みがそれを横取りしてよい場面は
// 限られる。レンダラー側は純粋な判定として書いてあるので jsdom は要らない（document を
// 見る3か所はすべて `typeof document === 'undefined'` を通す）。document を実際に見る所
// だけ、最小限のスタブを置いて確かめる（下の「ゴミ箱」のケース）。
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

  // ハンドラは同期で、取り込みは await しない Promise＝マイクロタスクを1周させてから見る。
  // 0ms はイベントループへの譲りであって時間待ちではない。すでにキューへ入ったマイクロ
  // タスクを吐き出すだけで、ここには実時間を待つものが無いので、遅い機械で「短すぎる」
  // ことにはならない。
  // biome-ignore lint/plugin: 0ms ＝マクロタスクを1つ譲るという意味で、時間を待っているのではない
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

  // ここが Issue の核心＝入力欄では貼り付けを横取りしない。
  test('INPUT にフォーカスがある間は発火しない', async () => {
    const intake = await freshIntake();
    const k = key({ key: 'v', ctrlKey: true, target: { tagName: 'INPUT' } as any });
    intake.handleShortcutClipboardKey(k.ev);
    await settle();
    expect(calls).toHaveLength(0);
    // preventDefault を呼ばない＝既定の貼り付けがそのまま動く。
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

  // ゴミ箱 (#268) は「新規保存を止める」唯一の行き先＝そこでは貼り付けが何もしない。
  // 見るのはストアの browseMode（body のクラスを覗く方式は P2-13 で止めた）。だから
  // 他の防ぎと同じく、本物のモジュールを動かして判定を確かめる。
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
      // ライブラリへ戻れば取り込みも元どおり動く＝止めているのは錠ではなく行き先。
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
