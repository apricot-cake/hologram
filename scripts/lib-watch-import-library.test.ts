// app/src/main/lib-watch-import.ts への #176 の追加ぶんの単体テスト＝「取り込み済み」
// の台帳（watch-import-state.json）が、見張っているフォルダごとだけでなくライブラリ
// ごとに分かれるようになった。これが無いと、ライブラリ A を開いている間に取り込んだ
// ファイルは、ライブラリ B へ切り替えたあと二度と取り込めない（さらに悪いことに、A へ
// 戻しても黙って飛ばされ続ける）。
//
// importLocalFile と ensureLibraryId はモックする。lib-watch-import.ts 自身の帳簿付けに
// 絞った単体テストのままにするため＝importLocalFile の実際のレコード書き込みと、
// ensureLibraryId の実際の DB の身元の発行には、別のところに担当がある
// （lib-local-intake / backup-destination.test.ts）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const imported: Array<{ libraryId: string; file: string }> = [];

vi.mock('../app/src/main/native-host.ts', () => ({
  configDir: () => stateDir,
}));

vi.mock('../app/src/main/lib-local-intake.ts', () => ({
  importLocalFile: vi.fn(async ({ sqlite, srcPath }: any) => {
    imported.push({ libraryId: sqlite.__libraryId, file: path.basename(srcPath) });
    return { captureId: 'watch-test' };
  }),
}));

vi.mock('../app/src/main/lib-db-write.ts', () => ({
  ensureLibraryId: (sqlite: any) => sqlite.__libraryId,
}));

let stateDir: string;
let watchDir: string;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-watch-config-'));
  watchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-watch-folder-'));
  imported.length = 0;
});

afterEach(() => {
  for (const d of [stateDir, watchDir]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* できる範囲での片付け */
    }
  }
  vi.resetModules();
});

// マネージャ内部のキュー投入の連鎖が落ち着くのを待つ。本物の呼び出し元（index.ts）が
// 聞いている 'intake-imported' の通知をそのまま使う。
function waitForImport(deps: { send: any }) {
  return new Promise<void>((resolve) => {
    deps.send.mockImplementationOnce(() => resolve());
  });
}

describe('#176: watch-import の「見た覚えがある」はライブラリごと', () => {
  test('同じファイルはライブラリが違えばもう一度取り込まれ、同じライブラリでは取り込み直さない', async () => {
    const { createWatchImportManager } = await import('../app/src/main/lib-watch-import');
    const file = path.join(watchDir, 'photo.jpg');
    fs.writeFileSync(file, 'not real image bytes, only existence/size matter here');

    let currentLibrary = { __libraryId: 'library-a' };
    const send = vi.fn();
    const manager = createWatchImportManager({
      readConfig: () => ({ watchImport: { folders: [{ path: watchDir, enabled: true }] } }),
      writeConfig: () => {},
      getSaveFolder: () => '/fake/save-folder',
      isLibraryMissing: () => false,
      ensurePostsSynced: () => ({ sqlite: currentLibrary }) as any,
      send,
    });

    // 1回目の refresh（ライブラリ A）＝ファイルは新しく、1回取り込まれる。
    let done = waitForImport({ send });
    await manager.refresh();
    await done;
    expect(imported).toEqual([{ libraryId: 'library-a', file: 'photo.jpg' }]);

    // 同じライブラリに対する2回目の refresh は取り込み直してはいけない＝#176 より前から
    // ある普通の「見た覚えがある」の振る舞いで、今も壊れていない。
    send.mockClear();
    await manager.refresh();
    // 起きないこと（2回目の取り込みが無いこと）を示す＝待って確かめられる後条件が無いので、
    // この時間は意図して使っている。要らないキュー投入が表に出るだけの長さが要る。
    // biome-ignore lint/plugin: この時間の窓が検証そのもの＝「何も起きなかった」ことを待っている
    await new Promise((r) => setTimeout(r, 50));
    expect(imported).toHaveLength(1);
    expect(send).not.toHaveBeenCalledWith('intake-imported', expect.anything());

    // ライブラリ B へ切り替える（#176: DB が違えば libraryId も違う）＝同じファイルを
    // また取り込めなければならない。「取り込み済み」とは「今開いているライブラリへ
    // 取り込み済み」という意味だから。
    currentLibrary = { __libraryId: 'library-b' };
    done = waitForImport({ send });
    await manager.refresh();
    await done;
    expect(imported).toEqual([
      { libraryId: 'library-a', file: 'photo.jpg' },
      { libraryId: 'library-b', file: 'photo.jpg' },
    ]);

    // ライブラリ A へ戻したときも取り込み直してはいけない＝A 自身の台帳のエントリは、
    // B を経由して戻ってくる間も手つかずで残っている。
    currentLibrary = { __libraryId: 'library-a' };
    send.mockClear();
    await manager.refresh();
    // 上と同じく起きないことの確認＝A の台帳のエントリが今も取り込みを抑えているはず。
    // biome-ignore lint/plugin: この時間の窓が検証そのもの＝「何も起きなかった」ことを待っている
    await new Promise((r) => setTimeout(r, 50));
    expect(imported).toHaveLength(2);
  });

  test('markExisting（setFolders）が取り込み済みの印を付けるのは、今のライブラリに対してだけ', async () => {
    const { createWatchImportManager } = await import('../app/src/main/lib-watch-import');
    const file = path.join(watchDir, 'existing.jpg');
    fs.writeFileSync(file, 'pre-existing file the user says is already accounted for');

    let currentLibrary = { __libraryId: 'library-a' };
    let cfg: any = { watchImport: { folders: [] } };
    const send = vi.fn();
    const manager = createWatchImportManager({
      readConfig: () => cfg,
      writeConfig: (next: any) => {
        cfg = next;
      },
      getSaveFolder: () => '/fake/save-folder',
      isLibraryMissing: () => false,
      ensurePostsSynced: () => ({ sqlite: currentLibrary }) as any,
      send,
    });

    await manager.setFolders([{ path: watchDir, enabled: true }], [watchDir]);
    expect(imported).toHaveLength(0); // markExisting は決して取り込まない

    // ライブラリ A はこれを既知として扱う＝refresh しても取り込んではいけない。
    await manager.refresh();
    // ここも起きないことの確認＝markExisting は、このファイルがライブラリ A のキューへ入るのを止め続ける。
    // biome-ignore lint/plugin: この時間の窓が検証そのもの＝「何も起きなかった」ことを待っている
    await new Promise((r) => setTimeout(r, 50));
    expect(imported).toHaveLength(0);

    // ライブラリ B にはその記録が無い＝同じファイルでも B にとっては新しい。
    currentLibrary = { __libraryId: 'library-b' };
    const done = waitForImport({ send });
    await manager.refresh();
    await done;
    expect(imported).toEqual([{ libraryId: 'library-b', file: 'existing.jpg' }]);
  });
});
